// SPDX-License-Identifier: AGPL-3.0-only
/** A retained point buffer for the owner's shark; replay changes only uniforms. */
import SHARK_DATA from './shark-particle-data.json'

const EXTENT = Math.max(SHARK_DATA.width, SHARK_DATA.height)
function hash(n: number): number {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return value - Math.floor(value)
}
export const SHARK_POINTS = SHARK_DATA.points.map(([x, y, r, g, b], i) => {
  const angle = hash(i + 1) * Math.PI * 2
  const radius = .10 + hash(i + 101) * .23
  return {
    tx: (x - (SHARK_DATA.width - 1) / 2) / EXTENT,
    ty: (y - (SHARK_DATA.height - 1) / 2) / EXTENT,
    color: `rgb(${r} ${g} ${b})`, r: r / 255, g: g / 255, b: b / 255,
    sx: Math.cos(angle) * radius, sy: Math.sin(angle) * radius,
    phase: i * 2.399963229728653,
  }
})
const VERTICES = new Float32Array(SHARK_POINTS.length * 7)
for (let i = 0; i < SHARK_POINTS.length; i++) {
  const p = SHARK_POINTS[i]
  VERTICES.set([p.tx, p.ty, p.r, p.g, p.b, p.sx, p.sy], i * 7)
}

/** A short outward burst, followed by a smooth return to the exact rest grid. */
export function assemblyDisplacement(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  if (p < .2) return Math.sin(p / .2 * Math.PI / 2)
  const t = (p - .2) / .8
  return 1 - t * t * (3 - 2 * t)
}

const VERTEX = `#version 300 es
in vec2 a_position;
in vec3 a_color;
in vec2 a_scatter;
uniform vec2 u_view;
uniform float u_scale;
uniform float u_dot;
uniform float u_displacement;
out vec3 v_color;
void main() {
  vec2 p = (a_position + a_scatter * u_displacement) * u_scale;
  gl_Position = vec4(p.x * 2.0 / u_view.x, -p.y * 2.0 / u_view.y, 0.0, 1.0);
  gl_PointSize = u_dot;
  v_color = a_color;
}`
const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 out_color;
void main() { out_color = vec4(v_color, .9); }`

export interface SharkAssemblyRenderer {
  render: (progress: number, width: number, height: number, dpr: number, scale: number) => boolean
  dispose: () => void
}

export function createSharkAssemblyRenderer(canvas: HTMLCanvasElement): SharkAssemblyRenderer | null {
  let context: WebGL2RenderingContext | null
  try { context = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true }) }
  catch { return null }
  const gl = context
  if (gl === null) return null
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let vao: WebGLVertexArrayObject | null = null
  let disposed = false
  let lost = false
  const release = (): void => {
    if (vao) gl.deleteVertexArray(vao)
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    for (const shader of shaders) gl.deleteShader(shader)
  }
  try {
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('No shader resource')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed')
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    program = gl.createProgram()
    if (!program) throw new Error('No program resource')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed')
    buffer = gl.createBuffer()
    vao = gl.createVertexArray()
    if (!buffer || !vao) throw new Error('No point buffer resource')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW)
    for (const [name, size, offset] of [['a_position', 2, 0], ['a_color', 3, 8], ['a_scatter', 2, 20]] as const) {
      const location = gl.getAttribLocation(program, name)
      if (location < 0) throw new Error('Missing point attribute')
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset)
    }
    const view = gl.getUniformLocation(program, 'u_view')
    const scaleUniform = gl.getUniformLocation(program, 'u_scale')
    const dot = gl.getUniformLocation(program, 'u_dot')
    const displacement = gl.getUniformLocation(program, 'u_displacement')
    if (!view || !scaleUniform || !dot || !displacement) throw new Error('Missing assembly uniform')
    gl.useProgram(program)
    gl.enable(gl.BLEND)
    // Store premultiplied RGB/alpha in the transparent drawing buffer, matching
    // browser compositing. Separate alpha avoids squaring the point's .9 opacity.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    let previousWidth = -1
    let previousHeight = -1
    let previousDpr = -1
    let previousScale = -1
    const onLost = (event: Event): void => { event.preventDefault(); lost = true }
    canvas.addEventListener('webglcontextlost', onLost)
    return {
      render(progress, width, height, dpr, scale): boolean {
        if (disposed || lost || gl.isContextLost()) return false
        const pixelWidth = Math.max(1, Math.round(width * dpr))
        const pixelHeight = Math.max(1, Math.round(height * dpr))
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight
        if (width !== previousWidth || height !== previousHeight || dpr !== previousDpr || scale !== previousScale) {
          gl.viewport(0, 0, pixelWidth, pixelHeight)
          gl.uniform2f(view, width, height)
          gl.uniform1f(scaleUniform, scale)
          gl.uniform1f(dot, Math.max(.65, scale / EXTENT * .69) * dpr)
          previousWidth = width
          previousHeight = height
          previousDpr = dpr
          previousScale = scale
        }
        gl.uniform1f(displacement, assemblyDisplacement(progress))
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.POINTS, 0, SHARK_POINTS.length)
        return true
      },
      dispose(): void {
        if (disposed) return
        disposed = true
        canvas.removeEventListener('webglcontextlost', onLost)
        release()
      },
    }
  } catch {
    release()
    return null
  }
}
