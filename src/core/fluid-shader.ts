/**
 * Source: SuperSgdk/DSH-Liquid-Glass-Theme (AGPL-3.0-only).
 * Original project by John Wu (WYH66666666), copyright 2026.
 * Independent portable adaptation by SuperSgdk. See PROVENANCE.txt.
 */
/**
 * The three GLSL programs below were independently written for this portable
 * renderer in 2026. A small diffusing velocity texture bends layered sine
 * contours, which blend the existing three-color palette continuously.
 * The TypeScript WebGL mounting, uniform wiring and parameter API retain the
 * AGPL source project's attribution above. Reduced motion uses static frames
 * and redraws only when parameters or size change.
 */

/** Portable renderer parameters, retaining the inherited palette API. */
export interface FluidParams {
  mouseRadius: number
  mouseStrength: number
  decay: number
  distortBoost: number
  noiseBoost: number
  swirlBoost: number
  speed: number
  distortion: number
  swirl: number
  swirlIterations: number
  scale: number
  rotation: number
  proportion: number
  softness: number
  shapeScale: number
  offsetX: number
  offsetY: number
  color1: string
  color2: string
  color3: string
}

/** Inherited parameter defaults; the exported name remains API-compatible. */
export const SITE_FLUID_PARAMS: FluidParams = {
  mouseRadius: 0.22,
  mouseStrength: 1.1,
  decay: 0.96,
  distortBoost: 1.35,
  noiseBoost: 0,
  swirlBoost: 0.45,
  speed: 14,
  distortion: 20,
  swirl: 12,
  swirlIterations: 8,
  scale: 0.5,
  rotation: -5,
  proportion: 50,
  softness: 100,
  shapeScale: 10,
  offsetX: 0,
  offsetY: 65,
  color1: '#8AA3D6',
  color2: '#FFFFFF',
  color3: '#FFFFFF',
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 surfaceUv;
void main() {
  surfaceUv = (a_position + vec2(1.0)) / 2.0;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FLOW_SHADER = `#version 300 es
precision highp float;
in vec2 surfaceUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 nextField;

void main() {
  // A weighted five-pixel average spreads each wake without a solver or noise.
  vec2 pixel = 1.0 / vec2(textureSize(u_prev, 0));
  vec3 neighbors = texture(u_prev, surfaceUv + vec2(pixel.x, 0.0)).rgb
    + texture(u_prev, surfaceUv - vec2(pixel.x, 0.0)).rgb
    + texture(u_prev, surfaceUv + vec2(0.0, pixel.y)).rgb
    + texture(u_prev, surfaceUv - vec2(0.0, pixel.y)).rgb;
  vec3 history = texture(u_prev, surfaceUv).rgb * 0.6 + neighbors * 0.1;
  float retention = clamp(u_decay, 0.0, 0.999);
  float reach = length(surfaceUv - u_mouse) / max(u_brushRadius, 0.001);
  float brush = 1.0 - smoothstep(0.0, 1.0, reach);
  float impulse = brush * clamp(u_brushStrength, 0.0, 4.0);
  vec2 velocity = (history.gb * 2.0 - 1.0) * retention;
  vec2 injection = clamp(u_velocity, vec2(-1.0), vec2(1.0));
  velocity += (injection - velocity) * min(impulse * 0.18, 0.75);
  float activity = min(1.0, history.r * retention + impulse * (0.015 + length(injection) * 0.24));
  nextField = vec4(activity, velocity * 0.5 + 0.5, 1.0);
}
`

const DISPLAY_SHADER = `#version 300 es
precision highp float;
in vec2 surfaceUv;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1, u_color2, u_color3;
uniform float u_colorCount;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_noiseBoost;
uniform float u_swirlBoost;
out vec4 surfaceColor;

void main() {
  // Normalize to the canvas height so resizing preserves the contour aspect.
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 centered = (surfaceUv * 2.0 - 1.0) * vec2(aspect, 1.0);
  float angle = u_rotation * 1.57079632679;
  vec2 domain = vec2(centered.x * cos(angle) - centered.y * sin(angle),
                     centered.x * sin(angle) + centered.y * cos(angle));
  domain = domain * (1.35 + u_scale * 2.8 + u_shapeScale * 3.0) + u_offset * 2.0;

  vec3 wake = texture(u_flowmap, surfaceUv).rgb;
  vec2 motion = wake.gb * 2.0 - 1.0;
  domain += motion * wake.r * (0.35 + max(u_distortBoost, 0.0) * 0.2);
  float amplitude = 0.12 + max(u_distortion, 0.0) * 1.4
    + max(u_swirl, 0.0) * 0.2 + wake.r * max(u_swirlBoost, 0.0) * 0.08;
  int layers = int(clamp(u_swirlIterations, 1.0, 24.0));
  // Each layer bends across a new direction; geometric falloff keeps it soft.
  for (int layer = 0; layer < 24; layer++) {
    if (layer >= layers) break;
    float index = float(layer);
    vec2 direction = vec2(cos(index * 1.37), sin(index * 1.37));
    float phase = dot(domain, direction) * (1.0 + index * 0.48)
      + index * 0.91 + u_time * (0.22 + index * 0.015);
    domain += vec2(-direction.y, direction.x) * sin(phase) * amplitude;
    amplitude *= 0.68;
  }
  float fineWave = sin(domain.x * 3.1 + domain.y * 2.3 - u_time * 0.4);
  domain += vec2(fineWave, -fineWave) * wake.r * max(u_noiseBoost, 0.0) * 0.045;

  float band = domain.x * 0.65 + domain.y * 0.42
    + sin(domain.y * 0.85 - u_time * 0.18) * 0.3;
  float bloom = 0.5 + sin(band + sin(domain.x * 0.73 + u_time * 0.17) * 0.35) * 0.5;
  float wash = 0.5 + sin(domain.y * 0.74 - domain.x * 0.36 + u_time * 0.11 + u_shape * 0.07) * 0.5;
  float density = clamp(bloom * 0.7 + wash * 0.3 + (u_proportion - 0.5) * 0.65, 0.0, 1.0);
  float pixelFeather = 2.0 * u_pixelRatio / max(min(u_resolution.x, u_resolution.y), 1.0);
  float feather = max(0.018, pixelFeather) + clamp(u_softness, 0.0, 1.0) * 0.22;
  float midWeight = smoothstep(0.12 - feather, 0.58 + feather, density);
  float bloomWeight = smoothstep(0.50 - feather, 0.94 + feather, density);
  vec3 color = u_color1.rgb;
  if (u_colorCount > 1.0) color = mix(u_color2.rgb, u_color1.rgb, bloomWeight);
  if (u_colorCount > 2.0) color = mix(mix(u_color3.rgb, u_color2.rgb, midWeight), u_color1.rgb, bloomWeight);
  surfaceColor = vec4(color, 1.0);
}
`

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '')
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ]
}

/** Handle returned by {@link attachFluidShader}. */
export interface FluidShaderHandle {
  /** Whether both WebGL programs and the flow targets were created. */
  available: boolean
  /** Update simulation parameters (e.g. a palette switch) without re-mounting. */
  setParams: (params: FluidParams) => void
  /** Stir the fluid at normalized coordinates with a velocity burst (wakes). */
  stir: (x: number, y: number, vx: number, vy: number) => void
  /** Stop the loop and release listeners. */
  dispose: () => void
}

/**
 * Mount the fluid simulation on a canvas and run it until disposed.
 * @param canvas - full-size canvas element (CSS-sized by the ambient layer).
 * @param params - simulation parameters, including the three palette colors.
 * @returns the live handle.
 */
export function attachFluidShader(canvas: HTMLCanvasElement, params: FluidParams): FluidShaderHandle {
  const unavailable = (): FluidShaderHandle => ({
    available: false,
    setParams: () => {},
    stir: () => {},
    dispose: () => {},
  })
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  })
  if (gl === null) {
    return unavailable()
  }

  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type)
    if (shader === null) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('fluid-renderer fluid shader:', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  const link = (fragment: string): WebGLProgram | null => {
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const frag = compile(gl.FRAGMENT_SHADER, fragment)
    if (vertex === null || frag === null) {
      if (vertex !== null) gl.deleteShader(vertex)
      if (frag !== null) gl.deleteShader(frag)
      return null
    }
    const program = gl.createProgram()
    if (program === null) {
      gl.deleteShader(vertex)
      gl.deleteShader(frag)
      return null
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(frag)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('fluid-renderer fluid link:', gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return null
    }
    return program
  }

  const flowProgram = link(FLOW_SHADER)
  const displayProgram = link(DISPLAY_SHADER)
  if (flowProgram === null || displayProgram === null) {
    if (flowProgram !== null) gl.deleteProgram(flowProgram)
    if (displayProgram !== null) gl.deleteProgram(displayProgram)
    return unavailable()
  }

  const flow = {
    prev: gl.getUniformLocation(flowProgram, 'u_prev'),
    mouse: gl.getUniformLocation(flowProgram, 'u_mouse'),
    velocity: gl.getUniformLocation(flowProgram, 'u_velocity'),
    brushRadius: gl.getUniformLocation(flowProgram, 'u_brushRadius'),
    brushStrength: gl.getUniformLocation(flowProgram, 'u_brushStrength'),
    decay: gl.getUniformLocation(flowProgram, 'u_decay'),
  }
  const display = {
    time: gl.getUniformLocation(displayProgram, 'u_time'),
    pixelRatio: gl.getUniformLocation(displayProgram, 'u_pixelRatio'),
    resolution: gl.getUniformLocation(displayProgram, 'u_resolution'),
    scale: gl.getUniformLocation(displayProgram, 'u_scale'),
    rotation: gl.getUniformLocation(displayProgram, 'u_rotation'),
    offset: gl.getUniformLocation(displayProgram, 'u_offset'),
    color1: gl.getUniformLocation(displayProgram, 'u_color1'),
    color2: gl.getUniformLocation(displayProgram, 'u_color2'),
    color3: gl.getUniformLocation(displayProgram, 'u_color3'),
    colorCount: gl.getUniformLocation(displayProgram, 'u_colorCount'),
    proportion: gl.getUniformLocation(displayProgram, 'u_proportion'),
    softness: gl.getUniformLocation(displayProgram, 'u_softness'),
    shape: gl.getUniformLocation(displayProgram, 'u_shape'),
    shapeScale: gl.getUniformLocation(displayProgram, 'u_shapeScale'),
    distortion: gl.getUniformLocation(displayProgram, 'u_distortion'),
    swirl: gl.getUniformLocation(displayProgram, 'u_swirl'),
    swirlIterations: gl.getUniformLocation(displayProgram, 'u_swirlIterations'),
    flowmap: gl.getUniformLocation(displayProgram, 'u_flowmap'),
    distortBoost: gl.getUniformLocation(displayProgram, 'u_distortBoost'),
    noiseBoost: gl.getUniformLocation(displayProgram, 'u_noiseBoost'),
    swirlBoost: gl.getUniformLocation(displayProgram, 'u_swirlBoost'),
  }

  const quadBuffer = gl.createBuffer()
  if (quadBuffer === null) {
    gl.deleteProgram(flowProgram)
    gl.deleteProgram(displayProgram)
    return unavailable()
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const bindQuad = (program: WebGLProgram): void => {
    const position = gl.getAttribLocation(program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  }

  interface FlowTarget { fbo: WebGLFramebuffer; tex: WebGLTexture }
  const makeTarget = (width: number, height: number, initial?: Uint8Array): FlowTarget => {
    const tex = gl.createTexture()
    if (tex === null) throw new Error('fluid-renderer fluid: texture allocation failed')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (initial !== undefined) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, initial)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    if (fbo === null) {
      gl.deleteTexture(tex)
      throw new Error('fluid-renderer fluid: framebuffer allocation failed')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fbo)
      gl.deleteTexture(tex)
      throw new Error('fluid-renderer fluid: incomplete framebuffer')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex }
  }

  let width = 0
  let height = 0
  let flowWidth = 0
  let flowHeight = 0
  let flip = false
  let current: FluidParams = { ...params }
  const pointer = { x: 0.5, y: 0.5, smoothX: 0.5, smoothY: 0.5, vx: 0, vy: 0, svx: 0, svy: 0 }
  const dprCap = Math.min(window.devicePixelRatio || 1, 1.5)
  width = Math.max(1, Math.round(canvas.clientWidth * dprCap))
  height = Math.max(1, Math.round(canvas.clientHeight * dprCap))
  canvas.width = width
  canvas.height = height
  flowWidth = Math.max(1, Math.round(width / 4))
  flowHeight = Math.max(1, Math.round(height / 4))

  const createTargets = (nextWidth: number, nextHeight: number): [FlowTarget, FlowTarget] => {
    const initial = new Uint8Array(nextWidth * nextHeight * 4)
    for (let i = 0; i < nextWidth * nextHeight; i += 1) {
      initial[4 * i + 1] = 128
      initial[4 * i + 2] = 128
      initial[4 * i + 3] = 255
    }
    const first = makeTarget(nextWidth, nextHeight, initial)
    try {
      return [first, makeTarget(nextWidth, nextHeight, initial)]
    } catch (error) {
      gl.deleteFramebuffer(first.fbo)
      gl.deleteTexture(first.tex)
      throw error
    }
  }
  let targetA: FlowTarget
  let targetB: FlowTarget
  try {
    ;[targetA, targetB] = createTargets(flowWidth, flowHeight)
  } catch (error) {
    console.error(error)
    gl.deleteBuffer(quadBuffer)
    gl.deleteProgram(flowProgram)
    gl.deleteProgram(displayProgram)
    return unavailable()
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Retained input policy: touch devices and Windows skip the mouse feed.
  const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } }
  const windows = ua.userAgentData
    ? ua.userAgentData.platform === 'Windows'
    : navigator.userAgent.includes('Windows')
  const onMouseMove = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect()
    // Guard against the wallpaper mode hiding the canvas (display: none → a
    // 0×0 rect): feeding NaN/Infinity pointer coordinates into the flow
    // shader poisons the simulation permanently (NaN never decays).
    if (rect.width <= 0 || rect.height <= 0) return
    pointer.x = (event.clientX - rect.left) / rect.width
    pointer.y = 1 - (event.clientY - rect.top) / rect.height
  }
  if (!reduced && !coarse && !windows) window.addEventListener('mousemove', onMouseMove)

  const start = performance.now()
  let raf = 0
  let disposed = false
  let previous = 0
  const step = 1000 / 30

  const queueFrame = (): void => {
    if (!disposed && raf === 0) raf = requestAnimationFrame(frame)
  }

  const frame = (now: number): void => {
    raf = 0
    if (disposed) return
    if (!reduced) {
      queueFrame()
      if (now - previous < step) return
      previous = now - ((now - previous) % step)
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    const nextWidth = Math.round(canvas.clientWidth * ratio)
    const nextHeight = Math.round(canvas.clientHeight * ratio)
    // Hidden canvas (wallpaper mode): skip GL work entirely this frame.
    if (nextWidth <= 0 || nextHeight <= 0) return
    if (nextWidth !== width || nextHeight !== height) {
      width = nextWidth
      height = nextHeight
      canvas.width = width
      canvas.height = height
      const nextFlowWidth = Math.max(1, Math.round(width / 4))
      const nextFlowHeight = Math.max(1, Math.round(height / 4))
      if (nextFlowWidth !== flowWidth || nextFlowHeight !== flowHeight) {
        try {
          const [nextA, nextB] = createTargets(nextFlowWidth, nextFlowHeight)
          gl.deleteFramebuffer(targetA.fbo)
          gl.deleteTexture(targetA.tex)
          gl.deleteFramebuffer(targetB.fbo)
          gl.deleteTexture(targetB.tex)
          targetA = nextA
          targetB = nextB
          flowWidth = nextFlowWidth
          flowHeight = nextFlowHeight
          flip = false
        } catch (error) {
          // Keep the existing flow targets if a resize allocation fails.
          console.error(error)
        }
      }
    }

    const p = current
    const s = pointer
    // Additional pointer damping lets injected wakes settle softly.
    s.svx *= 0.94
    s.svy *= 0.94
    s.smoothX += (s.x - s.smoothX) * 0.12
    s.smoothY += (s.y - s.smoothY) * 0.12
    s.svx += ((s.x - s.smoothX) * 0.5 - s.svx) * 0.15
    s.svy += ((s.y - s.smoothY) * 0.5 - s.svy) * 0.15

    const read = flip ? targetA : targetB
    const write = flip ? targetB : targetA
    flip = !flip

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
    gl.viewport(0, 0, flowWidth, flowHeight)
    gl.useProgram(flowProgram)
    bindQuad(flowProgram)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, read.tex)
    gl.uniform1i(flow.prev, 0)
    gl.uniform2f(flow.mouse, s.smoothX, s.smoothY)
    gl.uniform2f(flow.velocity, s.svx, s.svy)
    gl.uniform1f(flow.brushRadius, p.mouseRadius)
    gl.uniform1f(flow.brushStrength, p.mouseStrength)
    gl.uniform1f(flow.decay, p.decay)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    gl.viewport(0, 0, width, height)
    gl.useProgram(displayProgram)
    bindQuad(displayProgram)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, write.tex)
    gl.uniform1i(display.flowmap, 0)
    // A static redraw must not advance the animation when settings change.
    const time = reduced ? 0 : (now - start) * 0.001 * (p.speed / 100)
    gl.uniform1f(display.time, time)
    gl.uniform1f(display.pixelRatio, window.devicePixelRatio || 1)
    gl.uniform2f(display.resolution, width, height)
    gl.uniform1f(display.scale, p.scale)
    gl.uniform1f(display.rotation, p.rotation / 90)
    gl.uniform2f(display.offset, p.offsetX / 100, p.offsetY / 100)
    const c1 = hexToRgb(p.color1 || '#2E58A4')
    const c2 = hexToRgb(p.color2 || '#D2E2EE')
    const c3 = hexToRgb(p.color3 || '#FFFFFF')
    gl.uniform4f(display.color1, c1[0], c1[1], c1[2], 1)
    gl.uniform4f(display.color2, c2[0], c2[1], c2[2], 1)
    gl.uniform4f(display.color3, c3[0], c3[1], c3[2], 1)
    gl.uniform1f(display.colorCount, 3)
    gl.uniform1f(display.proportion, p.proportion / 100)
    gl.uniform1f(display.softness, p.softness / 100)
    gl.uniform1f(display.shape, 0)
    gl.uniform1f(display.shapeScale, p.shapeScale / 100)
    gl.uniform1f(display.distortion, p.distortion / 100)
    gl.uniform1f(display.swirl, p.swirl / 50)
    gl.uniform1f(display.swirlIterations, p.swirlIterations)
    gl.uniform1f(display.distortBoost, p.distortBoost)
    gl.uniform1f(display.noiseBoost, p.noiseBoost)
    gl.uniform1f(display.swirlBoost, p.swirlBoost)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  // The continuous loop measures every frame. Static mode needs independent
  // size notifications; queueFrame also merges these with palette updates.
  const resizeObserver = new ResizeObserver(queueFrame)
  resizeObserver.observe(canvas)

  const handle: FluidShaderHandle = {
    available: true,
    setParams: (next: FluidParams) => {
      if (disposed) return
      current = { ...next }
      queueFrame()
    },
    stir: (x: number, y: number, vx: number, vy: number) => {
      if (disposed || reduced) return
      // Damped stir: the brush glides toward the event point and the
      // velocity ramps up through a soft approach, so feedback reads as
      // water settling rather than a teleported kick.
      pointer.x += (x - pointer.x) * 0.35
      pointer.y += (y - pointer.y) * 0.35
      pointer.svx += (vx - pointer.svx) * 0.3
      pointer.svy += (vy - pointer.svy) * 0.3
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      raf = 0
      resizeObserver.disconnect()
      window.removeEventListener('mousemove', onMouseMove)
      gl.deleteFramebuffer(targetA.fbo)
      gl.deleteTexture(targetA.tex)
      gl.deleteFramebuffer(targetB.fbo)
      gl.deleteTexture(targetB.tex)
      gl.deleteBuffer(quadBuffer)
      gl.deleteProgram(flowProgram)
      gl.deleteProgram(displayProgram)
    },
  }

  queueFrame()
  return handle
}
