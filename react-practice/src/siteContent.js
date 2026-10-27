// The site's pages and the weekly experiments shown on the Exploration page.

export const PAGES = [
  { id: 'concept', title: 'Concept' },
  { id: 'world', title: 'World' },
  { id: 'techniques', title: 'Techniques' },
  { id: 'exploration', title: 'Exploration' },
]

export const WEEKS = [
  {
    id: 1,
    title: 'Three.js exploring',
    summary:
      'A first 3D viewer: change one object’s shape, size, material and gradient, and orbit around it.',
    hint: 'Drag to orbit · Scroll to zoom',
  },
  {
    id: 2,
    title: 'Infinite Noise Map',
    summary:
      'A terrain made only from noise. Land and sea layers blend into a height map that goes on forever.',
    hint: 'W A S D to travel · Drag to orbit',
  },
  {
    id: 3,
    title: 'Voxel Terrain',
    summary:
      'Density shapes, sequential CSG and Marching Cubes turn a voxel field into solid ground, in chunks.',
    hint: 'Orbit · Pan · Zoom',
  },
  {
    id: 4,
    title: 'Shader exploring',
    summary:
      'Small WebGL and GLSL studies: what each shader reads, what it changes, and why it is useful.',
    hint: 'Pick a shader strategy in the panel',
  },
  {
    id: 5,
    title: 'Distributions',
    summary:
      'A procedural world in layers: terrain, scattered trees and rocks, rivers, roads, and wind.',
    hint: 'Orbit · Pan · Zoom',
  },
  {
    id: 6,
    title: 'Branching System',
    summary: 'A plain canvas for studying how branches split and grow.',
    hint: 'Orbit · Pan · Zoom',
  },
]

const PAGE_IDS = new Set(PAGES.map((page) => page.id))

// The URL hash keeps the open page across reloads: #world, #exploration/3.
export function readHash() {
  const [page, week] = window.location.hash.slice(1).split('/')
  return {
    page: PAGE_IDS.has(page) ? page : 'concept',
    week: WEEKS.some((item) => String(item.id) === week) ? Number(week) : null,
  }
}

export function writeHash(page, week) {
  const hash = page === 'exploration' ? `#${page}/${week}` : `#${page}`
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
}
