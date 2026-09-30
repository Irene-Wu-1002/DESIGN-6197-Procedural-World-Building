import { fullscreenVertexShader } from './sharedShaderChunks'

export const FRESNEL_SHADER_DEFAULTS = Object.freeze({
  power: 3,
  intensity: 0.75,
  color: '#a8e5dc',
})

export const fresnelVertexShader = fullscreenVertexShader

export const fresnelFragmentShader = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_fresnelPower;
  uniform float u_glowIntensity;
  uniform vec3 u_glowColor;
  varying vec2 v_position;

  void main() {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 position = v_position;
    position.x *= aspect;
    position.x += 0.20 * step(1.45, aspect);

    float radius = 0.68;
    float radialDistance = length(position);
    float mask = 1.0 - smoothstep(radius - 0.008, radius + 0.008, radialDistance);
    float frontNormal = sqrt(max(1.0 - dot(position / radius, position / radius), 0.0));
    vec3 normal = normalize(vec3(position / radius, frontNormal));
    vec3 cameraDirection = vec3(0.0, 0.0, 1.0);

    float fresnel = pow(
      1.0 - max(dot(normal, cameraDirection), 0.0),
      u_fresnelPower
    );
    vec3 baseColor = vec3(0.30, 0.20, 0.12);
    vec3 color = baseColor + u_glowColor * fresnel * u_glowIntensity;
    vec3 background = vec3(0.035, 0.043, 0.055);
    gl_FragColor = vec4(mix(background, color, mask), 1.0);
  }
`
