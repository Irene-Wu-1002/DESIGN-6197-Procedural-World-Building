import { fullscreenVertexShader } from './sharedShaderChunks'

export const BIOME_SHADER_DEFAULTS = Object.freeze({
  debugValues: false,
})

export const biomeVertexShader = fullscreenVertexShader

export const biomeFragmentShader = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_debugValues;
  varying vec2 v_position;

  void main() {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 position = v_position;
    position.x *= aspect;
    position.x += 0.20 * step(1.45, aspect);

    float radius = 0.68;
    float distanceFromCenter = length(position);
    float surfaceMask = 1.0 - smoothstep(
      radius - 0.008,
      radius + 0.008,
      distanceFromCenter
    );
    vec3 background = vec3(0.045, 0.052, 0.064);

    float frontNormal = sqrt(max(
      1.0 - dot(position / radius, position / radius),
      0.0
    ));
    vec3 normal = normalize(vec3(
      position.x / radius,
      position.y / radius,
      frontNormal
    ));

    // Height chooses the biome; slope chooses its local surface material.
    float heightValue = clamp(position.y / radius * 0.5 + 0.5, 0.0, 1.0);
    float slopeValue = 1.0 - abs(normal.y);
    float steepBlend = smoothstep(0.32, 0.68, slopeValue);

    vec3 lowFlat = vec3(0.18, 0.38, 0.15);
    vec3 lowSteep = vec3(0.13, 0.085, 0.055);
    vec3 middleFlat = vec3(0.56, 0.29, 0.12);
    vec3 middleSteep = vec3(0.30, 0.23, 0.18);
    vec3 highFlat = vec3(0.55, 0.75, 0.43);
    vec3 highSteep = vec3(0.72, 0.79, 0.76);

    vec3 lowBiome = mix(lowFlat, lowSteep, steepBlend);
    vec3 middleBiome = mix(middleFlat, middleSteep, steepBlend);
    vec3 highBiome = mix(highFlat, highSteep, steepBlend);
    vec3 biomeColor = mix(
      lowBiome,
      middleBiome,
      smoothstep(0.20, 0.48, heightValue)
    );
    biomeColor = mix(
      biomeColor,
      highBiome,
      smoothstep(0.58, 0.84, heightValue)
    );

    if (u_debugValues > 0.5) {
      biomeColor = vec3(heightValue, slopeValue, 0.16);
    }

    gl_FragColor = vec4(mix(background, biomeColor, surfaceMask), 1.0);
  }
`
