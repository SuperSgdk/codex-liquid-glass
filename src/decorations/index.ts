/** Host-neutral decorations with the user-confirmed blue-white shark particles. */
import { createCritters } from './critters.ts'
import { mountParticleMark, type ParticleMarkHandle } from './particle-mark.ts'
import { DECORATION_STYLES } from './styles.ts'

export interface DecorationOptions {
  dark: boolean
  /** Keep the original `whale` settings key; it now renders shark particles. */
  whale: boolean
  critters: boolean
  /** Permit pointer repulsion of the particle mark. Defaults to true. */
  pointer: boolean
}

export interface DecorationHandle {
  update: (options: Partial<DecorationOptions>) => void
  dispose: () => void
}

/**
 * Mount into a positioned ambient host. `mainAnchor` is the application's main
 * column, supplied by the host adapter. The module has no app-specific selectors,
 * settings storage or runtime dependencies and owns every node/listener it adds.
 */
export function mountDecorations(
  container: HTMLElement,
  mainAnchor: HTMLElement,
  options: Partial<DecorationOptions> = {},
): DecorationHandle {
  let current: DecorationOptions = { dark: false, whale: true, critters: true, pointer: true, ...options }
  let disposed = false
  let mark: ParticleMarkHandle | null = null
  let critters: HTMLElement | null = null
  const layer = document.createElement('div')
  layer.setAttribute('data-codex-decoration-layer', '')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
  const stylesheet = document.createElement('style')
  stylesheet.textContent = DECORATION_STYLES
  layer.appendChild(stylesheet)
  container.appendChild(layer)

  const apply = (): void => {
    layer.setAttribute('data-scheme', current.dark ? 'dark' : 'light')
    if (current.critters && critters === null) {
      critters = createCritters()
      layer.appendChild(critters)
    } else if (!current.critters && critters !== null) {
      critters.remove()
      critters = null
    }
    if (current.whale && mark === null) {
      mark = mountParticleMark(layer, mainAnchor, current.dark, current.pointer)
    } else if (!current.whale && mark !== null) {
      mark.dispose()
      mark = null
    }
    mark?.setDark(current.dark)
    mark?.setPointerEnabled(current.pointer)
  }
  apply()

  return {
    update: (next): void => {
      if (disposed) return
      current = { ...current, ...next }
      apply()
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      mark?.dispose()
      mark = null
      critters = null
      layer.remove()
    },
  }
}
