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
 * flowerOpen, butterflies, ants (activity 0–1), plus readouts }.
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
})

export function createSimulation() {
  let settings = { day: DEFAULT_DAY }
  let running = false
  let blend = 0
  let time = DEFAULT_DAY.time
  const readout = { sun: { azimuth: 0, elevation: 0 }, air: 0, surface: 0, daylight: 0 }
  const simulated = makeEnvironment()
  const out = makeEnvironment()
  const moonDirection = new THREE.Vector3()

  // The simulated environment at the current time.
  const simulate = () => {
    const day = settings.day
    const sun = day.manualSun ? { azimuth: day.azimuth, elevation: day.elevation } : sunAt(time, day, PEAK_ELEVATION)
    const daylight = daylightOf(sun.elevation)
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
    simulated.hemiSky.copy(NIGHT_HEMI_SKY).lerp(BASE.hemiSky, daylight)
    simulated.hemiGround.copy(NIGHT_HEMI_GROUND).lerp(BASE.hemiGround, daylight)
    simulated.hemiIntensity = BASE.hemiIntensity * (NIGHT_HEMI + (1 - NIGHT_HEMI) * daylight) * (0.6 + 0.4 * sunScale)
    // Sky: golden near the horizon, forest day above, night below.
    const dayWeight = smoothstep(4, 22, sun.elevation)
    const nightWeight = smoothstep(-1, -12, sun.elevation)
    for (const key of SKY_KEYS) {
      simulated.sky[key].copy(SKY.golden[key]).lerp(SKY.day[key], dayWeight).lerp(SKY.night[key], nightWeight)
    }
    simulated.dapple = smoothstep(0, 12, sun.elevation)
    const { air, surface } = temperatureAt(time, sun.elevation)
    const brightness = daylight * sunScale
    simulated.flowerOpen = flowerOpening(brightness)
    simulated.butterflies = butterflyActivity(daylight, surface)
    simulated.ants = antActivity(daylight, surface)
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
      if (running && settings.day.playing) time = (time + hoursPerSecond(settings.day) * dt) % 24
      const k = blend * blend * (3 - 2 * blend)
      if (k > 0) simulate()
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
      }
    },
  }
}
