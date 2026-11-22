import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { OrbitCanvas } from './OrbitCanvas'
import { signalHeight } from './terrainMesh'

const motionQuery = '(prefers-reduced-motion: reduce)'
function motionPreference() { return window.matchMedia(motionQuery).matches }
function subscribeToMotion(change: () => void) {
  const media = window.matchMedia(motionQuery)
  media.addEventListener('change', change)
  return () => media.removeEventListener('change', change)
}

// 2D показывает срез той же поверхности через отмеченный пик.
function SignalSlice({seed}: {seed: number}) {
  const heightAt = (x: number) => 246 - signalHeight(x, -.18, seed) * 125
  const path = useMemo(() => Array.from({length: 97}, (_, i) => {
    const x = i / 48 - 1
    return (i ? 'L' : 'M') + (44 + i / 96 * 550).toFixed(1) + ',' + (246 - signalHeight(x, -.18, seed) * 125).toFixed(1)
  }).join(''), [seed])
  return <svg viewBox="0 0 640 356" className="terrain-svg" role="img" aria-label="Срез модели сигнала с отмеченным пиком">
    <defs>
      <linearGradient id="slice-ink"><stop stopColor="#796ac4"/><stop offset=".5" stopColor="#c8acff"/><stop offset="1" stopColor="#62e6e3"/></linearGradient>
      <linearGradient id="slice-fill" x2="0" y2="1"><stop stopColor="#b19bff" stopOpacity=".45"/><stop offset="1" stopColor="#a398ff" stopOpacity=".015"/></linearGradient>
      <pattern id="slice-dots" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#b5adff" opacity=".4"/></pattern>
    </defs>
    <rect x="15" y="18" width="610" height="307" fill="url(#slice-dots)"/>
    <g className="terrain-projection">
      {[96, 146, 196, 246].map(y => <path key={y} d={'M44 '+y+'H594'} fill="none" stroke="#575576" strokeWidth=".7" strokeDasharray="3 6"/>)}
      <path d={path + 'L594,246H44Z'} fill="url(#slice-fill)"/>
      <path d={path} fill="none" stroke="url(#slice-ink)" strokeWidth="2.4"/>
      <g transform={'translate(385 '+heightAt(.24)+')'}>
        <circle r="8" fill="#ffdb9522" stroke="#f4dfa9" strokeWidth=".8"/><circle r="3" fill="#ffefc0"/>
        <path d="M4 -4 17 -19h31" fill="none" stroke="#f4dfa9" strokeWidth=".85"/>
        <text x="52" y="-15.5" fill="#ffe5b6" fontSize="12" fontFamily="Inter, sans-serif">Пик</text>
      </g>
    </g>
  </svg>
}

export function SignalTerrain({seed}: {seed: number}) {
  const [flat, setFlat] = useState(false)
  const [canOrbit, setCanOrbit] = useState(true)
  const reduced = useSyncExternalStore(subscribeToMotion, motionPreference, () => true)
  const [manualPlay, setManualPlay] = useState<boolean | null>(null)
  const playing = manualPlay ?? !reduced
  const angle = useRef(0)
  const instructions = useId()
  const fallback = useCallback(() => { setCanOrbit(false); setFlat(true) }, [])
  const playbackTitle = playing ? 'Приостановить вращение' : 'Включить вращение'

  return <div className="terrain">
    <div className="terrain-mode" role="group" aria-label="Управление моделью сигнала">
      {!flat && <button type="button" className="terrain-playback" onClick={() => setManualPlay(!playing)}
        title={playbackTitle} aria-label={playbackTitle}>
        <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14" fill="currentColor">
          {playing ? <path d="M4 3h2.5v10H4zm5.5 0H12v10H9.5z"/> : <path d="m4.5 2.7 8.5 5.3-8.5 5.3z"/>}
        </svg>
      </button>}
      {['3D','2D'].map((mode, i) => <button key={mode} type="button" aria-pressed={flat === Boolean(i)}
        disabled={!i && !canOrbit} aria-label={i ? '2D — срез модели' : '3D — рельеф модели'}
        onClick={() => setFlat(Boolean(i))}>{mode}</button>)}
    </div>
    <div className="terrain-viewport">
      {flat ? <SignalSlice seed={seed}/> :
        <OrbitCanvas seed={seed} playing={playing} angle={angle} instructions={instructions} onUnavailable={fallback}/>}
    </div>
    {!flat && <span className="terrain-gesture" aria-hidden="true">↔ Потяните для поворота</span>}
    <span id={instructions} className="sr-only">Перетаскивайте модель по горизонтали или поворачивайте стрелками. Home возвращает исходный ракурс.</span>
    <span className="terrain-caption"><span aria-hidden="true"/>Модель сигнала <i/> seed {seed}</span>
  </div>
}

