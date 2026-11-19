import { useState } from 'react'
import { Icon, StatCard } from './Visuals'
import { episodeStatus, formatAmount, periodLabel, SCENARIOS } from './auditTypes'
import type { AuditStep, Episode, RecordRef } from './auditTypes'
import { findRecord, RecordButton, RecordInspector, useRecordInspector } from './RecordInspector'
import type { OpenRecord } from './RecordInspector'
import { EvidenceChain } from './EvidenceChain'

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

function ActionTrace({ episode, onOpen }: { episode: Episode; onOpen: OpenRecord }) {
  return (
    <section className="card trace-card" aria-labelledby="trace-title">
      <div className="panel-title">
        <h2 id="trace-title">История действий</h2>
        <span className="icon-tile compact" data-tone="violet"><Icon name="terminal" /></span>
      </div>
      {episode.trace.length ? (
        <ol className="trace">
          {episode.trace.map((step, index) => (
            <li key={step.number} data-latest={index === episode.trace.length - 1 || undefined}>
              <details className="trace-entry">
                <summary>
                  <span className="trace-index" aria-label={'Шаг ' + step.number}>{String(step.number).padStart(2, '0')}</span>
                  <span className="trace-summary"><code>{step.action}</code><small>{stepStatus[step.status]}</small></span>
                  <span className="trace-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div className="trace-body">
                  <p>{step.observation}</p>
                  <dl className="trace-budget">
                    <div><dt>Потрачено шагов</dt><dd>{step.spentSteps}</dd></div>
                    <div><dt>Осталось</dt><dd>{step.stepsRemaining}</dd></div>
                  </dl>
                  <h3>Параметры действия</h3>
                  <pre tabIndex={0} aria-label="Параметры в формате JSON">{JSON.stringify(step.params, null, 2)}</pre>
                  <h3>Полученные записи</h3>
                  {step.records.length ? (
                    <ul className="record-items">
                      {step.records.map((reference) => {
                        const record = findRecord(episode, reference)
                        return (
                          <li key={reference.source + ':' + reference.id}>
                            {record ? (
                              <button className="record-item" type="button" onClick={(event) => onOpen(reference, event.currentTarget)}>
                                <span><code>{reference.id}</code><small>{record.date}</small></span>
                                <span className="amount">{formatAmount(record.amountMinor, record.currency)}</span>
                              </button>
                            ) : <span className="unavailable-record"><code>{reference.id}</code> · подробности недоступны</span>}
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
      ) : <p className="trace-empty">Первое наблюдение появится после действия агента.</p>}
    </section>
  )
}

function Records({ episode, selection, onOpen }: { episode: Episode; selection: RecordRef | null; onOpen: OpenRecord }) {
  const [source, setSource] = useState<RecordRef['source']>('ledger')

  return (
    <section className="card records-card" aria-labelledby="records-title">
      <div className="panel-title">
        <h2 id="records-title">Финансовые записи</h2>
        <span className="icon-tile compact" data-tone="cyan"><Icon name="file" /></span>
      </div>
      <div className="source-switch" role="group" aria-label="Источник записей">
        <button type="button" aria-pressed={source === 'ledger'} onClick={() => setSource('ledger')}>
          Проводки <span aria-hidden="true">{episode.ledger.length}</span>
        </button>
        <button type="button" aria-pressed={source === 'documents'} onClick={() => setSource('documents')}>
          Документы <span aria-hidden="true">{episode.documents.length}</span>
        </button>
      </div>
      {episode[source].length ? (
        <div className="table-wrap" role="region" aria-label={source === 'ledger' ? 'Таблица проводок' : 'Таблица документов'} tabIndex={0}>
          {source === 'ledger' ? (
            <table>
              <thead><tr><th scope="col">Запись</th><th scope="col">Дата</th><th scope="col">Операция</th><th scope="col">Счёт</th><th scope="col">Сумма</th></tr></thead>
              <tbody>{episode.ledger.map((row) => (
                <tr key={row.id} data-selected={selection?.source === 'ledger' && selection.id === row.id || undefined}>
                  <td><RecordButton reference={{ source, id: row.id }} selected={selection} onOpen={onOpen} /></td>
                  <td>{row.date}</td><td>{row.description}</td><td>{row.invoiceId}</td>
                  <td className="amount">{formatAmount(row.amountMinor, row.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th scope="col">Документ</th><th scope="col">Вид</th><th scope="col">Ссылка</th><th scope="col">Сумма</th></tr></thead>
              <tbody>{episode.documents.map((row) => (
                <tr key={row.id} data-selected={selection?.source === 'documents' && selection.id === row.id || undefined}>
                  <td><RecordButton reference={{ source, id: row.id }} selected={selection} onOpen={onOpen} /></td>
                  <td>{row.kind}</td><td>{row.reference}</td><td className="amount">{formatAmount(row.amountMinor, row.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ) : <p className="trace-empty">В этой категории пока нет открытых записей.</p>}
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

  if (!episode) {
    return (
      <section className="card empty">
        <span className="icon-tile" data-tone="violet"><Icon name="audit" /></span>
        <h2>Эпизод ещё не запущен</h2>
        <p className="muted">Выберите компанию и сценарий на главной панели.</p>
        <button className="primary" type="button" onClick={onDashboard}>Настроить эпизод <Icon name="arrow" /></button>
      </section>
    )
  }

  const finished = episode.status !== 'running'
  const last = episode.trace.at(-1)

  return (
    <>
      <section className="episode-bar" aria-label="Эпизод и управление прогоном">
        <div className="episode-identity">
          <span className="icon-tile" data-tone="violet"><Icon name="audit" /></span>
          <div>
            <strong className="company-name">{episode.config.companyName}</strong>
            <p className="context-line"><code>{episode.id}</code><span>{periodLabel(episode.config)} · {episode.config.baseCurrency}</span></p>
            <p className="context-line"><code>seed {episode.config.seed}</code> <span>{SCENARIOS[episode.config.scenario].title}</span></p>
          </div>
        </div>
        <div className="budget">
          <div>
            <label htmlFor="step-budget">Осталось шагов</label>
            <strong>{episode.stepsRemaining} / {episode.stepBudget}</strong>
          </div>
          <progress id="step-budget" max={episode.stepBudget} value={episode.stepsRemaining} />
        </div>
        <span className="status" data-status={episode.status}>{episodeStatus[episode.status]}</span>
        {finished ? <button className="primary" type="button" onClick={onResults}>Открыть результаты <Icon name="arrow" /></button> : (
          <div className="playback" role="group" aria-label="Воспроизведение аудита">
            <button className="primary" type="button" onClick={playback.play} disabled={playback.playing || playback.busy}>
              <Icon name="play" /> Запустить всё
            </button>
            <button className="secondary" type="button" onClick={playback.pause} disabled={!playback.playing}>Пауза</button>
            <button className="secondary" type="button" onClick={onStep} disabled={playback.playing || playback.busy}>Следующее действие</button>
            <div className="playback-speed">
              <label htmlFor="playback-speed">Скорость</label>
              <select id="playback-speed" value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value))}>
                <option value="0.5">0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
              </select>
            </div>
          </div>
        )}
      </section>
      <p className="sr-only" role="status">
        {last ? 'Шаг ' + last.number + '. ' + last.observation + ' Осталось шагов — ' + episode.stepsRemaining + '.' : ''}
      </p>

      <div className="workspace-grid">
        <Records episode={episode} selection={inspector.selected} onOpen={inspector.open} />
        <div className="inspection-stack">
          {inspector.selected ? <RecordInspector episode={episode} reference={inspector.selected} onClose={inspector.close} onOpen={inspector.open} /> : null}
          <ActionTrace episode={episode} onOpen={inspector.open} />
        </div>
      </div>
    </>
  )
}

const metricFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

export function Results({ episode, mode, onBack }: { episode: Episode | null; mode: 'demo' | 'api'; onBack: () => void }) {
  const result = episode?.result
  const inspector = useRecordInspector()

  if (!episode || !result) {
    const finished = episode && episode.status !== 'running'
    return (
      <section className="card empty">
        <span className="icon-tile" data-tone="violet"><Icon name="results" /></span>
        <h2>Результаты ещё недоступны</h2>
        <p className="muted">
          {finished ? 'Эпизод завершён. Оценщик не передал итоговые данные.' : episode ? 'Завершите аудит, чтобы увидеть выводы.' : 'Запустите эпизод на главной панели.'}
        </p>
        <button className="primary" type="button" onClick={onBack}>
          {episode ? 'Вернуться к аудиту' : 'Настроить эпизод'} <Icon name="arrow" />
        </button>
      </section>
    )
  }

  const metrics = [
    { label: 'Точность (Precision)', value: result.precision, tone: 'violet', icon: 'target' },
    { label: 'Полнота (Recall)', value: result.recall, tone: 'cyan', icon: 'layers' },
    { label: 'F1', value: result.f1, tone: 'rose', icon: 'results' },
    { label: 'Награда', value: result.reward, tone: 'green', icon: 'reward' },
  ] as const

  return (
    <>
      <p className="demo-notice"><Icon name="info" /> {mode === 'demo' ? 'Демонстрационные метрики' : 'Метрики оценщика'} · {episode.id} · Шагов использовано — {episode.stepBudget - episode.stepsRemaining}</p>
      <section className="overview metrics" aria-label="Метрики эпизода">
        {metrics.map(({ label, value, icon, tone }) => (
          <StatCard key={label} icon={icon} tone={tone} label={label}>{metricFormat.format(value)}</StatCard>
        ))}
      </section>
      <div className={inspector.selected ? 'results-grid with-inspector' : 'results-grid'}>
        <section className="card findings" aria-labelledby="findings-title">
          <div className="panel-title">
            <h2 id="findings-title">Выводы и доказательства</h2>
            <span className="status" data-status={result.findings.length ? 'finding' : 'completed'}>
              {result.findings.length ? 'Выводов — ' + result.findings.length : 'Выводов нет'}
            </span>
          </div>
          {result.findings.length ? result.findings.map((finding) => (
            <article key={finding.id}>
              <h3><Icon name="alert" /> {finding.title}</h3>
              <p>{finding.explanation}</p>
              <p><strong>Сумма</strong> {formatAmount(finding.amountMinor, finding.currency)}</p>
              <ul className="evidence" aria-label="ID доказательств">
                {finding.evidenceIds.map((id) => {
                  const source = episode.documents.some((row) => row.id === id) ? 'documents' : 'ledger'
                  const reference = { source, id } as const
                  return (
                    <li key={id}>
                      {findRecord(episode, reference)
                        ? <RecordButton reference={reference} selected={inspector.selected} onOpen={inspector.open} />
                        : <code>{id}</code>}
                    </li>
                  )
                })}
              </ul>
              <EvidenceChain episode={episode} finding={finding} onOpen={inspector.open} />
            </article>
          )) : (
            <p className="muted">{mode === 'demo' && episode.config.scenario === 'clean'
              ? 'Агент отправил пустой список выводов для чистого эпизода.'
              : 'В итоговых данных нет выводов.'}</p>
          )}
          <button className="secondary" type="button" onClick={onBack}>Вернуться к истории аудита</button>
        </section>
        {inspector.selected ? <RecordInspector episode={episode} reference={inspector.selected} onClose={inspector.close} onOpen={inspector.open} /> : null}
      </div>
    </>
  )
}
