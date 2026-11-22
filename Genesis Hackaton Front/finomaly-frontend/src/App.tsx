import { useEffect, useRef, useState } from 'react'
import { Workspace, Results } from './AuditScreens'
import { Dashboard, initialConfig } from './Dashboard'
import { ShellTools } from './ShellTools'
import { WelcomeExperience } from './WelcomeExperience'
import { Icon } from './Visuals'
import type { EpisodeConfig } from './auditTypes'
import { auditMode } from './auditClient'
import { useAuditRun } from './useAuditRun'
import { useLabMotion } from './useLabMotion'
import { useButtonFeedback } from './useButtonFeedback'
import logo from './assets/brand/finomaly-logo.svg'

const sections = {
  dashboard: {name: 'Dashboard', icon: 'dashboard', title: 'Панель управления'},
  workspace: {name: 'Audit Workspace', icon: 'audit', title: 'Рабочая область'},
  results: {name: 'Results', icon: 'results', title: 'Результаты аудита'},
} as const
type Screen = keyof typeof sections
const screens = Object.keys(sections) as Screen[]

function Brand() {
  return <img className="lab-logo" src={logo} alt="FINOMALY" width="276" height="64"/>
}

function Environment() {
  return <div className="lab-environment"><span className="env-icon"><Icon name="server"/></span>
    <div><strong>{auditMode === 'api' ? 'Режим API' : 'Локальное демо'}</strong><small>Синтетические данные</small></div></div>
}

const glossary = [
  ['Эпизод', 'Один аудит виртуальной компании. Например, вы задаёте октябрь, тенге и сценарий дублирования. Среда готовит документы и проводки для этой проверки.'],
  ['Бюджет шагов', 'Лимит действий агента в одном эпизоде. В локальном демо после первого запроса к документам остаётся 99 шагов из 100. Просмотр документов человеком бюджет не расходует.'],
  ['Счёт и проводка', 'Счёт фиксирует, сколько нужно заплатить. Проводка фиксирует операцию в учёте. Если две проводки начисляют одну сумму по одному счёту, агент может проверить их на дублирование.'],
  ['Seed', 'Число для повтора эксперимента. Одинаковые настройки и seed дают один и тот же набор записей. Это позволяет сравнивать действия разных агентов на одинаковом примере.'],
  ['Рабочая область и результаты', 'В Audit Workspace можно читать записи, наблюдать за шагами агента и открывать параметры каждого запроса. После завершения в Results появляются выводы, доказательства и оценка.'],
]

export default function App() {
  useButtonFeedback()
  const run = useAuditRun()
  const {episode} = run
  const [screen, setScreen] = useState<Screen>(() => {
    if (auditMode === 'demo' && episode) {
      try {
        const last = sessionStorage.getItem('finomaly.demo.screen')
        if (last === 'workspace' || last === 'results') return last
      } catch { /* Закрытое хранилище не мешает работе панели. */ }
    }
    return 'dashboard'
  })
  const [config, setConfig] = useState(() => episode ? {...episode.config, seed: String(episode.config.seed)} : initialConfig)
  const [tourReplay, setTourReplay] = useState(0)
  const menu = useRef<HTMLDialogElement>(null)
  const guide = useRef<HTMLDialogElement>(null)
  const main = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrollProgress = useRef<HTMLSpanElement>(null)
  useLabMotion(main, screen)

  function navigate(next: Screen) {
    menu.current?.close()
    if (next !== screen) setScreen(next)
    requestAnimationFrame(() => {
      window.scrollTo({top: 0, behavior: 'instant'})
      heading.current?.focus({preventScroll: true})
    })
  }

  function configure() {
    setScreen('dashboard')
    requestAnimationFrame(() => {
      document.getElementById('company')?.focus({preventScroll: true})
      document.getElementById('configuration')?.scrollIntoView({behavior: 'instant', block: 'start'})
    })
  }
  function replay() {
    menu.current?.close()
    setTourReplay(key => key + 1)
  }
  function openGuide() {
    menu.current?.close()
    guide.current?.showModal()
  }
  async function start(input: EpisodeConfig, autoplay = false) {
    if (await run.start(input)) {
      navigate('workspace')
      if (autoplay) run.play()
    }
  }

  useEffect(() => {
    document.title = sections[screen].title + ' · FINOMALY'
    if (auditMode === 'demo') {
      try { sessionStorage.setItem('finomaly.demo.screen', screen) } catch { /* Необязательная настройка. */ }
    }
  }, [screen])

  useEffect(() => {
    let frame = 0
    function paint() {
      const span = document.documentElement.scrollHeight - window.innerHeight
      scrollProgress.current?.style.setProperty('transform', `scaleX(${span > 1 ? Math.min(1, window.scrollY / span) : 0})`)
      frame = 0
    }
    function update() { if (!frame) frame = requestAnimationFrame(paint) }
    const observer = new ResizeObserver(update)
    if (main.current) observer.observe(main.current)
    window.addEventListener('scroll', update, {passive: true})
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  function navigation() {
    return <>
      <div className="rail-group">
        <p className="rail-label">Рабочая среда</p>
        <nav aria-label="Разделы приложения">{screens.map(s => <button type="button" key={s} aria-current={s === screen ? 'page' : undefined}
          onClick={() => navigate(s)}><Icon name={sections[s].icon}/><span>{sections[s].name}</span></button>)}</nav>
      </div>
      <div className="rail-group rail-help">
        <p className="rail-label">Справка</p>
        <button type="button" onClick={openGuide}><Icon name="book"/>Гид по аудиту</button>
        <button type="button" onClick={replay}><Icon name="circlePlay"/>Тур по продукту</button>
      </div>
    </>
  }

  return <div className="lab-shell">
    <a className="skip-link" href="#main">К содержанию</a>
    <aside className="lab-rail">
      <button className="rail-brand" type="button" aria-label="FINOMALY — на Dashboard" onClick={() => navigate('dashboard')}><Brand/></button>
      {navigation()}<Environment/>
    </aside>
    <div className="lab-page">
      <header className="lab-topbar">
        <button className="mobile-menu-toggle" type="button" aria-haspopup="dialog" aria-label="Открыть меню" onClick={() => menu.current?.showModal()}><Icon name="menu"/></button>
        <div className="lab-breadcrumb"><Icon name="layers"/><span>Лаборатория</span><b aria-hidden="true">/</b><strong>{sections[screen].name}</strong></div>
        <span className="mobile-brand" aria-label="FINOMALY">Finomaly</span>
        <ShellTools episode={episode} error={run.error} onNavigate={navigate} onConfigure={configure} onTour={replay}/>
        <span aria-hidden="true" className="lab-scroll-progress" ref={scrollProgress}/>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="lab-main" data-page={screen}>
        {run.error && <p className="request-error" role="alert">{run.error}</p>}
        {screen === 'dashboard' ? <Dashboard config={config} episode={episode} busy={run.busy} onConfig={setConfig} onStart={start}
          onConfigure={configure} onContinue={() => navigate(episode?.status === 'running' ? 'workspace' : 'results')} headingRef={heading}/> :
          <>
            <header className="work-heading"><h1 tabIndex={-1} ref={heading}>{sections[screen].title}</h1>
              <p>{screen === 'workspace' ? 'Документы, проводки и история действий ИИ-аудитора.' : 'Выводы агента, подтверждающие записи и оценка эпизода.'}</p></header>
            {screen === 'workspace' ? <Workspace key={episode?.id} episode={episode} onStep={run.nextStep} playback={run}
              onDashboard={() => navigate('dashboard')} onResults={() => navigate('results')}/> :
              <Results episode={episode} mode={auditMode} onBack={() => navigate(episode ? 'workspace' : 'dashboard')}/>}
          </>}
      </main>
    </div>
    <dialog ref={menu} className="lab-menu-dialog" aria-label="Меню FINOMALY" onClick={e => {if (e.target === e.currentTarget) e.currentTarget.close()}}>
      <div className="menu-content"><div className="dialog-bar"><Brand/>
        <button type="button" className="lab-icon-button" aria-label="Закрыть меню" onClick={() => menu.current?.close()}><Icon name="close"/></button>
      </div>{navigation()}<Environment/></div>
    </dialog>
    <dialog ref={guide} className="lab-guide" aria-labelledby="guide-title" onClick={e => {if (e.target === e.currentTarget) e.currentTarget.close()}}>
      <div className="guide-content"><div className="dialog-bar"><span className="guide-symbol"><Icon name="book"/></span>
        <button type="button" className="lab-icon-button" aria-label="Закрыть гид" onClick={() => guide.current?.close()}><Icon name="close"/></button></div>
        <h2 id="guide-title">Гид по аудиту</h2><p>Пять понятий, которые помогут провести первую проверку.</p>
        {glossary.map(([term, explanation], i) => <details key={term} open={i === 0 ? true : undefined}><summary>{term}<Icon name="chevron"/></summary><p>{explanation}</p></details>)}
      </div>
    </dialog>
    <WelcomeExperience replayKey={tourReplay} resuming={Boolean(episode)}/>
  </div>
}
