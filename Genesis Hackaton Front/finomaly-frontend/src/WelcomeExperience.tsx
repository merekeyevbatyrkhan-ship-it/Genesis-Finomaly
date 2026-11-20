import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import markUrl from './assets/brand/finomaly-mark.svg'
import './WelcomeExperience.css'

const STORAGE_KEY = 'finomaly.welcome.v2'
const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const SCENE_TIME = 5000

function reducedMotion() {
  return typeof window === 'undefined' || window.matchMedia(MOTION_QUERY).matches
}

function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(MOTION_QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function getVisit() {
  if (typeof window === 'undefined') return { complete: true, repeat: true, restored: true }
  let previous: string | null = null
  try { previous = localStorage.getItem(STORAGE_KEY) } catch { /* В приватном режиме хранилище может быть закрыто. */ }
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  return { complete: previous === 'complete', repeat: Boolean(previous), restored: navigation?.type === 'back_forward' }
}

function saveVisit(status: 'seen' | 'complete') {
  try { localStorage.setItem(STORAGE_KEY, status) } catch { /* Сайт доступен и без сохранения настроек. */ }
}

// Маленький словарь пиктограмм используется только в заставке и обучающем плеере.
const glyphs = {
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6-6-6 6 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  pause: 'M8 5v14m8-14v14',
  play: 'm7 4 12 8-12 8z',
  check: 'm4 12 5 5L20 6',
  book: 'M5 3h12l3 3v15H5zM8 9h9m-9 4h9m-9 4h6',
} as const

function Glyph({ name }: { name: keyof typeof glyphs }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={glyphs[name]} />
    </svg>
  )
}

function LoadingSignal() {
  return (
    <svg className="welcome-signal" viewBox="0 0 360 86" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="welcome-pulse"><stop stopColor="#7056fc" /><stop offset=".64" stopColor="#b5a5ff" /><stop offset="1" stopColor="#58dbef" /></linearGradient>
      </defs>
      <path d="M0 62h360M0 38h360M0 14h360" stroke="currentColor" strokeOpacity=".1" strokeDasharray="2 5" />
      <path d="M5 62h73c24 0 31-6 51-6 18 0 24 7 34 7 21 0 24-16 48-16h42l15-3 15 3h72" stroke="url(#welcome-pulse)" strokeWidth="2" />
      <path d="M216 13v33" stroke="#7de4ef" strokeDasharray="2 4" opacity=".55" />
      <circle cx="216" cy="12" r="10" stroke="#83e1ef" opacity=".22" />
      <circle cx="216" cy="12" r="3.5" fill="#a0f3ff" />
    </svg>
  )
}

type InitialPhase = 'loader' | 'before-tour' | 'tour' | 'closed'

function BootSequence({ repeat, onDone, onSkip }: { repeat: boolean; onDone: () => void; onSkip: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const meter = useRef<HTMLDivElement>(null)
  const counter = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const node = dialog.current!
    node.showModal()
    node.focus({ preventScroll: true })
    return () => node.close()
  }, [])

  useEffect(() => {
    const node = dialog.current!
    const fromDialog = <T extends Element>(selector: string) => node.querySelectorAll<T>(selector)
    let stopped = false
    let finished = false
    let opening: GSAPTimeline | undefined
    let closing: GSAPTimeline | undefined
    let tasksDone = 0
    let observedResources = 0
    let timelineReady = false
    let assetsReady = false
    let lastValue = -1
    let observer: PerformanceObserver | undefined
    let reveal = () => {}
    const clock = { fraction: 0 }
    const duration = repeat ? .8 : 2.52
    const writeProgress = () => {
      if (stopped || finished) return
      const measured = .9 * tasksDone / 3 + .1 * Math.min(1, observedResources / 4)
      const value = Math.min(99, Math.round((.73 * clock.fraction + .27 * measured) * 100))
      if (value <= lastValue) return
      lastValue = value
      meter.current?.setAttribute('aria-valuenow', String(value))
      if (counter.current) counter.current.textContent = String(value).padStart(2, '0')
      if (bar.current) bar.current.style.transform = `scaleX(${value / 100})`
    }
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          observedResources += list.getEntries().length
          writeProgress()
        })
        observer.observe({ type: 'resource', buffered: true })
      } catch { /* Встроенный браузер может отключать измерение ресурсов. */ }
    }
    const mark = new Image()
    mark.src = markUrl
    const fonts = document.fonts
    const tracked = (job: Promise<unknown>) => job.catch(() => undefined).then(() => {
      tasksDone++
      writeProgress()
    })
    void Promise.all([
      tracked(mark.decode()),
      tracked(fonts ? Promise.all([fonts.load('700 48px "Inter Tight"', 'FINOMALY'), fonts.load('500 14px Inter', 'Рабочая среда')]) : Promise.resolve()),
      tracked(fonts?.ready ?? Promise.resolve()),
    ]).then(() => { assetsReady = true; reveal() })

    // Если шрифт или модуль потерян в сети, панель всё равно доступна.
    const deadline = window.setTimeout(() => { if (!stopped) onDone() }, repeat ? 2200 : 4300)
    void import('gsap').then(({ gsap }) => {
      if (stopped) return
      reveal = () => {
        if (stopped || finished || !timelineReady || !assetsReady) return
        finished = true
        meter.current?.setAttribute('aria-valuenow', '100')
        if (counter.current) counter.current.textContent = '100'
        if (bar.current) bar.current.style.transform = 'scaleX(1)'
        closing = gsap.timeline({ onComplete: onDone })
          .addLabel('curtain')
          .to(fromDialog('.welcome-core, .welcome-skip'), { opacity: 0, duration: .17 }, 'curtain')
          .to(fromDialog('.welcome-curtain--left'), { xPercent: -101, duration: repeat ? .35 : .66, ease: 'power3.inOut' }, 'curtain+=0.06')
          .to(fromDialog('.welcome-curtain--right'), { xPercent: 101, duration: repeat ? .35 : .66, ease: 'power3.inOut' }, 'curtain+=0.06')
      }
      opening = gsap.timeline()
        .addLabel('signal')
        .fromTo(fromDialog('.welcome-rule'), { scaleX: 0 }, { scaleX: 1, duration: repeat ? .28 : .57, ease: 'power3.inOut' }, 'signal')
        .addLabel('signature', repeat ? .02 : .23)
        .fromTo(fromDialog('.welcome-letter'), { yPercent: 105 }, { yPercent: 0, duration: repeat ? .32 : .64, stagger: repeat ? .018 : .066, ease: 'power4.out' }, 'signature')
        .fromTo(fromDialog('.welcome-signal'), { opacity: 0, y: 7 }, { opacity: 1, y: 0, duration: .45 }, 'signature')
        .fromTo(fromDialog('.welcome-meter'), { opacity: 0 }, { opacity: 1, duration: .27 }, repeat ? .09 : .66)
        .addLabel('readiness', 0)
        .to(clock, { fraction: 1, duration, ease: 'power1.inOut', onUpdate: writeProgress }, 'readiness')
        .call(() => { timelineReady = true; reveal() })
      node.dataset.signaling = 'true'
    }).catch(() => { if (!stopped) node.dataset.signaling = 'true' })
    return () => {
      stopped = true
      window.clearTimeout(deadline)
      observer?.disconnect()
      opening?.kill()
      closing?.kill()
    }
  }, [repeat, onDone])

  return (
    <dialog className="welcome-loader" ref={dialog} tabIndex={-1} aria-label="Загрузка FINOMALY"
      onCancel={(event) => { event.preventDefault(); onSkip() }}>
      <div className="welcome-curtain welcome-curtain--left" aria-hidden="true" />
      <div className="welcome-curtain welcome-curtain--right" aria-hidden="true" />
      <button type="button" className="welcome-skip" onClick={onSkip}>К панели <Glyph name="arrow" /></button>
      <div className="welcome-core">
        <LoadingSignal />
        <p className="welcome-wordmark" aria-label="FINOMALY">
          {Array.from('FINOMALY').map((letter, index) => <span aria-hidden="true" key={index}><i className="welcome-letter">{letter}</i></span>)}
        </p>
        <div className="welcome-rule" />
        <div className="welcome-meter" ref={meter} role="progressbar" aria-label="Подготовка рабочей среды" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <span>Подготовка рабочей среды</span><b><span ref={counter}>00</span>%</b>
          <div><span ref={bar} /></div>
        </div>
      </div>
    </dialog>
  )
}

const chapters = [
  { label: 'Эпизод', title: 'Создайте эпизод', body: 'Эпизод — одна проверка виртуальной компании. Выберите сценарий и seed. С теми же настройками вы получите те же записи.' },
  { label: 'Счёт', title: 'Откройте первоисточник', body: 'В учебном примере счёт DOC-I019 выставлен на 125 000 ₸. В рабочей области нажмите на его номер, чтобы увидеть связанные проводки.' },
  { label: 'Агент', title: 'Проследите за проверкой', body: 'У агента есть бюджет в 100 шагов. Раскройте действие в журнале, чтобы увидеть запрос, полученные записи и его стоимость.' },
  { label: 'Вывод', title: 'Проверьте доказательства', body: 'В этом примере L-104 и L-136 начисляют деньги по одному счёту дважды. В Results видны обе записи, связанный счёт и оценка ответа агента.' },
]

function TourPlate({ chapter }: { chapter: number }) {
  return (
    <div className="tour-plate" data-chapter={chapter} aria-hidden="true">
      {chapter === 0 ? <div className="tour-configuration"><span>Seed <b>42</b></span><i /><span>Валюта <b>KZT</b></span><i /><span>Бюджет <b>100</b></span></div>
        : chapter === 1 ? <div className="tour-invoice"><span className="tour-icon"><Glyph name="book" /></span><div><small>Счёт · INV-019</small><b>DOC-I019</b></div><strong>125 000 ₸</strong></div>
        : chapter === 2 ? <div className="tour-action"><span className="tour-icon"><Glyph name="play" /></span><div><small>Запрос агента</small><b>list_records</b></div><span className="tour-cost">−1 шаг</span></div>
        : <div className="tour-links"><span>DOC-I019</span><i /><div><b>L-104</b><b>L-136</b></div></div>}
    </div>
  )
}

function TourPlayer({ manual, reduce, finish }: { manual: boolean; reduce: boolean; finish: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const meter = useRef<HTMLElement>(null)
  const elapsed = useRef(0)
  const [chapter, setChapter] = useState(0)
  const [playing, setPlaying] = useState(!reduce)
  const current = chapters[chapter]
  const goTo = useCallback((next: number) => {
    elapsed.current = 0
    if (meter.current) meter.current.style.transform = 'scaleX(0)'
    setChapter(Math.max(0, Math.min(chapters.length - 1, next)))
  }, [])

  useLayoutEffect(() => {
    const node = dialog.current!
    if (manual) node.showModal()
    else {
      const before = document.activeElement
      node.show()
      if (before instanceof HTMLElement && before !== document.body) before.focus({ preventScroll: true })
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node)) finish()
    }
    const outsideKey = (event: globalThis.KeyboardEvent) => {
      if (manual) return
      const shortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const outsideActivation = event.key === 'Enter' && !node.contains(event.target as Node)
      if (event.key === 'Escape' || shortcut || outsideActivation) {
        // Сразу освобождаем сочетание клавиш для палитры команд панели.
        node.close()
        finish()
      }
    }
    if (!manual) document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', outsideKey, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', outsideKey, true)
      node.close()
    }
  }, [manual, finish])

  useEffect(() => {
    if (reduce) setPlaying(false)
  }, [reduce])

  // Время приостанавливается в фоновой вкладке и точно возобновляется после паузы.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const resetClock = () => { last = performance.now() }
    const tick = (now: number) => {
      if (!document.hidden) elapsed.current += now - last
      last = now
      const progress = Math.min(1, elapsed.current / SCENE_TIME)
      if (meter.current) meter.current.style.transform = `scaleX(${progress})`
      if (progress < 1) frame = requestAnimationFrame(tick)
      else if (chapter < chapters.length - 1) goTo(chapter + 1)
      else finish()
    }
    frame = requestAnimationFrame(tick)
    document.addEventListener('visibilitychange', resetClock)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', resetClock)
    }
  }, [chapter, playing, finish, goTo])

  function handleKeys(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Tab') setPlaying(false)
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    setPlaying(false)
    goTo(chapter + (event.key === 'ArrowRight' ? 1 : -1))
  }

  return (
    <dialog ref={dialog} className="welcome-tour" data-manual={manual} aria-label="Как устроен FINOMALY"
      onKeyDown={handleKeys} onCancel={(event) => { event.preventDefault(); finish() }}
      onClick={(event) => {
        if (manual && event.target === dialog.current) {
          const bounds = dialog.current.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) finish()
        }
      }}>
      <div className="tour-head">
        <span className="tour-kicker"><img src={markUrl} width="27" height="27" alt="" /> Как устроен FINOMALY</span>
        <button type="button" className="tour-icon-button" aria-label="Закрыть тур" title="Закрыть тур" onClick={finish}><Glyph name="close" /></button>
      </div>
      <nav aria-label="Главы тура" className="tour-chapters">
        {chapters.map((item, index) => (
          <button key={item.label} type="button" onClick={() => { setPlaying(false); goTo(index) }}
            aria-label={`Глава ${index + 1}. ${item.title}`} aria-current={index === chapter ? 'step' : undefined} data-past={index < chapter}>
            <span><i ref={index === chapter ? meter : undefined} style={{ transform: `scaleX(${index < chapter ? 1 : 0})` }} /></span>
          </button>
        ))}
      </nav>
      <article key={chapter} className="tour-story" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
        <TourPlate chapter={chapter} />
        <div className="tour-caption">
          <span className="tour-count">{String(chapter + 1).padStart(2, '0')} / 04</span>
          <h2>{current.title}</h2>
          <p>{current.body}</p>
        </div>
      </article>
      <footer className="tour-controls">
        <button type="button" className="tour-text" onClick={() => setPlaying(!playing)}><Glyph name={playing ? 'pause' : 'play'} />{playing ? 'Пауза' : 'Воспроизвести'}</button>
        <div>
          {chapter > 0 ? <button type="button" className="tour-icon-button" aria-label="Предыдущая глава" onClick={() => { setPlaying(false); goTo(chapter - 1) }}><Glyph name="back" /></button> : null}
          <button type="button" className="tour-next" onClick={() => { if (chapter === chapters.length - 1) finish(); else { setPlaying(false); goTo(chapter + 1) } }}>
            {chapter === chapters.length - 1 ? 'К работе' : 'Далее'} <Glyph name="arrow" />
          </button>
        </div>
      </footer>
    </dialog>
  )
}

export function WelcomeExperience({ replayKey, resuming = false }: { replayKey: number; resuming?: boolean }) {
  const [visit] = useState(getVisit)
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => true)
  const [phase, setPhase] = useState<InitialPhase>(() => visit.restored || resuming ? 'closed' : reducedMotion() ? (visit.complete ? 'closed' : 'tour') : 'loader')
  const [manual, setManual] = useState(false)
  const previousKey = useRef(replayKey)
  const finish = useCallback(() => {
    saveVisit('complete')
    setPhase('closed')
  }, [])
  const afterBoot = useCallback(() => {
    if (!visit.complete) saveVisit('seen')
    setPhase(visit.complete ? 'closed' : 'before-tour')
  }, [visit.complete])
  useEffect(() => {
    if (previousKey.current === replayKey) return
    previousKey.current = replayKey
    setManual(true)
    setPhase('tour')
  }, [replayKey])
  useEffect(() => {
    if (reduce && phase === 'loader') afterBoot()
  }, [reduce, phase, afterBoot])
  useEffect(() => {
    if (phase !== 'before-tour') return
    const timer = window.setTimeout(() => setPhase('tour'), 300)
    document.addEventListener('pointerdown', finish, { once: true, capture: true })
    document.addEventListener('keydown', finish, { once: true, capture: true })
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', finish, true)
      document.removeEventListener('keydown', finish, true)
    }
  }, [phase, finish])
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setPhase('closed') }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])
  if (phase === 'closed' || phase === 'before-tour') return null
  return createPortal(phase === 'loader'
    ? <BootSequence repeat={visit.repeat} onDone={afterBoot} onSkip={finish} />
    : <TourPlayer key={replayKey} manual={manual} reduce={reduce} finish={finish} />, document.body)
}
