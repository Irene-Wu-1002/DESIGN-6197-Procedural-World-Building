import {
  fullscreenVertexShader,
  noiseFunctions,
} from './sharedShaderChunks'

export const PROCEDURAL_NOISE_DEFAULTS = Object.freeze({
  scale: 5,
  strength: 0.22,
  contrast: 1.35,
  speed: 0,
})

export const proceduralNoiseVertexShader = fullscreenVertexShader

export const proceduralNoiseFragmentShader = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_noiseScale;
  uniform float u_noiseStrength;
  uniform float u_noiseContrast;
  uniform float u_animationSpeed;
  varying vec2 v_position;

  ${noiseFunctions}

  void main() {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 position = v_position;
    position.x *= aspect;
    position.x += 0.20 * step(1.45, aspect);

    float radius = 0.68;
    float radialDistance = length(position);
    float mask = 1.0 - smoothstep(radius - 0.008, radius + 0.008, radialDistance);
    vec2 noisePosition = position * u_noiseScale;
    noisePosition += vec2(u_time * u_animationSpeed * 0.18, 0.0);
    float organicNoise = valueNoise(noisePosition);
    organicNoise = pow(max(organicNoise, 0.001), u_noiseContrast);

    vec3 barkColor = mix(
      vec3(0.24, 0.12, 0.055),
      vec3(0.48, 0.29, 0.12),
      position.y * 0.5 + 0.5
    );
    float variation = mix(
      1.0 - u_noiseStrength,
      1.0 + u_noiseStrength,
      organicNoise
    );
    vec3 color = barkColor * variation;
    vec3 background = vec3(0.035, 0.043, 0.055);
    gl_FragColor = vec4(mix(background, color, mask), 1.0);
  }
`
