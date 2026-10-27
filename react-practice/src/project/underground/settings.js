import { DEFAULT_ROOTS } from './roots'

// The Underground tab. opacity: % of the ground left in X-ray; depth: cm
// the free camera's orbit point sinks below the surface.
export const DEFAULT_UNDERGROUND = {
  xray: false,
  opacity: 15,
  depth: 0,
  guides: true,
  ...DEFAULT_ROOTS,
}

// Settings that regrow the roots (the rest only change how they're seen).
export const ROOT_KEYS = Object.keys(DEFAULT_ROOTS).filter((key) => key !== 'roots')
