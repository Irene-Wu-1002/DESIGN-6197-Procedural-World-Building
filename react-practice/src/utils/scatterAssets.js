import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Low-poly asset shapes for the Week 5 scatter, built from basic primitives.
 *
 * Each instanced asset is a list of parts. Every part becomes one
 * InstancedMesh, so a whole forest costs one draw call per part.
 *   color:      base colour of the part
 *   shadeRange: how much lighter/darker each instance can be (0 = none)
 */

// Primitives disagree on indexing (cones are indexed, polyhedra are not).
function nonIndexed(geometry) {
  if (!geometry.index) return geometry
  const result = geometry.toNonIndexed()
  geometry.dispose()
  return result
}

function merge(geometries) {
  const parts = geometries.map(nonIndexed)
  const merged = mergeGeometries(parts)
  parts.forEach((geometry) => geometry.dispose())
  merged.computeVertexNormals()
  return merged
}

function at(geometry, x, y, z, scaleX = 1, scaleY = scaleX, scaleZ = scaleX) {
  geometry.scale(scaleX, scaleY, scaleZ)
  geometry.translate(x, y, z)
  return geometry
}

// Nudge each corner in or out; corners shared by several faces move together.
function roughen(geometry, amount, seed) {
  const positions = geometry.attributes.position
  const offsets = new Map()
  let state = seed
  const random = () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
  for (let index = 0; index < positions.count; index += 1) {
    const key = [positions.getX(index), positions.getY(index), positions.getZ(index)]
      .map((value) => value.toFixed(3))
      .join(',')
    if (!offsets.has(key)) offsets.set(key, 1 + (random() - 0.5) * 2 * amount)
    const factor = offsets.get(key)
    positions.setXYZ(
      index,
      positions.getX(index) * factor,
      positions.getY(index) * factor,
      positions.getZ(index) * factor
    )
  }
  geometry.computeVertexNormals()
  return geometry
}

export function createInstancedAssetParts() {
  const pineCanopy = merge([
    at(new THREE.ConeGeometry(0.75, 1.1, 7), 0, 0.95, 0),
    at(new THREE.ConeGeometry(0.6, 0.95, 7), 0, 1.5, 0),
    at(new THREE.ConeGeometry(0.42, 0.8, 7), 0, 2.0, 0),
  ])

  const roundCanopy = merge([
    at(new THREE.IcosahedronGeometry(0.7, 0), 0, 1.45, 0),
    at(new THREE.IcosahedronGeometry(0.5, 0), 0.38, 1.25, 0.2),
    at(new THREE.IcosahedronGeometry(0.45, 0), -0.32, 1.3, -0.25),
  ])

  const bush = merge([
    at(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.22, 0, 1, 0.7, 1),
    at(new THREE.IcosahedronGeometry(0.3, 0), 0.28, 0.16, 0.1, 1, 0.7, 1),
  ])

  const rock = roughen(new THREE.DodecahedronGeometry(0.5, 0), 0.22, 11)

  return {
    pine: [
      { geometry: at(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), 0, 0.3, 0), color: '#5b4128', shadeRange: 0.1 },
      { geometry: pineCanopy, color: '#2f5a32', shadeRange: 0.25 },
    ],
    round: [
      { geometry: at(new THREE.CylinderGeometry(0.09, 0.13, 1.0, 6), 0, 0.5, 0), color: '#6b4b2e', shadeRange: 0.1 },
      { geometry: roundCanopy, color: '#6f9a3c', shadeRange: 0.3 },
    ],
    bush: [{ geometry: bush, color: '#4f7a34', shadeRange: 0.3 }],
    rock: [{ geometry: rock, color: '#8c8a83', shadeRange: 0.25 }],
  }
}

/**
 * Windmills are few and have moving blades, so each is a normal Group.
 * Returns { group, rotor } – spin rotor.rotation.z to turn the blades.
 */
export function createWindmillGeometry() {
  const geometries = {
    tower: at(new THREE.CylinderGeometry(0.35, 0.6, 3.2, 8), 0, 1.6, 0),
    cap: at(new THREE.ConeGeometry(0.6, 0.7, 8), 0, 3.55, 0),
    hub: new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8).rotateX(Math.PI / 2),
    blade: at(new THREE.BoxGeometry(0.22, 1.7, 0.04), 0, 0.95, 0),
  }
  const materials = {
    tower: new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.85, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.9, flatShading: true }),
    blade: new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.8, flatShading: true }),
  }

  const build = () => {
    const group = new THREE.Group()
    const addPart = (geometry, material) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return mesh
    }
    group.add(addPart(geometries.tower, materials.tower))
    group.add(addPart(geometries.cap, materials.dark))

    const rotor = new THREE.Group()
    rotor.position.set(0, 3.2, 0.62)
    rotor.add(addPart(geometries.hub, materials.dark))
    for (let index = 0; index < 4; index += 1) {
      const blade = addPart(geometries.blade, materials.blade)
      blade.rotation.z = (index * Math.PI) / 2
      rotor.add(blade)
    }
    group.add(rotor)
    return { group, rotor }
  }

  const dispose = () => {
    Object.values(geometries).forEach((geometry) => geometry.dispose())
    Object.values(materials).forEach((material) => material.dispose())
  }

  return { build, dispose }
}
