import { BASE_CURRENCIES, SCENARIOS, STEP_BUDGET } from './auditTypes'
import type { Episode, EpisodeConfig } from './auditTypes'
import { createEpisode, advanceEpisode } from './mockAudit'

// Для повтора демо достаточно условий и номера действия. Проводки и отчёт
// восстанавливаются из генератора. Каждая вкладка ведёт свой эпизод.
const key = 'finomaly.demo.session.v1'
const dateOK = (date: unknown): date is string => typeof date === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' && date <= '9998-12-31' &&
  new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date

function configOK(value: unknown): value is EpisodeConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<EpisodeConfig>
  return typeof c.companyName === 'string' && c.companyName.trim().length > 0 && c.companyName.length <= 80 &&
    typeof c.scenario === 'string' && Object.hasOwn(SCENARIOS, c.scenario) &&
    typeof c.baseCurrency === 'string' && Object.hasOwn(BASE_CURRENCIES, c.baseCurrency) &&
    typeof c.seed === 'number' && Number.isInteger(c.seed) && c.seed >= 0 && c.seed <= 4294967295 &&
    dateOK(c.periodStart) && dateOK(c.periodEnd) && c.periodEnd >= c.periodStart
}

export function restoreDemo(): Episode | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const {config, steps} = JSON.parse(raw)
    if (!configOK(config) || !Number.isInteger(steps) || steps < 0 || steps > STEP_BUDGET) return null
    let episode = createEpisode(config)
    for (let i = 0; i < steps && episode.status === 'running'; i++) episode = advanceEpisode(episode)
    return episode
  } catch { return null }
}

export function rememberDemo(episode: Episode) {
  try { sessionStorage.setItem(key, JSON.stringify({config: episode.config, steps: episode.trace.length})) }
  catch { /* При закрытом хранилище эпизод остаётся в памяти. */ }
}
