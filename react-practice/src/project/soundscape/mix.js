/**
 * The soundscape's rules: how loud each sound is, and how often its calls
 * come, from the world's state and where you are. Pure functions, no Web
 * Audio, so they can be tested and read on their own; soundscape.js plays
 * what they decide.
 *
 *   rain      the shower's hiss and the drops' patter follow the rain
 *   drips     after rain, water falls from leaves while the ground is wet
 *   wind      a low roar and the leaves' rustle, gusting
 *   thunder   a few seconds after each lightning flash
 *   stream    louder as you come near the water, livelier where it falls
 *             steeply (riffles)
 *   birds     by day, a chorus around sunrise and sunset; quiet in rain
 *             and strong wind
 *   crickets  by night when it's warm enough; their chirp rate follows the
 *             air temperature (Dolbear's law)
 *
 * Every body hears the same world differently (hearing, viewpointConfig.js):
 * the ant feels the ground's thuds and low rumble, close to the ground the
 * wind is weaker, a butterfly hears the air rushing.
 */

export const DEFAULT_SOUND = {
  on: false,
  // Master and per-layer volumes (%).
  volume: 70,
  rain: 100,
  wind: 100,
  thunder: 100,
  water: 100,
  birds: 100,
  insects: 100,
}

// The layers, for the panel: [key, label].
export const SOUND_LAYERS = [
  ['water', 'Stream'],
  ['rain', 'Rain & drips'],
  ['wind', 'Wind & leaves'],
  ['thunder', 'Thunder'],
  ['birds', 'Birds'],
  ['insects', 'Crickets'],
]

// Hearing for a body without one (the free camera).
export const DEFAULT_HEARING = { wind: 1, drops: 1, birds: 1, insects: 1, water: 1, rumble: 0, pitch: 1 }

export const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// The stream is heard out to a few metres; half as loud at STREAM_NEAR.
const STREAM_NEAR = 0.35
// Steeper than this (fall per metre) is a riffle.
const RIFFLE = 0.08

/** 0–1: loudness of a source at distance d (m), half-power at `near`. */
export function falloff(d, near) {
  return 1 / (1 + (d / near) ** 2)
}

/**
 * The stream's voice at distance d (m) where it falls `slope` per metre:
 * { gain 0–1, babble (bubbles per second), brightness 0–1 }.
 */
export function streamVoice(d, slope, flow = 1) {
  if (!Number.isFinite(d) || flow <= 0) return { gain: 0, babble: 0, brightness: 0 }
  const riffle = clamp01(Math.max(slope, 0) / RIFFLE)
  const gain = falloff(d, STREAM_NEAR) * (0.55 + 0.45 * riffle) * Math.min(flow, 1.5)
  return { gain, babble: (25 + 70 * riffle) * Math.min(flow, 2), brightness: riffle }
}

/** Crickets' chirps per second at air temperature t (°C); 0 when too cold. */
export function chirpRate(t) {
  if (t < 8) return 0
  // Dolbear's law: chirps per minute ≈ 7 T + 30.
  return (7 * t + 30) / 60
}

/** Sun elevation (rad) from the direction toward the sun (y component). */
export const elevationOf = (sunY) => Math.asin(Math.max(Math.min(sunY, 1), -1))

/**
 * How lively each scheduled kind of sound is, 0–1, from the environment:
 * env { rain, wetness, wind, daylight, air (°C), sunY }.
 * Returns { birds, chorus, crickets, drips }.
 */
export function activity(env) {
  const rain = env.rain ?? 0
  const wind = env.wind ?? 0
  const daylight = env.daylight ?? 1
  const elevation = (elevationOf(env.sunY ?? 0.7) * 180) / Math.PI
  // Dawn and dusk chorus: the sun just around the horizon.
  const chorus = smoothstep(-8, -2, elevation) * (1 - smoothstep(8, 18, elevation))
  const calm = (1 - 0.9 * smoothstep(0.05, 0.5, rain)) * (1 - 0.6 * smoothstep(0.4, 0.9, wind))
  const birds = clamp01((smoothstep(0.05, 0.35, daylight) * 0.6 + chorus) * calm)
  const night = 1 - smoothstep(0.08, 0.3, daylight)
  const warm = smoothstep(8, 14, env.air ?? 15)
  const crickets = clamp01(night * warm * (1 - smoothstep(0.1, 0.4, rain)) * (1 - 0.5 * wind))
  const drips = clamp01((env.wetness ?? 0) * (1 - smoothstep(0.02, 0.15, rain)))
  return { birds, chorus, crickets, drips }
}

/**
 * Bed (continuous) gains 0–1 for the shower, the wind and the leaves:
 * env { rain, wind }, gust 0–1, hearing (DEFAULT_HEARING's keys),
 * shelter 0–1 (underground). Returns { rain, patter, wind, leaves }.
 */
export function beds(env, gust, hearing = DEFAULT_HEARING, shelter = 0) {
  const rain = env.rain ?? 0
  const wind = env.wind ?? 0
  const open = 1 - shelter
  return {
    rain: Math.sqrt(rain) * 0.5 * open,
    // Drops per second landing near you.
    patter: rain * 90 * hearing.drops * open,
    wind: clamp01(wind * (0.55 + 0.6 * gust) * hearing.wind) * open,
    leaves: clamp01(wind ** 1.4 * (0.3 + 0.9 * gust)) * 0.45 * open,
  }
}

/** Mix two hearing profiles (for the eased switch between bodies). */
export function lerpHearing(a, b, t, out = {}) {
  for (const key of Object.keys(DEFAULT_HEARING)) {
    const from = a?.[key] ?? DEFAULT_HEARING[key]
    const to = b?.[key] ?? DEFAULT_HEARING[key]
    out[key] = from + (to - from) * t
  }
  return out
}
