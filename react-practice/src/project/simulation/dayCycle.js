/**
 * Day and night: where the sun and moon are at a time of day, and what that
 * means for light, sky, warmth, flowers and animals. Pure functions of the
 * time and settings (hours 0–24, angles in degrees, compass azimuth as in
 * habitat/habitatFields.js: 0 toward +z, 90 toward +x).
 *
 * The sun rises at sunrise, peaks half-way to sunset at peakElevation, and
 * sets at sunset; its azimuth sweeps 180° through the day around NOON_AZIMUTH.
 * With the defaults (06:30–19:30, peak 48°) 14:00 puts the sun where the
 * Habitat tab's default sun is (61°, 47°), so starting the simulation at
 * 14:00 changes nothing at first.
 *
 * Plain data only, no Three.js.
 */

export const DEFAULT_DAY = {
  playing: true,
  // Hours (0–24).
  time: 14,
  // Multiplier on the clock; day length is real minutes per day at 1×.
  speed: 1,
  dayLength: 10,
  sunrise: 6.5,
  sunset: 19.5,
  // %: 100 is the forest's usual light.
  sunIntensity: 100,
  moonIntensity: 100,
  // Manual sun: set azimuth and elevation directly (time still runs).
  manualSun: false,
  azimuth: 61,
  elevation: 47,
}

export const SPEEDS = [0.25, 1, 4, 20]
export const NOON_AZIMUTH = 47
export const PEAK_ELEVATION = 48
// How deep the sun sinks at midnight (degrees below the horizon).
const NIGHT_DEPTH = 40

const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
const wrapHours = (hours) => ((hours % 24) + 24) % 24

/** Simulated hours that pass per real second. */
export function hoursPerSecond(day) {
  return (24 / (day.dayLength * 60)) * day.speed
}

/** Sun { azimuth, elevation } (degrees) at `time` (hours). */
export function sunAt(time, { sunrise, sunset }, peakElevation = PEAK_ELEVATION) {
  const t = wrapHours(time)
  const dayLength = Math.max(sunset - sunrise, 0.5)
  if (t >= sunrise && t <= sunset) {
    const f = (t - sunrise) / dayLength
    return { azimuth: NOON_AZIMUTH + (f - 0.5) * 180, elevation: peakElevation * Math.sin(Math.PI * f) }
  }
  // Night: below the horizon, carrying on round the other side.
  const nightLength = 24 - dayLength
  const g = wrapHours(t - sunset) / nightLength
  return { azimuth: NOON_AZIMUTH + 180 + (g - 0.5) * 180, elevation: -NIGHT_DEPTH * Math.sin(Math.PI * g) }
}

/** The moon, roughly opposite the sun (up when the sun is well down). */
export function moonAt(sun) {
  return { azimuth: sun.azimuth + 180, elevation: Math.max(-sun.elevation * 0.8, -10) }
}

/** Unit vector toward a body at { azimuth, elevation } as [x, y, z]. */
export function directionOf({ azimuth, elevation }) {
  const a = (azimuth * Math.PI) / 180
  const e = (elevation * Math.PI) / 180
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]
}

/** 0 at night – 1 in full day, from the sun's elevation. */
export function daylightOf(elevation) {
  return smoothstep(-4, 8, elevation)
}

/**
 * Air and surface temperature (°C). The air follows a daily swing around
 * `mean` (warmest mid-afternoon); the surface adds sun heating on top.
 * sunShare: how much direct sun gets through (0–1, clouds lower it).
 */
export function temperatureAt(time, sunElevation, { mean = 14, swing = 5, heating = 9, sunShare = 1 } = {}) {
  const air = mean + swing * Math.cos((2 * Math.PI * (time - 15)) / 24)
  const sun = Math.max(Math.sin((sunElevation * Math.PI) / 180), 0) * sunShare
  return { air, surface: air + heating * sun }
}

/** Flowers open in bright light (0 closed – 1 open). */
export function flowerOpening(brightness) {
  return smoothstep(0.12, 0.5, brightness)
}

/** Butterflies fly in warm daylight (0–1). */
export function butterflyActivity(daylight, surface) {
  return daylight * smoothstep(14, 22, surface)
}

/**
 * Ants forage at mild temperatures: mornings and evenings, less in midday
 * heat or cold, a little at night (0–1).
 */
export function antActivity(daylight, surface) {
  // Warm enough to move, but midday heat sends many back into the nest.
  const mild = smoothstep(8, 14, surface) * (1 - 0.65 * smoothstep(19, 26, surface))
  return mild * (0.15 + 0.85 * daylight)
}

export const formatClock = (hours) => {
  const t = wrapHours(hours)
  const h = Math.floor(t)
  const m = Math.floor((t - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
