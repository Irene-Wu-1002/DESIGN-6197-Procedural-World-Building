/**
 * The World page's one pause switch and world clock (Pause / Play / Step).
 *
 * Two kinds of time run in the frame loop (MapScene):
 *   - real time: the frame's own delta, for the camera, input, view
 *     switches, X-ray easing, the panels and drawing;
 *   - world time: what this clock hands out, for everything that lives in
 *     the world (butterflies, scent, nectar, ants and pheromones, the day,
 *     weather and season, water, sap, crown growth, rain, sway, spores).
 *
 * Every frame asks advance(realDt) how much world time to run, as `steps`
 * passes of `dt` each, and runs the same world update that many times:
 *   - playing: one pass of the real delta;
 *   - paused: one pass of 0 (the world is drawn, nothing moves), or
 *   - paused with Steps queued: one pass of STEP (1/60 s) per Step, at most
 *     MAX_STEPS_PER_FRAME a frame; the rest wait for the next frames, so no
 *     click is lost and none runs twice.
 * A pause is never made up afterwards: playing again runs only the frames
 * that follow. Each system still applies its own speed (day speed, ant
 * simSpeed, the butterflies' cap) and its own fixed-step accumulator to the
 * world time it is given.
 *
 * subscribe / getSnapshot fit React's useSyncExternalStore. The snapshot
 * changes when the clock is paused, played or stepped, and on sync() (the
 * panel refresh while it runs), never every frame.
 */

export const WORLD_STEP = 1 / 60
export const WORLD_STEP_LABEL = '1/60 s'
const MAX_STEPS_PER_FRAME = 8

export function createWorldClock({ step = WORLD_STEP, maxStepsPerFrame = MAX_STEPS_PER_FRAME } = {}) {
  let paused = false
  let pending = 0
  // World seconds run so far (base time, before any system's own speed).
  let elapsed = 0
  const listeners = new Set()
  const tick = { steps: 1, dt: 0 }
  const makeSnapshot = () => ({ paused, elapsed, pending, step })
  let snapshot = makeSnapshot()
  const publish = () => {
    snapshot = makeSnapshot()
    for (const listener of listeners) listener()
  }

  const pause = () => {
    if (paused) return
    paused = true
    publish()
  }
  // Play again from now (queued Steps are dropped: they belong to the pause).
  const play = () => {
    if (!paused) return
    paused = false
    pending = 0
    publish()
  }

  // Plain functions throughout (no `this`), so they can be handed around.
  return {
    step,
    get paused() {
      return paused
    },
    get elapsed() {
      return elapsed
    },
    get pending() {
      return pending
    },

    pause,
    play,
    toggle: () => (paused ? play() : pause()),
    /** Queue one Step (only while paused); false if it was ignored. */
    requestStep: () => {
      if (!paused) return false
      pending += 1
      publish()
      return true
    },
    /** Forget queued Steps (the scene is being torn down or rebuilt). */
    clearPending: () => {
      if (pending === 0) return
      pending = 0
      publish()
    },

    /**
     * Once per frame: the world time to run, as { steps, dt } (run the
     * world update `steps` times with `dt` each). The object is reused.
     */
    advance: (realDt) => {
      if (!paused) {
        tick.steps = 1
        tick.dt = Math.max(realDt, 0)
        elapsed += tick.dt
        return tick
      }
      if (pending === 0) {
        tick.steps = 1
        tick.dt = 0
        return tick
      }
      const steps = Math.min(pending, maxStepsPerFrame)
      pending -= steps
      tick.steps = steps
      tick.dt = step
      for (let i = 0; i < steps; i += 1) elapsed += step
      publish()
      return tick
    },

    /** Refresh the snapshot if world time moved (the panel's refresh). */
    sync: () => {
      if (snapshot.elapsed !== elapsed) publish()
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => {
      return snapshot
    },
  }
}
