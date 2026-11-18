import { ENERGY, MORPH_RULES, MORPHOLOGY, THERMAL } from './ecologyConfig'
import { clamp } from './random'

/**
 * A butterfly's body, and what it can do because of it.
 *
 * drawMorphology(random) draws a body from MORPHOLOGY. deriveTraits(morph)
 * then works out its abilities from that body with the rules in
 * MORPH_RULES (ecologyConfig.js): wing loading sets speed, how much the
 * wind pushes it and what flying costs; mass sets its energy store and
 * upkeep; dark, large wings on a light body soak up sun; and so on. No
 * ability is drawn on its own, so every advantage comes with a cost.
 *
 * describe(morph, traits) puts the body and its most notable consequences
 * into a few plain words for the follow card.
 *
 * Plain data only, no Three.js.
 */

const BASE = MORPH_RULES.base
const LIMITS = MORPH_RULES.limits

/** A body from the seeded random stream (random.range(low, high)). */
export function drawMorphology(random) {
  const range = ([low, high]) => random.range(low, high)
  return {
    wingLength: range(MORPHOLOGY.wingLength),
    wingAspect: range(MORPHOLOGY.wingAspect),
    body: range(MORPHOLOGY.body),
    darkness: range(MORPHOLOGY.darkness),
    eye: range(MORPHOLOGY.eye),
    proboscis: range(MORPHOLOGY.proboscis),
  }
}

/** Mass, wing area and wing loading, relative to the reference body. */
export function bodyMeasures(morph) {
  const mass = morph.body ** 3
  const wingArea = (morph.wingLength * morph.wingLength) / morph.wingAspect
  return { mass, wingArea, wingLoading: mass / wingArea }
}

/** The abilities that follow from a body (see MORPH_RULES). */
export function deriveTraits(morph) {
  const { mass, wingArea, wingLoading } = bodyMeasures(morph)
  const limit = (key, value) => clamp(value, LIMITS[key][0], LIMITS[key][1])
  const upkeep = mass ** 0.75
  return {
    // Overall body size, for placing antennae, feet and perches.
    scale: morph.body,
    proboscis: morph.proboscis,
    speed: limit('speed', BASE.speed * wingLoading ** 0.3),
    turnRate: limit('turnRate', BASE.turnRate * morph.wingLength ** -0.8 * mass ** -0.25 * morph.wingAspect ** -0.3),
    accel: limit('accel', BASE.accel * (wingArea / mass) ** 0.5),
    // How much of the wind carries it (× FLIGHT.drift) and how well it lands
    // in gusts (× THRESHOLDS.landingWind): light bodies on big wings are
    // pushed about more.
    windDrift: limit('windDrift', wingLoading ** -0.4),
    gustTolerance: 1 / limit('windDrift', wingLoading ** -0.4),
    visualRange: BASE.visualRange * morph.eye,
    energyCapacity: ENERGY.capacity * mass,
    flightCost: (ENERGY.flight * mass ** 0.8 * wingLoading ** 0.3) / morph.wingAspect ** 0.4,
    restCost: ENERGY.rest * upkeep,
    baskCost: ENERGY.bask * upkeep,
    // Share of full sun it takes in (1 = reference) and how fast its body
    // temperature follows (s).
    absorb: limit('absorb', (0.6 + 0.8 * morph.darkness) * (wingArea / mass) ** 0.3),
    warmTime: THERMAL.tau * morph.body,
    // A longer proboscis takes longer to uncoil and coil (× TIMERS).
    uncoil: morph.proboscis / BASE.proboscis,
  }
}

// Plain-words description: the body, then up to two of its most notable
// consequences (by how far each is from the reference).
const word = (value, low, high, lowWord, highWord) => (value <= low ? lowWord : value >= high ? highWord : '')

export function describe(morph, traits) {
  const wing = [
    word(morph.wingLength, 0.88, 1.02, 'short', 'long'),
    word(morph.wingAspect, 0.92, 1.12, 'broad', 'slender'),
    word(morph.darkness, 0.33, 0.67, 'pale', 'dark'),
  ].filter(Boolean)
  const body = word(morph.body, 0.94, 1.06, 'light body', 'heavy body')
  const looks = [`${wing.length ? wing.join(', ') : 'medium'} wings`, body].filter(Boolean).join(', ')
  const reference = deriveTraits({ wingLength: 1, wingAspect: 1, body: 1, darkness: 0.5, eye: 1, proboscis: BASE.proboscis })
  const notes = [
    [traits.speed / reference.speed, 'fast', 'slow'],
    [traits.turnRate / reference.turnRate, 'agile', 'turns wide'],
    [traits.windDrift / reference.windDrift, 'easily blown about', 'steady in wind'],
    [traits.absorb / reference.absorb, 'warms quickly in sun', 'slow to warm'],
    [reference.flightCost / traits.flightCost, 'flies cheaply', 'costly to fly'],
    [traits.proboscis / reference.proboscis, 'long tongue', 'short tongue'],
  ]
    .map(([ratio, high, low]) => ({ size: Math.abs(Math.log(ratio)), text: ratio > 1 ? high : low }))
    .filter((note) => note.size > 0.1)
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .map((note) => note.text)
  const text = looks.charAt(0).toUpperCase() + looks.slice(1)
  return notes.length ? `${text}: ${notes.join(', ')}` : text
}
