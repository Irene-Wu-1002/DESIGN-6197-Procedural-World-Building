// Run with `npm test` (Node's built-in test runner, no dependencies).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_HEARING, activity, beds, chirpRate, lerpHearing, streamVoice } from './mix.js'

test('the stream is louder near, and livelier where it falls steeply', () => {
  const near = streamVoice(0.1, 0.02)
  const mid = streamVoice(0.6, 0.02)
  const far = streamVoice(4, 0.02)
  assert.ok(near.gain > mid.gain && mid.gain > far.gain)
  assert.ok(far.gain < 0.01)
  const riffle = streamVoice(0.6, 0.2)
  assert.ok(riffle.gain > mid.gain && riffle.babble > mid.babble && riffle.brightness === 1)
  assert.equal(streamVoice(Infinity, 0.1).gain, 0)
  assert.equal(streamVoice(0.1, 0.1, 0).gain, 0)
})

test('crickets chirp faster when warm and stop in the cold (Dolbear)', () => {
  assert.equal(chirpRate(5), 0)
  assert.ok(Math.abs(chirpRate(20) - 170 / 60) < 1e-9)
  assert.ok(chirpRate(25) > chirpRate(15))
})

test('birds by day, a chorus at dawn, quiet in rain; crickets on warm nights', () => {
  const day = activity({ daylight: 1, sunY: 0.7, air: 18 })
  const dawn = activity({ daylight: 0.3, sunY: Math.sin((3 * Math.PI) / 180), air: 12 })
  const rainy = activity({ daylight: 1, sunY: 0.7, rain: 0.8, air: 14 })
  const night = activity({ daylight: 0, sunY: -0.5, air: 18 })
  const coldNight = activity({ daylight: 0, sunY: -0.5, air: 4 })
  assert.ok(day.birds > 0.5 && day.crickets === 0)
  assert.ok(dawn.chorus > 0.9 && dawn.birds >= day.birds)
  assert.ok(rainy.birds < 0.15)
  assert.equal(night.birds, 0)
  assert.ok(night.crickets > 0.9)
  assert.equal(coldNight.crickets, 0)
})

test('drips only once the rain has stopped and the ground is wet', () => {
  assert.equal(activity({ wetness: 0.8, rain: 0.6 }).drips, 0)
  assert.ok(activity({ wetness: 0.8, rain: 0 }).drips > 0.7)
  assert.equal(activity({ wetness: 0, rain: 0 }).drips, 0)
})

test('rain and wind beds follow the weather, and are shut out underground', () => {
  const calm = beds({ rain: 0, wind: 0 }, 0.5)
  assert.equal(calm.rain, 0)
  assert.equal(calm.wind, 0)
  const storm = beds({ rain: 0.9, wind: 0.8 }, 0.5)
  assert.ok(storm.rain > 0.4 && storm.patter > 50 && storm.wind > 0.5)
  const below = beds({ rain: 0.9, wind: 0.8 }, 0.5, DEFAULT_HEARING, 1)
  assert.equal(below.rain, 0)
  assert.equal(below.wind, 0)
  // The ant hears far more drops, and less wind.
  const ant = beds({ rain: 0.9, wind: 0.8 }, 0.5, { ...DEFAULT_HEARING, drops: 2.2, wind: 0.45 })
  assert.ok(ant.patter > storm.patter && ant.wind < storm.wind)
})

test('hearing eases between bodies', () => {
  const half = lerpHearing(DEFAULT_HEARING, { ...DEFAULT_HEARING, rumble: 1, pitch: 0.4 }, 0.5)
  assert.equal(half.rumble, 0.5)
  assert.ok(Math.abs(half.pitch - 0.7) < 1e-9)
  assert.equal(half.wind, 1)
})
