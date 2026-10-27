import { DEFAULT_ROOTS } from './roots'

// The Underground tab. view: 'surface' | 'xray' | 'section' (the
// cross-section); opacity: % of the ground left in X-ray; depth: cm the
// free camera's orbit point sinks below the surface in X-ray.
export const UNDERGROUND_VIEWS = ['surface', 'xray', 'section']
export const DEFAULT_UNDERGROUND = {
  view: 'surface',
  opacity: 15,
  depth: 0,
  guides: true,
  ...DEFAULT_ROOTS,
}

// Settings that regrow (or recolour) the roots; the rest only change how
// they're seen.
export const ROOT_KEYS = Object.keys(DEFAULT_ROOTS).filter((key) => key !== 'roots')
