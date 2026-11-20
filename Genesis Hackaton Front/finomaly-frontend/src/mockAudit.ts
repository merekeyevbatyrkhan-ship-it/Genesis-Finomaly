import { currencyScale, SCENARIOS, STEP_BUDGET } from './auditTypes'
import type { AuditStep, BaseCurrency, DocumentRecord, Episode, EpisodeConfig, ErrorType, Finding, LedgerRecord, RecordRef } from './auditTypes'

const INVOICE = 'INV-019'
const DAY = 86400000

// Синтетические цены и курсы для воспроизводимых демо-сценариев.
const DEMO_CURRENCY: Record<BaseCurrency, { invoice: number; rate: number; wrongRate: number }> = {
  KZT: { invoice: 125000, rate: 500, wrongRate: 510 },
  USD: { invoice: 1250, rate: 1.125, wrongRate: 1.15 },
  EUR: { invoice: 1250, rate: 1.125, wrongRate: 1.15 },
  GBP: { invoice: 1000, rate: .8, wrongRate: .82 },
  CHF: { invoice: 1100, rate: .88, wrongRate: .9 },
  CNY: { invoice: 9000, rate: 7.2, wrongRate: 7.35 },
  JPY: { invoice: 187500, rate: 150, wrongRate: 153 },
  UZS: { invoice: 15625000, rate: 12500, wrongRate: 12750 },
}

function offsetDate(date: string, days: number) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10)
}

function buildFixture(config: EpisodeConfig) {
  const errors: readonly ErrorType[] = SCENARIOS[config.scenario].errors
  const has = (type: ErrorType) => errors.includes(type)
  const days = (Date.parse(config.periodEnd) - Date.parse(config.periodStart)) / DAY
  const date = (fraction: number) => offsetDate(config.periodStart, Math.round(days * fraction))
  const outsidePeriod = offsetDate(config.periodEnd, 1)
  const currency = config.baseCurrency
  const counterparty = ['Orion Services', 'Vector Supply', 'Delta Systems'][config.seed % 3]
  const { invoice, rate, wrongRate } = DEMO_CURRENCY[currency]
  const foreign = currency === 'USD' ? 'EUR' : 'USD'
  const baseScale = currencyScale(currency)
  const foreignScale = currencyScale(foreign)
  const amount = (invoice + config.seed % 997 - 42) * baseScale
  const unconvertedSecond = Math.round(amount * .6)
  // Курсы заданы в основных единицах, а проводки и документы хранят минимальные.
  const foreignMinor = Math.round(unconvertedSecond * foreignScale / (rate * baseScale))
  const expectedSecond = has('fx_rate') ? Math.round(foreignMinor * rate * baseScale / foreignScale) : unconvertedSecond
  const converted = has('fx_rate') ? Math.round(foreignMinor * wrongRate * baseScale / foreignScale) : expectedSecond
  const allocated = has('partial_allocation') ? Math.round(converted * .8) : converted
  const first = amount - expectedSecond
  const shared = { invoiceId: INVOICE, counterparty }
  const ledger: LedgerRecord[] = [
    { ...shared, id: 'L-104', date: has('period_cutoff') && !has('duplicate_invoice') ? outsidePeriod : date(.07),
      description: 'Начисление по счёту', amountMinor: amount, currency, documentIds: ['DOC-I019'] },
    { ...shared, id: 'L-118', date: date(.3), description: 'Первый частичный платёж',
      amountMinor: first, currency, documentIds: ['DOC-I019', 'DOC-P041'] },
    { ...shared, id: 'L-122', date: date(.4), description: 'Распределение второго платежа',
      amountMinor: allocated, currency, documentIds: ['DOC-I019', 'DOC-P042'] },
  ]
  const documents: DocumentRecord[] = [
    { ...shared, id: 'DOC-I019', reference: INVOICE, kind: 'Счёт', date: date(.07), amountMinor: amount, currency },
    { ...shared, id: 'DOC-P041', reference: 'PAY-041', kind: 'Платёж', date: date(.3), amountMinor: first, currency },
    { ...shared, id: 'DOC-P042', reference: 'PAY-042', kind: 'Платёж', date: date(.4),
      amountMinor: has('fx_rate') ? foreignMinor : expectedSecond, currency: has('fx_rate') ? foreign : currency,
      note: has('fx_rate') ? `Курс по справочнику — ${rate}. Применённый курс — ${wrongRate} ${currency} за ${foreign}.` : undefined },
  ]
  if (has('duplicate_invoice')) {
    ledger.push({ ...ledger[0], id: 'L-136', date: has('period_cutoff') ? outsidePeriod : date(.67) })
  }

  const cutoffId = has('duplicate_invoice') ? 'L-136' : 'L-104'
  const descriptions: Record<ErrorType, Omit<Finding, 'id' | 'type' | 'currency'>> = {
    duplicate_invoice: {
      title: 'Повторное начисление по счёту INV-019',
      explanation: 'L-104 и L-136 содержат одинаковое начисление и ссылаются на один счёт DOC-I019. Платежи относятся к погашению этого счёта.',
      amountMinor: amount, affectedIds: ['L-104', 'L-136'], evidenceIds: ['L-104', 'L-136', 'DOC-I019'],
    },
    partial_allocation: {
      title: 'Второй платёж распределён частично',
      explanation: 'В L-122 на счёт отнесено 80% суммы второго платежа после пересчёта. DOC-P042 подтверждает исходную сумму.',
      amountMinor: converted - allocated, affectedIds: ['L-122'], evidenceIds: ['L-122', 'DOC-P042', 'DOC-I019'],
    },
    fx_rate: {
      title: 'Второй платёж пересчитан по неверному курсу',
      explanation: `Для DOC-P042 применён курс ${wrongRate} вместо ${rate}. Разница рассчитана до распределения платежа.`,
      amountMinor: converted - expectedSecond, affectedIds: ['L-122'], evidenceIds: ['DOC-P042', 'L-122'],
    },
    period_cutoff: {
      title: 'Начисление проведено за границей периода',
      explanation: `Дата проводки ${cutoffId} — ${outsidePeriod}, после конца периода ${config.periodEnd}. Первичный счёт датирован внутри периода.`,
      amountMinor: amount, affectedIds: [cutoffId], evidenceIds: [cutoffId, 'DOC-I019'],
    },
  }
  return {
    ledger, documents,
    findings: errors.map((type): Finding => ({ ...descriptions[type], id: type, type, currency })),
  }
}

export function createEpisode(config: EpisodeConfig): Episode {
  const { ledger, documents } = buildFixture(config)
  return {
    id: `FIN-${Object.keys(SCENARIOS).indexOf(config.scenario) + 1}-${config.seed}`,
    config, status: 'running', stepBudget: STEP_BUDGET, stepsRemaining: STEP_BUDGET,
    ledger, documents, trace: [], result: null,
  }
}

export function advanceEpisode(episode: Episode): Episode {
  if (episode.status !== 'running') return episode

  const stepsRemaining = episode.stepsRemaining - 1
  const number = episode.trace.length + 1
  const documents = episode.documents.map(({ id }): RecordRef => ({ source: 'documents', id }))
  const ledger = episode.ledger.map(({ id }): RecordRef => ({ source: 'ledger', id }))
  const queries: Array<Pick<AuditStep, 'action' | 'params' | 'records' | 'observation'>> = [
    { action: 'list_records', params: { table: 'ledger', cursor: null, limit: 20 }, records: ledger, observation: `Получено проводок — ${ledger.length}.` },
    { action: 'get_record', params: { table: 'ledger', id: 'L-104' }, records: ledger.slice(0, 1), observation: 'Открыта связанная со счётом проводка L-104.' },
    { action: 'get_document', params: { doc_id: 'DOC-I019' }, records: documents.slice(0, 1), observation: 'Открыт первичный счёт DOC-I019.' },
  ]
  const errors: readonly ErrorType[] = SCENARIOS[episode.config.scenario].errors
  if (errors.includes('partial_allocation') || errors.includes('fx_rate')) {
    queries.push({ action: 'get_document', params: { doc_id: 'DOC-P042' }, records: documents.slice(2, 3),
      observation: 'Получены исходная сумма и условия второго платежа.' })
  }
  const query = queries[number - 1]
  if (query) {
    const step: AuditStep = { ...query, number, spentSteps: 1, stepsRemaining, status: 'ok' }
    return { ...episode, stepsRemaining, trace: [...episode.trace, step] }
  }

  const { findings } = buildFixture(episode.config)
  const hasFindings = findings.length > 0
  const step: AuditStep = {
    action: 'submit', records: [],
    params: {
      episode_id: episode.id,
      findings: findings.map((finding) => ({
        type: finding.type, affected_ids: finding.affectedIds, claimed_amount_minor: finding.amountMinor,
        currency: finding.currency, evidence_ids: finding.evidenceIds, explanation: finding.explanation,
      })),
    },
    observation: 'Проверка завершена. Итог доступен в Results.',
    number, spentSteps: 1, stepsRemaining, status: 'terminated',
  }
  return {
    ...episode, stepsRemaining, status: 'completed', trace: [...episode.trace, step],
    result: { findings, precision: hasFindings ? 1 : 0, recall: hasFindings ? 1 : 0, f1: 1, reward: 1 - 0.002 * (number - 1) },
  }
}
