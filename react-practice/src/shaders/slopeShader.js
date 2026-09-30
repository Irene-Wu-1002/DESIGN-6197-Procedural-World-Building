import {
  fullscreenVertexShader,
  noiseFunctions,
} from './sharedShaderChunks'

export const SLOPE_SHADER_DEFAULTS = Object.freeze({
  threshold1: 0.28,
  threshold2: 0.62,
  softness: 0.1,
})

export const slopeVertexShader = fullscreenVertexShader

export const slopeFragmentShader = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_slopeThreshold1;
  uniform float u_slopeThreshold2;
  uniform float u_transitionSoftness;

  varying vec2 v_position;

  ${noiseFunctions}

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

    vec3 background = mix(
      vec3(0.035, 0.043, 0.055),
      vec3(0.075, 0.070, 0.065),
      v_position.y * 0.5 + 0.5
    );

    float verticalNormal = sqrt(max(
      1.0 - dot(position / radius, position / radius),
      0.0
    ));
    vec3 surfaceNormal = normalize(vec3(
      position.x / radius,
      verticalNormal,
      position.y / radius
    ));
    float steepness = 1.0 - clamp(surfaceNormal.y, 0.0, 1.0);

    float softness = max(u_transitionSoftness, 0.001);
    float mediumSlope = smoothstep(
      u_slopeThreshold1 - softness,
      u_slopeThreshold1 + softness,
      steepness
    );
    float steepSlope = smoothstep(
      u_slopeThreshold2 - softness,
      u_slopeThreshold2 + softness,
      steepness
    );

    vec3 mossGreen = vec3(0.22, 0.43, 0.18);
    vec3 earthBrown = vec3(0.44, 0.27, 0.13);
    vec3 rockGray = vec3(0.39, 0.41, 0.40);
    float barkVariation = (hash(position * 170.0) - 0.5) * 0.08;

    vec3 slopeColor = mix(mossGreen, earthBrown, mediumSlope);
    slopeColor = mix(slopeColor, rockGray, steepSlope);
    slopeColor += barkVariation * steepSlope;

    vec3 lightDirection = normalize(vec3(-0.35, 0.82, 0.45));
    float diffuse = 0.68 + 0.32 * max(dot(surfaceNormal, lightDirection), 0.0);
    slopeColor *= diffuse;

    vec3 finalColor = mix(background, slopeColor, surfaceMask);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`
