export function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

export function createProgramInfo(
  gl,
  vertexSource,
  fragmentSource,
  uniformNames,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return {
    program,
    positionLocation: gl.getAttribLocation(program, 'a_position'),
    uniforms: Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
    ),
  }
}

export function createFullscreenQuad(gl) {
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )
  return { buffer, vertexCount: 6 }
}

export function createGridMesh(gl, segments = 48) {
  const vertices = []
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const x0 = (column / segments) * 2 - 1
      const x1 = ((column + 1) / segments) * 2 - 1
      const y0 = (row / segments) * 2 - 1
      const y1 = ((row + 1) / segments) * 2 - 1
      vertices.push(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1)
    }
  }

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
  return { buffer, vertexCount: vertices.length / 2 }
}

export function bindPositionBuffer(gl, programInfo, geometry) {
  gl.useProgram(programInfo.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry.buffer)
  gl.enableVertexAttribArray(programInfo.positionLocation)
  gl.vertexAttribPointer(
    programInfo.positionLocation,
    2,
    gl.FLOAT,
    false,
    0,
    0,
  )
}

export function hexToRgb(hex) {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  )
}
