// SPDX-License-Identifier: AGPL-3.0-only
/** Blue-white shark particles, using the image-derived points confirmed by the user. */
import SHARK_DATA from './shark-particle-data.json'
import { assemblyDisplacement, createSharkAssemblyRenderer, SHARK_POINTS, type SharkAssemblyRenderer } from './shark-assembly-renderer.ts'

const FPS = 30
const EXTENT = Math.max(SHARK_DATA.width, SHARK_DATA.height)
const REST_POINTS = SHARK_POINTS
const ASSEMBLY_DURATION_MS = 900
const ASSEMBLY_FPS = 60

export interface ParticleMarkOptions {
  /** Play the entrance without first exposing the retained rest bitmap. */
  replayOnMount?: boolean
}

interface Particle {
  tx: number
  ty: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  phase: number
}

export interface ParticleMarkHandle {
  /** Reuse the existing artwork and canvas when the application changes chats. */
  setAnchor: (anchor: HTMLElement | null) => void
  /** Explicit chat-change burst; resizing never replays it. */
  replayAssembly: () => void
  /** Preserve the image's blue-white RGB in either scheme. */
  setDark: (dark: boolean) => void
  setPointerEnabled: (enabled: boolean) => void
  dispose: () => void
}

/** The retained bitmap moves as one layer; only pointer displacement redraws dots. */
export function mountParticleMark(host: HTMLElement, mainAnchor: HTMLElement, dark: boolean, pointer = true, options: ParticleMarkOptions = {}): ParticleMarkHandle {
  const holder = document.createElement('div')
  holder.setAttribute('data-codex-particle-mark', 'shark')
  holder.setAttribute('data-scheme', dark ? 'dark' : 'light')
  holder.style.cssText = 'position:absolute;transform:translate(-50%,-50%);pointer-events:none;opacity:0.76'
  holder.style.mixBlendMode = 'normal'
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  holder.appendChild(canvas)
  host.appendChild(holder)
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    holder.remove()
    return { setAnchor: () => {}, replayAssembly: () => {}, setDark: () => {}, setPointerEnabled: () => {}, dispose: () => {} }
  }

  const restCanvas = document.createElement('canvas')
  const restCtx = restCanvas.getContext('2d')
  const stylesheet = document.createElement('style')
  stylesheet.textContent = '@keyframes codex-particle-mark-float { from { transform:translate(-50%,-50%) translate(-.65px,-.55px); } to { transform:translate(-50%,-50%) translate(.65px,.55px); } }'
  holder.appendChild(stylesheet)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // Both renderers inherit the same floating transform. A replay can switch
  // canvases without reading computed styles during React's route layout.
  holder.style.animation = reduced ? 'none' : 'codex-particle-mark-float 9s ease-in-out infinite alternate'
  holder.style.animationPlayState = document.hidden ? 'paused' : 'running'

  let anchor: HTMLElement | null = mainAnchor
  // Mutable particle state is created only when the pointer reaches the artwork.
  let particles: Particle[] | null = null
  let simulating = false
  let raf = 0
  let disposed = false
  let previous = 0
  let width = 0
  let height = 0
  let dpr = 0
  let scale = 1
  let darkMode = dark
  let pointerEnabled = pointer && !reduced
  const mouse = { clientX: 0, clientY: 0, x: 0, y: 0, inside: false }
  let assemblyRenderer: SharkAssemblyRenderer | null = null
  let gpuCanvas: HTMLCanvasElement | null = null
  let gpuInitialized = false
  let warmup = 0
  let idleWarmup = false
  let assemblyRaf = 0
  let assemblyStart: number | null = null
  let lastAssemblyDraw = 0
  let assemblyRunning = false
  let assemblyPending = false
  // Only the entrance survives React's temporary missing chat column. Once
  // completed, normal chat replays keep their original cancel-on-removal rule.
  let initialAssemblyNeeded = !!options.replayOnMount && !reduced
  let fallbackDirty = false

  function syncDrift(): void {
    holder.style.animationPlayState = document.hidden || anchor === null || assemblyRunning || assemblyPending ? 'paused' : 'running'
  }

  function cancelWarmup(): void {
    if (!warmup) return
    if (idleWarmup && typeof cancelIdleCallback === 'function') cancelIdleCallback(warmup)
    else clearTimeout(warmup)
    warmup = 0
  }

  function ensureAssemblyRenderer(): void {
    if (disposed || reduced || gpuInitialized) return
    gpuInitialized = true
    gpuCanvas = document.createElement('canvas')
    gpuCanvas.setAttribute('aria-hidden', 'true')
    gpuCanvas.setAttribute('data-codex-shark-assembly', '')
    gpuCanvas.style.cssText = 'position:absolute;inset:0;display:none;width:100%;height:100%;pointer-events:none'
    holder.appendChild(gpuCanvas)
    assemblyRenderer = createSharkAssemblyRenderer(gpuCanvas)
  }

  function queueWarmup(): void {
    if (disposed || reduced || gpuInitialized || warmup) return
    const prepare = (): void => {
      warmup = 0
      if (disposed) return
      ensureAssemblyRenderer()
      // Preheat the driver's first draw while this canvas remains hidden.
      if (assemblyRenderer && !assemblyRenderer.render(0, width, height, dpr, scale)) {
        assemblyRenderer.dispose()
        assemblyRenderer = null
      }
      if (assemblyPending && anchor !== null && !document.hidden) startAssembly()
    }
    idleWarmup = typeof requestIdleCallback === 'function'
    warmup = idleWarmup ? requestIdleCallback(prepare, { timeout: 500 }) : setTimeout(prepare, 0)
  }

  function cancelAssembly(): void {
    if (assemblyRaf) cancelAnimationFrame(assemblyRaf)
    assemblyRaf = 0
    assemblyStart = null
    assemblyRunning = false
    assemblyPending = false
    if (gpuCanvas) gpuCanvas.style.display = 'none'
    canvas.style.visibility = ''
    if (fallbackDirty) restoreBitmap()
    fallbackDirty = false
    syncDrift()
  }

  function drawAssemblyFallback(progress: number): void {
    const displacement = assemblyDisplacement(progress)
    const side = Math.max(.65, scale / EXTENT * .69)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.clearRect(0, 0, width, height)
    ctx!.globalCompositeOperation = 'source-over'
    ctx!.globalAlpha = .9
    for (const point of REST_POINTS) {
      const x = width / 2 + (point.tx + point.sx * displacement) * scale
      const y = height / 2 + (point.ty + point.sy * displacement) * scale
      ctx!.fillStyle = point.color
      ctx!.fillRect(x - side / 2, y - side / 2, side, side)
    }
    ctx!.globalAlpha = 1
    fallbackDirty = true
  }

  function scheduleAssembly(): void {
    if (!disposed && anchor !== null && assemblyRunning && !document.hidden && !assemblyRaf) {
      assemblyRaf = requestAnimationFrame(tickAssembly)
    }
  }

  function deferAssembly(): void {
    cancelAssembly()
    assemblyPending = true
    canvas.style.visibility = 'hidden'
    syncDrift()
  }

  function tickAssembly(now: number): void {
    assemblyRaf = 0
    if (disposed || anchor === null || !assemblyRunning) return
    if (document.hidden) { deferAssembly(); return }
    if (assemblyStart === null) {
      assemblyStart = lastAssemblyDraw = now
      scheduleAssembly()
      return
    }
    const progress = (now - assemblyStart) / ASSEMBLY_DURATION_MS
    if (progress >= 1) {
      initialAssemblyNeeded = false
      cancelAssembly()
      return
    }
    // On high-refresh displays, retain rAF's wall clock but submit at most
    // 60 GPU draws a second. Carry fractional time forward rather than rounding
    // each interval to the next monitor frame and losing animation smoothness.
    const interval = 1000 / (assemblyRenderer ? ASSEMBLY_FPS : 15)
    const elapsed = now - lastAssemblyDraw
    if (elapsed + .001 < interval) { scheduleAssembly(); return }
    lastAssemblyDraw += Math.max(1, Math.floor((elapsed + .001) / interval)) * interval
    if (assemblyRenderer) {
      if (!assemblyRenderer.render(progress, width, height, dpr, scale)) {
        assemblyRenderer.dispose()
        assemblyRenderer = null
        if (gpuCanvas) gpuCanvas.style.display = 'none'
        canvas.style.visibility = ''
        drawAssemblyFallback(progress)
      }
    } else drawAssemblyFallback(progress)
    scheduleAssembly()
  }

  function startAssembly(): void {
    if (!gpuInitialized) {
      // A route change never compiles shaders synchronously. The pending request
      // starts after the single preheat task, even when it is the first quick click.
      assemblyPending = true
      canvas.style.visibility = 'hidden'
      syncDrift()
      queueWarmup()
      return
    }
    assemblyPending = false
    assemblyRunning = true
    assemblyStart = null
    lastAssemblyDraw = 0
    syncDrift()
    if (assemblyRenderer && gpuCanvas) {
      if (assemblyRenderer.render(0, width, height, dpr, scale)) {
        gpuCanvas.style.display = 'block'
        canvas.style.visibility = 'hidden'
      } else {
        assemblyRenderer.dispose()
        assemblyRenderer = null
      }
    }
    if (!assemblyRenderer) {
      canvas.style.visibility = ''
      drawAssemblyFallback(0)
    }
    scheduleAssembly()
  }

  function positionHost(): { width: number; height: number } | null {
    if (anchor === null) return null
    const rect = anchor.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const area = rect.width > 0 && rect.height > 0 ? rect : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    // Fit the visible contour, whose width/height are .77/.752 of the square.
    // The requested size is 1.2 times the previous 420px mark.
    const size = Math.floor(Math.max(1, Math.min(504, (area.width - 12) / .77, (area.height - 12) / .752)))
    holder.style.width = `${size}px`
    holder.style.height = `${size}px`
    holder.style.left = `${Math.round(area.left - hostRect.left + area.width / 2)}px`
    holder.style.top = `${Math.round(area.top - hostRect.top + area.height / 2)}px`
    return { width: size, height: size }
  }

  function updatePointer(): void {
    if (anchor === null) { mouse.inside = false; return }
    const rect = holder.getBoundingClientRect()
    mouse.x = (mouse.clientX - rect.left - width / 2) / scale
    mouse.y = (mouse.clientY - rect.top - height / 2) / scale
    mouse.inside = pointerEnabled && mouse.clientX >= rect.left && mouse.clientX <= rect.left + rect.width
      && mouse.clientY >= rect.top && mouse.clientY <= rect.top + rect.height
  }

  function drawPoints(target: CanvasRenderingContext2D, points: readonly { tx: number; ty: number; color: string }[], moving = false): void {
    target.setTransform(dpr, 0, 0, dpr, 0, 0)
    target.clearRect(0, 0, width, height)
    target.globalCompositeOperation = 'source-over'
    target.globalAlpha = .9
    const side = Math.max(.65, scale / EXTENT * .69)
    for (const point of points) {
      const particle = moving ? point as Particle : null
      const x = width / 2 + (particle ? particle.x : point.tx) * scale
      const y = height / 2 + (particle ? particle.y : point.ty) * scale
      target.fillStyle = point.color
      target.fillRect(x - side / 2, y - side / 2, side, side)
    }
    target.globalAlpha = 1
  }

  function restoreBitmap(): void {
    if (disposed) return
    if (restCtx === null) { drawPoints(ctx!, REST_POINTS); return }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.clearRect(0, 0, width, height)
    ctx!.globalAlpha = 1
    ctx!.globalCompositeOperation = 'source-over'
    ctx!.drawImage(restCanvas, 0, 0, width, height)
  }

  function finishInteraction(): void {
    mouse.inside = false
    previous = 0
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (!simulating) return
    simulating = false
    particles = null
    restoreBitmap()
  }

  function resize(): void {
    if (disposed) return
    const size = positionHost()
    if (size === null) return
    const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5)
    if (size.width === width && size.height === height && nextDpr === dpr) {
      if (mouse.inside) updatePointer()
      return
    }
    width = size.width
    height = size.height
    dpr = nextDpr
    canvas.width = restCanvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = restCanvas.height = Math.max(1, Math.round(height * dpr))
    scale = Math.min(width * .77 / (SHARK_DATA.width / EXTENT), height * .81 / (SHARK_DATA.height / EXTENT))
    if (restCtx !== null) drawPoints(restCtx, REST_POINTS)
    if (simulating && particles) {
      if (mouse.inside) updatePointer()
      drawPoints(ctx!, particles, true)
    } else restoreBitmap()
  }

  function schedule(): void {
    if (!disposed && anchor !== null && simulating && !reduced && !document.hidden && !raf) raf = requestAnimationFrame(tick)
  }

  function tick(now: number): void {
    raf = 0
    if (disposed || document.hidden || !simulating || particles === null) return
    if (previous && now - previous < 1000 / FPS) { schedule(); return }
    const dt = previous ? Math.min((now - previous) / 1000, .035) : 1 / 60
    previous = now
    const damping = Math.exp(-7.5 * dt)
    const radius = Math.max(48, Math.min(90, width * .12)) / scale
    let settled = true
    for (const particle of particles) {
      particle.vx += (particle.tx - particle.x) * 27 * dt
      particle.vy += (particle.ty - particle.y) * 27 * dt
      if (mouse.inside) {
        const dx = particle.x - mouse.x
        const dy = particle.y - mouse.y
        const distance = Math.hypot(dx, dy)
        if (distance < radius) {
          const strength = Math.pow(1 - distance / radius, 2) * 2.8 * dt
          const angle = distance > .001 ? Math.atan2(dy, dx) : particle.phase
          particle.vx += Math.cos(angle) * strength
          particle.vy += Math.sin(angle) * strength
        }
      }
      particle.vx *= damping
      particle.vy *= damping
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      if (Math.abs(particle.x - particle.tx) * scale > .05 || Math.abs(particle.y - particle.ty) * scale > .05
        || Math.abs(particle.vx) * scale > .25 || Math.abs(particle.vy) * scale > .25) settled = false
    }
    if (settled) { finishInteraction(); return }
    drawPoints(ctx!, particles, true)
    schedule()
  }

  const onMove = (event: PointerEvent): void => {
    if (disposed || anchor === null || assemblyRunning || assemblyPending) return
    mouse.clientX = event.clientX
    mouse.clientY = event.clientY
    updatePointer()
    if (!mouse.inside) return
    if (!simulating) {
      const radius = Math.max(48, Math.min(90, width * .12)) / scale
      if (!REST_POINTS.some(point => Math.hypot(point.tx - mouse.x, point.ty - mouse.y) < radius)) return
      particles = REST_POINTS.map(point => ({ ...point, x: point.tx, y: point.ty, vx: 0, vy: 0 }))
      simulating = true
      previous = 0
    }
    schedule()
  }
  const onLeave = (): void => { mouse.inside = false }
  const onOut = (event: PointerEvent): void => { if (event.relatedTarget === null) onLeave() }
  const onVisibility = (): void => {
    previous = 0
    mouse.inside = false
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (document.hidden && (assemblyRunning || assemblyPending)) deferAssembly()
    else if (!document.hidden) {
      resize()
      if (assemblyPending && anchor !== null) startAssembly()
      else schedule()
    }
    syncDrift()
  }
  function syncPointerListeners(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerout', onOut)
    document.removeEventListener('pointerleave', onLeave)
    if (pointerEnabled) {
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerout', onOut, { passive: true })
      document.addEventListener('pointerleave', onLeave)
    }
  }
  syncPointerListeners()
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(anchor)
  resizeObserver.observe(host)
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  resize()
  queueWarmup()
  if (initialAssemblyNeeded) {
    if (document.hidden) deferAssembly()
    else startAssembly()
  }

  return {
    setAnchor(next: HTMLElement | null): void {
      if (disposed || next === anchor) return
      finishInteraction()
      if (anchor !== null) resizeObserver.unobserve(anchor)
      anchor = next
      holder.style.display = next === null ? 'none' : ''
      if (next === null) cancelAssembly()
      syncDrift()
      if (next !== null) {
        resizeObserver.observe(next)
        resize()
        if (initialAssemblyNeeded && !assemblyRunning && !assemblyPending) {
          if (document.hidden) deferAssembly()
          else startAssembly()
        }
      }
    },
    replayAssembly(): void {
      if (disposed || reduced || anchor === null) return
      finishInteraction()
      cancelAssembly()
      if (document.hidden) deferAssembly()
      else startAssembly()
    },
    setDark(next: boolean): void {
      if (disposed || darkMode === next) return
      darkMode = next
      holder.setAttribute('data-scheme', next ? 'dark' : 'light')
    },
    setPointerEnabled(enabled: boolean): void {
      if (disposed) return
      const next = enabled && !reduced
      if (pointerEnabled === next) return
      pointerEnabled = next
      finishInteraction()
      syncPointerListeners()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      initialAssemblyNeeded = false
      cancelWarmup()
      cancelAssembly()
      assemblyRenderer?.dispose()
      assemblyRenderer = null
      if (gpuCanvas) gpuCanvas.width = gpuCanvas.height = 1
      cancelAnimationFrame(raf)
      raf = 0
      particles = null
      simulating = false
      pointerEnabled = false
      syncPointerListeners()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      anchor = null
      holder.remove()
      canvas.width = canvas.height = restCanvas.width = restCanvas.height = 1
    },
  }
}
