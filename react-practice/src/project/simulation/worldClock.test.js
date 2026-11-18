// Run with `npm test` (Node's built-in test runner, no dependencies).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WORLD_STEP, createWorldClock } from './worldClock.js'

// Run the clock for `frames` frames of `realDt`; the world time handed out.
const run = (clock, frames, realDt = 1 / 60) => {
  let world = 0
  let passes = 0
  for (let i = 0; i < frames; i += 1) {
    const { steps, dt } = clock.advance(realDt)
    world += steps * dt
    passes += steps
  }
  return { world, passes }
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`)

test('playing hands out the real delta', () => {
  const clock = createWorldClock()
  close(run(clock, 30, 0.02).world, 0.6)
  close(clock.elapsed, 0.6)
})

test('paused, no world time passes however long it waits', () => {
  const clock = createWorldClock()
  clock.pause()
  const before = clock.elapsed
  const { world, passes } = run(clock, 600)
  assert.equal(world, 0)
  // Still one (zero) pass a frame: the world keeps being drawn.
  assert.equal(passes, 600)
  assert.equal(clock.elapsed, before)
})

test('one Step is exactly one 1/60 s pass, and stays paused', () => {
  const clock = createWorldClock()
  clock.pause()
  clock.requestStep()
  const tick = clock.advance(0.5)
  assert.equal(tick.steps, 1)
  assert.equal(tick.dt, WORLD_STEP)
  close(clock.elapsed, 1 / 60)
  assert.equal(clock.paused, true)
  // The next frames run nothing.
  assert.equal(run(clock, 10).world, 0)
})

test('ten quick Steps are ten passes, none lost or doubled', () => {
  const clock = createWorldClock({ maxStepsPerFrame: 4 })
  clock.pause()
  for (let i = 0; i < 10; i += 1) clock.requestStep()
  const { world } = run(clock, 10)
  close(world, 10 / 60)
  close(clock.elapsed, 10 / 60)
  assert.equal(clock.pending, 0)
})

test('Step is ignored while playing', () => {
  const clock = createWorldClock()
  assert.equal(clock.requestStep(), false)
  assert.equal(clock.pending, 0)
})

test('playing again does not make up the pause', () => {
  const clock = createWorldClock()
  run(clock, 60)
  clock.pause()
  run(clock, 600)
  clock.play()
  const tick = clock.advance(1 / 60)
  close(tick.dt, 1 / 60)
  close(clock.elapsed, 61 / 60)
})

test('Steps still queued when playing again are dropped', () => {
  const clock = createWorldClock({ maxStepsPerFrame: 1 })
  clock.pause()
  clock.requestStep()
  clock.requestStep()
  clock.play()
  assert.equal(clock.pending, 0)
  const tick = clock.advance(0.01)
  assert.equal(tick.steps, 1)
  close(tick.dt, 0.01)
})

test('snapshot changes on pause, step and sync only', () => {
  const clock = createWorldClock()
  let calls = 0
  clock.subscribe(() => (calls += 1))
  const first = clock.getSnapshot()
  clock.advance(0.1)
  assert.equal(clock.getSnapshot(), first)
  clock.sync()
  assert.notEqual(clock.getSnapshot(), first)
  clock.pause()
  clock.requestStep()
  clock.advance(0.1)
  assert.equal(calls, 4)
  assert.equal(clock.getSnapshot().paused, true)
})
