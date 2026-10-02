/**
 * Source: SuperSgdk/DSH-Liquid-Glass-Theme (AGPL-3.0-only).
 * Original project by John Wu (WYH66666666), copyright 2026.
 * Independent portable adaptation by SuperSgdk. See PROVENANCE.txt.
 */
/**
 * The grid geometry, pointer displacement and drawing below were independently
 * rewritten for this portable renderer in 2026. The previous website grid
 * implementation is removed. The public mount API and DOM lifecycle retain
 * the AGPL source project's attribution above.
 *
 * Each point follows a radial displacement target with exponential easing.
 * There is no mass/spring simulation: a stationary target settles and stops
 * scheduling frames. Touch and reduced-motion modes draw an unmoving grid.
 */

const CELL_LIMIT = 104
const POINTER_REACH = 190
const POINTER_SHIFT = 26
const FOLLOW_TIME = 110
const FRAME_INTERVAL = 1000 / 30
const RESIZE_DELAY = 140

/** Mesh handle: disposal. */
export interface MeshHandle {
  /** Stop the renderer and remove its canvas. */
  dispose: () => void
}

interface GridPoint {
  anchorX: number
  anchorY: number
  offsetX: number
  offsetY: number
  emphasis: number
}

/** Attach a decorative grid without changing the host's layout. */
export function mountMesh(host: HTMLElement): MeshHandle {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-fluid-mesh', '')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
  })
  host.appendChild(canvas)
  const context = canvas.getContext('2d')
  if (context === null) {
    canvas.remove()
    return { dispose: () => {} }
  }

  const staticMode = typeof matchMedia !== 'undefined' && (
    matchMedia('(prefers-reduced-motion: reduce)').matches
    || matchMedia('(hover: none), (pointer: coarse)').matches
  )
  let closed = false
  let visible = true
  let width = 0
  let height = 0
  let ratio = 0
  let columns = 0
  let points: GridPoint[] = []
  let pointer: { x: number; y: number } | undefined
  let frameToken = 0
  let resizeToken = 0
  let lastPaint = 0

  const measure = (): boolean => {
    const nextWidth = Math.max(0, canvas.clientWidth)
    const nextHeight = Math.max(0, canvas.clientHeight)
    const nextRatio = Math.min(window.devicePixelRatio || 1, 2)
    if (width === nextWidth && height === nextHeight && ratio === nextRatio) return false
    width = nextWidth
    height = nextHeight
    ratio = nextRatio
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    return true
  }

  const makeGrid = (): void => {
    points = []
    if (width === 0 || height === 0) { columns = 0; return }
    const horizontalCells = Math.max(1, Math.ceil(width / CELL_LIMIT))
    const verticalCells = Math.max(1, Math.ceil(height / CELL_LIMIT))
    columns = horizontalCells + 1
    const count = columns * (verticalCells + 1)
    for (let index = 0; index < count; index += 1) {
      points.push({
        anchorX: (index % columns) * width / horizontalCells,
        anchorY: Math.floor(index / columns) * height / verticalCells,
        offsetX: 0, offsetY: 0, emphasis: 0,
      })
    }
  }

  const paint = (): void => {
    context.clearRect(0, 0, width, height)
    context.strokeStyle = 'rgba(93, 131, 179, 0.09)'
    context.lineWidth = 0.7
    context.beginPath()
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const links = []
      if (index % columns + 1 < columns) links.push(points[index + 1])
      if (index + columns < points.length) links.push(points[index + columns])
      for (const neighbor of links) {
        context.moveTo(point.anchorX + point.offsetX, point.anchorY + point.offsetY)
        context.lineTo(neighbor.anchorX + neighbor.offsetX, neighbor.anchorY + neighbor.offsetY)
      }
    }
    context.stroke()
    context.fillStyle = '#658BB9'
    for (const point of points) {
      const side = 2.6 + point.emphasis * 1.2
      context.globalAlpha = 0.18 + point.emphasis * 0.20
      context.fillRect(point.anchorX + point.offsetX - side / 2,
        point.anchorY + point.offsetY - side / 2, side, side)
    }
    context.globalAlpha = 1
  }

  const schedule = (): void => {
    if (!closed && visible && !staticMode && frameToken === 0) {
      frameToken = requestAnimationFrame(tick)
    }
  }

  const resize = (): void => {
    if (closed || !measure()) return
    window.clearTimeout(resizeToken)
    resizeToken = window.setTimeout(() => {
      resizeToken = 0
      if (closed) return
      makeGrid()
      if (staticMode) paint()
      else schedule()
    }, RESIZE_DELAY)
  }

  const tick = (timestamp: number): void => {
    frameToken = 0
    if (closed || !visible) return
    // RAF also detects a measurement change if a browser delays its observer.
    if (measure()) {
      window.clearTimeout(resizeToken)
      resizeToken = 0
      makeGrid()
    }
    if (resizeToken !== 0) return
    const elapsed = timestamp - lastPaint
    if (elapsed < FRAME_INTERVAL) { schedule(); return }
    lastPaint = timestamp
    const follow = 1 - Math.exp(-Math.min(elapsed, 100) / FOLLOW_TIME)
    let moving = false
    for (const point of points) {
      let targetX = 0
      let targetY = 0
      point.emphasis = 0
      if (pointer !== undefined) {
        const dx = point.anchorX - pointer.x
        const dy = point.anchorY - pointer.y
        const distance = Math.hypot(dx, dy)
        const weight = Math.exp(-((distance / POINTER_REACH) ** 2))
        const shift = POINTER_SHIFT * weight / Math.max(distance, 1)
        targetX = dx * shift
        targetY = dy * shift
        point.emphasis = weight
      }
      point.offsetX += (targetX - point.offsetX) * follow
      point.offsetY += (targetY - point.offsetY) * follow
      if (Math.abs(targetX - point.offsetX) + Math.abs(targetY - point.offsetY) > 0.03) {
        moving = true
      } else {
        point.offsetX = targetX
        point.offsetY = targetY
      }
    }
    paint()
    if (moving) schedule()
  }

  const move = (event: PointerEvent): void => {
    if (closed) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    pointer = { x, y }
    schedule()
  }
  const rest = (): void => {
    if (closed) return
    pointer = undefined
    schedule()
  }

  measure()
  makeGrid()
  const sizeObserver = new ResizeObserver(resize)
  sizeObserver.observe(host)
  window.addEventListener('resize', resize)
  let visibilityObserver: IntersectionObserver | undefined
  if (staticMode) {
    paint()
  } else {
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerleave', rest)
    window.addEventListener('blur', rest)
    visibilityObserver = new IntersectionObserver(entries => {
      if (closed) return
      visible = entries[0]?.isIntersecting ?? false
      if (visible) schedule()
      else {
        cancelAnimationFrame(frameToken)
        frameToken = 0
      }
    })
    visibilityObserver.observe(canvas)
    schedule()
  }

  return {
    dispose: () => {
      if (closed) return
      closed = true
      cancelAnimationFrame(frameToken)
      window.clearTimeout(resizeToken)
      frameToken = 0
      resizeToken = 0
      sizeObserver.disconnect()
      visibilityObserver?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerleave', rest)
      window.removeEventListener('blur', rest)
      canvas.remove()
    },
  }
}
