export const VERTEX_DISPLACEMENT_DEFAULTS = Object.freeze({
  strength: 0.06,
  speed: 0.65,
  noiseScale: 2.4,
  paused: false,
})

export const vertexDisplacementVertexShader = `
  attribute vec2 a_position;

  uniform float u_aspect;
  uniform float u_time;
  uniform float u_strength;
  uniform float u_speed;
  uniform float u_noiseScale;

  varying float v_worldHeight;
  varying float v_displacement;

  void main() {
    float worldHeight = a_position.y * 0.5 + 0.5;
    float canopyWeight = smoothstep(0.0, 1.0, worldHeight);
    float wave = sin(
      a_position.x * u_noiseScale * 5.0 + u_time * u_speed * 2.0
    );
    wave *= cos(
      a_position.y * u_noiseScale * 3.0 - u_time * u_speed * 1.4
    );
    float displacement = wave * u_strength * canopyWeight;

    vec2 position = a_position;
    position.x = position.x * 0.66 / max(u_aspect, 1.0) - 0.13;
    position.y = position.y * 0.66 + displacement;
    v_worldHeight = worldHeight;
    v_displacement = displacement;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

export const vertexDisplacementFragmentShader = `
  precision highp float;

  varying float v_worldHeight;
  varying float v_displacement;

  void main() {
    vec3 rootColor = vec3(0.21, 0.11, 0.055);
    vec3 canopyColor = vec3(0.43, 0.67, 0.34);
    vec3 color = mix(rootColor, canopyColor, smoothstep(0.0, 1.0, v_worldHeight));
    color += abs(v_displacement) * vec3(0.32, 0.42, 0.28);
    gl_FragColor = vec4(color, 1.0);
  }
`
