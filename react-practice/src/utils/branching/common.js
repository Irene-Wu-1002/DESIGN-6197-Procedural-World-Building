import * as THREE from 'three'

// Shared by the Topic 6 branching methods.

export const UP = new THREE.Vector3(0, 1, 0)
export const DEG = Math.PI / 180

// Upper bound on segments so a deep or bushy structure can't freeze the page.
export const MAX_SEGMENTS = 120000

// Any unit vector perpendicular to `dir`.
export function perpendicular(dir) {
  const helper = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  return new THREE.Vector3().crossVectors(dir, helper).normalize()
}

// `dir` turned by `angle` toward a random side.
export function turnRandomly(dir, angle, random) {
  const axis = perpendicular(dir).applyAxisAngle(dir, random() * Math.PI * 2)
  return dir.clone().applyAxisAngle(axis, angle)
}
