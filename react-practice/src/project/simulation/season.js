/**
 * Seasons: presets, a blend between two of them, and the eased values the
 * simulation applies. No whole-year cycle yet: pick a season (and blend
 * toward another with the transition slider).
 *
 *   autumn     share of fallen leaves in autumn colours (0–1)
 *   leaves     fallen-leaf amount  ┐
 *   flowers    flower amount       │ × the Scatter settings (0 – 1.5,
 *   mushrooms  mushroom activity   │ SEASON_HEADROOM in coverRules.js)
 *   moss       moss coverage       ┘
 *   wetness    soil wetness (0–1, darker, glossier ground)
 *   fog        share of mornings that start misty (0–1)
 *   dayLength  hours of daylight (sunrise and sunset around 13:00)
 *   warmth     sun warmth (0–1: how high the sun climbs, how warm the air)
 *
 * Changing season never regenerates anything: cover was scattered once
 * with headroom, and these values only move per-kind levels that grow or
 * shrink items where they stand (cover/coverRenderer.js), leaf colour
 * blends, and the light.
 *
 * Plain data only, no Three.js.
 */

export const SEASONS = {
  spring: { label: 'Spring', autumn: 0.05, leaves: 0.4, flowers: 1.5, mushrooms: 0.3, moss: 1.1, wetness: 0.5, fog: 0.3, dayLength: 13, warmth: 0.5 },
  summer: { label: 'Summer', autumn: 0, leaves: 0.3, flowers: 0.25, mushrooms: 0.5, moss: 0.8, wetness: 0.2, fog: 0.1, dayLength: 16, warmth: 1 },
  earlyAutumn: {
    label: 'Early autumn',
    autumn: 0.45,
    leaves: 0.9,
    flowers: 0.1,
    mushrooms: 1.5,
    moss: 1,
    wetness: 0.5,
    fog: 0.5,
    dayLength: 12,
    warmth: 0.6,
  },
  lateAutumn: {
    label: 'Late autumn',
    autumn: 0.95,
    leaves: 1.5,
    flowers: 0,
    mushrooms: 0.8,
    moss: 1.1,
    wetness: 0.7,
    fog: 0.8,
    dayLength: 9.5,
    warmth: 0.3,
  },
  wetSeason: {
    label: 'Wet season',
    autumn: 0.2,
    leaves: 0.7,
    flowers: 0.4,
    mushrooms: 1.4,
    moss: 1.4,
    wetness: 0.9,
    fog: 0.7,
    dayLength: 12,
    warmth: 0.45,
  },
}

export const SEASON_KEYS = ['autumn', 'leaves', 'flowers', 'mushrooms', 'moss', 'wetness', 'fog', 'dayLength', 'warmth']

// apply: the season is in use; from, to: preset ids; blend: 0–1 from → to.
export const DEFAULT_SEASON = { apply: false, from: 'earlyAutumn', to: 'earlyAutumn', blend: 0 }

/** The season's values for these settings (from, blended toward to). */
export function seasonValues({ from, to, blend }) {
  const a = SEASONS[from]
  const b = SEASONS[to] ?? a
  return Object.fromEntries(SEASON_KEYS.map((key) => [key, a[key] + (b[key] - a[key]) * blend]))
}

// Seconds for the season to fade in or out, and for its values to follow
// a change (the season moves even while the clock is paused).
const FADE_SECONDS = 4
const FOLLOW_SECONDS = 1.5

/** The season as applied: weight 0–1 (fading in/out) and eased values. */
export function createSeasonState() {
  const values = seasonValues(DEFAULT_SEASON)
  let weight = 0
  return {
    values,
    /** Advance by dt real seconds toward these settings. */
    update(settings, dt) {
      weight = Math.min(Math.max(weight + (settings.apply ? 1 : -1) * (dt / FADE_SECONDS), 0), 1)
      const target = seasonValues(settings)
      const k = Math.min(dt / (FOLLOW_SECONDS / 3), 1)
      for (const key of SEASON_KEYS) {
        // While fading in from nothing, jump to the target (weight eases it).
        values[key] = weight <= dt / FADE_SECONDS ? target[key] : values[key] + (target[key] - values[key]) * k
      }
      return { weight: weight * weight * (3 - 2 * weight), values }
    },
  }
}

/** A stable 0–1 number per simulated day (for misty mornings). */
export function dayRoll(day) {
  const x = Math.sin(day * 12.9898 + 4.1414) * 43758.5453
  return x - Math.floor(x)
}
