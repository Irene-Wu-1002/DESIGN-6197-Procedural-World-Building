import * as THREE from 'three'

/**
 * The underground X-ray view: blends the World between the surface (0) and
 * a see-through ground (1) over a short fade.
 *
 *   ground      the tile and far-ground materials turn transparent and
 *               double-sided (so the surface is a faint film from below
 *               too), down to the chosen opacity
 *   atmosphere  the sky is hidden and the haze turns to a soil-brown
 *               darkness with no ground mist, so depth reads as darkness
 *   guides      dashed rings 10, 25 and 50 cm under the point you look at
 *
 * Cover shrinking away and the roots' rim glow read `amount` from update().
 */

const FADE_SECONDS = 0.6
const SOIL = new THREE.Color('#1c140e')
// Haze density underground (exponential-squared, per metre): about a
// third gone 3 m away, so roots across the view stay readable.
const SOIL_HAZE = 0.2
const GUIDE_DEPTHS = [0.1, 0.25, 0.5]
const GUIDE_RADIUS = 0.3

function createGuides() {
  const group = new THREE.Group()
  const material = new THREE.LineDashedMaterial({
    color: '#d9b98f',
    dashSize: 0.012,
    gapSize: 0.01,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const ring = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 97 }, (_, k) => {
      const angle = (k / 96) * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * GUIDE_RADIUS, 0, Math.sin(angle) * GUIDE_RADIUS)
    })
  )
  const geometries = [ring]
  for (const depth of GUIDE_DEPTHS) {
    const line = new THREE.Line(ring, material)
    line.position.y = -depth
    line.computeLineDistances()
    group.add(line)
  }
  // A plumb line from the surface down to the deepest ring.
  const plumb = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -GUIDE_DEPTHS.at(-1), 0),
  ])
  geometries.push(plumb)
  const plumbLine = new THREE.Line(plumb, material)
  plumbLine.computeLineDistances()
  group.add(plumbLine)
  return { group, material, geometries }
}

/** materials: the ground materials to make see-through (tiles, far ground). */
export function createXray(scene, materials) {
  const guides = createGuides()
  guides.group.visible = false
  scene.add(guides.group)

  let target = 0
  let amount = 0
  let opacity = 0.15
  let showGuides = true
  let seeThrough = false
  const background = new THREE.Color()

  // Switch the materials' blending only when crossing in or out (it
  // recompiles their shaders), and keep it while the fade runs.
  const setSeeThrough = (on) => {
    if (on === seeThrough) return
    seeThrough = on
    for (const material of materials) {
      material.transparent = on
      material.side = on ? THREE.DoubleSide : THREE.FrontSide
      material.needsUpdate = true
    }
  }

  return {
    /** 0 surface – 1 X-ray, after the fade. */
    get amount() {
      return amount
    },
    setOn(on) {
      target = on ? 1 : 0
    },
    setOpacity(value) {
      opacity = value
    },
    setGuides(on) {
      showGuides = on
    },

    /** Once per frame, before rendering; anchor: where you look (on the ground). */
    update(dt, anchor) {
      const step = dt / FADE_SECONDS
      amount = target > amount ? Math.min(amount + step, target) : Math.max(amount - step, target)
      setSeeThrough(amount > 0)
      for (const material of materials) material.opacity = 1 - amount * (1 - opacity)

      guides.group.visible = showGuides && amount > 0
      guides.group.position.set(anchor.x, anchor.y, anchor.z)
      guides.material.opacity = 0.55 * amount
    },

    /**
     * After the light and weather have set the sky and fog for the surface:
     * blend them toward the underground darkness.
     */
    applyAtmosphere(scene, sky) {
      if (amount <= 0) {
        sky.mesh.visible = true
        return
      }
      sky.mesh.visible = amount < 0.5
      background.copy(scene.background).lerp(SOIL, amount)
      scene.background.copy(background)
      scene.fog.color.lerp(SOIL, amount)
      const { haze, mistDensity, mistHeight } = scene.fog.values()
      scene.fog.set(haze + (SOIL_HAZE - haze) * amount, mistDensity * (1 - amount), mistHeight)
    },

    dispose() {
      scene.remove(guides.group)
      guides.geometries.forEach((geometry) => geometry.dispose())
      guides.material.dispose()
    },
  }
}
