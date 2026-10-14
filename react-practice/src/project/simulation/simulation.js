import * as THREE from 'three'
import { FOREST_COLORS } from '../forest/sky'
import {
  antActivity,
  butterflyActivity,
  daylightOf,
  directionOf,
  flowerOpening,
  hoursPerSecond,
  moonAt,
  smoothstep,
  sunAt,
  temperatureAt,
  DEFAULT_DAY,
  PEAK_ELEVATION,
} from './dayCycle'
import { DEFAULT_WEATHER, createWeatherState } from './weather'
import { DEFAULT_SEASON, createSeasonState, dayRoll } from './season'
import { SEASON_HEADROOM } from '../cover/coverRules'
import { windVector } from '../../utils/windField'

/**
 * The simulation engine: a clock and everything that follows from it, run
 * once per frame by MapScene (no React state, no rebuilding the world).
 * update(dt, staticSun) returns the environment to show: the "static" one
 * (today's fixed forest light, sun from the Habitat tab) blended with the
 * simulated one by how far the simulation has faded in (start/end ease
 * over START_SECONDS).
 *
 * Environment: { sunDirection (Vector3, toward the light), lightColor,
 * lightIntensity, hemiSky, hemiGround, hemiIntensity, sky: { canopy,
 * middle, horizon, sunGlow }, dapple (0–1 share of the dappled light),
 * flowerOpen, butterflies, ants (activity 0–1), haze (× the usual haze),
 * mist (ground mist per metre), mistHeight (m), rain, wetness, wind (0–1),
 * windDirection [x, z] }.
 *
 * The season (season.js) sets day length and sun warmth, soil wetness,
 * misty mornings, leaf colours and how much of each kind of cover shows:
 * levels { leaves, flowers, mushrooms, moss } for the cover renderer (items
 * with presence ≤ level show; 1 / SEASON_HEADROOM is the Scatter amounts)
 * and autumn { value, weight } for leaf colours.
 *
 * Weather (weather.js) acts on top of the day: clouds dim and soften the
 * sun and grey the sky, rain closes flowers and sends butterflies and ants
 * home, humidity and fog thicken the haze and ground mist, lightning
 * flashes the sky, and the ground wets and dries.
 */

const START_SECONDS = 1.5
const BASE = {
  light: new THREE.Color('#ffd9a0'),
  lightIntensity: 1.8,
  hemiSky: new THREE.Color('#9fb48a'),
  hemiGround: new THREE.Color('#3a2c20'),
  hemiIntensity: 0.6,
}
const LOW_SUN = new THREE.Color('#ff8a3d')
const MOON = new THREE.Color('#a9bcff')
const NIGHT_HEMI_SKY = new THREE.Color('#3d4a66')
const NIGHT_HEMI_GROUND = new THREE.Color('#1a1814')
const MOON_INTENSITY = 0.18
const NIGHT_HEMI = 0.1
const palette = (colors) => Object.fromEntries(Object.entries(colors).map(([key, hex]) => [key, new THREE.Color(hex)]))
const SKY = {
  day: palette(FOREST_COLORS),
  golden: palette({ canopy: '#1d1a14', middle: '#4a3d2c', horizon: '#a8835a', sunGlow: '#ffb066' }),
  night: palette({ canopy: '#04070c', middle: '#0a1018', horizon: '#141c26', sunGlow: '#3a4a66' }),
}
const SKY_KEYS = Object.keys(FOREST_COLORS)
const OVERCAST = palette({ canopy: '#1a1f1d', middle: '#3b423e', horizon: '#7a807b', sunGlow: '#8a8d86' })
const OVERCAST_HEMI = new THREE.Color('#7d8580')
const FLASH = new THREE.Color('#c9d4ff')
// Ground mist at 100% fog (per metre), and extra haze at full humidity.
const MIST = 4
const HUMID_HAZE = 1.2
// Wind direction for rain slant (degrees it comes from, as in the Habitat tab).
const WIND_FROM = 45

const makeEnvironment = () => ({
  sunDirection: new THREE.Vector3(),
  lightColor: new THREE.Color(),
  lightIntensity: 0,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,
  sky: Object.fromEntries(SKY_KEYS.map((key) => [key, new THREE.Color()])),
  dapple: 1,
  flowerOpen: 1,
  butterflies: 0,
  ants: 0,
  haze: 1,
  mist: 0,
  mistHeight: 0.3,
  rain: 0,
  wetness: 0,
  wind: 0,
  windDirection: windVector(WIND_FROM),
  levels: { leaves: 1 / SEASON_HEADROOM, flowers: 1 / SEASON_HEADROOM, mushrooms: 1 / SEASON_HEADROOM, moss: 1 / SEASON_HEADROOM },
  autumn: { value: 0, weight: 0 },
})
const COVER_KINDS = ['leaves', 'flowers', 'mushrooms', 'moss']
// Misty mornings: mist (per metre) and how long it lasts around sunrise (h).
const MORNING_MIST = { density: 2.8, height: 0.3, before: 1.5, after: [1.5, 3.5] }

export function createSimulation() {
  let settings = { day: DEFAULT_DAY, weather: DEFAULT_WEATHER, season: DEFAULT_SEASON }
  const season = createSeasonState()
  let seasonNow = { weight: 0, values: season.values }
  // Simulated days passed (each decides whether its morning is misty).
  let days = 0
  let sunrise = DEFAULT_DAY.sunrise
  let sunset = DEFAULT_DAY.sunset
  const weather = createWeatherState()
  let weatherNow = { ...weather.current, flash: 0, rainEnded: false }
  let running = false
  let blend = 0
  let time = DEFAULT_DAY.time
  const readout = { sun: { azimuth: 0, elevation: 0 }, air: 0, surface: 0, daylight: 0 }
  const lerp = (a, b, t) => a + (b - a) * t
  const simulated = makeEnvironment()
  const out = makeEnvironment()
  const moonDirection = new THREE.Vector3()

  // The simulated environment at the current time (dt real seconds, hours
  // simulated hours passed this frame).
  const simulate = (dt, hours) => {
    const day = settings.day
    // The season sets the length of the day (around 13:00) and how high the
    // sun climbs; its weight fades it in.
    const sw = seasonNow.weight
    const sv = seasonNow.values
    sunrise = day.sunrise + (13 - sv.dayLength / 2 - day.sunrise) * sw
    sunset = day.sunset + (13 + sv.dayLength / 2 - day.sunset) * sw
    const peak = PEAK_ELEVATION + (25 + 35 * sv.warmth - PEAK_ELEVATION) * sw
    const sun = day.manualSun
      ? { azimuth: day.azimuth, elevation: day.elevation }
      : sunAt(time, { sunrise, sunset }, peak)
    const daylight = daylightOf(sun.elevation)
    const sunUp = Math.max(Math.sin((sun.elevation * Math.PI) / 180), 0)
    const w = weather.update(settings.weather, dt, hours, sunUp * (1 - 0.8 * weatherNow.cloud), Math.random)
    weatherNow = w
    const cloud = w.cloud
    const sunScale = day.sunIntensity / 100
    const moonScale = day.moonIntensity / 100
    // The light follows the sun down to just below the horizon, then the
    // moon; both are near zero at the hand-over, so it never jumps.
    if (sun.elevation > -2) {
      simulated.sunDirection.fromArray(directionOf({ azimuth: sun.azimuth, elevation: Math.max(sun.elevation, 1) }))
      simulated.lightColor.copy(LOW_SUN).lerp(BASE.light, smoothstep(2, 30, sun.elevation))
      simulated.lightIntensity = BASE.lightIntensity * sunScale * smoothstep(-2, 10, sun.elevation)
    } else {
      const moon = moonAt(sun)
      moonDirection.fromArray(directionOf({ azimuth: moon.azimuth, elevation: Math.max(moon.elevation, 5) }))
      simulated.sunDirection.copy(moonDirection)
      simulated.lightColor.copy(MOON)
      simulated.lightIntensity = MOON_INTENSITY * moonScale * smoothstep(-2, -10, sun.elevation)
    }
    // Clouds dim the direct light (sun or moon) far more than the sky's.
    simulated.lightIntensity *= 1 - 0.78 * cloud
    simulated.hemiSky.copy(NIGHT_HEMI_SKY).lerp(BASE.hemiSky, daylight).lerp(OVERCAST_HEMI, 0.6 * cloud * daylight)
    simulated.hemiGround.copy(NIGHT_HEMI_GROUND).lerp(BASE.hemiGround, daylight)
    simulated.hemiIntensity =
      BASE.hemiIntensity * (NIGHT_HEMI + (1 - NIGHT_HEMI) * daylight) * (0.6 + 0.4 * sunScale) * (1 - 0.15 * cloud) +
      2.5 * w.flash
    // Sky: golden near the horizon, forest day above, night below.
    const dayWeight = smoothstep(4, 22, sun.elevation)
    const nightWeight = smoothstep(-1, -12, sun.elevation)
    for (const key of SKY_KEYS) {
      simulated.sky[key].copy(SKY.golden[key]).lerp(SKY.day[key], dayWeight).lerp(SKY.night[key], nightWeight)
      // Overcast: greyer by day, a little lighter grey at night.
      simulated.sky[key].lerp(OVERCAST[key], 0.7 * cloud * (0.25 + 0.75 * daylight))
      simulated.sky[key].lerp(FLASH, 0.6 * w.flash)
    }
    simulated.dapple = smoothstep(0, 12, sun.elevation) * (1 - cloud)
    const temperature = temperatureAt(time, sun.elevation, {
      mean: w.temperature + (sv.warmth - 0.5) * 14 * sw,
      sunShare: 1 - 0.8 * cloud,
    })
    const air = temperature.air
    const surface = temperature.surface - 3 * w.rain
    const brightness = daylight * sunScale * (1 - 0.55 * cloud)
    simulated.flowerOpen = flowerOpening(brightness) * (1 - 0.7 * w.rain)
    simulated.butterflies = butterflyActivity(daylight, surface) * (1 - w.rain) * (1 - 0.8 * Math.max(w.wind - 0.5, 0) * 2)
    simulated.ants = antActivity(daylight, surface) * (1 - 0.85 * w.rain)
    simulated.haze = 1 + HUMID_HAZE * Math.max(w.humidity - 0.5, 0) * 2
    simulated.mist = MIST * w.fog ** 1.5
    simulated.mistHeight = w.fogHeight
    // Some mornings start misty (how many: the season's fog frequency).
    if (dayRoll(days) < sv.fog * sw) {
      const morning =
        smoothstep(sunrise - MORNING_MIST.before, sunrise, time) *
        (1 - smoothstep(sunrise + MORNING_MIST.after[0], sunrise + MORNING_MIST.after[1], time))
      if (morning > 0) {
        // Two mists together: densities add, heights average by density.
        const morningMist = morning * MORNING_MIST.density
        simulated.mistHeight =
          (simulated.mist * simulated.mistHeight + morningMist * MORNING_MIST.height) / (simulated.mist + morningMist)
        simulated.mist += morningMist
      }
    }
    simulated.rain = w.rain
    // Season soil wetness under the weather's.
    simulated.wetness = 1 - (1 - w.wetness) * (1 - sw * sv.wetness * 0.85)
    simulated.wind = w.wind
    Object.assign(readout, { sun, air, surface, daylight })
  }

  return {
    /** New settings ({ day }); takes effect next frame. */
    setSettings(next) {
      settings = next
    },
    start() {
      running = true
    },
    end() {
      running = false
    },
    setTime(hours) {
      time = ((hours % 24) + 24) % 24
    },

    /**
     * Advance by dt (s) and return the environment to show. staticSun: the
     * Habitat tab's sun direction (Vector3, normalised).
     */
    update(dt, staticSun) {
      blend = Math.min(Math.max(blend + (running ? 1 : -1) * (dt / START_SECONDS), 0), 1)
      const playing = running && settings.day.playing
      const hours = playing ? hoursPerSecond(settings.day) * dt : 0
      if (time + hours >= 24) days += 1
      time = (time + hours) % 24
      // The season fades and follows its settings even while paused.
      seasonNow = season.update(running ? settings.season : { ...settings.season, apply: false }, dt)
      const k = blend * blend * (3 - 2 * blend)
      // Paused holds everything still, the weather included.
      if (k > 0) simulate(playing ? dt : 0, hours)
      out.sunDirection.copy(staticSun).lerp(simulated.sunDirection, k).normalize()
      out.lightColor.copy(BASE.light).lerp(simulated.lightColor, k)
      out.lightIntensity = BASE.lightIntensity + (simulated.lightIntensity - BASE.lightIntensity) * k
      out.hemiSky.copy(BASE.hemiSky).lerp(simulated.hemiSky, k)
      out.hemiGround.copy(BASE.hemiGround).lerp(simulated.hemiGround, k)
      out.hemiIntensity = BASE.hemiIntensity + (simulated.hemiIntensity - BASE.hemiIntensity) * k
      for (const key of SKY_KEYS) out.sky[key].copy(SKY.day[key]).lerp(simulated.sky[key], k)
      out.dapple = 1 + (simulated.dapple - 1) * k
      out.flowerOpen = 1 + (simulated.flowerOpen - 1) * k
      out.butterflies = simulated.butterflies * k
      out.ants = simulated.ants * k
      out.haze = lerp(1, simulated.haze, k)
      out.mist = simulated.mist * k
      out.mistHeight = simulated.mistHeight
      out.rain = simulated.rain * k
      out.wetness = simulated.wetness * k
      out.wind = simulated.wind * k
      // Season levels for the cover and leaf colours, faded with the rest.
      const weight = seasonNow.weight * k
      for (const kind of COVER_KINDS) {
        out.levels[kind] = Math.min((1 + (seasonNow.values[kind] - 1) * weight) / SEASON_HEADROOM, 1)
      }
      out.autumn.value = seasonNow.values.autumn
      out.autumn.weight = weight
      return out
    },

    /** For the panel: running, how far faded in, clock and readouts. */
    snapshot() {
      return {
        running,
        blend,
        time,
        sunAzimuth: readout.sun.azimuth,
        sunElevation: readout.sun.elevation,
        air: readout.air,
        surface: readout.surface,
        butterflies: simulated.butterflies,
        ants: simulated.ants,
        cloud: weatherNow.cloud,
        rain: weatherNow.rain,
        wetness: weatherNow.wetness,
        fog: weatherNow.fog,
        rainEnded: weatherNow.rainEnded,
        season: { weight: seasonNow.weight, ...seasonNow.values },
        sunrise,
        sunset,
      }
    },
  }
}
