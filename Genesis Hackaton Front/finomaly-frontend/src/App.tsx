import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Workspace, Results } from './AuditScreens'
import { AuditIllustration, Icon, StatCard } from './Visuals'
import finomalyLogo from './assets/brand/finomaly-logo.svg'
import { SCENARIOS, STEP_BUDGET, episodeStatus, periodLabel } from './auditTypes'
import type { Episode, EpisodeConfig, Scenario } from './auditTypes'
import { auditMode } from './auditClient'
import { useAuditRun } from './useAuditRun'

const screens = {
  dashboard: 'Dashboard',
  workspace: 'Audit Workspace',
  results: 'Results',
} as const

type Screen = keyof typeof screens

const descriptions: Record<Screen, string> = {
  dashboard: 'Запустите аудит финансовых записей и проследите, как агент собирает доказательства.',
  workspace: 'Проводки, документы и действия агента в текущем эпизоде.',
  results: 'Выводы, доказательства и метрики завершённого прогона.',
}

type ConfigDraft = Omit<EpisodeConfig, 'seed'> & { seed: string }

const defaultConfig: ConfigDraft = {
  companyName: 'Demo Company',
  scenario: 'duplicate_invoice',
  seed: '42',
  baseCurrency: 'KZT',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
}

const scenarioOptions = Object.keys(SCENARIOS) as Scenario[]

function RunSummary({ episode, onNavigate }: {
  episode: Episode | null
  onNavigate: (screen: Screen) => void
}) {
  const completed = episode ? episode.status !== 'running' : false
  const phase = completed ? 3 : episode ? 1 : 0
  const stages = [
    { title: 'Настройка эпизода', detail: 'Компания и сценарий', icon: 'layers' },
    {
      title: 'Пошаговый аудит',
      detail: episode ? `Осталось ${episode.stepsRemaining} из ${episode.stepBudget} шагов` : 'Записи и действия агента',
      icon: 'audit',
    },
    { title: 'Результат', detail: 'Доказательства и метрики', icon: 'results' },
  ] as const

  return (
    <section className="card run-card" aria-labelledby="run-title">
      <div className="panel-title">
        <h2 id="run-title">Текущий прогон</h2>
        <span className="status" data-status={episode?.status ?? 'idle'}>
          {episode ? episodeStatus[episode.status] : 'Ожидает запуска'}
        </span>
      </div>
      {episode ? (
        <div className="run-context">
          <p className="company-name">{episode.config.companyName}</p>
          <p className="context-line"><code>{episode.id}</code> <span>{periodLabel(episode.config)} · {episode.config.baseCurrency}</span></p>
          <p className="context-line"><code>seed {episode.config.seed}</code></p>
        </div>
      ) : null}
      <ol className="run-stages" aria-label="Этапы прогона">
        {stages.map((stage, index) => (
          <li key={stage.title} data-stage={index < phase ? 'done' : index === phase ? 'current' : 'pending'}
            aria-current={index === phase ? 'step' : undefined}>
            <span className="stage-icon"><Icon name={index < phase ? 'check' : stage.icon} /></span>
            <div><strong>{stage.title}</strong><span>{stage.detail}</span></div>
          </li>
        ))}
      </ol>
      {episode ? (
        <button className="secondary" type="button" onClick={() => onNavigate(completed ? 'results' : 'workspace')}>
          {completed ? 'Открыть результаты' : 'Продолжить аудит'}<Icon name="arrow" />
        </button>
      ) : null}
    </section>
  )
}

function Dashboard({ episode, config, busy, onConfig, onStart, onNavigate }: {
  episode: Episode | null
  config: ConfigDraft
  busy: boolean
  onConfig: (config: ConfigDraft) => void
  onStart: (config: EpisodeConfig) => void
  onNavigate: (screen: Screen) => void
}) {
  const seed = Number(config.seed)
  const wrongPeriod = Boolean(config.periodStart && config.periodEnd && config.periodStart > config.periodEnd)
  const canStart = Boolean(config.companyName.trim() && config.seed && config.periodStart && config.periodEnd) &&
    !wrongPeriod && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canStart && !busy) onStart({ ...config, companyName: config.companyName.trim(), seed })
  }

  return (
    <>
      <section className="overview" aria-label="Сводка">
        <StatCard icon="steps" label="Бюджет эпизода">{episode?.stepBudget ?? STEP_BUDGET} <small>шагов</small></StatCard>
        <StatCard icon="layers" tone="cyan" label="Доступные сценарии">{scenarioOptions.length}</StatCard>
        <StatCard icon="file" tone="rose" label="Текущий эпизод">
          {episode ? <code>{episode.id}</code> : <span className="stat-empty">Нет запуска</span>}
        </StatCard>
      </section>

      <div className="dashboard-grid">
        <section className="card setup-card" aria-labelledby="setup-title">
          <div className="panel-title">
            <h2 id="setup-title">Настройки эпизода</h2>
            <span className="icon-tile compact" data-tone="violet"><Icon name="layers" /></span>
          </div>
          <form onSubmit={handleSubmit} className="setup-form">
            <div className="field">
              <label htmlFor="company">Название компании</label>
              <input
                id="company"
                required
                maxLength={80}
                value={config.companyName}
                onChange={(event) => onConfig({ ...config, companyName: event.target.value })}
              />
            </div>
            <fieldset className="scenario-field">
              <legend>Сценарий</legend>
              <div className="scenario-options">
                {scenarioOptions.map((value) => (
                  <label className="scenario-option" key={value}>
                    <input type="radio" name="scenario" value={value} checked={config.scenario === value}
                      onChange={() => onConfig({ ...config, scenario: value })} />
                    <Icon name={value === 'clean' ? 'check' : value === 'duplicate_invoice' ? 'duplicate' : 'layers'} />
                    <span><strong>{SCENARIOS[value].title}</strong><small>{SCENARIOS[value].description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="config-fields">
              <div className="field">
                <label htmlFor="seed">Seed</label>
                <input id="seed" type="number" min="0" max="4294967295" step="1" required value={config.seed}
                  onChange={(event) => onConfig({ ...config, seed: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="base-currency">Базовая валюта</label>
                <select id="base-currency" value={config.baseCurrency}
                  onChange={(event) => onConfig({ ...config, baseCurrency: event.target.value })}>
                  <option value="KZT">KZT</option><option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="period-start">Начало периода</label>
                <input id="period-start" type="date" min="1900-01-01" max="9998-12-31" required value={config.periodStart}
                  onChange={(event) => onConfig({ ...config, periodStart: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="period-end">Конец периода</label>
                <input id="period-end" type="date" min="1900-01-01" max="9998-12-31" required value={config.periodEnd}
                  aria-invalid={wrongPeriod || undefined} aria-describedby={wrongPeriod ? 'period-error' : undefined}
                  onChange={(event) => onConfig({ ...config, periodEnd: event.target.value })} />
              </div>
            </div>
            {wrongPeriod ? <p className="input-warning" id="period-error">Конец периода должен быть не раньше начала.</p> : null}
            <div className="form-footer">
              <button className="primary" type="submit" disabled={!canStart || busy}>
                <Icon name="play" />
                {busy ? 'Ожидание…' : episode ? 'Запустить новый аудит' : 'Запустить аудит'}
                <Icon name="arrow" />
              </button>
              {episode ? <small>Новый запуск заменит текущий эпизод.</small> : null}
            </div>
          </form>
        </section>
        <RunSummary episode={episode} onNavigate={onNavigate} />
      </div>
    </>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [config, setConfig] = useState<ConfigDraft>(defaultConfig)
  const run = useAuditRun()
  const { episode } = run
  const focusOnNavigate = useRef(false)

  function navigate(next: Screen) {
    if (next === screen) return
    focusOnNavigate.current = true
    setScreen(next)
  }

  async function startAudit(input: EpisodeConfig) {
    if (await run.start(input)) navigate('workspace')
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">К содержанию</a>
      <aside className="sidebar">
        <div className="brand">
          <img src={finomalyLogo} className="brand-logo" alt="FINOMALY" width={276} height={64} />
          <span className="brand-caption">Симулятор аудита</span>
        </div>
        <nav aria-label="Разделы приложения">
          {(Object.keys(screens) as Screen[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-current={screen === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              <Icon name={key === 'workspace' ? 'audit' : key} />
              <span>{screens[key]}</span>
            </button>
          ))}
        </nav>
        <div className="mode"><span aria-hidden="true" /><div><strong>{auditMode === 'api' ? 'Режим API' : 'Локальное демо'}</strong><small>Синтетические данные</small></div></div>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className={screen === 'dashboard' ? 'page-heading dashboard-heading' : 'page-heading'}>
          <div className="heading-copy">
            {screen === 'dashboard' ? <p className="heading-context"><Icon name="terminal" /> Среда для FinTech-команд</p> : null}
            <h1
              key={screen}
              tabIndex={-1}
              ref={(heading) => {
                if (heading && focusOnNavigate.current) {
                  heading.focus()
                  focusOnNavigate.current = false
                }
              }}
            >
              {screens[screen]}
            </h1>
            <p className="heading-description">{descriptions[screen]}</p>
          </div>
          {screen === 'dashboard' ? <AuditIllustration /> : null}
        </header>
        {run.error ? <p className="request-error" role="alert">{run.error}</p> : null}
        {screen === 'dashboard' ? (
          <Dashboard episode={episode} config={config} busy={run.busy} onConfig={setConfig} onStart={startAudit} onNavigate={navigate} />
        ) : screen === 'workspace' ? (
          <Workspace
            key={episode?.id}
            episode={episode}
            onStep={run.nextStep}
            playback={run}
            onDashboard={() => navigate('dashboard')}
            onResults={() => navigate('results')}
          />
        ) : (
          <Results episode={episode} mode={auditMode} onBack={() => navigate(episode ? 'workspace' : 'dashboard')} />
        )}
      </main>
    </div>
  )
}
