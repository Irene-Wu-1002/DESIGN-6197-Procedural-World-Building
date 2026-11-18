import * as THREE from 'three'
import {
  DEFAULT_HEARING,
  DEFAULT_SOUND,
  activity,
  beds,
  chirpRate,
  clamp01,
  falloff,
  streamVoice,
} from './mix'
import { BIRD_SPECIES, bed, birdSong, bubble, cricket, drip, drop, noiseBuffers, thunder } from './voices'

/**
 * The soundscape: the forest heard from wherever the camera is. MapScene
 * calls update() every frame with the world's state; the rules for how
 * loud and how often are in mix.js, the sounds themselves in voices.js.
 *
 *   beds        continuous: the rain's hiss, the wind's roar (panned toward
 *               where it comes from), the leaves' rustle, and the stream's
 *               rush, placed (HRTF) at the nearest point of the water
 *   events      scheduled a little ahead on the audio clock (so frame
 *               pacing never makes them stutter): raindrops, drips,
 *               the stream's bubbles, thunder after lightning, songs of
 *               five birds up in the trees, and crickets on the ground,
 *               each in its own place in the world
 *   hearing     the body you're in (viewpointConfig.js `hearing`) and
 *               being underground shape the master filter: muffled below
 *               ground, the ant's world low and thudding
 *
 * Silent until the Sound setting is turned on (browsers only start audio
 * after a click); fades out while the World is paused.
 */

// Scheduling: how often, and how far ahead (s).
const TICK_MS = 50
const AHEAD = 0.15
// Bed gain easing (time constant, s).
const EASE = 0.25
const BIRDS = 5
const CRICKETS = 4
// Birds sit in the trees this far away (m) and this high (m); they move
// on when you've walked further than RESEAT from them.
const BIRD_PLACE = { distance: [2.5, 9], height: [1.5, 5], near: 4 }
const CRICKET_PLACE = { distance: [0.4, 3], near: 0.8 }
const RESEAT = 10
const LAYERS = ['water', 'rain', 'wind', 'thunder', 'birds', 'insects']

const random = (a, b) => a + Math.random() * (b - a)
// Seconds to the next of a random (Poisson) stream at `rate` per second.
const nextGap = (rate) => -Math.log(1 - Math.random()) / rate

// Set an AudioParam smoothly (or a plain value where params aren't supported).
const ease = (param, value, context, constant = EASE) => {
  param.setTargetAtTime(value, context.currentTime, constant)
}

function placeListener(listener, position, forward, up, context) {
  if (listener.positionX) {
    const t = context.currentTime
    listener.positionX.setValueAtTime(position.x, t)
    listener.positionY.setValueAtTime(position.y, t)
    listener.positionZ.setValueAtTime(position.z, t)
    listener.forwardX.setValueAtTime(forward.x, t)
    listener.forwardY.setValueAtTime(forward.y, t)
    listener.forwardZ.setValueAtTime(forward.z, t)
    listener.upX.setValueAtTime(up.x, t)
    listener.upY.setValueAtTime(up.y, t)
    listener.upZ.setValueAtTime(up.z, t)
  } else {
    listener.setPosition(position.x, position.y, position.z)
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z)
  }
}

function placePanner(panner, x, y, z, context) {
  if (panner.positionX) {
    const t = context.currentTime
    panner.positionX.setTargetAtTime(x, t, 0.05)
    panner.positionY.setTargetAtTime(y, t, 0.05)
    panner.positionZ.setTargetAtTime(z, t, 0.05)
  } else {
    panner.setPosition(x, y, z)
  }
}

// A panner that only gives direction (loudness is ours, from mix.js).
const directional = (context) => {
  const panner = context.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'linear'
  panner.rolloffFactor = 0
  return panner
}

/**
 * The nearest point of the stream's centre line to (x, y, z), for hearing
 * (any distance): { distance (3D, m), x, y, z, slope } or null.
 */
export function hearStream(stream, x, y, z) {
  if (!stream) return null
  const { points, level, slope, count } = stream
  let best = Infinity
  let index = 0
  for (let i = 0; i < count; i += 4) {
    const d = (points[i * 2] - x) ** 2 + (points[i * 2 + 1] - z) ** 2
    if (d < best) {
      best = d
      index = i
    }
  }
  for (let i = Math.max(index - 4, 0); i <= Math.min(index + 4, count - 1); i += 1) {
    const d = (points[i * 2] - x) ** 2 + (points[i * 2 + 1] - z) ** 2
    if (d < best) {
      best = d
      index = i
    }
  }
  const px = points[index * 2]
  const pz = points[index * 2 + 1]
  const py = level[index]
  return { distance: Math.hypot(px - x, py - y, pz - z), x: px, y: py, z: pz, slope: slope[index] }
}

export function createSoundscape() {
  let settings = DEFAULT_SOUND
  let context = null
  let audio = null
  let timer = null
  let suspendTimer = null

  // What the last update() saw.
  const world = {
    env: { rain: 0, wetness: 0, wind: 0, daylight: 1, air: 15, sunY: 0.7, flash: 0 },
    hearing: { ...DEFAULT_HEARING },
    shelter: 0,
    paused: false,
    listener: new THREE.Vector3(),
    ground: 0,
    voice: { gain: 0, babble: 0, brightness: 0 },
    active: { birds: 0, chorus: 0, crickets: 0, drips: 0 },
    bed: { rain: 0, patter: 0, wind: 0, leaves: 0 },
  }
  let gust = 0.5
  let gustTarget = 0.5
  let gustTimer = 0
  let lastFlash = 0
  let thunderCooldown = 0
  let lastThunder = -Infinity
  const forward = new THREE.Vector3()
  const up = new THREE.Vector3()
  const right = new THREE.Vector3()

  const build = () => {
    context = new (window.AudioContext || window.webkitAudioContext)()
    const buffers = noiseBuffers(context)
    const master = context.createGain()
    master.gain.value = 0
    // Underground and the ant's low world: a low-pass and a low shelf.
    const muffle = context.createBiquadFilter()
    muffle.type = 'lowpass'
    muffle.frequency.value = 18000
    const shelf = context.createBiquadFilter()
    shelf.type = 'lowshelf'
    shelf.frequency.value = 220
    shelf.gain.value = 0
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 6
    master.connect(muffle).connect(shelf).connect(limiter).connect(context.destination)
    const layers = {}
    for (const key of LAYERS) {
      layers[key] = context.createGain()
      layers[key].connect(master)
    }

    // Beds. The wind and leaves pan toward where the wind comes from.
    const windPan = context.createStereoPanner()
    windPan.connect(layers.wind)
    const rainBed = bed(context, layers.rain, buffers.pink, { type: 'bandpass', frequency: 2600, Q: 0.35 })
    const windBed = bed(context, windPan, buffers.brown, { type: 'lowpass', frequency: 400, Q: 0.9 })
    const leavesBed = bed(context, windPan, buffers.white, { type: 'bandpass', frequency: 3200, Q: 0.6 })
    // The stream: a rush and its bubbles, from the nearest point of water.
    const streamPanner = directional(context)
    const streamBus = context.createGain()
    streamBus.gain.value = 0
    streamBus.connect(streamPanner).connect(layers.water)
    const rushBed = bed(context, streamBus, buffers.white, { type: 'bandpass', frequency: 1400, Q: 0.5 })
    rushBed.gain.gain.value = 0.22
    const gurgleBed = bed(context, streamBus, buffers.brown, { type: 'lowpass', frequency: 380, Q: 1.5 })
    gurgleBed.gain.gain.value = 0.5

    // Birds in the trees and crickets on the ground: each has a place, a
    // panner and its own gain (by distance).
    const singer = (destination) => {
      const panner = directional(context)
      const gain = context.createGain()
      gain.gain.value = 0
      const input = context.createGain()
      input.connect(panner).connect(gain).connect(destination)
      return { panner, gain, input, x: 0, y: 0, z: 0, placed: false, next: 0 }
    }
    const birds = Array.from({ length: BIRDS }, (_, k) => ({
      ...singer(layers.birds),
      species: BIRD_SPECIES[k % BIRD_SPECIES.length],
      pitch: random(0.85, 1.15),
    }))
    const crickets = Array.from({ length: CRICKETS }, (_, k) => ({
      ...singer(layers.insects),
      carrier: random(4200, 5200),
      // Crickets join one by one as conditions improve.
      threshold: (k + 0.5) / CRICKETS,
    }))

    audio = {
      buffers,
      master,
      muffle,
      shelf,
      layers,
      windPan,
      rainBed,
      windBed,
      leavesBed,
      streamPanner,
      streamBus,
      rushBed,
      gurgleBed,
      birds,
      crickets,
      next: { drop: 0, drip: 0, bubble: 0 },
      // A short random pan for one-shot sounds near you.
      scatter(destination) {
        const pan = context.createStereoPanner()
        pan.pan.value = random(-0.9, 0.9)
        pan.connect(destination)
        setTimeout(() => pan.disconnect(), 1500)
        return pan
      },
    }
    applySettings()
  }

  const applySettings = () => {
    if (!audio) return
    for (const key of LAYERS) ease(audio.layers[key].gain, (settings[key] ?? 100) / 100, context, 0.1)
  }

  // Put a singer somewhere around the listener (birds up in the trees).
  const seat = (one, place, height) => {
    const angle = Math.random() * Math.PI * 2
    const d = random(...place.distance)
    one.x = world.listener.x + Math.cos(angle) * d
    one.z = world.listener.z + Math.sin(angle) * d
    one.y = height
    one.placed = true
    placePanner(one.panner, one.x, one.y, one.z, context)
  }

  // Schedule everything due in the next AHEAD seconds.
  const schedule = () => {
    if (!context || context.state !== 'running' || world.paused || !settings.on) return
    const now = context.currentTime
    const until = now + AHEAD
    const { hearing } = world
    const next = audio.next

    // Raindrops around you.
    const patter = world.bed.patter
    if (patter > 0.5) {
      if (next.drop < now) next.drop = now
      while (next.drop < until) {
        drop(context, audio.scatter(audio.layers.rain), audio.buffers, next.drop, random(0.01, 0.05) * hearing.drops, hearing.pitch)
        next.drop += nextGap(patter)
      }
    } else next.drop = now + 0.2

    // Drips from leaves after rain.
    const drips = world.active.drips * 2.5
    if (drips > 0.05) {
      if (next.drip < now) next.drip = now
      while (next.drip < until) {
        drip(context, audio.scatter(audio.layers.rain), next.drip, random(0.015, 0.05) * hearing.drops, hearing.pitch)
        next.drip += nextGap(drips)
      }
    } else next.drip = now + 0.5

    // The stream's babble.
    const { voice } = world
    if (voice.gain > 0.005) {
      if (next.bubble < now) next.bubble = now
      while (next.bubble < until) {
        const f = (380 + Math.random() ** 2 * 2200 * (1 + voice.brightness * 0.6)) * (0.55 + 0.45 * hearing.pitch)
        bubble(context, audio.streamBus, next.bubble, f, random(0.04, 0.16))
        next.bubble += nextGap(voice.babble)
      }
    } else next.bubble = now + 0.2

    // Birds: each sings its song now and then, more at dawn and dusk.
    const birdRate = world.active.birds * (0.08 + 0.3 * world.active.chorus)
    for (const bird of audio.birds) {
      const away = Math.hypot(bird.x - world.listener.x, bird.z - world.listener.z)
      if (!bird.placed || away > RESEAT) seat(bird, BIRD_PLACE, world.ground + random(...BIRD_PLACE.height))
      const d = Math.hypot(bird.x - world.listener.x, bird.y - world.listener.y, bird.z - world.listener.z)
      ease(bird.gain.gain, falloff(d, BIRD_PLACE.near) * hearing.birds, context, 0.5)
      if (birdRate < 0.002) {
        bird.next = now + random(1, 4)
        continue
      }
      if (bird.next < now) bird.next = now + nextGap(birdRate)
      if (bird.next < until) {
        const length = birdSong(context, bird.input, bird.next, bird.species, bird.pitch, random(0.05, 0.1))
        bird.next += length + nextGap(birdRate)
        // Now and then a bird flies off and another lands elsewhere.
        if (Math.random() < 0.15) bird.placed = false
      }
    }

    // Crickets on the ground, chirping at the temperature's rate.
    const rate = chirpRate(world.env.air)
    for (const one of audio.crickets) {
      const away = Math.hypot(one.x - world.listener.x, one.z - world.listener.z)
      if (!one.placed || away > RESEAT / 3) seat(one, CRICKET_PLACE, world.ground)
      const on = world.active.crickets > one.threshold * 0.9 && rate > 0
      const d = Math.hypot(one.x - world.listener.x, one.y - world.listener.y, one.z - world.listener.z)
      ease(one.gain.gain, on ? falloff(d, CRICKET_PLACE.near) * hearing.insects : 0, context, 0.8)
      if (!on) {
        one.next = now + random(0.5, 2)
        continue
      }
      if (one.next < now) one.next = now + Math.random() / rate
      while (one.next < until) {
        cricket(context, one.input, one.next, one.carrier, 0.05)
        one.next += (1 / rate) * random(0.92, 1.08)
      }
    }
  }

  let warned = false
  const updateFrame = ({ dt, env, wind, windDirection, camera, ground, stream, hearing, underground, paused }) => {
    world.paused = paused
    world.hearing = hearing ?? DEFAULT_HEARING
    world.ground = ground
    world.listener.copy(camera.position)
    world.shelter += ((underground ? 1 : 0) - world.shelter) * Math.min(dt * 3, 1)
    const e = world.env
    e.rain = env.rain
    e.wetness = env.wetness
    e.wind = wind
    e.daylight = env.daylight
    e.air = env.air
    e.sunY = env.sunDirection.y
    e.flash = env.flash ?? 0
    world.active = activity(e)

    // Gusts: wander toward a new strength every few seconds.
    gustTimer -= dt
    if (gustTimer <= 0) {
      gustTarget = Math.random()
      gustTimer = random(1, 4)
    }
    gust += (gustTarget - gust) * Math.min(dt * 0.9, 1)
    world.bed = beds(e, gust, world.hearing, world.shelter)

    const on = settings.on && !paused
    ease(audio.master.gain, on ? (settings.volume / 100) * 0.9 : 0, context, 0.3)
    if (!on) return

    // Listener: the camera.
    camera.getWorldDirection(forward)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    placeListener(context.listener, camera.position, forward, up, context)

    // Beds.
    const { bed: b } = world
    ease(audio.rainBed.gain.gain, b.rain, context)
    ease(audio.rainBed.filter.frequency, 2600 * (0.4 + 0.6 * world.hearing.pitch), context)
    ease(audio.windBed.gain.gain, b.wind * 0.9, context)
    ease(audio.windBed.filter.frequency, 220 + 900 * wind * gust, context)
    ease(audio.leavesBed.gain.gain, b.leaves * (1 - world.hearing.rumble * 0.6), context)
    right.set(-forward.z, 0, forward.x).normalize()
    const fromX = -windDirection[0]
    const fromZ = -windDirection[1]
    audio.windPan.pan.setTargetAtTime(clamp01(0.5 + 0.35 * (fromX * right.x + fromZ * right.z)) * 2 - 1, context.currentTime, 0.4)

    // The stream, from its nearest point.
    const near = hearStream(stream, camera.position.x, camera.position.y, camera.position.z)
    world.voice = near
      ? streamVoice(near.distance, near.slope, stream.flow)
      : { gain: 0, babble: 0, brightness: 0 }
    const waterGain = world.voice.gain * world.hearing.water * (1 - 0.7 * world.shelter)
    ease(audio.streamBus.gain, waterGain, context, 0.15)
    if (near) placePanner(audio.streamPanner, near.x, near.y, near.z, context)
    ease(audio.rushBed.filter.frequency, (900 + 1600 * world.voice.brightness) * (0.6 + 0.4 * world.hearing.pitch), context)

    // Thunder a few seconds after each flash (sound is slower than light).
    thunderCooldown -= dt
    if (e.flash > 0.4 && lastFlash <= 0.4 && thunderCooldown <= 0) {
      const delay = random(0.6, 3.5)
      const level = 0.55 * (1 - world.shelter * 0.5) * (1 + world.hearing.rumble * 0.4)
      thunder(context, audio.layers.thunder, audio.buffers, context.currentTime + delay, level, 1 - delay / 3.5)
      thunderCooldown = 2
      lastThunder = performance.now() + delay * 1000
    }
    lastFlash = e.flash

    // The body's ears and the ground above you.
    const muffled = 18000 * (1 - 0.8 * world.hearing.rumble)
    ease(audio.muffle.frequency, muffled * (1 - world.shelter) + 550 * world.shelter, context)
    ease(audio.shelf.gain, 9 * world.hearing.rumble + 5 * world.shelter, context)
  }

  return {
    /** Whether audio has started (after the first Sound on). */
    get started() {
      return Boolean(context)
    },

    /** New Sound settings (DEFAULT_SOUND's keys); on starts the audio. */
    setSettings(next) {
      settings = { ...DEFAULT_SOUND, ...next }
      if (settings.on && !context) {
        try {
          build()
          timer = setInterval(schedule, TICK_MS)
        } catch {
          return
        }
      }
      if (!context) return
      clearTimeout(suspendTimer)
      if (settings.on) context.resume()
      else suspendTimer = setTimeout(() => context?.suspend(), 600)
      applySettings()
    },

    /**
     * Every frame: dt (real s); env (simulation.js environment); wind 0–1
     * and windDirection [x, z] (where it blows toward); camera; ground: the
     * ground height under the camera; stream (terrain/stream.js) or null;
     * hearing (viewpointConfig.js); underground: whether you're below the
     * surface; paused: the World's clock.
     */
    update(frame) {
      if (!context) return
      // Sound must never stop the world: a failure here only skips a frame.
      try {
        updateFrame(frame)
      } catch (error) {
        if (!warned) console.warn('Soundscape:', error)
        warned = true
      }
    },

    /** What's sounding now, 0–1 each (for the panel). */
    levels() {
      const thunderAgo = (performance.now() - lastThunder) / 1000
      return {
        started: Boolean(context),
        running: Boolean(context) && settings.on && !world.paused,
        stream: world.voice.gain,
        rain: Math.max(world.bed.rain * 2, world.active.drips * 0.5),
        wind: world.bed.wind,
        thunder: thunderAgo >= 0 && thunderAgo < 6 ? 1 - thunderAgo / 6 : 0,
        birds: world.active.birds,
        crickets: world.active.crickets,
        underground: world.shelter > 0.5,
      }
    },

    dispose() {
      clearInterval(timer)
      clearTimeout(suspendTimer)
      if (audio) {
        for (const one of [audio.rainBed, audio.windBed, audio.leavesBed, audio.rushBed, audio.gurgleBed]) one.stop()
      }
      context?.close()
      context = null
      audio = null
    },
  }
}
