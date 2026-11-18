import * as THREE from 'three'
import { createButterfly } from '../viewpoints/bodies'

/**
 * The autonomous butterflies' body: the viewpoints' butterfly model
 * (bodies.js: head, thorax and abdomen, two pairs of wings in one textured
 * plane each side, antennae) plus what visiting flowers needs: three pairs of
 * legs that reach down to land and a proboscis that uncoils from a spiral
 * under the head into the flower, and coils back.
 *
 * Its shape follows the agent's morphology (morphology.js): wing length and
 * width, body size (the whole group), eye size and wing colour from pale to
 * dark, so how a butterfly looks is what it can do.
 *
 * update(agent, dt, detail) poses it from the agent (ecology/butterflyAgent):
 * position, pose { forward, up }, anim { phase, beat, wings, legs,
 * proboscis, tip }. Wing modes: flap, glide, open (basking, flat), closed
 * (perched, over the back), feed (slow fanning while drinking). detail
 * false (far away) hides the legs and proboscis.
 */

const PROBOSCIS_SEGMENTS = 10
const LEG_Z = [-0.0074, -0.0052, -0.003]
const WING_POSE = { glide: 0.28, open: 0.06, closed: 1.47, feed: 1.2 }
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)
// Wing tint (× the wing texture) from pale (darkness 0) through the
// model's own colours (0.5) to dark (1).
const PALE = new THREE.Color(1.7, 1.6, 1.4)
const DARK = new THREE.Color(0.16, 0.13, 0.12)
const WHITE = new THREE.Color(1, 1, 1)
export function wingTint(darkness, out = new THREE.Color()) {
  return darkness < 0.5 ? out.copy(PALE).lerp(WHITE, darkness / 0.5) : out.copy(WHITE).lerp(DARK, (darkness - 0.5) / 0.5)
}

// A thin cylinder from a to b (unit cylinder geometry, along +y).
function limb(geometry, material, a, b, radius) {
  const mesh = new THREE.Mesh(geometry, material)
  const from = new THREE.Vector3(...a)
  const direction = new THREE.Vector3(...b).sub(from)
  mesh.position.copy(from).addScaledVector(direction, 0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  mesh.scale.set(radius, direction.length(), radius)
  return mesh
}

export function createButterflyBody(material, { proboscis = 0.01, scale = 1, morph = null } = {}) {
  const body = createButterfly(material)
  const group = body.group
  group.visible = false
  // Wings: length along the span, width along the body (the whole group is
  // scaled by body size, so divide that out); tinted pale to dark.
  const span = (morph?.wingLength ?? scale) / scale
  const chord = (morph ? morph.wingLength / morph.wingAspect : scale) / scale
  for (const { pivot } of body.wings) pivot.children[0].scale.set(span, 1, chord)
  if (morph) wingTint(morph.darkness, body.wings[0].pivot.children[0].material.color)
  // Compound eyes on the sides of the head, sized by the eye trait.
  const eyeGeometry = new THREE.SphereGeometry(1, 10, 8)
  const eye = 0.00085 * (morph?.eye ?? 1)
  for (const side of [-1, 1]) {
    const mesh = new THREE.Mesh(eyeGeometry, material)
    mesh.position.set(side * 0.0021, 0.0009, -0.0118)
    mesh.scale.setScalar(eye)
    group.add(mesh)
  }
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 5)
  cylinder.translate(0, 0.5, 0)
  const centered = new THREE.CylinderGeometry(1, 1, 1, 5)

  // Legs: femur out and down, tibia to the foot. The group squashes up
  // (tucked) in flight and stretches out to land.
  const legs = new THREE.Group()
  for (const side of [-1, 1]) {
    LEG_Z.forEach((z, k) => {
      const spread = (k - 1) * 0.0018
      const knee = [side * 0.0032, -0.0008, z + spread * 0.5]
      const foot = [side * 0.0046, -0.0036, z + spread]
      legs.add(limb(centered, material, [side * 0.0007, -0.0014, z], knee, 0.00017))
      legs.add(limb(centered, material, knee, foot, 0.00013))
    })
  }
  group.add(legs)

  // Proboscis: a chain of joints under the head; each segment lies along
  // its joint's −z. Curling every joint coils it into a spiral.
  const proboscisRoot = new THREE.Group()
  proboscisRoot.position.set(0, -0.0016, -0.0124)
  const joints = []
  let parent = proboscisRoot
  const length = proboscis / scale
  const segment = length / PROBOSCIS_SEGMENTS
  for (let i = 0; i < PROBOSCIS_SEGMENTS; i += 1) {
    const joint = new THREE.Group()
    if (i > 0) joint.position.set(0, 0, -segment)
    const piece = new THREE.Mesh(cylinder, material)
    piece.rotation.x = -Math.PI / 2
    piece.scale.set(0.00014, segment * 1.02, 0.00014)
    joint.add(piece)
    parent.add(joint)
    joints.push(joint)
    parent = joint
  }
  group.add(proboscisRoot)

  const wings = body.wings
  let wingAngle = WING_POSE.closed
  let flapMix = 1
  const basis = new THREE.Matrix4()
  const x = new THREE.Vector3()
  const y = new THREE.Vector3()
  const z = new THREE.Vector3()
  const local = new THREE.Vector3()
  const inverse = new THREE.Quaternion()
  const down = new THREE.Vector3(0, -0.55, -0.45).normalize()
  const aim = new THREE.Vector3()
  const forwardAxis = new THREE.Vector3(0, 0, -1)
  const aimQ = new THREE.Quaternion()

  return {
    group,
    update(agent, dt, detail = true) {
      const { pose, anim } = agent
      // Orientation from forward / up: local −z forward, +y up.
      z.set(-pose.forward.x, -pose.forward.y, -pose.forward.z).normalize()
      y.set(pose.up.x, pose.up.y, pose.up.z)
      y.addScaledVector(z, -y.dot(z)).normalize()
      x.crossVectors(y, z)
      basis.makeBasis(x, y, z)
      group.quaternion.setFromRotationMatrix(basis)
      group.position.set(agent.position.x, agent.position.y, agent.position.z)
      // A little bob with the wingbeat in flight.
      if (anim.wings === 'flap') group.position.y += Math.sin(anim.phase) * 0.0015 * agent.traits.scale
      group.scale.setScalar(agent.traits.scale * agent.seen)

      // Wings: beating, or held in a pose, blended so nothing snaps.
      const flapping = anim.wings === 'flap'
      flapMix += ((flapping ? 1 : 0) - flapMix) * smooth(8, dt)
      const posed = WING_POSE[anim.wings] ?? WING_POSE.closed
      const tremble = anim.wings === 'feed' ? 0.25 * Math.sin(agent.stateTime * 1.6) : 0
      wingAngle += (posed + tremble - wingAngle) * smooth(6, dt)
      const stroke = Math.min(1, 0.35 + 0.65 * anim.beat)
      const flap = 0.35 + (1 - stroke) * 0.25 + Math.sin(anim.phase) * 0.75 * stroke
      const angle = wingAngle + (flap - wingAngle) * flapMix
      for (const { pivot, side } of wings) pivot.rotation.z = angle * side

      legs.visible = detail
      proboscisRoot.visible = detail
      if (!detail) return
      legs.scale.set(0.7 + 0.3 * anim.legs, 0.35 + 0.65 * anim.legs, 1)

      // Proboscis: aimed at the nectar when out, curled under the head when in.
      const u = anim.proboscis
      if (u > 0.02 && anim.tip) {
        // The tip target in the body's own frame.
        local.set(anim.tip.x, anim.tip.y, anim.tip.z).sub(group.position)
        inverse.copy(group.quaternion).invert()
        local.applyQuaternion(inverse).divideScalar(agent.traits.scale)
        local.sub(proboscisRoot.position).normalize()
        aim.copy(down).lerp(local, u).normalize()
      } else aim.copy(down)
      aimQ.setFromUnitVectors(forwardAxis, aim)
      proboscisRoot.quaternion.copy(aimQ)
      for (let i = 1; i < joints.length; i += 1) joints[i].rotation.x = (1 - u) * (0.55 + 0.05 * i)
    },
    dispose() {
      for (const geometry of body.geometries) geometry.dispose()
      cylinder.dispose()
      centered.dispose()
      eyeGeometry.dispose()
      for (const item of body.extra) item.dispose()
    },
  }
}
