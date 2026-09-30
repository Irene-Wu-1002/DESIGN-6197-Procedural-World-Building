export const DISTANCE_FOG_DEFAULTS = Object.freeze({
  start: 5,
  end: 28,
  density: 0.82,
  color: '#86c7c1',
})

export const distanceFogVertexShader = `
  attribute vec2 a_position;
  varying vec2 v_position;
  varying float v_cameraDistance;

  void main() {
    v_position = a_position;
    v_cameraDistance = mix(32.0, 2.0, a_position.y * 0.5 + 0.5);
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

export const distanceFogFragmentShader = `
  precision highp float;

  uniform float u_fogStart;
  uniform float u_fogEnd;
  uniform float u_fogDensity;
  uniform vec3 u_fogColor;

  varying vec2 v_position;
  varying float v_cameraDistance;

  void main() {
    vec3 nearColor = vec3(0.20, 0.34, 0.16);
    vec3 farColor = vec3(0.12, 0.20, 0.15);
    float terrainBands = sin(v_position.x * 18.0 + v_position.y * 5.0) * 0.035;
    vec3 surfaceColor = mix(nearColor, farColor, v_position.y * 0.5 + 0.5);
    surfaceColor += terrainBands;

    float fogRange = max(u_fogEnd - u_fogStart, 0.001);
    float normalizedDistance = (v_cameraDistance - u_fogStart) / fogRange;
    float fogAmount = smoothstep(0.0, 1.0, normalizedDistance);
    fogAmount = clamp(fogAmount * u_fogDensity, 0.0, 1.0);
    vec3 finalColor = mix(surfaceColor, u_fogColor, fogAmount);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`
