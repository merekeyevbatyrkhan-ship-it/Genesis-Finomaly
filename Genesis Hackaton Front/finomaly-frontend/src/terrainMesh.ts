const PEAK_X = .24
const PEAK_Z = -.18
const COLUMNS = 48
const ROWS = 56
const STRIDE = COLUMNS + 1

function gaussian(x: number, z: number, kx: number, kz: number) {
  return Math.exp(-(x * x * kx + z * z * kz))
}

// Тот же профиль используется для среза в режиме 2D.
export function signalHeight(x: number, z: number, seed: number) {
  const phase = (seed % 137) * .035
  const main = 1.35 * gaussian(x - PEAK_X, z - PEAK_Z, 12, 8)
  const shoulder = .58 * gaussian(x + .43, z + .16, 15, 9)
  const ridge = .23 * gaussian(x - .58, z - .38, 14, 10)
  const envelope = (1 - x ** 4) * (1 - z ** 4)
  const wave = .055 * Math.sin(x * 10 + z * 4 + phase) + .035 * Math.cos(z * 13 - x * 5 + phase)
  return Math.max(.004, (main + shoulder + ridge + .1 + wave) * envelope)
}

export function createTerrainMesh(seed: number) {
  const size = STRIDE * (ROWS + 1)
  const elevation = new Float32Array(size)
  for (let row = 0; row <= ROWS; row++) {
    for (let column = 0; column <= COLUMNS; column++) {
      elevation[row * STRIDE + column] = signalHeight(2 * column / COLUMNS - 1, 2 * row / ROWS - 1, seed) * 130
    }
  }
  return {
    elevation,
    peakHeight: signalHeight(PEAK_X, PEAK_Z, seed) * 130,
    // Буферы экранных координат переиспользуются между кадрами.
    screenX: new Float32Array(size),
    screenY: new Float32Array(size),
  }
}

let gridPath: Path2D | undefined
function drawGrid(ctx: CanvasRenderingContext2D) {
  if (!gridPath) {
    gridPath = new Path2D()
    for (let y = 18; y < 324; y += 17) {
      for (let x = 18; x < 625; x += 17) gridPath.rect(x, y, 1.1, 1.1)
    }
  }
  ctx.fillStyle = 'rgba(185,173,241,.36)'
  ctx.fill(gridPath)
}

function drawPeak(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 17)
  glow.addColorStop(0, '#ffe4b4')
  glow.addColorStop(.27, 'rgba(255,211,147,.48)')
  glow.addColorStop(1, 'rgba(255,207,150,0)')
  ctx.fillStyle = glow
  ctx.fillRect(x - 17, y - 17, 34, 34)
  ctx.beginPath()
  ctx.arc(x, y, 6, 0, 2 * Math.PI)
  ctx.strokeStyle = '#ffdeb0'
  ctx.lineWidth = .9
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 2.6, 0, 2 * Math.PI)
  ctx.fillStyle = '#fff0c6'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + 4, y - 4)
  ctx.lineTo(x + 18, y - 18)
  ctx.lineTo(x + 47, y - 18)
  ctx.stroke()
  ctx.font = '12px Inter, sans-serif'
  ctx.fillText('Пик', x + 52, y - 14.5)
}

/** Ортографическая камера вращается вокруг вертикали. yaw задаётся в радианах. */
export function drawTerrain(ctx: CanvasRenderingContext2D, mesh: ReturnType<typeof createTerrainMesh>,
  yaw: number, width: number, height: number) {
  if (width <= 0 || height <= 0) return
  const scale = Math.min(width / 640, height / 356)
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.translate((width - 640 * scale) / 2, (height - 356 * scale) / 2)
  ctx.scale(scale, scale)
  drawGrid(ctx)

  const c = Math.cos(yaw), s = Math.sin(yaw)
  const horizontalX = 214 * c - 76 * s, horizontalZ = -214 * s - 76 * c
  const depthX = 22 * c + 69 * s, depthZ = -22 * s + 69 * c
  // Поворот квадрата по диагонали не должен обрезать ближние углы.
  const fit = Math.min(1, 306 / (Math.abs(horizontalX) + Math.abs(horizontalZ)))
  const { screenX, screenY, elevation } = mesh
  for (let row = 0; row <= ROWS; row++) {
    const z = row * 2 / ROWS - 1
    const originX = 320 + (horizontalZ * z - horizontalX) * fit
    const originY = 236 + (depthZ * z - depthX) * fit
    const dx = 2 * horizontalX * fit / COLUMNS
    const dy = 2 * depthX * fit / COLUMNS
    for (let col = 0; col <= COLUMNS; col++) {
      const index = row * STRIDE + col
      screenX[index] = originX + col * dx
      screenY[index] = originY + col * dy - elevation[index]
    }
  }

  const surface = ctx.createLinearGradient(28, 0, 616, 0)
  surface.addColorStop(0, '#211e37')
  surface.addColorStop(.52, '#29253f')
  surface.addColorStop(1, '#183137')
  const wire = ctx.createLinearGradient(28, 0, 616, 0)
  wire.addColorStop(0, '#7562ba')
  wire.addColorStop(.35, '#b097f5')
  wire.addColorStop(.59, '#c4b3fc')
  wire.addColorStop(.82, '#87c5dc')
  wire.addColorStop(1, '#65d7cb')

  // Рисуем дальние полосы первыми. Выбор ведущей оси сохраняет видимость
  // рёбер по всему кругу без сортировки каждой отдельной ячейки сетки.
  const byRow = Math.abs(depthZ) >= Math.abs(depthX)
  const bands = byRow ? ROWS : COLUMNS
  const segments = byRow ? COLUMNS : ROWS
  const stride = byRow ? STRIDE : 1
  const along = byRow ? 1 : STRIDE
  const direction = (byRow ? depthZ : depthX) >= 0 ? 1 : -1
  let back = direction === 1 ? 0 : bands * stride
  ctx.lineJoin = 'round'
  for (let band = 0; band < bands; band++) {
    const front = back + direction * stride
    ctx.beginPath()
    ctx.moveTo(screenX[back], screenY[back])
    for (let i = 1; i <= segments; i++) {
      const k = back + i * along
      ctx.lineTo(screenX[k], screenY[k])
    }
    for (let i = segments; i >= 0; i--) {
      const k = front + i * along
      ctx.lineTo(screenX[k], screenY[k])
    }
    ctx.closePath()
    ctx.fillStyle = surface
    ctx.fill()

    ctx.beginPath()
    for (let i = 0; i <= segments; i++) {
      const offset = i * along
      ctx.moveTo(screenX[back + offset], screenY[back + offset])
      ctx.lineTo(screenX[front + offset], screenY[front + offset])
    }
    ctx.strokeStyle = wire
    ctx.lineWidth = byRow ? .54 : .91
    ctx.globalAlpha = byRow ? .58 : .88
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(screenX[front], screenY[front])
    for (let i = 1; i <= segments; i++) {
      const k = front + i * along
      ctx.lineTo(screenX[k], screenY[k])
    }
    ctx.lineWidth = byRow ? .91 : .54
    ctx.globalAlpha = byRow ? .88 : .58
    ctx.stroke()
    ctx.globalAlpha = 1
    back = front
  }
  drawPeak(ctx, 320 + (PEAK_X * horizontalX + PEAK_Z * horizontalZ) * fit,
    236 + (PEAK_X * depthX + PEAK_Z * depthZ) * fit - mesh.peakHeight)
  ctx.restore()
}
