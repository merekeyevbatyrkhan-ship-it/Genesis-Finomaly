import { useState } from 'react'
import type { FormEvent, Ref } from 'react'
import { BASE_CURRENCIES, SCENARIOS, STEP_BUDGET, episodeStatus } from './auditTypes'
import type { BaseCurrency, Episode, EpisodeConfig, Scenario } from './auditTypes'
import { SignalTerrain } from './SignalTerrain'
import { Icon } from './Visuals'
import { auditMode } from './auditClient'
import { configOK } from './demoSession'
import type { IconName } from './Visuals'

export type ConfigDraft = Omit<EpisodeConfig, 'seed'> & {seed: string}
export const initialConfig: ConfigDraft = {
  companyName: 'Demo Company', scenario: 'duplicate_invoice', seed: '42',
  baseCurrency: 'KZT', periodStart: '2026-10-01', periodEnd: '2026-10-31',
}
const scenarios = Object.keys(SCENARIOS) as Scenario[]
const currencies = Object.keys(BASE_CURRENCIES) as BaseCurrency[]
const formatCount = (n: number) => String(n).padStart(2, '0')

function Metric({icon, label, value, note, color, children}: {
  icon: IconName; label: string; value: number; note: string; color: string; children: React.ReactNode
}) {
  return <div className="lab-metric" data-accent={color}>
    <div className="metric-label"><span className="metric-glyph"><Icon name={icon}/></span>{label}</div>
    <div className="metric-reading"><strong>{formatCount(value)}</strong>{children}</div>
    <p>{note}</p>
  </div>
}

function Overview({episode}: {episode: Episode | null}) {
  const budget = episode?.stepBudget ?? STEP_BUDGET
  const remaining = episode?.stepsRemaining ?? budget
  return <section className="lab-overview" aria-label="Параметры среды">
    <Metric icon="steps" label="Бюджет эпизода" value={budget} note={episode ? `Осталось ${remaining} из ${budget} шагов` : 'Шагов на один аудит'} color="lilac">
      <svg aria-hidden="true" className="metric-chart" viewBox="0 0 108 32">
        {Array.from({length: 18}, (_, i) => <rect key={i} x={4 + i * 5.7} y={24 - i} width="3" height={5 + i}
          rx="1" fill="currentColor" opacity={i / 18 < remaining / Math.max(1, budget) ? .26 + i * .04 : .11}/>)}
      </svg>
    </Metric>
    <Metric icon="layers" label="Сценарии аудита" value={scenarios.length} note="4 базовых · 2 смешанных · 1 чистый" color="mint">
      <svg aria-hidden="true" className="metric-chart" viewBox="0 0 108 32">
        {[0, 1, 2, 3, 4, 5, 6].map(i => <rect key={i} x={9 + i * 13.8} y={14} width="10" height="12" rx="2"
          fill="currentColor" fillOpacity={i < 4 ? .83 : i < 6 ? .43 : .13} stroke="currentColor" strokeWidth=".65"/>)}
      </svg>
    </Metric>
    <Metric icon="globe" label="Валюты учёта" value={currencies.length} note="Базовые валюты для проверки" color="blue">
      <svg aria-hidden="true" className="metric-chart metric-orbits" viewBox="0 0 108 32" fill="none" stroke="currentColor">
        {[0, 1, 2, 3].map(i => <g key={i} opacity={.24 + .19 * i}><ellipse cx={35 + i * 16} cy="17" rx="16" ry="10" transform={`rotate(-28 ${35+i*16} 17)`}/></g>)}
      </svg>
    </Metric>
  </section>
}

function RunSummary({episode, onContinue}: {episode: Episode | null; onContinue: () => void}) {
  const finished = episode && episode.status !== 'running'
  const phase = finished ? 3 : episode ? 1 : 0
  const stages = [
    {icon: 'sliders', title: 'Настройка', note: 'Выберите компанию, сценарий и период.'},
    {icon: 'audit', title: 'Расследование', note: 'Проследите запросы агента к проводкам и документам.'},
    {icon: 'results', title: 'Оценка', note: 'Сверьте выводы с доказательствами и метриками.'},
  ] as const
  return <aside className="lab-card route-card" aria-labelledby="route-title">
    <div className="lab-panel-title"><h2 id="route-title">Ход эпизода</h2><Icon name="compass"/></div>
    <ol className="route-steps">
      {stages.map((stage, i) => <li key={stage.title} data-state={i < phase ? 'done' : i === phase ? 'current' : 'waiting'} aria-current={i === phase ? 'step' : undefined}>
        <span className="route-icon"><Icon name={i < phase ? 'check' : stage.icon}/></span>
        <div><strong>{stage.title}</strong><p>{stage.note}</p></div>
      </li>)}
    </ol>
    <div className="route-state"><span className="route-state-dot"/>{episode ? episodeStatus[episode.status] : 'Ожидает первого запуска'}
      {episode && <code>{episode.id}</code>}</div>
    {episode && <button type="button" className="secondary" onClick={onContinue}>{finished ? 'Открыть результаты' : 'Продолжить аудит'}</button>}
  </aside>
}

export function Dashboard({config, episode, busy, onConfig, onStart, onConfigure, onContinue, headingRef}: {
  config: ConfigDraft; episode: Episode | null; busy: boolean; onConfig: (config: ConfigDraft) => void
  onStart: (config: EpisodeConfig, autoplay: boolean) => void; onConfigure: () => void; onContinue: () => void
  headingRef: Ref<HTMLHeadingElement>
}) {
  const [touched, setTouched] = useState({company: false, seed: false})
  const seed = Number(config.seed)
  const badSeed = !config.seed.trim() || !Number.isInteger(seed) || seed < 0 || seed > 4294967295
  const companyName = config.companyName.trim()
  const badCompany = !configOK({...config, companyName, seed}) && (!companyName || companyName.length > 80 || /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(companyName))
  const wrongPeriod = Boolean(config.periodStart && config.periodEnd && config.periodStart > config.periodEnd)
  const canStart = !wrongPeriod && !badSeed && !badCompany && config.periodStart && config.periodEnd
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => onConfig({...config, [key]: value})
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (canStart && !busy) onStart({...config, companyName: config.companyName.trim(), seed},
      submitter instanceof HTMLButtonElement && submitter.value === 'autoplay')
  }
  return <>
    <header className="lab-hero">
      <div className="hero-identity">
        <span className="hero-kicker"><span className="wave-mark" aria-hidden="true">∿</span> Симулятор ИИ-аудита</span>
        <h1 ref={headingRef} tabIndex={-1}><span>Лаборатория</span> <em>аномалий<span className="hero-period">.</span></em></h1>
        <p>Создайте финансовый эпизод и проследите, как ИИ-аудитор находит расхождения в документах.</p>
        <div className="hero-actions">
          {episode ? <button type="button" className="hero-primary" onClick={onContinue}><Icon name="circlePlay"/>
            {episode.status === 'running' ? 'К текущему аудиту' : 'К результатам'}</button> :
            <button type="submit" form="episode-config" className="hero-primary" value="autoplay" disabled={busy}
              onClick={() => {if (!canStart) onConfigure()}}><Icon name="play"/>
              {busy ? 'Создаём эпизод…' : auditMode === 'demo' ? 'Запустить демо' : 'Запустить аудит'}</button>}
          <button type="button" className="hero-tour" onClick={onConfigure}><Icon name="sliders"/>Настройки</button>
        </div>
      </div>
      <SignalTerrain seed={badSeed ? 0 : seed}/>
    </header>
    <Overview episode={episode}/>
    <div className="lab-grid">
      <section id="configuration" className="lab-card setup-card" aria-labelledby="setup-title">
        <div className="lab-panel-title"><h2 id="setup-title">Новый эпизод</h2><Icon name="sliders"/></div>
        <p className="panel-lead">Задайте условия одной проверки.</p>
        <form id="episode-config" onSubmit={handleSubmit} className="lab-form" aria-busy={busy}>
          <div className="field"><label htmlFor="company">Название компании</label>
            <input id="company" required maxLength={80} value={config.companyName} onBlur={() => setTouched({...touched, company: true})}
              aria-invalid={touched.company && badCompany || undefined} aria-describedby={touched.company && badCompany ? 'company-error' : undefined}
              onChange={e => set('companyName', e.target.value)}/>
            {touched.company && badCompany && <small id="company-error" className="input-warning">Введите название компании.</small>}
          </div>
          <div className="field"><label htmlFor="scenario">Сценарий аудита</label>
            <select id="scenario" value={config.scenario} onChange={e => set('scenario', e.target.value as Scenario)} aria-describedby="scenario-note">
              {scenarios.map(s => <option key={s} value={s}>{SCENARIOS[s].title}</option>)}
            </select>
            <small id="scenario-note">{SCENARIOS[config.scenario].description}.</small>
          </div>
          <div className="config-fields">
            <div className="field"><label htmlFor="seed">Seed <span>· ключ повтора</span></label>
              <input id="seed" type="number" min="0" max="4294967295" required value={config.seed}
                aria-invalid={touched.seed && badSeed || undefined} aria-describedby={touched.seed && badSeed ? 'seed-error' : undefined}
                onBlur={() => setTouched({...touched, seed: true})} onChange={e => set('seed', e.target.value)}/>
              {touched.seed && badSeed && <small className="input-warning" id="seed-error">Целое число от 0 до 4 294 967 295.</small>}
            </div>
            <div className="field"><label htmlFor="base-currency">Базовая валюта</label>
              <select id="base-currency" value={config.baseCurrency} onChange={e => set('baseCurrency', e.target.value as BaseCurrency)}>
                {currencies.map(c => <option key={c} value={c}>{c} — {BASE_CURRENCIES[c]}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="period-start">Начало периода</label>
              <input id="period-start" type="date" min="1900-01-01" max="9998-12-31" required value={config.periodStart} onChange={e => set('periodStart', e.target.value)}/>
            </div>
            <div className="field"><label htmlFor="period-end">Конец периода</label>
              <input id="period-end" type="date" min="1900-01-01" max="9998-12-31" required value={config.periodEnd} onChange={e => set('periodEnd', e.target.value)}
                aria-invalid={wrongPeriod || undefined} aria-describedby={wrongPeriod ? 'period-error' : undefined}/>
            </div>
          </div>
          {wrongPeriod && <p id="period-error" className="input-warning">Конец периода должен быть не раньше начала.</p>}
          <div className="form-footer">
            <button type="submit" className="primary lab-submit" disabled={!canStart || busy}>
              <Icon name="play"/>{busy ? 'Создаём эпизод…' : episode ? 'Запустить новый аудит' : 'Запустить аудит'}
            </button>
            {episode && <small>Новый запуск заменит текущий эпизод.</small>}
          </div>
        </form>
      </section>
      <RunSummary episode={episode} onContinue={onContinue}/>
    </div>
  </>
}
