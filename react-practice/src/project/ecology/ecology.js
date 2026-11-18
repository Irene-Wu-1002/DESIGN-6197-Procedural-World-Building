import { createButterflyAgent, decide, move, perceive, physiology, placeAgent, reshape, statusOf } from './butterflyAgent'
import { DEFAULT_ECOLOGY, FLIGHT, FLOWER_TYPES, LOD, STATE_LABELS, TIME, TIMERS } from './ecologyConfig'
import { bodyMeasures, describe } from './morphology'
import { createFlowerRegistry } from './flowerRegistry'
import { createRandom, lerp, smoothstep } from './random'
import { createScentField } from './scentField'
import { createWindSampler } from './windSampler'

/**
 * The flower–scent–wind–butterfly ecology, stepped by MapScene each frame.
 * It owns the true state (flower registry, scent particles, wind sampler)
 * and the butterflies, and runs them on fixed sub-steps of ecology time
 * (TIME): world time (none while the World is paused), never faster than
 * it. It never touches the camera or the viewer's own body.
 *
 * Continuity: flowers follow the tiles (registered when a tile is
 * scattered, dropped when it unloads, nectar kept meanwhile; see
 * flowerRegistry). Butterflies live in world space and keep flying when
 * the camera moves; ones that stray beyond the loaded ground are drawn back
 * toward the watched area by their wander leash (they fly there, never
 * jump). Far ones update less often (LOD). Leaving the World page keeps the
 * butterflies and the nectar (module-level `kept`) for when you come back to
 * the same seed.
 *
 * Plain data only, no Three.js.
 */

let kept = null

export function createEcology(initialSeed) {
  let seed = initialSeed
  const restoring = kept && kept.seed === seed ? kept : null
  kept = null
  const random = createRandom(seed * 31 + 7)
  const flowers = createFlowerRegistry()
  const wind = createWindSampler()
  const scent = createScentField(createRandom(seed * 131 + 3))
  let now = restoring?.now ?? 0
  let agents = restoring?.agents ?? []
  if (restoring) flowers.restore(restoring.flowers)
  let settings = { ...DEFAULT_ECOLOGY }
  let particleClock = 0
  let agentClock = 0
  // Ground heights (2 cm cells) for the scent's floor, cleared with the ground.
  const groundCache = new Map()
  let groundKey = null
  let sampler = null
  const groundAt = (x, z) => {
    if (!sampler) return 0
    const key = (Math.round(x * 50) + 1e6) * 2e6 + (Math.round(z * 50) + 1e6)
    let value = groundCache.get(key)
    if (value === undefined) {
      if (groundCache.size > 200000) groundCache.clear()
      value = sampler.height(Math.round(x * 50) / 50, Math.round(z * 50) / 50)
      groundCache.set(key, value)
    }
    return value
  }
  // Openness per flower type now (0–1).
  const open = FLOWER_TYPES.map(() => 1)
  const env = { air: 18, sun: 0.7, daylight: 1, rain: 0, open, level: 1 }
  const ctx = {
    now: 0,
    env,
    flowers,
    scent,
    wind,
    agents,
    center: { x: 0, z: 0 },
    visibleRadius: 1,
    swayTime: 0,
    swayWind: 0,
    shadeAt: (x, z) => wind.shadeAt(x, z),
    world: null,
  }

  const spawn = (index) => {
    const agent = createButterflyAgent(index, seed)
    const angle = random() * Math.PI * 2
    const distance = lerp(0.5, 0.9, random())
    const x = ctx.center.x + Math.cos(angle) * distance
    const z = ctx.center.z + Math.sin(angle) * distance
    placeAgent(agent, x, groundAt(x, z) + agent.wander.height, z)
    // Facing roughly into the watched area.
    agent.yaw = Math.atan2(Math.cos(angle), Math.sin(angle)) + (random() - 0.5)
    return agent
  }

  // Keep the population at the setting: new ones fly in, extra ones fade.
  const managePopulation = (realDt) => {
    const wanted = Math.max(0, Math.round(settings.butterflies))
    for (let i = 0; i < Math.max(wanted, agents.length); i += 1) {
      if (i < wanted && (!agents[i] || agents[i].removing)) {
        if (!agents[i]) agents[i] = spawn(i)
        agents[i].removing = false
      }
      const agent = agents[i]
      if (!agent) continue
      if (i >= wanted) agent.removing = true
      agent.seen = Math.min(Math.max(agent.seen + (agent.removing ? -1 : 1) * realDt, 0), 1)
    }
    while (agents.length > wanted && agents[agents.length - 1]?.removing && agents[agents.length - 1].seen <= 0) agents.pop()
    ctx.agents = agents
  }

  const stepAgent = (agent, h) => {
    agent.decideIn -= h
    if (agent.decideIn <= 0) {
      perceive(agent, ctx, Math.max(TIMERS.decide, h))
      decide(agent, ctx)
      agent.decideIn += Math.max(TIMERS.decide, h)
    }
    move(agent, ctx, h)
    physiology(agent, ctx, h)
  }

  return {
    flowers,
    wind,
    scent,
    get agents() {
      return agents
    },
    get time() {
      return now
    },
    get settings() {
      return settings
    },
    /** How open each flower type is now (0–1, FLOWER_TYPES order). */
    get open() {
      return open
    },

    setSettings(next) {
      settings = { ...settings, ...next }
    },

    /** A new world seed: new butterflies, no scent in the air. */
    setSeed(next) {
      if (next === seed) return
      seed = next
      agents = []
      ctx.agents = agents
      scent.clear()
    },

    // Flowers follow the tiles.
    setTile(key, items) {
      flowers.setTile(key, items?.flowers ?? [], now)
    },
    removeTile(key) {
      flowers.removeTile(key, now)
    },

    /**
     * One frame. frame: {
     *   dt            world seconds this pass (0 while paused)
     *   scale         ecology time per world second (0 … 1)
     *   center        { x, z } the watched ground (the view's anchor)
     *   visibleRadius m from it where cover is still drawn
     *   camera        { x, y, z } for the level of detail
     *   follow        index of the followed butterfly, or -1
     *   world         { groundAt, surfaceAt, trunksNear, resolve, agaric }
     *   sampler       the ground sampler; groundKey changes with it
     *   habitat       the habitat field; habitatKey changes with it
     *   wind          { strength 0–1, from degrees }
     *   light         brightness 0–1 (flower opening), daylight 0–1,
     *                 sun (direct sun 0–1), air (°C), rain (0–1)
     *   level         the season's flower level (presence ≤ level shows)
     *   sway          { time, wind } the cover's sway clock and strength
     * }
     */
    update(frame) {
      if (frame.groundKey !== groundKey) {
        groundKey = frame.groundKey
        groundCache.clear()
      }
      sampler = frame.sampler
      wind.setHabitat(frame.habitat, frame.habitatKey)
      wind.setWind(frame.wind.strength, frame.wind.from)
      ctx.center.x = frame.center.x
      ctx.center.z = frame.center.z
      ctx.visibleRadius = frame.visibleRadius
      ctx.swayTime = frame.sway.time
      ctx.swayWind = frame.sway.wind
      ctx.world = { ...frame.world, groundAt }
      env.air = frame.light.air
      env.sun = frame.light.sun
      env.daylight = frame.light.daylight
      env.rain = frame.light.rain
      env.level = frame.level
      FLOWER_TYPES.forEach((type, k) => {
        open[k] = smoothstep(type.open.light[0], type.open.light[1], frame.light.brightness) * (1 - type.open.rainClose * frame.light.rain)
      })
      if (!sampler) return
      managePopulation(frame.dt)

      const scaled = frame.dt * Math.min(Math.max(frame.scale, 0), TIME.maxScale)
      // Scent particles.
      particleClock = Math.min(particleClock + scaled, TIME.particleStep * TIME.maxParticleSteps)
      const scentCtx = {
        wind,
        flowers,
        now,
        center: ctx.center,
        radius: ctx.visibleRadius,
        open,
        level: env.level,
        groundAt,
        turbulence: settings.turbulence / 100,
      }
      while (particleClock >= TIME.particleStep) {
        particleClock -= TIME.particleStep
        scentCtx.now = now
        scent.step(TIME.particleStep, scentCtx)
      }
      // Butterflies: fixed sub-steps; far ones take bigger, rarer steps.
      agentClock = Math.min(agentClock + scaled, TIME.agentStep * TIME.maxAgentSteps)
      const camera = frame.camera
      for (const agent of agents) {
        const distance = Math.hypot(agent.position.x - camera.x, agent.position.y - camera.y, agent.position.z - camera.z)
        const followed = agent.index === frame.follow
        const h = followed || distance < LOD.near ? LOD.nearStep : distance < LOD.far ? LOD.midStep : LOD.farStep
        agent.lodStep = h
        agent.lod = Math.min(agent.lod + scaled, h * TIME.maxAgentSteps)
      }
      while (agentClock >= TIME.agentStep) {
        agentClock -= TIME.agentStep
        now += TIME.agentStep
        ctx.now = now
        for (const agent of agents) {
          if (agent.seen <= 0 && agent.removing) continue
          while (agent.lod >= agent.lodStep) {
            agent.lod -= agent.lodStep
            stepAgent(agent, agent.lodStep)
            if (agent.lodStep === LOD.nearStep) break
          }
        }
      }
    },

    /** The butterfly a ray hits (origin, direction: {x, y, z}), or -1. */
    pick(origin, direction, slack = 0.01) {
      let best = -1
      let bestT = Infinity
      for (const agent of agents) {
        if (agent.seen < 0.5) continue
        const p = agent.position
        const ox = p.x - origin.x
        const oy = p.y - origin.y
        const oz = p.z - origin.z
        const t = ox * direction.x + oy * direction.y + oz * direction.z
        if (t <= 0) continue
        const dx = ox - direction.x * t
        const dy = oy - direction.y * t
        const dz = oz - direction.z * t
        // A bit more generous further away (a few pixels at any zoom).
        const radius = 0.025 * agent.traits.scale + slack * t
        if (dx * dx + dy * dy + dz * dz < radius * radius && t < bestT) {
          bestT = t
          best = agent.index
        }
      }
      return best
    },

    /** The live butterfly nearest (x, z), or -1. */
    nearest(x, z) {
      let best = -1
      let bestD = Infinity
      for (const agent of agents) {
        if (agent.removing) continue
        const d = Math.hypot(agent.position.x - x, agent.position.z - z)
        if (d < bestD) {
          bestD = d
          best = agent.index
        }
      }
      return best
    },

    /** Short status of butterfly `index` for the panel, or null. */
    /**
     * Change one butterfly's body ({ wingLength, wingAspect, body, darkness,
     * eye, proboscis }, any subset; kept inside MORPHOLOGY). Its abilities
     * follow at once and its model reshapes on the next frame.
     */
    setMorph(index, changes) {
      const agent = agents[index]
      if (!agent || agent.removing) return
      reshape(agent, changes)
    },
    /** Give it back the body it was born with. */
    resetMorph(index) {
      const agent = agents[index]
      if (!agent || agent.removing) return
      reshape(agent, agent.bornMorph)
    },

    status(index) {
      const agent = agents[index]
      if (!agent || agent.removing) return null
      return {
        index,
        state: agent.state,
        label: statusOf(agent) || STATE_LABELS[agent.state],
        energy: agent.energy / agent.traits.energyCapacity,
        temperature: agent.temperature,
        proboscis: agent.traits.proboscis,
        prefs: agent.prefs.slice(),
        smelt: agent.percept.smelt,
        seen: agent.percept.flowers.length,
        attraction: agent.percept.attraction,
        visits: agent.stats.visits,
        drunk: agent.stats.drunk,
        empty: agent.stats.empty,
        outOfReach: agent.stats.outOfReach,
        target: agent.target ? FLOWER_TYPES[agent.target.type].label : null,
        // Its body in plain words, and the numbers behind it (developer view).
        looks: describe(agent.morph, agent.traits),
        morph: { ...agent.morph },
        changed: Object.keys(agent.morph).some((key) => agent.morph[key] !== agent.bornMorph[key]),
        derived: { ...bodyMeasures(agent.morph), speed: agent.traits.speed, turnRate: agent.traits.turnRate, flightCost: agent.traits.flightCost, energyCapacity: agent.traits.energyCapacity, absorb: agent.traits.absorb, windDrift: agent.traits.windDrift },
      }
    },

    stats() {
      let flying = 0
      let feeding = 0
      let alive = 0
      for (const agent of agents) {
        if (agent.removing) continue
        alive += 1
        if (agent.state === 'feed') feeding += 1
        else if (agent.phase === 'fly' || ['explore', 'searchScent', 'approach', 'depart'].includes(agent.state)) flying += 1
      }
      return { butterflies: alive, flying, feeding, flowers: flowers.count, ...scent.stats(), wind: wind.speed, from: wind.from }
    },

    /** Leaving the page: keep the butterflies and nectar for coming back. */
    dispose() {
      kept = { seed, now, agents: agents.filter((agent) => !agent.removing), flowers: flowers.snapshot(now) }
    },
  }
}

export { FLIGHT }
