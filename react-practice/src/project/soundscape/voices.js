/**
 * Synthesised nature sounds (Web Audio), no recordings: each is built from
 * noise and oscillators at the moment it's needed.
 *
 *   noise buffers  white, pink and brown noise, a few seconds each, looped
 *   bed(...)       a looping noise through a filter into a gain (rain hiss,
 *                  wind, leaves, the stream's rush)
 *   bubble         the stream's babble: a sine whose pitch rises quickly as
 *                  it fades (a bubble's resonance as it closes)
 *   drop           a raindrop's tick: a short burst of filtered noise (for
 *                  the ant, a lower, heavier thud)
 *   drip           a drip from a leaf: a pinging sine that falls in pitch
 *   thunder        a crack, then a long low rumble that rolls in waves
 *   bird songs     three made-up species: a whistler (gliding notes), a
 *                  trill (fast chirps) and a two-tone caller
 *   cricket        a chirp of three quick pulses of a high carrier
 *
 * Every function takes the AudioContext, a destination node and a start
 * time (context seconds), so the scheduler can place them a little ahead.
 */

const SECONDS = 4

/** { white, pink, brown } looping noise buffers for this context. */
export function noiseBuffers(context) {
  const length = Math.floor(context.sampleRate * SECONDS)
  const make = (fill) => {
    const buffer = context.createBuffer(1, length, context.sampleRate)
    fill(buffer.getChannelData(0))
    return buffer
  }
  const white = make((data) => {
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  })
  // Paul Kellet's economy pink filter.
  const pink = make((data) => {
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < data.length; i += 1) {
      const w = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
    }
  })
  const brown = make((data) => {
    let last = 0
    for (let i = 0; i < data.length; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      data[i] = last * 3.5
    }
  })
  return { white, pink, brown }
}

/**
 * A continuous bed: looping `buffer` → filter (type, frequency, Q) → gain
 * (starts silent) → destination. Returns { gain, filter, stop() }.
 */
export function bed(context, destination, buffer, { type = 'lowpass', frequency = 1000, Q = 0.7 } = {}) {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  // Start each bed somewhere different in its loop.
  const offset = Math.random() * buffer.duration
  const filter = context.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.Q.value = Q
  const gain = context.createGain()
  gain.gain.value = 0
  source.connect(filter).connect(gain).connect(destination)
  source.start(context.currentTime, offset)
  return {
    gain,
    filter,
    stop() {
      source.stop()
      source.disconnect()
      gain.disconnect()
    },
  }
}

// An envelope on a gain: silent at t, up to `peak` after attack, then an
// exponential fall over decay.
const envelope = (param, t, peak, attack, decay) => {
  param.setValueAtTime(0.0001, t)
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

// A one-shot oscillator into its own gain; cleans up after itself.
const tone = (context, destination, t, length, type = 'sine') => {
  const osc = context.createOscillator()
  osc.type = type
  const gain = context.createGain()
  gain.gain.value = 0
  osc.connect(gain).connect(destination)
  osc.start(t)
  osc.stop(t + length + 0.05)
  osc.onended = () => gain.disconnect()
  return { osc, gain }
}

// A one-shot slice of noise through a filter.
const burst = (context, destination, buffer, t, length, { type = 'bandpass', frequency = 3000, Q = 1 } = {}) => {
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.Q.value = Q
  const gain = context.createGain()
  gain.gain.value = 0
  source.connect(filter).connect(gain).connect(destination)
  // Longer than the buffer (thunder): loop it.
  const room = buffer.duration - length - 0.1
  source.loop = room <= 0
  source.start(t, room > 0 ? Math.random() * room : Math.random() * buffer.duration * 0.5)
  source.stop(t + length + 0.05)
  source.onended = () => gain.disconnect()
  return { source, filter, gain }
}

/** A bubble in the stream: f (Hz) rising by `rise` as it fades. */
export function bubble(context, destination, t, f, level, rise = 1.7) {
  const length = 0.02 + Math.random() * 0.05
  const { osc, gain } = tone(context, destination, t, length)
  osc.frequency.setValueAtTime(f, t)
  osc.frequency.exponentialRampToValueAtTime(f * rise, t + length)
  envelope(gain.gain, t, level, 0.003, length)
}

/** A raindrop landing nearby; pitch < 1 makes it a heavier thud. */
export function drop(context, destination, buffers, t, level, pitch = 1) {
  const f = (2200 + Math.random() * 4000) * pitch
  const { gain } = burst(context, destination, buffers.white, t, 0.03, { frequency: f, Q: 1.2 + Math.random() })
  envelope(gain.gain, t, level, 0.001, 0.012 + 0.02 / pitch)
  if (pitch < 0.8) {
    // The thud the ground carries.
    const { osc, gain: body } = tone(context, destination, t, 0.08)
    osc.frequency.setValueAtTime(220 * pitch * (0.8 + Math.random() * 0.5), t)
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.07)
    envelope(body.gain, t, level * 1.6 * (1 - pitch), 0.002, 0.07)
  }
}

/** A drip from a leaf into a puddle: a ping falling in pitch. */
export function drip(context, destination, t, level, pitch = 1) {
  const f = (1400 + Math.random() * 2200) * pitch
  const { osc, gain } = tone(context, destination, t, 0.12)
  osc.frequency.setValueAtTime(f, t)
  osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.06)
  envelope(gain.gain, t, level, 0.002, 0.1)
}

/** Thunder: `near` 0–1 (a close strike cracks first). */
export function thunder(context, destination, buffers, t, level, near = 0.5) {
  const length = 5 + Math.random() * 3
  if (near > 0.4) {
    const crack = burst(context, destination, buffers.white, t, 0.4, { type: 'highpass', frequency: 1200, Q: 0.5 })
    envelope(crack.gain.gain, t, level * 0.5 * near, 0.005, 0.35)
  }
  const rumble = burst(context, destination, buffers.brown, t, length, { type: 'lowpass', frequency: 260, Q: 0.8 })
  rumble.filter.frequency.setValueAtTime(320, t)
  rumble.filter.frequency.exponentialRampToValueAtTime(70, t + length)
  const g = rumble.gain.gain
  g.setValueAtTime(0.0001, t)
  g.exponentialRampToValueAtTime(level, t + 0.25 + (1 - near) * 0.6)
  // Rolls: a few swells as the sound comes back from far clouds.
  let at = t + 0.8
  for (let k = 0; k < 3; k += 1) {
    at += 0.6 + Math.random() * 1.2
    g.exponentialRampToValueAtTime(level * (0.25 + Math.random() * 0.25), at)
    g.exponentialRampToValueAtTime(level * (0.5 + Math.random() * 0.4) * (1 - k * 0.2), at + 0.35)
  }
  g.exponentialRampToValueAtTime(0.0001, t + length)
}

// One note: a sine gliding from f0 to f1 over `length`, with a soft
// envelope. Returns its end time.
const note = (context, destination, t, f0, f1, length, level) => {
  const { osc, gain } = tone(context, destination, t, length)
  osc.frequency.setValueAtTime(f0, t)
  osc.frequency.exponentialRampToValueAtTime(f1, t + length)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(level, t + Math.min(0.02, length * 0.3))
  gain.gain.setValueAtTime(level, t + length * 0.7)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
  return t + length
}

export const BIRD_SPECIES = ['whistler', 'trill', 'caller']

/**
 * One song of a bird of `species` at pitch scale `pitch`, starting at t.
 * Returns how long it lasts (s).
 */
export function birdSong(context, destination, t, species, pitch, level) {
  let at = t
  if (species === 'whistler') {
    // 3–5 gliding whistles, each a little lower.
    const notes = 3 + Math.floor(Math.random() * 3)
    let f = 3400 * pitch
    for (let k = 0; k < notes; k += 1) {
      const up = Math.random() < 0.35
      at = note(context, destination, at, f, f * (up ? 1.25 : 0.78), 0.12 + Math.random() * 0.08, level) + 0.06
      f *= 0.93
    }
  } else if (species === 'trill') {
    // A fast run of chirps that speeds up a little.
    const chirps = 8 + Math.floor(Math.random() * 9)
    let gap = 0.065
    for (let k = 0; k < chirps; k += 1) {
      const f = 5200 * pitch * (1 + 0.04 * Math.sin(k))
      at = note(context, destination, at, f, f * 0.8, 0.028, level * (0.6 + 0.4 * Math.min(k / 3, 1))) + gap
      gap *= 0.96
    }
  } else {
    // Tee–oo: a clear high note, then a falling lower one.
    at = note(context, destination, at, 4100 * pitch, 4250 * pitch, 0.2, level) + 0.07
    at = note(context, destination, at, 3100 * pitch, 2600 * pitch, 0.32, level * 0.85)
  }
  return at - t
}

/** One cricket chirp: three pulses of `carrier` Hz. */
export function cricket(context, destination, t, carrier, level) {
  for (let k = 0; k < 3; k += 1) {
    const at = t + k * 0.032
    const { osc, gain } = tone(context, destination, at, 0.02)
    osc.frequency.setValueAtTime(carrier, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.02)
  }
}
