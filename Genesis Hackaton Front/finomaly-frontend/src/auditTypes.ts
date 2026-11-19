export const SCENARIOS = {
  duplicate_invoice: { title: 'Дублирование счетов', description: 'Одно начисление проведено дважды', errors: ['duplicate_invoice'] },
  partial_allocation: { title: 'Частичное распределение платежа', description: 'Часть платежа не отнесена на счёт', errors: ['partial_allocation'] },
  fx_rate: { title: 'Ошибка валютного курса', description: 'Применён неверный курс пересчёта', errors: ['fx_rate'] },
  period_cutoff: { title: 'Ошибка отчётного периода', description: 'Начисление отражено за пределами периода', errors: ['period_cutoff'] },
  allocation_fx: { title: 'Распределение + валютный курс', description: 'Обе ошибки влияют на один платёж', errors: ['partial_allocation', 'fx_rate'] },
  duplicate_cutoff: { title: 'Дубликат + отчётный период', description: 'Повторное начисление попадает в другой период', errors: ['duplicate_invoice', 'period_cutoff'] },
  clean: { title: 'Компания без ошибок', description: 'Согласованные записи и документы', errors: [] },
} as const

export type Scenario = keyof typeof SCENARIOS
export type ErrorType = 'duplicate_invoice' | 'partial_allocation' | 'fx_rate' | 'period_cutoff'

export type EpisodeConfig = {
  companyName: string
  scenario: Scenario
  seed: number
  baseCurrency: string
  periodStart: string
  periodEnd: string
}

type PublicRecord = {
  id: string
  date: string
  amountMinor: number
  currency: string
  counterparty: string
  invoiceId: string
}

export type LedgerRecord = PublicRecord & {
  description: string
  documentIds: string[]
}

export type DocumentRecord = PublicRecord & {
  reference: string
  kind: 'Счёт' | 'Платёж' | 'Курс FX'
  note?: string
}

export type RecordRef = { source: 'ledger' | 'documents'; id: string }

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type AuditStep = {
  number: number
  action: string
  params: Record<string, JsonValue>
  records: RecordRef[]
  spentSteps: number
  stepsRemaining: number
  status: 'ok' | 'error' | 'terminated' | 'truncated'
  observation: string
}

export type Finding = {
  id: string
  type: ErrorType
  title: string
  explanation: string
  amountMinor: number
  currency: string
  affectedIds: string[]
  evidenceIds: string[]
}

export type AuditResult = {
  precision: number
  recall: number
  f1: number
  reward: number
  findings: Finding[]
}

export type Episode = {
  id: string
  config: EpisodeConfig
  status: 'running' | 'completed' | 'truncated'
  stepBudget: number
  stepsRemaining: number
  ledger: LedgerRecord[]
  documents: DocumentRecord[]
  trace: AuditStep[]
  result: AuditResult | null
}

export const STEP_BUDGET = 100

export const episodeStatus: Record<Episode['status'], string> = {
  running: 'В процессе', completed: 'Завершён', truncated: 'Исчерпан лимит',
}

export const periodLabel = (config: EpisodeConfig) => `${config.periodStart} — ${config.periodEnd}`

const amountFormatters = new Map<string, Intl.NumberFormat>()

export function formatAmount(amountMinor: number, currency: string) {
  let formatter = amountFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', { style: 'currency', currency })
    amountFormatters.set(currency, formatter)
  }
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amountMinor / 10 ** digits)
}
