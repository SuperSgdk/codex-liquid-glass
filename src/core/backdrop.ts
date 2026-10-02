/**
 * Source: SuperSgdk/DSH-Liquid-Glass-Theme (AGPL-3.0-only).
 * Original project by John Wu (WYH66666666), copyright 2026.
 * Independent portable adaptation by SuperSgdk. See PROVENANCE.txt.
 *
 * Browser-only mounting is deferred until this function is called. Importing
 * the core is safe in Node; host selection and application tokens belong to
 * the adapter, not to this module.
 */
import { attachFluidShader, SITE_FLUID_PARAMS, type FluidShaderHandle } from './fluid-shader.ts'
import { fluidToneColors } from './fluid-tones.ts'
import { attachFluidInteractions } from './fluid-interactions.ts'
import { mountMesh, type MeshHandle } from './mesh.ts'

export interface FluidBackdropOptions {
  scheme: 'light' | 'dark'
  /** Original continuous hue slider. The physical hue adds HUE_BASE (217). */
  fluidHue: number
  fluidDepth: number
  /** Dark mode 0..50 adds black; light mode 50..100 adds white. */
  bgBrightness: number
  mesh: boolean
}

export const DEFAULT_BACKDROP_OPTIONS: Readonly<FluidBackdropOptions> = Object.freeze({
  scheme: 'light',
  fluidHue: 320,
  fluidDepth: 25,
  bgBrightness: 50,
  mesh: true,
})

export interface FluidBackdropStatus {
  renderer: 'webgl2' | 'css-fallback'
  running: boolean
  options: FluidBackdropOptions
}

export interface FluidBackdropHandle {
  update: (options: Partial<FluidBackdropOptions>) => void
  dispose: () => void
  getStatus: () => FluidBackdropStatus
}

const finiteClamp = (value: unknown, fallback: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback

/** Normalize continuous settings without introducing palette presets. */
export function normalizeBackdropOptions(
  input: Partial<FluidBackdropOptions> = {},
  previous: Readonly<FluidBackdropOptions> = DEFAULT_BACKDROP_OPTIONS,
): FluidBackdropOptions {
  return {
    scheme: input.scheme === 'dark' || input.scheme === 'light' ? input.scheme : previous.scheme,
    fluidHue: finiteClamp(input.fluidHue, previous.fluidHue, 360),
    fluidDepth: finiteClamp(input.fluidDepth, previous.fluidDepth, 100),
    bgBrightness: finiteClamp(input.bgBrightness, previous.bgBrightness, 100),
    mesh: typeof input.mesh === 'boolean' ? input.mesh : previous.mesh,
  }
}

/**
 * Mount one original fluid board into a positioned, measurable container.
 * This layer never changes host layout, inserts application UI, or saves
 * preferences. The host adapter owns those concerns and calls dispose when
 * disabled. The layer and all its children let pointer events pass through.
 */
export function mountFluidBackdrop(
  container: HTMLElement,
  options: Partial<FluidBackdropOptions> = {},
): FluidBackdropHandle {
  let current = normalizeBackdropOptions(options)
  let disposed = false
  let fluid: FluidShaderHandle | undefined
  let mesh: MeshHandle | undefined
  let detachInteractions: (() => void) | undefined

  const scene = document.createElement('div')
  scene.setAttribute('data-fluid-backdrop', '')
  scene.setAttribute('aria-hidden', 'true')
  Object.assign(scene.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    overflow: 'hidden', pointerEvents: 'none',
  })
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-fluid-canvas', '')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
  })
  const veil = document.createElement('div')
  veil.setAttribute('data-fluid-brightness', '')
  Object.assign(veil.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
  })
  scene.append(canvas, veil)
  container.appendChild(scene)

  const shaderParams = () => ({
    ...SITE_FLUID_PARAMS,
    ...fluidToneColors(current.scheme === 'dark', current.fluidHue, current.fluidDepth),
  })

  const apply = (): void => {
    const colors = fluidToneColors(current.scheme === 'dark', current.fluidHue, current.fluidDepth)
    // A transparent/failed canvas still leaves a readable wash derived from
    // the same continuous palette. Live WebGL paints over this fallback.
    scene.style.background =
      `radial-gradient(ellipse at 12% 85%, ${colors.color1}, transparent 65%), ` +
      `radial-gradient(ellipse at 65% 20%, ${colors.color2}, transparent 75%), ${colors.color3}`
    const dark = current.scheme === 'dark'
    const black = dark ? Math.max(0, (50 - current.bgBrightness) / 50) : 0
    const white = dark ? 0 : Math.max(0, (current.bgBrightness - 50) / 50)
    veil.style.background =
      `linear-gradient(rgba(255,255,255,${white}),rgba(255,255,255,${white})), ` +
      `linear-gradient(rgba(0,0,0,${black}),rgba(0,0,0,${black}))`
    fluid?.setParams(shaderParams())

    if (current.mesh && mesh === undefined) {
      mesh = mountMesh(scene)
      const meshCanvas = scene.querySelector<HTMLCanvasElement>('[data-fluid-mesh]')
      if (meshCanvas !== null) {
        Object.assign(meshCanvas.style, {
          position: 'absolute', inset: '0', width: '100%', height: '100%',
          pointerEvents: 'none',
        })
      }
      // The original brightness scrim sits over the mesh as well as the fluid.
      scene.appendChild(veil)
    } else if (!current.mesh && mesh !== undefined) {
      mesh.dispose()
      mesh = undefined
    }
  }

  apply()
  try {
    fluid = attachFluidShader(canvas, shaderParams())
    if (fluid.available) detachInteractions = attachFluidInteractions({ main: fluid, mainCanvas: canvas })
  } catch (error) {
    // Device-level failures preserve the material layer and its fallback.
    console.error('fluid-renderer: WebGL mounting failed', error)
    fluid?.dispose()
    fluid = undefined
  }
  const renderer = (): FluidBackdropStatus['renderer'] => fluid?.available ? 'webgl2' : 'css-fallback'
  scene.setAttribute('data-fluid-renderer', renderer())

  return {
    update: (next) => {
      if (disposed) return
      current = normalizeBackdropOptions(next, current)
      apply()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      detachInteractions?.()
      mesh?.dispose()
      fluid?.dispose()
      scene.remove()
    },
    getStatus: () => ({ renderer: renderer(), running: !disposed, options: { ...current } }),
  }
}
