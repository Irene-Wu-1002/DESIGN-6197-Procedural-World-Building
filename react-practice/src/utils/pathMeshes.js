import * as THREE from 'three'
import { tangents } from './splines'

/**
 * Meshes for Week 5 paths: water ribbons for rivers, dirt ribbons for roads,
 * and plank bridges where a road crosses a river.
 */

const RIVER_LIFT = 0.02
const ROAD_LIFT = 0.03
const DECK_THICKNESS = 0.12
const DECK_EXTRA_WIDTH = 0.3
const RAIL_HEIGHT = 0.28
const RAIL_SIZE = 0.06

/**
 * A flat strip along the samples. width(sample) and y(sample) give the
 * strip's width and height at each point.
 */
function ribbonGeometry(samples, width, y) {
  const directions = tangents(samples)
  const positions = []
  const uvs = []
  const indices = []
  let distance = 0
  samples.forEach((sample, index) => {
    if (index > 0) {
      distance += Math.hypot(sample.x - samples[index - 1].x, sample.z - samples[index - 1].z)
    }
    const [dx, dz] = directions[index]
    // Perpendicular in the ground plane.
    const half = width(sample) / 2
    const px = -dz * half
    const pz = dx * half
    const height = y(sample)
    positions.push(sample.x + px, height, sample.z + pz, sample.x - px, height, sample.z - pz)
    uvs.push(0, distance, 1, distance)
    if (index > 0) {
      const a = (index - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Consecutive runs of samples where keep(sample) is true.
function runs(samples, keep) {
  const result = []
  let current = []
  for (const sample of samples) {
    if (keep(sample)) current.push(sample)
    else if (current.length) {
      result.push(current)
      current = []
    }
  }
  if (current.length) result.push(current)
  return result.filter((run) => run.length >= 2)
}

function bridgeMeshes(road, bridge, materials) {
  const start = road.samples[bridge.from]
  const end = road.samples[bridge.to]
  const length = Math.hypot(end.x - start.x, end.z - start.z) + 0.4
  const width = road.width + DECK_EXTRA_WIDTH
  const group = new THREE.Group()
  group.position.set((start.x + end.x) / 2, bridge.y, (start.z + end.z) / 2)
  group.rotation.y = Math.atan2(-(end.z - start.z), end.x - start.x)

  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, DECK_THICKNESS, width), materials.wood)
  deck.position.y = -DECK_THICKNESS / 2 + ROAD_LIFT
  group.add(deck)
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, RAIL_SIZE, RAIL_SIZE), materials.wood)
    rail.position.set(0, RAIL_HEIGHT, (side * width) / 2)
    group.add(rail)
    for (const along of [-0.5, 0, 0.5]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(RAIL_SIZE, RAIL_HEIGHT, RAIL_SIZE),
        materials.wood
      )
      post.position.set(along * (length - 0.2), RAIL_HEIGHT / 2, (side * width) / 2)
      group.add(post)
    }
  }
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  return group
}

/**
 * Build every path mesh. Returns { group, dispose }.
 * rivers / roads are the results of carveRivers() / buildRoads() (or null).
 */
export function createPathMeshes(rivers, roads) {
  const group = new THREE.Group()
  const materials = {
    river: new THREE.MeshStandardMaterial({
      color: '#4a8fc4',
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    }),
    road: new THREE.MeshStandardMaterial({
      color: '#8a7350',
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    wood: new THREE.MeshStandardMaterial({ color: '#7a5534', roughness: 0.9, flatShading: true }),
  }

  for (const river of rivers?.rivers ?? []) {
    const mesh = new THREE.Mesh(
      ribbonGeometry(river.samples, (s) => s.width, (s) => s.surface + RIVER_LIFT),
      materials.river
    )
    mesh.receiveShadow = true
    group.add(mesh)
  }

  for (const road of roads?.roads ?? []) {
    // Road surface everywhere except over bridges, where the deck takes over.
    for (const run of runs(road.samples, (s) => !s.bridge)) {
      const mesh = new THREE.Mesh(
        ribbonGeometry(run, () => road.width, (s) => s.y + ROAD_LIFT),
        materials.road
      )
      mesh.receiveShadow = true
      group.add(mesh)
    }
    for (const bridge of road.bridges) group.add(bridgeMeshes(road, bridge, materials))
  }

  const dispose = () => {
    group.traverse((child) => {
      if (child.isMesh) child.geometry.dispose()
    })
    Object.values(materials).forEach((material) => material.dispose())
  }
  return { group, dispose }
}
