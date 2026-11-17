import { FLOWER_TOP, FLOWER_TYPES } from './ecologyConfig'
import { clamp, hashString } from './random'

/**
 * The flowers as the ecology knows them: the true state of every flower in
 * the loaded tiles, registered from the same scattered items the cover
 * renderer draws (so a butterfly lands where a flower is drawn).
 *
 * Each record: { id (stable: type + position), tile, type (index into
 * FLOWER_TYPES), base x/y/z, normal (unit), sx/sy (scale), yaw, presence
 * (season level at which it shows), head / land / nectary / scent points,
 * radius (m), emit (scent emission accumulator) } plus its nectar, which is
 * private: it is read only through readNectar / drink, which the butterfly
 * code calls only once its proboscis is in the flower (see butterflyAgent).
 *
 * Nectar refills at the type's rate and stays within 0 … capacity. When a
 * tile unloads, each of its flowers' nectar is kept (with the time) in a
 * store; when the tile comes back the flower continues from there, refilled
 * for the time it was away. A flower never seen starts at a seeded share of
 * its capacity. The store forgets its oldest entries beyond STORE_LIMIT
 * (those flowers start again from their seeded value).
 *
 * Plain data only, no Three.js.
 */

const CELL = 0.1
const STORE_LIMIT = 60000
const START_SHARE = [0.4, 1]

const cellKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768)

export function createFlowerRegistry() {
  const records = new Map()
  const tiles = new Map()
  const grid = new Map()
  const store = new Map()

  const addToGrid = (record) => {
    const key = cellKey(Math.floor(record.x / CELL), Math.floor(record.z / CELL))
    let list = grid.get(key)
    if (!list) grid.set(key, (list = []))
    list.push(record)
  }
  const removeFromGrid = (record) => {
    const key = cellKey(Math.floor(record.x / CELL), Math.floor(record.z / CELL))
    const list = grid.get(key)
    if (!list) return
    const index = list.indexOf(record)
    if (index >= 0) list.splice(index, 1)
    if (!list.length) grid.delete(key)
  }

  const level = (record, now) => {
    const type = FLOWER_TYPES[record.type]
    return clamp(record.nectar + type.nectar.refill * Math.max(now - record.nectarTime, 0), 0, type.nectar.capacity)
  }
  const keep = (record, now) => {
    store.delete(record.id)
    store.set(record.id, { nectar: level(record, now), time: now })
    while (store.size > STORE_LIMIT) store.delete(store.keys().next().value)
  }

  const pointAlong = (record, height, out) => {
    const h = (FLOWER_TOP + height) * record.sy
    out.x = record.x + record.nx * h
    out.y = record.y + record.ny * h
    out.z = record.z + record.nz * h
    return out
  }

  const makeRecord = (item, tile, now) => {
    const type = FLOWER_TYPES[item.species ?? 0]
    const length = Math.hypot(...item.normal) || 1
    const record = {
      id: item.id ?? `${item.species ?? 0}:${Math.round(item.x * 1e5)}:${Math.round(item.z * 1e5)}`,
      tile,
      type: item.species ?? 0,
      x: item.x,
      y: item.y,
      z: item.z,
      nx: item.normal[0] / length,
      ny: item.normal[1] / length,
      nz: item.normal[2] / length,
      sx: item.scale[0],
      sy: item.scale[1],
      yaw: item.yaw,
      presence: item.presence ?? 0,
      radius: type.visual.size * (item.scale[0] / 0.08),
      head: {},
      land: {},
      nectary: {},
      scent: {},
      emit: 0,
      nectar: 0,
      nectarTime: now,
    }
    pointAlong(record, 0, record.head)
    pointAlong(record, type.land, record.land)
    pointAlong(record, type.nectary, record.nectary)
    pointAlong(record, type.land * 0.6, record.scent)
    const kept = store.get(record.id)
    if (kept) {
      record.nectar = kept.nectar
      record.nectarTime = kept.time
    } else {
      const share = START_SHARE[0] + (START_SHARE[1] - START_SHARE[0]) * hashString(record.id, 17)
      record.nectar = type.nectar.capacity * share
      record.nectarTime = now
    }
    return record
  }

  const registry = {
    /** Register a tile's scattered flowers (replacing what it had). */
    setTile(key, flowers, now) {
      registry.removeTile(key, now)
      const list = []
      for (const item of flowers ?? []) {
        const record = makeRecord(item, key, now)
        // Two tiles never place the same flower, but be safe.
        if (records.has(record.id)) continue
        records.set(record.id, record)
        addToGrid(record)
        list.push(record)
      }
      tiles.set(key, list)
    },

    /** Forget a tile's flowers, keeping their nectar in the store. */
    removeTile(key, now) {
      const list = tiles.get(key)
      if (!list) return
      for (const record of list) {
        keep(record, now)
        records.delete(record.id)
        removeFromGrid(record)
      }
      tiles.delete(key)
    },

    clear(now) {
      for (const key of [...tiles.keys()]) registry.removeTile(key, now)
    },

    /** The record with this id, or undefined once its tile has unloaded. */
    get(id) {
      return records.get(id)
    },

    /** Visit every flower whose base is within `radius` of (x, z). */
    query(x, z, radius, visit) {
      const r2 = radius * radius
      const x0 = Math.floor((x - radius) / CELL)
      const x1 = Math.floor((x + radius) / CELL)
      const z0 = Math.floor((z - radius) / CELL)
      const z1 = Math.floor((z + radius) / CELL)
      for (let iz = z0; iz <= z1; iz += 1) {
        for (let ix = x0; ix <= x1; ix += 1) {
          const list = grid.get(cellKey(ix, iz))
          if (!list) continue
          for (const record of list) {
            const dx = record.x - x
            const dz = record.z - z
            if (dx * dx + dz * dz <= r2) visit(record)
          }
        }
      }
    },

    forEach(visit) {
      for (const record of records.values()) visit(record)
    },

    get count() {
      return records.size
    },

    /**
     * Nectar in the flower now (units). For contact only: the proboscis
     * is in the flower (butterflyAgent's probe and feed).
     */
    readNectar(id, now) {
      const record = records.get(id)
      return record ? level(record, now) : 0
    },

    /** Drink up to `wanted` units; returns what was drunk (never more than there is). */
    drink(id, wanted, now) {
      const record = records.get(id)
      if (!record) return 0
      const available = level(record, now)
      const drunk = clamp(wanted, 0, available)
      record.nectar = available - drunk
      record.nectarTime = now
      return drunk
    },

    /** Share of capacity (0–1), for scent emission and the debug view. */
    fullness(record, now) {
      return level(record, now) / FLOWER_TYPES[record.type].nectar.capacity
    },

    /**
     * Where the flower's sway (coverRenderer's SWAY_VERTEX) has moved a
     * point `height` (unit space, above the base) at this time and wind:
     * writes the world offset into out { x, z }.
     */
    sway(record, height, time, wind, out) {
      const phase = record.x * 41 + record.z * 37
      const gust = Math.sin(time * 2.3 + phase) + 0.5 * Math.sin(time * 5.1 + phase * 1.7)
      const local = gust * wind * 0.12 * height * height * record.sx
      out.x = Math.cos(record.yaw) * local
      out.z = -Math.sin(record.yaw) * local
      return out
    },

    /** For keeping across a remount: the nectar of every flower known. */
    snapshot(now) {
      const kept = new Map(store)
      for (const record of records.values()) kept.set(record.id, { nectar: level(record, now), time: now })
      return kept
    },
    restore(kept) {
      for (const [id, value] of kept) store.set(id, value)
    },
  }
  return registry
}
