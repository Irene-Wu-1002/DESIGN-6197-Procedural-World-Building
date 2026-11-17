/**
 * Seeded randomness for the ecology, so a world seed gives the same
 * butterflies and the same starting nectar every time.
 *
 * Plain data only, no Three.js.
 */

/** A seeded 0–1 generator (mulberry32). */
export function createRandom(seed) {
  let a = seed >>> 0 || 0x9e3779b9
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (low, high) => low + (high - low) * next()
  // A standard normal number (Box–Muller).
  next.normal = () => {
    const u = Math.max(next(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  return next
}

/** A stable 0–1 number for a string (FNV-1a). */
export function hashString(text, salt = 0) {
  let h = (2166136261 ^ salt) >>> 0
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export const clamp = (value, low, high) => Math.min(Math.max(value, low), high)
export const clamp01 = (value) => clamp(value, 0, 1)
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
export const lerp = (a, b, t) => a + (b - a) * t
/** Angle wrapped to −π…π. */
export const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))
