export function createTestGL({ compile = true, link = true } = {}) {
  const counts = { shaders: 0, programs: 0, buffers: 0, uploads: 0, draws: 0, viewport: 0, uniforms: {}, deletedShaders: 0, deletedPrograms: 0, deletedBuffers: 0, deletedVaos: 0 };
  const uniforms = {};
  const draws = [];
  const sources = [];
  let uploaded = null;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, BLEND: 8, SRC_ALPHA: 9,
    ONE_MINUS_SRC_ALPHA: 10, ONE: 11, COLOR_BUFFER_BIT: 12, POINTS: 13,
    createShader() { counts.shaders++; return {}; },
    shaderSource(shader, source) { sources.push(source); }, compileShader() {},
    getShaderParameter() { return compile; },
    createProgram() { counts.programs++; return {}; },
    attachShader() {}, linkProgram() {}, getProgramParameter() { return link; },
    createBuffer() { counts.buffers++; return {}; },
    createVertexArray() { return {}; },
    bindVertexArray() {}, bindBuffer() {},
    bufferData(target, data) { counts.uploads++; uploaded = data; },
    getAttribLocation(program, name) { return { a_position: 0, a_color: 1, a_scatter: 2 }[name]; },
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation(program, name) { return { name }; },
    useProgram() {}, enable() {}, blendFuncSeparate() {}, clearColor() {}, viewport() { counts.viewport++; }, clear() {},
    uniform2f(location, x, y) { counts.uniforms[location.name] = (counts.uniforms[location.name] || 0) + 1; uniforms[location.name] = [x, y]; },
    uniform1f(location, value) { counts.uniforms[location.name] = (counts.uniforms[location.name] || 0) + 1; uniforms[location.name] = value; },
    drawArrays(mode, start, count) { counts.draws++; draws.push({ mode, start, count, uniforms: { ...uniforms } }); },
    deleteShader() { counts.deletedShaders++; }, deleteProgram() { counts.deletedPrograms++; },
    deleteBuffer() { counts.deletedBuffers++; }, deleteVertexArray() { counts.deletedVaos++; },
    isContextLost() { return false; },
  };
  return { gl, counts, draws, sources, uploaded: () => uploaded };
}
