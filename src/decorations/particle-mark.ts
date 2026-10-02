// SPDX-License-Identifier: AGPL-3.0-only
/** Blue-white shark particles, using the image-derived points confirmed by the user. */
import SHARK_DATA from './shark-particle-data.json'

const FPS = 30
const EXTENT = Math.max(SHARK_DATA.width, SHARK_DATA.height)

interface Particle {
  tx: number
  ty: number
  x: number
  y: number
  vx: number
  vy: number
  sx: number
  sy: number
  edge: number
  color: string
  phase: number
  brightness: number
}

function hash(n: number): number {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return value - Math.floor(value)
}

export interface ParticleMarkHandle {
  /** Preserve the image's blue-white RGB in either scheme. */
  setDark: (dark: boolean) => void
  setPointerEnabled: (enabled: boolean) => void
  dispose: () => void
}

/** Keep the existing main-column anchor and wrapper size; all data is bundled. */
export function mountParticleMark(host: HTMLElement, mainAnchor: HTMLElement, dark: boolean, pointer = true): ParticleMarkHandle {
  const holder = document.createElement('div')
  holder.setAttribute('data-codex-particle-mark', 'shark')
  holder.setAttribute('data-scheme', dark ? 'dark' : 'light')
  holder.style.cssText = 'position:absolute;transform:translate(-50%,-50%);pointer-events:none;opacity:0.92'
  holder.style.mixBlendMode = 'normal'
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  holder.appendChild(canvas)
  host.appendChild(holder)
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    holder.remove()
    return { setDark: () => {}, setPointerEnabled: () => {}, dispose: () => {} }
  }

  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const particles: Particle[] = SHARK_DATA.points.map(([x, y, r, g, b, edge], i) => {
    const tx = (x - (SHARK_DATA.width - 1) / 2) / EXTENT
    const ty = (y - (SHARK_DATA.height - 1) / 2) / EXTENT
    const angle = hash(i + 1) * Math.PI * 2
    const radius = .36 + hash(i + 101) * .48
    const sx = Math.cos(angle) * radius
    const sy = Math.sin(angle) * radius
    return {
      tx, ty, x: reduced ? tx : sx, y: reduced ? ty : sy, vx: 0, vy: 0, sx, sy, edge,
      color: `rgb(${r} ${g} ${b})`, phase: hash(i + 17) * Math.PI * 2,
      brightness: .82 + hash(i + 35) * .18,
    }
  })
  let raf = 0
  let disposed = false
  let previous = 0
  let elapsed = 0
  let width = 1
  let height = 1
  let dpr = 1
  let scale = 1
  let darkMode = dark
  let pointerEnabled = pointer && !reduced
  const mouse = { clientX: 0, clientY: 0, x: 0, y: 0, inside: false }

  function positionHost(): void {
    const rect = mainAnchor.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const area = rect.width > 0 ? rect : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const size = Math.round(Math.max(220, Math.min(660, window.innerHeight * .76, area.width * .8)))
    holder.style.width = `${size}px`
    holder.style.height = `${size}px`
    holder.style.left = `${Math.round(area.left - hostRect.left + area.width / 2)}px`
    holder.style.top = `${Math.round(area.top - hostRect.top + area.height / 2)}px`
  }

  function updatePointer(): void {
    const rect = holder.getBoundingClientRect()
    mouse.x = (mouse.clientX - rect.left - width / 2) / scale
    mouse.y = (mouse.clientY - rect.top - height / 2) / scale
    mouse.inside = pointerEnabled && mouse.clientX >= rect.left && mouse.clientX <= rect.left + rect.width
      && mouse.clientY >= rect.top && mouse.clientY <= rect.top + rect.height
  }

  function draw(): void {
    if (disposed) return
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.clearRect(0, 0, width, height)
    ctx!.globalCompositeOperation = 'source-over'
    const side = Math.max(.65, scale / EXTENT * .69)
    for (const particle of particles) {
      const drift = reduced ? 0 : .0027 + particle.edge * .0016
      const x = width / 2 + (particle.x + Math.sin(elapsed * .75 + particle.phase) * drift) * scale
      const y = height / 2 + (particle.y + Math.cos(elapsed * .63 + particle.phase * 1.7) * drift) * scale
      ctx!.globalAlpha = particle.brightness
      ctx!.fillStyle = particle.color
      ctx!.fillRect(x - side / 2, y - side / 2, side, side)
    }
    ctx!.globalAlpha = 1
  }

  function resize(): void {
    if (disposed) return
    positionHost()
    const rect = holder.getBoundingClientRect()
    width = Math.max(1, rect.width)
    height = Math.max(1, rect.height)
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    scale = Math.min(width * .77 / (SHARK_DATA.width / EXTENT), height * .81 / (SHARK_DATA.height / EXTENT))
    if (mouse.inside) updatePointer()
    draw()
  }

  function schedule(): void {
    if (!disposed && !reduced && !document.hidden && !raf) raf = requestAnimationFrame(tick)
  }

  function tick(now: number): void {
    raf = 0
    if (disposed || document.hidden) return
    if (previous && now - previous < 1000 / FPS) { schedule(); return }
    const dt = previous ? Math.min((now - previous) / 1000, .035) : 1 / 60
    previous = now
    elapsed += dt
    positionHost()
    if (mouse.inside) updatePointer()
    const damping = Math.exp(-7.5 * dt)
    const radius = Math.max(48, Math.min(90, width * .12)) / scale
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
    }
    draw()
    schedule()
  }

  const onMove = (event: PointerEvent): void => {
    mouse.clientX = event.clientX
    mouse.clientY = event.clientY
    updatePointer()
  }
  const onLeave = (): void => { mouse.inside = false }
  const onVisibility = (): void => {
    previous = 0
    mouse.inside = false
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (!document.hidden) { draw(); schedule() }
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
  const onOut = (event: PointerEvent): void => { if (event.relatedTarget === null) onLeave() }
  syncPointerListeners()
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(mainAnchor)
  resizeObserver.observe(host)
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  resize()
  schedule()

  return {
    setDark(next: boolean): void {
      if (disposed || darkMode === next) return
      darkMode = next
      holder.setAttribute('data-scheme', next ? 'dark' : 'light')
      draw()
    },
    setPointerEnabled(enabled: boolean): void {
      if (disposed) return
      const next = enabled && !reduced
      if (pointerEnabled === next) return
      pointerEnabled = next
      mouse.inside = false
      syncPointerListeners()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      raf = 0
      pointerEnabled = false
      syncPointerListeners()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      holder.remove()
    },
  }
}
