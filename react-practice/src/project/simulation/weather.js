/**
 * Weather: presets, and the state that moves toward them gradually.
 *
 * Settings hold the targets (presets just fill them in); the current
 * weather eases toward them over the transition duration, so nothing
 * jumps. Rain stops by itself after the rain duration (simulated minutes;
 * 0 = until changed) and the weather turns into "After rain". The ground
 * gets wet while it rains and dries slowly, faster in sun and dry air.
 * Lightning flashes at random, at the set rate (per real minute).
 *
 * Values: cloud, rain, humidity, fog, wind 0–1; temperature °C (mean air);
 * fogHeight m; lightning per minute; rainDuration simulated minutes;
 * transition real seconds.
 *
 * Plain data only, no Three.js.
 */

export const WEATHER_PRESETS = {
  clear: { label: 'Clear', cloud: 0.05, rain: 0, humidity: 0.45, temperature: 16, fog: 0, fogHeight: 0.3, lightning: 0, wind: 0.15 },
  cloudy: { label: 'Cloudy', cloud: 0.8, rain: 0, humidity: 0.6, temperature: 14, fog: 0.1, fogHeight: 0.5, lightning: 0, wind: 0.25 },
  lightRain: {
    label: 'Light rain',
    cloud: 0.85,
    rain: 0.3,
    humidity: 0.85,
    temperature: 12,
    fog: 0.2,
    fogHeight: 0.6,
    lightning: 0,
    wind: 0.2,
    rainDuration: 120,
  },
  heavyRain: {
    label: 'Heavy rain',
    cloud: 1,
    rain: 0.9,
    humidity: 0.95,
    temperature: 11,
    fog: 0.35,
    fogHeight: 1,
    lightning: 0,
    wind: 0.4,
    rainDuration: 90,
  },
  morningMist: { label: 'Morning mist', cloud: 0.2, rain: 0, humidity: 0.9, temperature: 9, fog: 0.9, fogHeight: 0.25, lightning: 0, wind: 0.03 },
  windy: { label: 'Windy', cloud: 0.4, rain: 0, humidity: 0.4, temperature: 13, fog: 0, fogHeight: 0.3, lightning: 0, wind: 0.9 },
  afterRain: {
    label: 'After rain',
    cloud: 0.4,
    rain: 0,
    humidity: 0.85,
    temperature: 13,
    fog: 0.25,
    fogHeight: 0.15,
    lightning: 0,
    wind: 0.1,
    // Starts with the ground soaked.
    wet: 0.85,
  },
  autumnStorm: {
    label: 'Autumn storm',
    cloud: 1,
    rain: 1,
    humidity: 1,
    temperature: 9,
    fog: 0.3,
    fogHeight: 1.5,
    lightning: 6,
    wind: 1,
    rainDuration: 60,
    storm: true,
  },
}

export const WEATHER_KEYS = ['cloud', 'rain', 'humidity', 'temperature', 'fog', 'fogHeight', 'lightning', 'wind']

/** Settings for a preset: its values, plus the shared transition. */
export function weatherFromPreset(id, transition = 20) {
  const preset = WEATHER_PRESETS[id]
  return {
    preset: id,
    ...Object.fromEntries(WEATHER_KEYS.map((key) => [key, preset[key]])),
    rainDuration: preset.rainDuration ?? 0,
    transition,
  }
}

export const DEFAULT_WEATHER = weatherFromPreset('clear')

// Wetting and drying, per simulated hour.
const SOAK = 1.6
const DRY = [0.12, 0.45]
const FLASH = { length: 0.35, gap: 0.12 }

/** The weather as it moves toward its settings. */
export function createWeatherState() {
  const current = { ...weatherFromPreset('clear'), wetness: 0 }
  let rainClock = 0
  let rainEnded = false
  let wetKick = null
  let kickLeft = 0
  let flash = -1
  let lastSettings = null

  return {
    current,
    /**
     * Advance: settings (targets), dt real seconds, hours simulated hours
     * passed, sun 0–1 (direct sun on the ground), random() 0–1.
     */
    update(settings, dt, hours, sun, random) {
      // New settings: restart the rain clock; a preset may soak the ground.
      if (settings !== lastSettings) {
        lastSettings = settings
        rainClock = 0
        rainEnded = false
        const preset = WEATHER_PRESETS[settings.preset]
        if (preset?.wet !== undefined) {
          wetKick = preset.wet
          kickLeft = Math.max(settings.transition, 0.01)
        }
      }
      // Rain stops after its duration and the weather turns to after-rain.
      const target = rainEnded ? weatherFromPreset('afterRain', settings.transition) : settings
      if (!rainEnded && settings.rain > 0 && settings.rainDuration > 0) {
        rainClock += hours * 60
        if (rainClock >= settings.rainDuration) {
          rainEnded = true
          wetKick = null
        }
      }
      const k = settings.transition <= 0 ? 1 : Math.min(dt / (settings.transition / 3), 1)
      for (const name of WEATHER_KEYS) current[name] += (target[name] - current[name]) * k

      // Ground wetness: soaks in rain, dries in sun and dry air.
      const drying = (DRY[0] + DRY[1] * sun) * (1 - 0.7 * current.humidity)
      current.wetness += (current.rain * SOAK * (1 - current.wetness) - drying * current.wetness) * hours
      if (wetKick !== null && kickLeft > 0) {
        current.wetness += (wetKick - current.wetness) * Math.min(dt / Math.max(settings.transition / 3, 0.01), 1)
        kickLeft -= dt
      }
      current.wetness = Math.min(Math.max(current.wetness, 0), 1)

      // Lightning: a double flash now and then.
      if (flash < 0 && random() < (current.lightning / 60) * dt) flash = 0
      let lightning = 0
      if (flash >= 0) {
        flash += dt
        const first = Math.max(1 - flash / FLASH.gap, 0)
        const second = flash > FLASH.gap * 1.5 ? Math.max(1 - (flash - FLASH.gap * 1.5) / (FLASH.length - FLASH.gap * 1.5), 0) : 0
        lightning = Math.max(first, second * 0.8)
        if (flash > FLASH.length) flash = -1
      }
      return { ...current, flash: lightning, rainEnded }
    },
  }
}
