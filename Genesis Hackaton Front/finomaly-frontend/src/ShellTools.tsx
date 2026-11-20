import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Episode } from './auditTypes'
import { Icon } from './Visuals'
import type { IconName } from './Visuals'
import './ShellTools.css'

type Screen = 'dashboard' | 'workspace' | 'results'
type Theme = 'dark' | 'light'
type ToastKind = 'success' | 'error' | 'warning' | 'info'
type Notice = { id: number; kind: ToastKind; title: string; detail: string }
type ShellToolsProps = {
  episode: Episode | null
  error: string | null
  onNavigate: (screen: Screen) => void
  onConfigure: () => void
  onTour: () => void
}

const strokes = {
  search: 'M10.5 17.5a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM16 16l5 5',
  moon: 'M20.4 14.2A8.9 8.9 0 0 1 9.8 3.6a9 9 0 1 0 10.6 10.6Z',
  sun: 'M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  tour: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM10 8.5l5.5 3.5-5.5 3.5v-7Z',
  close: 'm6 6 12 12M18 6 6 18',
  enter: 'M19 5v9H5m4-4-4 4 4 4',
  adjust: 'M3 7h10m4 0h4M3 17h4m4 0h10M13 4v6M7 14v6',
  lock: 'M7 10H5v11h14V10h-2m-10 0h10m-10 0V7a5 5 0 0 1 10 0v3',
} as const

type ToolGlyph = keyof typeof strokes | IconName

function Glyph({ name }: { name: ToolGlyph }) {
  if (!(name in strokes)) return <Icon name={name as IconName} />
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="st-glyph" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={strokes[name as keyof typeof strokes]} />
    </svg>
  )
}

const themeKey = 'finomaly.theme'
const lightQuery = '(prefers-color-scheme: light)'

function readPreference(): Theme | null {
  try {
    const value = localStorage.getItem(themeKey)
    return value === 'dark' || value === 'light' ? value : null
  } catch {
    return null
  }
}

function useTheme() {
  const [preference, setPreference] = useState(readPreference)
  const [systemLight, setSystemLight] = useState(() => window.matchMedia(lightQuery).matches)
  const theme: Theme = preference ?? (systemLight ? 'light' : 'dark')

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11131b' : '#f1f2f7')
  }, [theme])

  useEffect(() => {
    const query = window.matchMedia(lightQuery)
    const systemChanged = () => setSystemLight(query.matches)
    const storageChanged = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null) setPreference(readPreference())
    }
    systemChanged()
    query.addEventListener('change', systemChanged)
    window.addEventListener('storage', storageChanged)
    return () => {
      query.removeEventListener('change', systemChanged)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setPreference(next)
    try { localStorage.setItem(themeKey, next) } catch { /* Тема действует до закрытия вкладки. */ }
  }

  return { theme, toggle }
}

// Уведомления следуют за переходами состояния, включая повторный запуск с тем же seed.
function useAuditNotices(episode: Episode | null, error: string | null) {
  const [notices, setNotices] = useState<Notice[]>([])
  const previous = useRef<{ episode: Episode | null; error: string | null }>({ episode, error: null })
  const serial = useRef(0)
  const dismiss = useCallback((id: number) => {
    setNotices((items) => items.filter((item) => item.id !== id))
  }, [])

  useEffect(() => {
    const last = previous.current
    previous.current = { episode, error }
    const incoming: Notice[] = []
    function notify(kind: ToastKind, title: string, detail: string) {
      incoming.push({ id: ++serial.current, kind, title, detail })
    }
    if (error && error !== last.error) notify('error', 'Запрос не выполнен', error)
    if (episode && episode !== last.episode) {
      const started = !last.episode || last.episode.id !== episode.id ||
        (episode.status === 'running' && !episode.trace.length && episode.config !== last.episode.config)
      const finished = started || last.episode?.status !== episode.status
      if (episode.status === 'completed' && finished) {
        notify('success', 'Аудит завершён', episode.result ? 'Доказательства и метрики доступны в Results.' : 'Итоговый статус доступен в Results.')
      } else if (episode.status === 'truncated' && finished) {
        notify('warning', 'Бюджет шагов исчерпан', 'Историю действий можно посмотреть в Audit Workspace.')
      } else if (started && episode.status === 'running') {
        notify('info', 'Эпизод запущен', episode.id + ' · ' + episode.config.companyName)
      }
    }
    if (incoming.length) setNotices((items) => [...items, ...incoming].slice(-3))
  }, [episode, error])
  return { notices, dismiss }
}

const noticeIcons: Record<ToastKind, ToolGlyph> = { success: 'check', error: 'alert', warning: 'alert', info: 'audit' }

function Toast({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const remaining = useRef(4000)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (paused) return
    const start = performance.now()
    const timer = window.setTimeout(() => dismiss(notice.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - start))
    }
  }, [dismiss, notice.id, paused])

  return (
    <li className="st-toast" data-tone={notice.kind} data-paused={paused || undefined}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') touchStart.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerCancel={() => { touchStart.current = null }}
      onPointerUp={(event) => {
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const dx = Math.abs(event.clientX - start.x)
        if (dx > 52 && dx > Math.abs(event.clientY - start.y) * 1.5) dismiss(notice.id)
      }}>
      <span className="st-toast-icon"><Glyph name={noticeIcons[notice.kind]} /></span>
      <div><strong>{notice.title}</strong><p>{notice.detail}</p></div>
      <button type="button" className="st-close" aria-label={'Закрыть уведомление «' + notice.title + '»'}
        onClick={() => dismiss(notice.id)}><Glyph name="close" /></button>
    </li>
  )
}

type Command = { id: string; title: string; detail: string; glyph: ToolGlyph; words: string; run: () => void; disabled?: boolean }

function CommandMenu({ commands, shortcut }: { commands: Command[]; shortcut: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const listId = useId()
  const titleId = useId()
  const words = query.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean)
  const filtered = commands.filter((command) => {
    const target = [command.title, command.detail, command.words].join(' ').toLocaleLowerCase('ru')
    return words.every((word) => target.includes(word))
  })
  const available = filtered.filter((command) => !command.disabled)
  const current = available.find((command) => command.id === cursor) ?? available[0]

  const open = useCallback(() => {
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return
    setQuery('')
    setCursor(null)
    dialog.current?.showModal()
    field.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    function shortcutPressed(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.shiftKey || event.repeat ||
          !(event.metaKey || event.ctrlKey) || !(event.key.toLowerCase() === 'k' || event.code === 'KeyK')) return
      if (dialog.current?.open) {
        event.preventDefault()
        dialog.current.close()
      } else if (!document.querySelector('dialog[open], [aria-modal="true"]')) {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', shortcutPressed)
    return () => window.removeEventListener('keydown', shortcutPressed)
  }, [open])

  function choose(command: Command) {
    if (command.disabled) return
    dialog.current?.close()
    command.run()
  }

  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !current) return
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(current)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const currentIndex = available.indexOf(current)
      const shift = event.key === 'ArrowDown' ? 1 : -1
      const next = available[(currentIndex + shift + available.length) % available.length]
      setCursor(next.id)
      document.getElementById(listId + next.id)?.scrollIntoView({ block: 'nearest' })
    }
  }

  return (
    <>
      <button type="button" className="st-action st-search" onClick={open} aria-label="Быстрые команды"
        aria-haspopup="dialog" aria-keyshortcuts="Control+k Meta+k" title={'Быстрые команды (' + shortcut + ')'}>
        <Glyph name="search" /><kbd>{shortcut}</kbd>
      </button>
      {createPortal(
        <dialog ref={dialog} className="st-dialog" aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return
            const box = event.currentTarget.getBoundingClientRect()
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
              event.currentTarget.close()
            }
          }}>
          <div className="st-dialog-head">
            <h2 id={titleId}>Быстрые команды</h2>
            <button type="button" aria-label="Закрыть быстрые команды" className="st-close"
              onClick={() => dialog.current?.close()}><Glyph name="close" /></button>
          </div>
          <div className="st-searchbox"><Glyph name="search" />
            <input ref={field} type="text" role="combobox" aria-label="Найти команду"
              aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
              aria-activedescendant={current ? listId + current.id : undefined} autoComplete="off" spellCheck={false}
              placeholder="Найти экран или действие…" value={query}
              onKeyDown={keyboard} onChange={(event) => { setQuery(event.target.value); setCursor(null) }} />
          </div>
          <ul className="st-results" id={listId} role="listbox" aria-label="Команды">
            {filtered.map((command) => (
              <li key={command.id} id={listId + command.id} role="option" aria-selected={current?.id === command.id}
                aria-disabled={command.disabled || undefined} onPointerMove={() => { if (!command.disabled) setCursor(command.id) }}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(command)}>
                <span className="st-result-glyph"><Glyph name={command.glyph} /></span>
                <span className="st-result-text"><strong>{command.title}</strong><small>{command.detail}</small></span>
                <span className="st-result-tail"><Glyph name={command.disabled ? 'lock' : 'enter'} /></span>
              </li>
            ))}
          </ul>
          {!filtered.length && <p className="st-no-results" role="status">Команда не найдена. Попробуйте «сценарий» или «тур».</p>}
          <div className="st-keys" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> Выбрать</span><span><kbd>Enter</kbd> Открыть</span><span><kbd>Esc</kbd> Закрыть</span></div>
        </dialog>, document.body)}
    </>
  )
}

export function ShellTools({ episode, error, onNavigate, onConfigure, onTour }: ShellToolsProps) {
  const { theme, toggle } = useTheme()
  const { notices, dismiss } = useAuditNotices(episode, error)
  const themeName = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
  const themeGlyph = theme === 'dark' ? 'sun' : 'moon'
  const shortcut = /Mac|iPad|iPhone/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
  const canReadResult = Boolean(episode && episode.status !== 'running')
  const commands: Command[] = [
    { id: 'dashboard', title: 'Dashboard', detail: 'Обзор среды и текущего прогона', glyph: 'dashboard',
      words: 'панель главная обзор', run: () => onNavigate('dashboard') },
    { id: 'configure', title: 'Настроить эпизод', detail: 'Компания, сценарий, валюта и период', glyph: 'adjust',
      words: 'seed настройки создать новый запуск', run: onConfigure },
    { id: 'workspace', title: 'Audit Workspace', detail: episode ? 'Документы, проводки и действия агента' : 'Сначала запустите эпизод',
      glyph: 'audit', words: 'аудит история операции документы', run: () => onNavigate('workspace'), disabled: !episode },
    { id: 'results', title: 'Results', detail: canReadResult ? 'Итог аудита, доказательства и метрики' : 'Доступно после завершения аудита',
      glyph: 'results', words: 'результаты оценка выводы', run: () => onNavigate('results'), disabled: !canReadResult },
    { id: 'tour', title: 'Посмотреть тур', detail: 'Как пройти свой первый аудит', glyph: 'tour',
      words: 'обучение инструкция помощь', run: onTour },
    { id: 'theme', title: themeName, detail: 'Оформление рабочего пространства', glyph: themeGlyph,
      words: 'цвет оформление темная светлая', run: toggle },
  ]

  return (
    <div className="st-toolbar" role="group" aria-label="Инструменты интерфейса">
      <CommandMenu commands={commands} shortcut={shortcut} />
      <button type="button" className="st-action st-tour" onClick={onTour} title="Посмотреть тур" aria-label="Посмотреть тур" aria-haspopup="dialog">
        <Glyph name="tour" /><span>Тур</span>
      </button>
      <button type="button" className="st-action st-theme" onClick={toggle} aria-label={themeName} title={themeName}>
        <Glyph name={themeGlyph} />
      </button>
      {createPortal(<ul className="st-toasts" aria-label="Уведомления" aria-live="polite" aria-relevant="additions">
        {notices.map((notice) => <Toast key={notice.id} notice={notice} dismiss={dismiss} />)}
      </ul>, document.body)}
    </div>
  )
}
