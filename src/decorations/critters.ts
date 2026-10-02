/**
 * Ambient bubbles and twinkling plankton behind the app frame.
 * Positions, sizes and timing are preserved from the source theme;
 * motion lives in styles.ts and respects prefers-reduced-motion.
 */

/** One inline-SVG decoration. */
function svg(critter: string, viewBox: string, width: number, style: string, body: string): string {
  return `<svg data-codex-critter="${critter}" viewBox="${viewBox}" width="${width}" `
    + `style="${style}" aria-hidden="true">${body}</svg>`
}

function bubble(style: string, size: number): string {
  return svg('bubble', '0 0 8 8', size, style,
    '<circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" stroke-width="1"/>')
}

function plankton(style: string): string {
  return svg('plankton', '0 0 3 3', 3, style, '<circle cx="1.5" cy="1.5" r="1.5" fill="currentColor"/>')
}

/**
 * Click-transparent ambient markup. The separately owned fluid canvas
 * forms the background; bubbles and plankton ride over it.
 */
export const CRITTER_SCENE = [
  bubble('bottom:8%;left:9%;animation-duration:8s', 7),
  bubble('bottom:5%;left:13%;animation-duration:10s;animation-delay:2.5s', 5),
  bubble('bottom:10%;left:17%;animation-duration:9s;animation-delay:5s', 6),
  bubble('bottom:9%;left:82%;animation-duration:11s;animation-delay:1.5s', 8),
  bubble('bottom:6%;left:87%;animation-duration:8s;animation-delay:4s', 5),
  plankton('top:14%;left:42%;animation-delay:-1s'),
  plankton('top:32%;left:70%;animation-delay:-3s'),
  plankton('top:72%;left:18%;animation-delay:-2s'),
  plankton('top:56%;left:86%;animation-delay:-4s'),
].join('')

/** Create only decorative bubbles and plankton. No app DOM hooks. */
export function createCritters(): HTMLElement {
  const holder = document.createElement('div')
  holder.setAttribute('data-codex-critters', '')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  holder.innerHTML = CRITTER_SCENE
  return holder
}
