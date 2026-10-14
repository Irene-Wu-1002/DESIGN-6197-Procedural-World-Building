import * as THREE from 'three'

/**
 * Height fog for the Map: an even haze plus a ground mist that thins with
 * height, in the scene's own fog (so every lit material gets it without
 * changes).
 *
 * three.js only sends a fog's near, far and colour to the shaders, so
 * HeightFog is a THREE.Fog that packs its values into them, marked by a
 * negative near (which ordinary linear fog never has):
 *   near = -haze            haze density (per metre)
 *   far  = mistHeight (mm, whole part) + mistDensity / 10 (fraction)
 * installHeightFog() replaces three's fog shader chunks with versions that
 * decode this; ordinary linear (near ≥ 0) and exponential fog behave
 * exactly as before, so other scenes are unaffected.
 *
 * Mist is weighed at the average height of the camera and the surface,
 * relative to the forest floor (y ≈ 0): a cheap stand-in for integrating
 * along the view ray.
 */

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogHeight;
#endif
`

const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World height: the view-space point taken back through the camera.
  vFogHeight = cameraPosition.y + ( transpose( mat3( viewMatrix ) ) * mvPosition.xyz ).y;
#endif
`

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogHeight;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor;
    if ( fogNear < 0.0 ) {
      float mistHeight = max( floor( fogFar ) / 1000.0, 0.001 );
      float mistDensity = fract( fogFar ) * 10.0;
      float height = max( 0.5 * ( vFogHeight + cameraPosition.y ), 0.0 );
      float density = - fogNear + mistDensity * exp( - height / mistHeight );
      fogFactor = 1.0 - exp( - density * density * vFogDepth * vFogDepth );
    } else {
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    }
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`

let installed = false

/** Swap in the height-aware fog chunks (once, before anything compiles). */
export function installHeightFog() {
  if (installed) return
  installed = true
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX
  THREE.ShaderChunk.fog_vertex = VERTEX
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT
  THREE.ShaderChunk.fog_fragment = FRAGMENT
}

// Mist density is packed as a fraction (×10), so it tops out just under 10/m.
const MAX_MIST = 9.99

export class HeightFog extends THREE.Fog {
  constructor(color) {
    super(color, -0.1, 300)
  }

  /** haze, mistDensity: per metre; mistHeight: metres. */
  set(haze, mistDensity, mistHeight) {
    this.near = -Math.max(haze, 1e-4)
    this.far = Math.round(Math.max(mistHeight, 0.001) * 1000) + Math.min(Math.max(mistDensity, 0), MAX_MIST) / 10
  }
}
