import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { createTerrainMesh, drawTerrain } from './terrainMesh'
import initialTerrain from './assets/brand/signal-terrain.webp'
import smallTerrain from './assets/brand/signal-terrain-mobile.webp'

const turn = Math.PI * 2
const turnDuration = 48_000
const frameInterval = 1000 / 30
const normalize = (angle: number) => ((angle % turn) + turn) % turn

export function OrbitCanvas({seed, playing, angle, instructions, onUnavailable}: {
  seed: number
  playing: boolean
  angle: RefObject<number>
  instructions: string
  onUnavailable: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const mesh = useMemo(() => createTerrainMesh(seed), [seed])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const context = element.getContext('2d')
    if (!context) { onUnavailable(); return }
    const node = element
    const ctx = context
    let visible = false
    let frame = 0
    let previousTime: number | null = null
    let pointer: number | null = null
    let startX = 0
    let startAngle = 0
    let width = 0
    let height = 0
    let dirty = true
    let lastDegree = -1

    function schedule() {
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(paint)
    }
    function stopClock() {
      cancelAnimationFrame(frame)
      frame = 0
      previousTime = null
    }
    function paint(time: number) {
      frame = 0
      if (!visible || document.hidden || !width || !height) return
      const running = playing && pointer === null
      const elapsed = previousTime === null ? 0 : time - previousTime
      if (dirty || previousTime === null || (running && elapsed >= frameInterval - 1)) {
        if (running) angle.current = normalize(angle.current + Math.min(elapsed, 100) * turn / turnDuration)
        previousTime = time
        drawTerrain(ctx, mesh, angle.current, width, height)
        if (!node.dataset.ready) node.dataset.ready = 'true'
        const degree = Math.round(angle.current * 360 / turn) % 360
        if (degree !== lastDegree) {
          node.setAttribute('aria-valuenow', String(degree))
          node.setAttribute('aria-valuetext', degree + '°')
          lastDegree = degree
        }
        dirty = false
      }
      if (running) schedule()
    }
    function resize() {
      const rect = node.getBoundingClientRect()
      width = rect.width
      height = rect.height
      if (width < 1 || height < 1) return
      const density = Math.min(window.devicePixelRatio || 1, 2, 1700 / width)
      const pixelsWide = Math.round(width * density)
      const pixelsHigh = Math.round(height * density)
      if (node.width !== pixelsWide) node.width = pixelsWide
      if (node.height !== pixelsHigh) node.height = pixelsHigh
      ctx.setTransform(node.width / width, 0, 0, node.height / height, 0, 0)
      dirty = true
      schedule()
    }
    function down(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || pointer !== null) return
      pointer = event.pointerId
      startX = event.clientX
      startAngle = angle.current
      node.setPointerCapture(pointer)
      node.dataset.dragging = 'true'
      stopClock()
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointer) return
      angle.current = normalize(startAngle + (event.clientX - startX) / Math.max(width, 180) * turn)
      dirty = true
      schedule()
    }
    function end(event: PointerEvent) {
      if (event.pointerId !== pointer) return
      pointer = null
      delete node.dataset.dragging
      previousTime = null
      schedule()
    }
    function key(event: KeyboardEvent) {
      const step = turn / 24
      switch (event.key) {
        case 'ArrowRight': case 'ArrowUp': angle.current = normalize(angle.current + step); break
        case 'ArrowLeft': case 'ArrowDown': angle.current = normalize(angle.current - step); break
        case 'Home': angle.current = 0; break
        case 'End': angle.current = 359 * turn / 360; break
        default: return
      }
      event.preventDefault()
      previousTime = null
      dirty = true
      schedule()
    }
    function syncVisibility() {
      stopClock()
      dirty = true
      schedule()
    }
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      syncVisibility()
    })
    const size = new ResizeObserver(resize)
    size.observe(node)
    intersection.observe(node)
    node.addEventListener('pointerdown', down)
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', end)
    node.addEventListener('lostpointercapture', end)
    node.addEventListener('pointercancel', end)
    node.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', syncVisibility)
    resize()
    return () => {
      stopClock()
      intersection.disconnect()
      size.disconnect()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', end)
      node.removeEventListener('pointercancel', end)
      node.removeEventListener('lostpointercapture', end)
      node.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', syncVisibility)
      if (pointer !== null && node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer)
      delete node.dataset.dragging
    }
  }, [mesh, playing, angle, onUnavailable])

  return <>
    <canvas className="terrain-canvas" ref={canvas} role="slider" tabIndex={0}
      aria-label="Угол поворота модели" aria-describedby={instructions}
      aria-valuemin={0} aria-valuemax={359} aria-valuenow={0}/>
    {seed === 42 && <picture className="terrain-poster" aria-hidden="true">
      <source media="(max-width: 700px)" srcSet={smallTerrain}/>
      <img className="terrain-svg terrain-image" src={initialTerrain} alt="" width="1200" height="668" fetchPriority="high"/>
    </picture>}
  </>
}
