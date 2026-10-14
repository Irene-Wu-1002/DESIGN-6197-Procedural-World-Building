import { DEFAULT_HABITAT } from '../habitat/habitatFields'
import { DEFAULT_PATHS } from '../paths/antTrail'

// Which settings each tab and scatter element owns, so the panel can reset
// just those. Keys are grouped by the scene state they live in.

export const MAP_TABS = [
  ['terrain', 'Terrain'],
  ['habitat', 'Habitat'],
  ['scatter', 'Scatter'],
  ['paths', 'Paths'],
  ['debug', 'Debug'],
]

export const SCATTER_ELEMENTS = [
  ['moss', 'Moss'],
  ['flowers', 'Flowers'],
  ['leaves', 'Leaves'],
  ['twigs', 'Twigs'],
  ['pebbles', 'Pebbles'],
  ['mushrooms', 'Mushrooms'],
]

export const ELEMENT_KEYS = {
  moss: { cover: ['moss'] },
  flowers: { cover: ['flowers'] },
  leaves: { cover: ['leaves'] },
  twigs: { cover: ['twigs'] },
  pebbles: { ground: ['pebbles'] },
  mushrooms: { cover: ['mushrooms', 'flyAgaric'] },
}

export const TAB_KEYS = {
  terrain: { ground: ['seed', 'slopes', 'bumps', 'warp', 'grain'] },
  habitat: {
    ground: ['trunks', 'trunkSpacing', 'antHill'],
    view: ['haze', 'dapple'],
    habitat: Object.keys(DEFAULT_HABITAT),
  },
  scatter: mergeKeys(Object.values(ELEMENT_KEYS)),
  paths: { paths: Object.keys(DEFAULT_PATHS) },
  debug: { view: ['preview', 'distance'] },
}

function mergeKeys(list) {
  const merged = {}
  for (const keys of list) {
    for (const [group, names] of Object.entries(keys)) {
      merged[group] = [...(merged[group] ?? []), ...names]
    }
  }
  return merged
}
