import { useState } from 'react'
import type { MouseEvent } from 'react'
import { Icon } from './Visuals'
import type { IconName } from './Visuals'
import { episodeStatus, formatAmount, periodLabel, SCENARIOS } from './auditTypes'
import type { AuditStep, Episode, RecordRef } from './auditTypes'
import { findRecord, RecordButton, RecordInspector, useRecordInspector } from './RecordInspector'
import type { OpenRecord } from './RecordInspector'
import { EvidenceChain } from './EvidenceChain'
import { downloadReport } from './downloadReport'
import './Workbench.css'

type Playback = {
  busy: boolean
  playing: boolean
  speed: number
  setSpeed: (speed: number) => void
  play: () => void
  pause: () => void
}

const stepStatus: Record<AuditStep['status'], string> = {
  ok: 'Успешно', error: 'Ошибка', terminated: 'Завершён', truncated: 'Лимит исчерпан',
}

function SectionTitle({ id, title, icon, count }: { id: string; title: string; icon: IconName; count?: number }) {
  return (
    <header className="wb-section-heading">
      <span className="wb-heading-icon"><Icon name={icon} /></span>
      <h2 id={id}>{title}</h2>
      {count !== undefined && <span className="wb-count">{count}</span>}
    </header>
  )
}

function ActionTrace({ episode, onOpen, busy }: { episode: Episode; onOpen: OpenRecord; busy: boolean }) {
  return (
    <section className="wb-panel wb-log" aria-labelledby="trace-title">
      <SectionTitle id="trace-title" title="История действий" icon="terminal" count={episode.trace.length} />
      {episode.trace.length ? (
        <ol className="wb-trace">
          {episode.trace.map((step) => (
            <li key={step.number} data-status={step.status}>
              <details className="wb-trace-entry">
                <summary>
                  <span className="wb-trace-index" aria-label={'Шаг ' + step.number}>{String(step.number).padStart(2, '0')}</span>
                  <span className="wb-trace-summary"><code>{step.action}</code><small>{stepStatus[step.status]} · записей {step.records.length}</small></span>
                  <svg className="wb-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
                </summary>
                <div className="wb-trace-body">
                  <h3>Результат запроса</h3>
                  <p>{step.observation}</p>
                  <dl className="wb-trace-budget">
                    <div><dt>Потрачено шагов</dt><dd>{step.spentSteps}</dd></div>
                    <div><dt>Осталось</dt><dd>{step.stepsRemaining}</dd></div>
                  </dl>
                  <h3>Параметры действия</h3>
                  <pre tabIndex={0} aria-label="Параметры в формате JSON">{JSON.stringify(step.params, null, 2)}</pre>
                  <h3>Полученные записи</h3>
                  {step.records.length ? (
                    <ul className="wb-record-list">
                      {step.records.map((reference) => {
                        const record = findRecord(episode, reference)
                        return (
                          <li key={reference.source + ':' + reference.id}>
                            {record ? (
                              <button type="button" aria-haspopup="dialog" onClick={(event) => onOpen(reference, event.currentTarget)}>
                                <span><code>{reference.id}</code><small>{record.date}</small></span>
                                <span className="wb-list-end">{formatAmount(record.amountMinor, record.currency)} <Icon name="arrow" /></span>
                              </button>
                            ) : <span className="wb-note"><code>{reference.id}</code> · подробности недоступны</span>}
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p>Запрос не вернул записей.</p>}
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : <div className="wb-wait">
        <svg viewBox="0 0 170 48" fill="none" aria-hidden="true">
          <path className="wb-wait-guide" d="M0 24h170" />
          <path className="wb-wait-signal" d="M25 24h30l7-7 9 14 12-25 13 36 10-18h36" />
          <circle cx="142" cy="24" r="3" />
        </svg>
        <strong>Ожидание первого действия</strong>
        <p>Запустите аудит целиком или выполните один шаг, чтобы увидеть ответ среды.</p>
      </div>}
      {busy && <p className="wb-pending" role="status"><span aria-hidden="true" />Среда обрабатывает действие…</p>}
    </section>
  )
}

function Records({ episode, selection, onOpen }: { episode: Episode; selection: RecordRef | null; onOpen: OpenRecord }) {
  const [source, setSource] = useState<RecordRef['source']>('ledger')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase('ru')
  const ledger = source === 'ledger'
  const records = episode[source].filter((row) => {
    const specific = 'kind' in row ? [row.kind, row.reference] : [row.description, ...row.documentIds]
    return !needle || [row.id, row.date, row.counterparty, row.invoiceId, row.currency, ...specific]
      .some((value) => value.toLocaleLowerCase('ru').includes(needle))
  })

  function openRow(event: MouseEvent<HTMLTableRowElement>) {
    if (event.target instanceof Element && !event.target.closest('button') && !window.getSelection()?.toString()) {
      event.currentTarget.querySelector('button')?.click()
    }
  }

  return (
    <section className="wb-panel wb-records" aria-labelledby="records-title">
      <SectionTitle id="records-title" title="Финансовые записи" icon="layers" />
      <div className="wb-toolbar">
        <div className="wb-source-switch" role="group" aria-label="Источник записей">
          {(['ledger', 'documents'] as const).map((key) => (
            <button type="button" key={key} aria-pressed={source === key} onClick={() => { setSource(key); setQuery('') }}>
              {key === 'ledger' ? 'Проводки' : 'Документы'} <span>{episode[key].length}</span>
            </button>
          ))}
        </div>
        <label className="wb-search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5" /><path d="m12 12 5 5" /></svg>
          <input aria-label="Поиск по записям" type="search" placeholder="Найти запись" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {records.length ? (
        <div className="wb-table-wrap" role="region" aria-label={ledger ? 'Таблица проводок' : 'Таблица документов'}>
          <table className="wb-table" key={source}>
            <thead><tr><th scope="col">{ledger ? 'Запись' : 'Документ'}</th><th scope="col">Дата</th>
              <th scope="col">{ledger ? 'Операция' : 'Вид'}</th><th scope="col">{ledger ? 'Счёт' : 'Ссылка'}</th>
              <th scope="col">Сумма</th></tr></thead>
            <tbody>{records.map((row) => (
              <tr key={row.id} onClick={openRow}>
                <td><RecordButton reference={{ source, id: row.id }} selected={selection} onOpen={onOpen} />
                  <small className="wb-mobile-meta">{'description' in row ? row.description : row.kind}</small></td>
                <td><time dateTime={row.date}>{row.date}</time></td>
                <td>{'description' in row ? row.description : row.kind}</td>
                <td><code>{'reference' in row ? row.reference : row.invoiceId}</code></td>
                <td className="wb-amount">{formatAmount(row.amountMinor, row.currency)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="wb-table-empty" role="status">
          <p>{needle ? 'Совпадений по запросу нет.' : 'В этой категории пока нет открытых записей.'}</p>
          {needle && <button className="wb-text-button" type="button" onClick={() => setQuery('')}>Очистить поиск</button>}
        </div>
      )}
    </section>
  )
}

function EmptyScreen({ title, message, icon, button, action }: {
  title: string; message: string; icon: IconName; button: string; action: () => void
}) {
  return (
    <section className="wb wb-empty">
      <span className="wb-empty-symbol"><Icon name={icon} /></span>
      <h2>{title}</h2><p>{message}</p>
      <button className="primary" type="button" onClick={action}>{button} <Icon name="arrow" /></button>
    </section>
  )
}

export function Workspace({ episode, onStep, playback, onDashboard, onResults }: {
  episode: Episode | null
  onStep: () => void
  playback: Playback
  onDashboard: () => void
  onResults: () => void
}) {
  const inspector = useRecordInspector()
  if (!episode) return <EmptyScreen title="Эпизод ещё не запущен" message="Выберите компанию и сценарий на главной панели."
    icon="audit" button="Настроить эпизод" action={onDashboard} />
  const finished = episode.status !== 'running'
  const last = episode.trace.at(-1)

  return (
    <div className="wb">
      <section className="wb-console" aria-labelledby="console-company">
        <div className="wb-run-lead">
          <div className="wb-run-copy">
            <div className="wb-meta-line"><code>{episode.id}</code>
              <span className="wb-run-state" data-status={episode.status}>{episodeStatus[episode.status]}</span></div>
            <h2 id="console-company">{episode.config.companyName}</h2>
            <p>{SCENARIOS[episode.config.scenario].title}</p>
            <div className="wb-config-line"><span>{periodLabel(episode.config)}</span><span>{episode.config.baseCurrency}</span><span>seed {episode.config.seed}</span></div>
          </div>
          <div className="wb-budget">
            <label htmlFor="step-budget"><Icon name="steps" /> Осталось шагов</label>
            <p><strong>{episode.stepsRemaining}</strong><span> / {episode.stepBudget}</span></p>
            <progress id="step-budget" max={episode.stepBudget} value={episode.stepsRemaining} />
          </div>
        </div>
        <div className="wb-controls" role="group" aria-label="Воспроизведение аудита">
          {finished ? <button className="primary" type="button" onClick={onResults}>Открыть результаты <Icon name="arrow" /></button> : <>
            {playback.playing
              ? <button className="primary" type="button" onClick={playback.pause}><span className="wb-pause-icon" aria-hidden="true" /> Пауза</button>
              : <button className="primary" type="button" onClick={playback.play} disabled={playback.busy}><Icon name="play" /> Запустить всё</button>}
            <button className="secondary" type="button" onClick={onStep} disabled={playback.playing || playback.busy}>
              Следующее действие <Icon name="steps" />
            </button>
            <label className="wb-speed" htmlFor="playback-speed">Скорость
              <select id="playback-speed" value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value))}>
                <option value="0.5">0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
              </select>
            </label>
          </>}
        </div>
      </section>
      <p className="sr-only" role="status">
        {last ? 'Шаг ' + last.number + '. ' + last.observation + ' Осталось шагов — ' + episode.stepsRemaining + '.' : ''}
      </p>
      <div className="wb-grid">
        <Records episode={episode} selection={inspector.selected} onOpen={inspector.open} />
        <ActionTrace episode={episode} onOpen={inspector.open} busy={playback.busy} />
      </div>
      {inspector.selected && <RecordInspector episode={episode} reference={inspector.selected} onClose={inspector.close} onOpen={inspector.open} />}
    </div>
  )
}

const metricFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })
const percentages = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })

export function Results({ episode, mode, onBack }: { episode: Episode | null; mode: 'demo' | 'api'; onBack: () => void }) {
  const result = episode?.result
  const inspector = useRecordInspector()
  if (!episode || !result) {
    const finished = episode && episode.status !== 'running'
    const message = finished ? 'Эпизод завершён. Оценщик не передал итоговые данные.'
      : episode ? 'Завершите аудит, чтобы увидеть выводы.' : 'Запустите эпизод на главной панели.'
    return <EmptyScreen title="Результаты ещё недоступны" message={message} icon="results"
      button={episode ? 'Вернуться к аудиту' : 'Настроить эпизод'} action={onBack} />
  }

  const metrics = [
    { name: 'Точность', key: 'Precision', value: result.precision, hint: 'Доля верных выводов среди заявленных', icon: 'target' },
    { name: 'Полнота', key: 'Recall', value: result.recall, hint: 'Доля обнаруженных ошибок среды', icon: 'layers' },
    { name: 'F1', key: 'F1 score', value: result.f1, hint: 'Сводная оценка точности и полноты', icon: 'results' },
    { name: 'Награда', key: 'Reward', value: result.reward, hint: 'Итоговая оценка агента за эпизод', icon: 'reward' },
  ] as const

  return (
    <div className="wb">
      <section className="wb-report" aria-labelledby="report-company">
        <div>
          <div className="wb-meta-line"><code>{episode.id}</code><span className="wb-run-state" data-status={episode.status}>{episodeStatus[episode.status]}</span></div>
          <h2 id="report-company">{episode.config.companyName}</h2>
          <p>{mode === 'demo' ? 'Демонстрационные метрики' : 'Метрики оценщика'} · Шагов использовано — {episode.stepBudget - episode.stepsRemaining}</p>
        </div>
        <div className="wb-report-actions">
          {episode.status !== 'running' && <button className="primary" type="button" onClick={() => downloadReport(episode, mode)}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" />
            </svg>
            Скачать отчёт
          </button>}
          <button className="secondary" type="button" onClick={onBack}><Icon name="terminal" /> К истории аудита</button>
        </div>
      </section>
      <section className="wb-metrics" aria-label="Метрики эпизода">
        {metrics.map(({ name, key, value, hint, icon }) => (
          <article className="wb-metric" key={key} data-kind={key}>
            <div className="wb-metric-name"><Icon name={icon} /><h3>{name}</h3></div>
            <div className="wb-metric-value">{key === 'Reward' ? metricFormat.format(value) : percentages.format(value)}</div>
            <p>{hint}</p>
          </article>
        ))}
      </section>
      <section className="wb-panel wb-findings" aria-labelledby="findings-title">
        <SectionTitle id="findings-title" title="Выводы и доказательства" icon="file" count={result.findings.length} />
        {result.findings.length ? result.findings.map((finding) => (
          <article className="wb-finding" key={finding.id}>
            <div className="wb-finding-head">
              <div><h3>{finding.title}</h3><p>{finding.explanation}</p></div>
              <div className="wb-finding-amount"><small>Сумма расхождения</small><strong>{formatAmount(finding.amountMinor, finding.currency)}</strong></div>
            </div>
            {finding.evidenceIds.length > 0 && <ul className="wb-evidence" aria-label="ID доказательств">
              {finding.evidenceIds.map((id) => {
                const source = episode.documents.some((row) => row.id === id) ? 'documents' : 'ledger'
                const reference = { source, id } as const
                return <li key={id}>{findRecord(episode, reference)
                  ? <RecordButton reference={reference} selected={inspector.selected} onOpen={inspector.open} />
                  : <code>{id}</code>}</li>
              })}
            </ul>}
            <EvidenceChain episode={episode} finding={finding} onOpen={inspector.open} />
          </article>
        )) : <div className="wb-clean"><span className="wb-heading-icon"><Icon name="check" /></span><div>
          <h3>В отчёте нет расхождений</h3>
          <p>{mode === 'demo' && episode.config.scenario === 'clean' ? 'Агент отправил пустой список выводов для чистого эпизода.' : 'Оценщик вернул пустой список выводов.'}</p>
        </div></div>}
      </section>
      {inspector.selected && <RecordInspector episode={episode} reference={inspector.selected} onClose={inspector.close} onOpen={inspector.open} />}
    </div>
  )
}
