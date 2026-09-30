export const HEIGHT_GRADIENT_DEFAULTS = Object.freeze({
  intensity: 1,
  smoothness: 0.45,
  minHeight: -20,
  maxHeight: 100,
})

export const HEIGHT_GRADIENT_PREVIEW_RANGE = Object.freeze({
  min: -50,
  max: 150,
})

export const heightGradientVertexShader = `
  attribute vec2 a_position;

  uniform float u_previewMinHeight;
  uniform float u_previewMaxHeight;

  varying float v_worldY;

  void main() {
    float verticalPosition = a_position.y * 0.5 + 0.5;
    v_worldY = mix(
      u_previewMinHeight,
      u_previewMaxHeight,
      verticalPosition
    );
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

export const heightGradientFragmentShader = `
  precision highp float;

  uniform float u_gradientIntensity;
  uniform float u_transitionSmoothness;
  uniform float u_minHeight;
  uniform float u_maxHeight;

  varying float v_worldY;

  vec3 blendAtStop(
    vec3 currentColor,
    vec3 nextColor,
    float heightValue,
    float stop,
    float blendWidth
  ) {
    float blend = smoothstep(stop - blendWidth, stop + blendWidth, heightValue);
    return mix(currentColor, nextColor, blend);
  }

  void main() {
    float heightRange = max(u_maxHeight - u_minHeight, 0.001);
    float normalizedHeight = clamp(
      (v_worldY - u_minHeight) / heightRange,
      0.0,
      1.0
    );
    float blendWidth = mix(0.004, 0.12, u_transitionSmoothness);

    vec3 darkRootBrown = vec3(0.12, 0.07, 0.035);
    vec3 mossyGreen = vec3(0.20, 0.30, 0.12);
    vec3 warmBrown = vec3(0.43, 0.23, 0.10);
    vec3 cityOrangeBrown = vec3(0.70, 0.36, 0.14);
    vec3 branchGreen = vec3(0.30, 0.52, 0.23);
    vec3 canopySky = vec3(0.67, 0.84, 0.82);

    vec3 zoneColor = darkRootBrown;
    zoneColor = blendAtStop(
      zoneColor,
      mossyGreen,
      normalizedHeight,
      0.12,
      blendWidth
    );
    zoneColor = blendAtStop(
      zoneColor,
      warmBrown,
      normalizedHeight,
      0.29,
      blendWidth
    );
    zoneColor = blendAtStop(
      zoneColor,
      cityOrangeBrown,
      normalizedHeight,
      0.50,
      blendWidth
    );
    zoneColor = blendAtStop(
      zoneColor,
      branchGreen,
      normalizedHeight,
      0.72,
      blendWidth
    );
    zoneColor = blendAtStop(
      zoneColor,
      canopySky,
      normalizedHeight,
      0.90,
      blendWidth
    );

    vec3 defaultColor = vec3(0.32);
    vec3 finalColor = mix(defaultColor, zoneColor, u_gradientIntensity);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`
