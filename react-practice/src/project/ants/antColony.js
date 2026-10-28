import * as THREE from 'three'
import { antGeometry } from '../simulation/ambientLife'
import { MAX_ANTS, INSIDE, STEP, createColony } from './colony'

/**
 * The ant colony in the scene: runs the agents (colony.js) in fixed steps
 * at the chosen speed, draws every ant as one instanced mesh, and paints
 * the pheromone grid onto the ground through the ground shader
 * (groundMaterial.js: uPheromoneMap and friends).
 *
 * A new world is pre-warmed: a couple of simulated minutes run over the
 * first frames (a few milliseconds each), so the trails are already there.
 * Steps are fixed, so how the pre-warm is split across frames never
 * changes what grows.
 */

// Simulated seconds of pre-warm, and the time budget for it per frame (ms).
const PREWARM = 150
const PREWARM_BUDGET = 6
// Most steps a frame may run at speed (the rest are dropped, not owed).
const MAX_STEPS = 60
// How often the scent texture is refreshed (s), and its squash constant.
const TEXTURE_EVERY = 0.15
const TEXTURE_HALF = 3
const FADE_IN = 0.4

export function createAntColony(scene, groundUniforms) {
  const colony = createColony()
  const { grid } = colony

  const ants = new THREE.InstancedMesh(
    antGeometry(),
    new THREE.MeshStandardMaterial({ color: '#1c120c', roughness: 0.5 }),
    MAX_ANTS
  )
  ants.castShadow = true
  ants.frustumCulled = false
  ants.count = 0
  scene.add(ants)

  const pixels = new Uint8Array(grid.n * grid.n * 4)
  const texture = new THREE.DataTexture(pixels, grid.n, grid.n, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  groundUniforms.uPheromoneMap.value = texture
  groundUniforms.uPheromoneArea.value.set(grid.minX, grid.minZ, grid.size)

  let on = true
  let seed = 1
  let settings = null
  let speed = 1
  let warm = 0
  let carry = 0
  let textureTimer = 0
  const pheromones = { show: false, intensity: 0.7 }

  const matrix = new THREE.Matrix4()
  const yaw = new THREE.Quaternion()
  const tilt = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  const writeTexture = () => {
    const { food, home } = grid
    for (let i = 0; i < food.length; i += 1) {
      pixels[i * 4] = (255 * food[i]) / (food[i] + TEXTURE_HALF)
      pixels[i * 4 + 1] = (255 * home[i]) / (home[i] + TEXTURE_HALF)
    }
    texture.needsUpdate = true
  }

  const drawAnts = (sampler, alpha) => {
    let count = 0
    if (on && sampler) {
      const e = grid.cell
      for (const ant of colony.ants) {
        if (ant.state === INSIDE) continue
        const x = ant.px + (ant.x - ant.px) * alpha
        const z = ant.pz + (ant.z - ant.pz) * alpha
        const heading = ant.ph + Math.atan2(Math.sin(ant.heading - ant.ph), Math.cos(ant.heading - ant.ph)) * alpha
        position.set(x, sampler.height(x, z), z)
        // Face along the heading (the body looks down -z), tipped with the slope.
        yaw.setFromAxisAngle(up, Math.atan2(-Math.cos(heading), -Math.sin(heading)))
        normal
          .set(
            colony.heightAt(x - e, z) - colony.heightAt(x + e, z),
            2 * e,
            colony.heightAt(x, z - e) - colony.heightAt(x, z + e)
          )
          .normalize()
        tilt.setFromUnitVectors(up, normal).multiply(yaw)
        scale.setScalar(Math.min(ant.age / FADE_IN, 1))
        matrix.compose(position, tilt, scale)
        ants.setMatrixAt(count, matrix)
        count += 1
      }
    }
    ants.count = count
    ants.instanceMatrix.needsUpdate = true
  }

  return {
    meshes: [ants],

    /** Whether the agents run (Paths > Ant colony). */
    get on() {
      return on
    },

    /** Start over on this ground (see colony.place) and pre-warm. */
    place(world) {
      seed = world.seed
      colony.place(world)
      warm = PREWARM
      carry = 0
      writeTexture()
    },

    /** Clear the scent and call every ant home, then pre-warm again. */
    reset() {
      colony.reset(seed)
      warm = PREWARM
      carry = 0
      writeTexture()
    },

    /**
     * Paths settings: antAgents (on/off), colonySize, simSpeed (×),
     * scentHalfLife (s), diffusion, sensorAngle (°), sensorDistance (cm),
     * wander, slopeAvoidance (%).
     */
    setSettings(paths) {
      on = paths.antAgents
      speed = paths.simSpeed
      settings = {
        colonySize: paths.colonySize,
        halfLife: paths.scentHalfLife,
        diffusion: (paths.diffusion / 100) * 2,
        sensorAngle: THREE.MathUtils.degToRad(paths.sensorAngle),
        sensorDistance: paths.sensorDistance / 100,
        wander: paths.wander / 100,
        slopeAvoidance: paths.slopeAvoidance / 100,
      }
    },

    /** Paths > Pheromones: show (in every view), intensity (0–1). */
    setPheromones({ show, intensity }) {
      Object.assign(pheromones, { show, intensity })
    },

    /**
     * dt, time (s); activity: share of the colony out (0–1); sampler: the
     * ground; scent: how much the viewer smells (0–1); fadeStart, fadeEnd:
     * where the glow fades with distance from the viewer (m).
     */
    update({ dt, time, activity, sampler, scent, fadeStart, fadeEnd }) {
      const smelled = pheromones.show ? 1 : scent
      groundUniforms.uPheromoneStrength.value = on && colony.ready ? smelled * (pheromones.intensity / 0.7) : 0
      groundUniforms.uPheromoneTime.value = time
      groundUniforms.uPheromoneFade.value.set(fadeStart, fadeEnd)
      if (!on || !settings) {
        ants.count = 0
        return
      }
      colony.build()
      if (!colony.ready) {
        ants.count = 0
        return
      }

      // Pre-warm with the whole colony out, then run at the chosen speed.
      if (warm > 0) {
        const start = performance.now()
        while (warm > 0 && performance.now() - start < PREWARM_BUDGET) {
          colony.step(settings, 1)
          warm -= STEP
        }
        textureTimer = TEXTURE_EVERY
      } else {
        carry += Math.min(dt, 0.1) * speed
        let steps = 0
        while (carry >= STEP && steps < MAX_STEPS) {
          colony.step(settings, activity)
          carry -= STEP
          steps += 1
        }
        if (steps === MAX_STEPS) carry = 0
      }

      textureTimer += dt
      if (textureTimer >= TEXTURE_EVERY) {
        textureTimer = 0
        writeTexture()
      }
      drawAnts(sampler, warm > 0 ? 1 : carry / STEP)
    },

    /** { out, carrying, delivered, time (simulated s), ready, warming }. */
    stats() {
      return { ...colony.stats(), warming: warm > 0, on }
    },

    /** The colony itself (for checks during development). */
    colony,

    dispose() {
      scene.remove(ants)
      ants.geometry.dispose()
      ants.material.dispose()
      ants.dispose()
      texture.dispose()
      groundUniforms.uPheromoneStrength.value = 0
    },
  }
}
