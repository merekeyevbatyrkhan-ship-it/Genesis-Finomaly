import { useCallback, useEffect, useRef, useState } from 'react'
import { auditMode, startAudit, stepAudit } from './auditClient'
import { rememberDemo, restoreDemo } from './demoSession'
import type { Episode, EpisodeConfig } from './auditTypes'

export function useAuditRun() {
  const [episode, setEpisode] = useState<Episode | null>(() => auditMode === 'demo' ? restoreDemo() : null)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const requestInFlight = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const pause = useCallback(() => {
    window.clearTimeout(timer.current)
    setPlaying(false)
  }, [])

  const request = useCallback(async (action: () => Promise<Episode>) => {
    if (requestInFlight.current) return false
    requestInFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      if (auditMode === 'demo') rememberDemo(next)
      setEpisode(next)
      if (next.status !== 'running') pause()
      return true
    } catch (cause) {
      pause()
      setError(cause instanceof Error ? cause.message : 'Ошибка аудита.')
      return false
    } finally {
      requestInFlight.current = false
      setBusy(false)
    }
  }, [pause])

  function start(config: EpisodeConfig) {
    pause()
    return request(() => startAudit(config))
  }

  const nextStep = useCallback(() => {
    if (episode?.status === 'running') return request(() => stepAudit(episode))
  }, [episode, request])

  useEffect(() => {
    if (!playing || busy || episode?.status !== 'running') return
    timer.current = window.setTimeout(nextStep, 1000 / speed)
    return () => window.clearTimeout(timer.current)
  }, [playing, busy, episode?.status, nextStep, speed])

  return {
    episode, busy, error, playing, speed, setSpeed, start, nextStep, pause,
    play: () => setPlaying(true),
  }
}
