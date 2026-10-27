import * as THREE from 'three'
import { createRandom } from '../distributions'
import { DEG, MAX_SEGMENTS, UP, turnRandomly } from './common'

/**
 * Topic 6: stochastic branching.
 *
 * No fixed rule decides the shape. Every growing tip takes one small step at
 * a time and makes random choices: it wanders a little, sometimes splits off a
 * side branch, and sometimes stops. The result is messy and organic, like
 * hyphae, roots or lightning. A segment's depth is the step it grew in.
 */

export const DEFAULT_STOCHASTIC = {
  steps: 90,
  stepLength: 0.1,
  wander: 12,
  splitChance: 0.06,
  splitAngle: 35,
  stopChance: 0.005,
  tropism: 0.2,
  flatness: 0,
  startPoints: 1,
  growDown: false,
  seed: 1,
  showTips: true,
}

export const STOCHASTIC_PRESETS = {
  sapling: {
    label: 'Sapling',
    params: { steps: 90, stepLength: 0.1, wander: 12, splitChance: 0.06, splitAngle: 35, stopChance: 0.005, tropism: 0.2, flatness: 0, startPoints: 1, growDown: false },
  },
  roots: {
    label: 'Roots',
    params: { steps: 110, stepLength: 0.07, wander: 18, splitChance: 0.07, splitAngle: 40, stopChance: 0.012, tropism: -0.25, flatness: 0.35, startPoints: 1, growDown: true },
  },
  hyphae: {
    label: 'Hyphae',
    params: { steps: 130, stepLength: 0.07, wander: 20, splitChance: 0.03, splitAngle: 50, stopChance: 0.008, tropism: 0, flatness: 1, startPoints: 4, growDown: false },
  },
  lightning: {
    label: 'Lightning',
    params: { steps: 70, stepLength: 0.12, wander: 32, splitChance: 0.1, splitAngle: 28, stopChance: 0.03, tropism: -0.1, flatness: 0, startPoints: 1, growDown: true },
  },
}

// Upper bound on tips growing at once.
export const MAX_ACTIVE_TIPS = 4000

// Squash the vertical part of `dir` by `flatness` (1 = stay in a flat layer).
function flatten(dir, flatness, random) {
  dir.y *= 1 - flatness
  if (dir.lengthSq() < 1e-6) {
    const angle = random() * Math.PI * 2
    dir.set(Math.cos(angle), 0, Math.sin(angle))
  }
  return dir.normalize()
}

export function growStochastic(params) {
  const random = createRandom(params.seed)
  const vertical = new THREE.Vector3(0, params.growDown ? -1 : 1, 0)

  // Start points sit on a small circle; each starts mostly vertical, leaning
  // outward as flatness rises.
  let active = []
  for (let index = 0; index < params.startPoints; index += 1) {
    const angle = (index / params.startPoints) * Math.PI * 2 + random() * 0.5
    const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const position = params.startPoints > 1 ? outward.clone().multiplyScalar(0.5) : new THREE.Vector3()
    const dir = vertical
      .clone()
      .multiplyScalar(1 - params.flatness)
      .addScaledVector(outward, params.flatness)
    active.push({ position, dir: flatten(dir, params.flatness, random) })
  }

  const segments = []
  const tips = []
  let stopped = 0
  let capped = false
  let lastStep = 0

  for (let step = 0; step < params.steps && active.length; step += 1) {
    const next = []
    for (const tip of active) {
      if (step > 0 && random() < params.stopChance) {
        tips.push(tip.position)
        stopped += 1
        continue
      }
      if (segments.length >= MAX_SEGMENTS) {
        capped = true
        tips.push(tip.position)
        continue
      }

      // Wander, lean toward up or down, then stay as flat as asked.
      const dir = turnRandomly(tip.dir, random() * params.wander * DEG, random)
      dir.addScaledVector(UP, params.tropism * 0.15)
      flatten(dir, params.flatness, random)

      const end = tip.position.clone().addScaledVector(dir, params.stepLength)
      segments.push({ start: tip.position, end, depth: step })
      lastStep = step
      next.push({ position: end, dir })

      if (random() < params.splitChance) {
        if (active.length + next.length >= MAX_ACTIVE_TIPS) {
          capped = true
        } else {
          const side = turnRandomly(dir, params.splitAngle * DEG, random)
          next.push({ position: end, dir: flatten(side, params.flatness, random) })
        }
      }
    }
    active = next
  }
  active.forEach((tip) => tips.push(tip.position))

  return {
    segments,
    tips,
    maxDepth: lastStep,
    capped,
    stepName: 'Step',
    stats: [
      [segments.length, 'segments'],
      [stopped, 'tips stopped'],
      [active.length, 'tips reached the step limit'],
    ],
  }
}
