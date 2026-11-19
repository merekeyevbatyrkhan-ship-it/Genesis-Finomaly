import type { AuditStep, DocumentRecord, Episode, EpisodeConfig, Finding, LedgerRecord } from './auditTypes'
import { SCENARIOS } from './auditTypes'
import { advanceEpisode, createEpisode } from './mockAudit'

const baseUrl = (import.meta.env.VITE_AUDIT_API_URL as string | undefined)?.trim().replace(/\/+$/, '')
export const auditMode = baseUrl ? 'api' : 'demo'

type JsonObject = Record<string, unknown>
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const nonnegative = (value: unknown): value is number => integer(value) && value >= 0
const currency = (value: unknown): value is string => text(value) && /^[A-Z]{3}$/.test(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function jsonValue(value: unknown, depth = 0): boolean {
  if (value === null || text(value) || finite(value) || typeof value === 'boolean') return true
  if (depth >= 16) return false
  if (Array.isArray(value)) return value.every((item) => jsonValue(item, depth + 1))
  return object(value) && Object.values(value).every((item) => jsonValue(item, depth + 1))
}

function publicRecord(value: unknown): value is JsonObject {
  return object(value) && text(value.id) && text(value.date) && integer(value.amountMinor) &&
    currency(value.currency) && text(value.counterparty) && text(value.invoiceId)
}

function isLedger(value: unknown): value is LedgerRecord {
  return publicRecord(value) && text(value.description) && strings(value.documentIds)
}

function isDocument(value: unknown): value is DocumentRecord {
  return publicRecord(value) && text(value.reference) &&
    (value.kind === 'Счёт' || value.kind === 'Платёж' || value.kind === 'Курс FX') &&
    (value.note === undefined || text(value.note))
}

function isStep(value: unknown, index: number): value is AuditStep {
  return object(value) && value.number === index + 1 && text(value.action) && text(value.observation) &&
    nonnegative(value.spentSteps) && nonnegative(value.stepsRemaining) &&
    ['ok', 'error', 'terminated', 'truncated'].includes(String(value.status)) &&
    object(value.params) && jsonValue(value.params) &&
    Array.isArray(value.records) && value.records.every((item) =>
      object(item) && (item.source === 'ledger' || item.source === 'documents') && text(item.id))
}

function isFinding(value: unknown): value is Finding {
  return object(value) && text(value.id) && text(value.title) && text(value.explanation) &&
    ['duplicate_invoice', 'partial_allocation', 'fx_rate', 'period_cutoff'].includes(String(value.type)) &&
    integer(value.amountMinor) && currency(value.currency) && strings(value.affectedIds) && strings(value.evidenceIds)
}

function decodeEpisode(payload: unknown, config: EpisodeConfig): Episode {
  if (!object(payload)) throw invalidResponse()
  const { id, status, stepBudget, stepsRemaining, ledger, documents, trace, result } = payload
  if (!text(id) || !id || (status !== 'running' && status !== 'completed' && status !== 'truncated') ||
    !nonnegative(stepBudget) || stepBudget === 0 || !nonnegative(stepsRemaining) ||
    stepsRemaining > stepBudget || !Array.isArray(ledger) || !ledger.every(isLedger) ||
    !Array.isArray(documents) || !documents.every(isDocument) || !Array.isArray(trace) || !trace.every(isStep)) {
    throw invalidResponse()
  }
  if (result === null) {
    return { id, status, config, stepBudget, stepsRemaining, ledger, documents, trace, result }
  }
  if (status === 'running' || !object(result) ||
    !finite(result.precision) || !finite(result.recall) || !finite(result.f1) || !finite(result.reward) ||
    !Array.isArray(result.findings) || !result.findings.every(isFinding) ||
    (status === 'truncated' && result.findings.length !== 0)) {
    throw invalidResponse()
  }
  return {
    id, status, config, stepBudget, stepsRemaining, ledger, documents, trace,
    result: { precision: result.precision, recall: result.recall, f1: result.f1, reward: result.reward, findings: result.findings },
  }
}

function invalidResponse() {
  return new Error('Ответ API не соответствует контракту FINOMALY.')
}

async function post(path: string, body: object): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('API недоступен или истекло время ожидания. Проверьте сервер и повторите действие.')
  }
  if (!response.ok) throw new Error('API вернул ошибку HTTP ' + response.status + '.')
  try {
    return await response.json()
  } catch {
    throw invalidResponse()
  }
}

export async function startAudit(config: EpisodeConfig): Promise<Episode> {
  if (!baseUrl) return createEpisode(config)
  const payload = await post('/episodes', {
    company_name: config.companyName,
    scenario: config.scenario,
    error_types: SCENARIOS[config.scenario].errors,
    seed: config.seed,
    base_currency: config.baseCurrency,
    period_start: config.periodStart,
    period_end: config.periodEnd,
  })
  return decodeEpisode(payload, config)
}

export async function stepAudit(episode: Episode): Promise<Episode> {
  if (!baseUrl) return advanceEpisode(episode)
  const next = decodeEpisode(await post('/episodes/' + encodeURIComponent(episode.id) + '/step', {
    expected_step: episode.trace.length + 1,
  }), episode.config)
  if (next.id !== episode.id || next.trace.length <= episode.trace.length) throw invalidResponse()
  return next
}
