import * as THREE from 'three'

// Weather for the Project tab. The panel edits a *target* weather; every
// frame the live weather eases toward it, so switching Sunny → Rain blends
// over a few seconds instead of jumping. `computeAtmosphere()` then turns
// the live weather into light, sky, fog, and wetness values for the scene.

export const WEATHER_PRESETS = {
  sunny: { label: 'Sunny', cloudCover: 0.18, rain: 0, wind: 0.25 },
  cloudy: { label: 'Cloudy', cloudCover: 0.72, rain: 0, wind: 0.45 },
  rain: { label: 'Rain', cloudCover: 1, rain: 0.85, wind: 0.6 },
}

// Auto cycle loops through these, holding each for CYCLE_SECONDS.
export const CYCLE_ORDER = ['sunny', 'cloudy', 'rain', 'cloudy']
export const CYCLE_SECONDS = 9

export function createWeatherSettings() {
  return {
    preset: 'sunny',
    ...pickPreset('sunny'),
    timeOfDay: 0.35,
    windDirection: 35,
    autoCycle: false,
  }
}

export function pickPreset(name) {
  const { cloudCover, rain, wind } = WEATHER_PRESETS[name]
  return { cloudCover, rain, wind }
}

// Seconds for the live weather to cover ~63% of the gap to the target.
const EASE_SECONDS = 1.4
// Surfaces get wet quickly but dry slowly.
const WET_SECONDS = 2.5
const DRY_SECONDS = 9

export function createLiveWeather(settings) {
  return {
    cloudCover: settings.cloudCover,
    rain: settings.rain,
    wind: settings.wind,
    timeOfDay: settings.timeOfDay,
    windDirection: settings.windDirection,
    wetness: settings.rain,
  }
}

function ease(current, target, dt, seconds) {
  return current + (target - current) * (1 - Math.exp(-dt / seconds))
}

// Shortest-way easing for an angle in degrees.
function easeAngle(current, target, dt, seconds) {
  const delta = ((target - current + 540) % 360) - 180
  return current + delta * (1 - Math.exp(-dt / seconds))
}

export function stepLiveWeather(live, target, dt) {
  live.cloudCover = ease(live.cloudCover, target.cloudCover, dt, EASE_SECONDS)
  live.rain = ease(live.rain, target.rain, dt, EASE_SECONDS)
  live.wind = ease(live.wind, target.wind, dt, EASE_SECONDS)
  live.timeOfDay = ease(live.timeOfDay, target.timeOfDay, dt, 0.6)
  live.windDirection = easeAngle(live.windDirection, target.windDirection, dt, EASE_SECONDS)
  const wetTarget = Math.min(1, live.rain * 1.4)
  live.wetness = ease(
    live.wetness,
    wetTarget,
    dt,
    wetTarget > live.wetness ? WET_SECONDS : DRY_SECONDS
  )
  return live
}

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

const MAX_SUN_ELEVATION = THREE.MathUtils.degToRad(64)
const SUN_DISTANCE = 214

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const COLORS = {
  sunLow: new THREE.Color('#ff9f5a'),
  sunHigh: new THREE.Color('#fff3df'),
  skyTopDay: new THREE.Color('#5d8fc4'),
  skyHorizonDay: new THREE.Color('#b3c9c6'),
  skyTopDusk: new THREE.Color('#4a5f8a'),
  skyHorizonDusk: new THREE.Color('#e8a576'),
  skyTopOvercast: new THREE.Color('#8b969d'),
  skyHorizonOvercast: new THREE.Color('#a8b2b2'),
  skyTopRain: new THREE.Color('#646f76'),
  skyHorizonRain: new THREE.Color('#8a9597'),
  cloudLitClear: new THREE.Color('#ffffff'),
  cloudShadeClear: new THREE.Color('#c4cfd9'),
  cloudLitStorm: new THREE.Color('#9aa3a9'),
  cloudShadeStorm: new THREE.Color('#5a636a'),
  hemiGround: new THREE.Color('#3b3322'),
}

/**
 * Everything the scene needs from the weather, as plain values.
 * Reuses `out` so it can run every frame without allocating.
 */
export function computeAtmosphere(live, out = createAtmosphere()) {
  const { cloudCover, rain, timeOfDay } = live

  // Sun path: rises in the east (t = 0), highest at noon (t = 0.5), sets in
  // the west (t = 1). A small negative offset puts sunrise at the horizon.
  const elevation = Math.sin(timeOfDay * Math.PI) * MAX_SUN_ELEVATION - 0.03
  const azimuth = THREE.MathUtils.degToRad(-75 + timeOfDay * 150)
  out.sunDirection.set(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth)
  )
  out.sunPosition.copy(out.sunDirection).multiplyScalar(SUN_DISTANCE)

  const elevationDeg = THREE.MathUtils.radToDeg(elevation)
  const daylight = smoothstep(-2, 12, elevationDeg) // 0 at the horizon, 1 by mid-morning
  const dusk = 1 - smoothstep(4, 28, elevationDeg) // warm light near the horizon
  const overcast = smoothstep(0.35, 1, cloudCover)

  out.sunColor.copy(COLORS.sunHigh).lerp(COLORS.sunLow, dusk)
  out.sunIntensity = 3.1 * daylight * (1 - 0.85 * overcast) * (1 - 0.3 * rain)
  // How visible the sun disc and glow are through the clouds.
  out.sunVisibility = daylight * (1 - overcast * 0.95)

  out.skyTop.copy(COLORS.skyTopDay).lerp(COLORS.skyTopDusk, dusk)
  out.skyHorizon.copy(COLORS.skyHorizonDay).lerp(COLORS.skyHorizonDusk, dusk * 0.85)
  out.skyTop.lerp(COLORS.skyTopOvercast, overcast)
  out.skyHorizon.lerp(COLORS.skyHorizonOvercast, overcast)
  out.skyTop.lerp(COLORS.skyTopRain, rain)
  out.skyHorizon.lerp(COLORS.skyHorizonRain, rain)
  // Dimmer overall at dawn and dusk.
  const brightness = 0.55 + 0.45 * daylight
  out.skyTop.multiplyScalar(brightness)
  out.skyHorizon.multiplyScalar(0.7 + 0.3 * daylight)

  // Fog matches the horizon so the ground melts into the sky.
  out.fogColor.copy(out.skyHorizon)

  // Overcast light is softer but spreads from the whole sky.
  out.hemiSky.copy(out.skyTop).lerp(COLORS.cloudLitClear, 0.35)
  out.hemiGround.copy(COLORS.hemiGround)
  out.hemiIntensity = (1.25 + 0.85 * overcast) * (0.45 + 0.55 * daylight)

  out.cloudLit.copy(COLORS.cloudLitClear).lerp(COLORS.cloudLitStorm, Math.max(rain, overcast * 0.5))
  out.cloudLit.lerp(out.sunColor, dusk * 0.45 * (1 - overcast))
  out.cloudShade.copy(COLORS.cloudShadeClear).lerp(COLORS.cloudShadeStorm, Math.max(rain, overcast * 0.6))
  out.cloudLit.multiplyScalar(0.5 + 0.5 * daylight)
  out.cloudShade.multiplyScalar(0.5 + 0.5 * daylight)

  // Rain pulls the fog in and thickens the ground mist.
  out.fogScale = 1 - 0.3 * rain - 0.1 * overcast
  out.heightFogBoost = 0.2 * rain + 0.08 * overcast
  out.wetness = live.wetness
  return out
}

export function createAtmosphere() {
  return {
    sunDirection: new THREE.Vector3(),
    sunPosition: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    sunVisibility: 0,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fogColor: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
    fogScale: 1,
    heightFogBoost: 0,
    wetness: 0,
  }
}
