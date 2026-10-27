import * as THREE from 'three'
import { createRandom } from '../distributions'
import { DEG, MAX_SEGMENTS, UP } from './common'

/**
 * Topic 6: L-systems.
 *
 * Start from the axiom and rewrite every symbol that has a rule, again and
 * again. A 3D turtle then walks the final string:
 *
 *   F   draw forward          f   move forward without drawing
 *   + - turn left / right     & ^ pitch down / up
 *   \ / roll left / right     |   turn around
 *   [ ] save / return to the turtle's position (this is what makes branches)
 *
 * Any other letter (X, A, B…) only drives the rewriting and draws nothing.
 * A segment's depth is how many F steps lie between it and the root, so the
 * plant grows up its stems and out along its branches.
 */

export const DEFAULT_LSYSTEM = {
  axiom: 'X',
  rules: ['X=F+[[X]-X]-F[-FX]+X', 'F=FF', ''],
  iterations: 5,
  angle: 25,
  stepLength: 0.09,
  lengthScale: 1,
  angleJitter: 4,
  tropism: 0,
  seed: 1,
  showTips: false,
}

export const LSYSTEM_PRESETS = {
  plant: {
    label: 'Fractal plant',
    params: { axiom: 'X', rules: ['X=F+[[X]-X]-F[-FX]+X', 'F=FF', ''], iterations: 5, angle: 25, stepLength: 0.09, lengthScale: 1, angleJitter: 4, tropism: 0 },
  },
  weed: {
    label: 'Weed',
    params: { axiom: 'F', rules: ['F=F[+F]F[-F][F]', '', ''], iterations: 4, angle: 22, stepLength: 0.11, lengthScale: 1, angleJitter: 6, tropism: 0.1 },
  },
  bush: {
    label: '3D bush',
    params: { axiom: 'A', rules: ['A=[&FA]/////[&FA]///////[&FA]', 'F=S/////F', 'S=F'], iterations: 6, angle: 22.5, stepLength: 0.22, lengthScale: 1, angleJitter: 3, tropism: 0 },
  },
  tree: {
    label: '3D tree',
    params: { axiom: 'FFFFA', rules: ['A=[&FFFA]////[&FFFA]////[&FFFA]', '', ''], iterations: 6, angle: 28, stepLength: 0.4, lengthScale: 0.78, angleJitter: 6, tropism: 0.15 },
  },
}

// The rewritten string stops growing past this many symbols.
export const MAX_STRING = 200000

// "X=F[+X]" (also "X→…" or "X->…") becomes ['X', 'F[+X]']; blank lines are skipped.
export function parseRules(lines) {
  const rules = new Map()
  for (const line of lines) {
    const match = line.trim().match(/^(\S)\s*(?:=|->|→)\s*(.*)$/)
    if (match) rules.set(match[1], match[2].replace(/\s+/g, ''))
  }
  return rules
}

export function expandLSystem(axiom, rules, iterations) {
  let current = axiom.replace(/\s+/g, '')
  let capped = false
  for (let step = 0; step < iterations; step += 1) {
    let next = ''
    for (const symbol of current) {
      next += rules.get(symbol) ?? symbol
      if (next.length > MAX_STRING) {
        capped = true
        break
      }
    }
    current = next.slice(0, MAX_STRING)
    if (capped) break
  }
  return { string: current, capped }
}

export function growLSystem(params) {
  const random = createRandom(params.seed)
  const jitter = () => (random() * 2 - 1) * params.angleJitter * DEG
  const { string, capped: stringCapped } = expandLSystem(
    params.axiom,
    parseRules(params.rules),
    params.iterations
  )

  // Heading, left and up: the turtle's own frame.
  let turtle = {
    position: new THREE.Vector3(),
    heading: new THREE.Vector3(0, 1, 0),
    left: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
    level: 0,
    steps: 0,
    drewSinceBranch: false,
  }
  const stack = []
  const segments = []
  const tips = []
  let capped = stringCapped

  const rotate = (axis, angle) => {
    turtle.heading.applyAxisAngle(axis, angle)
    turtle.left.applyAxisAngle(axis, angle)
    turtle.up.applyAxisAngle(axis, angle)
  }
  const turn = (angle) => rotate(turtle.up.clone(), angle)
  const pitch = (angle) => rotate(turtle.left.clone(), angle)
  const roll = (angle) => rotate(turtle.heading.clone(), angle)
  const delta = params.angle * DEG

  for (const symbol of string) {
    switch (symbol) {
      case 'F':
      case 'f': {
        // Tropism: bend the heading toward up (or down) a little each step.
        if (params.tropism) {
          const axis = new THREE.Vector3().crossVectors(turtle.heading, UP)
          const amount = axis.length() * params.tropism * 0.12
          if (axis.lengthSq() > 1e-8) rotate(axis.normalize(), amount)
        }
        const length = params.stepLength * params.lengthScale ** turtle.level
        const end = turtle.position.clone().addScaledVector(turtle.heading, length)
        if (symbol === 'F') {
          if (segments.length >= MAX_SEGMENTS) {
            capped = true
          } else {
            segments.push({ start: turtle.position, end, depth: turtle.steps })
            turtle.steps += 1
            turtle.drewSinceBranch = true
          }
        }
        turtle.position = end
        break
      }
      case '+': turn(delta + jitter()); break
      case '-': turn(-delta + jitter()); break
      case '&': pitch(delta + jitter()); break
      case '^': pitch(-delta + jitter()); break
      case '\\': roll(delta + jitter()); break
      case '/': roll(-delta + jitter()); break
      case '|': turn(Math.PI); break
      case '[':
        stack.push({
          ...turtle,
          position: turtle.position.clone(),
          heading: turtle.heading.clone(),
          left: turtle.left.clone(),
          up: turtle.up.clone(),
        })
        turtle.level += 1
        turtle.drewSinceBranch = false
        // A random roll on every branch lifts flat (2D) rules into 3D.
        roll(jitter() * 6)
        break
      case ']':
        if (turtle.drewSinceBranch) tips.push(turtle.position)
        if (stack.length) turtle = stack.pop()
        break
      default:
        break
    }
  }
  if (turtle.drewSinceBranch) tips.push(turtle.position)

  const maxDepth = segments.reduce((max, segment) => Math.max(max, segment.depth), 0)
  return {
    segments,
    tips,
    maxDepth,
    capped,
    string,
    stepName: 'Step',
    stats: [
      [string.length, 'symbols'],
      [segments.length, 'segments'],
      [tips.length, 'tips'],
    ],
  }
}
