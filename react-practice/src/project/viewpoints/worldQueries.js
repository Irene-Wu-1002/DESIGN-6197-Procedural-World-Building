import { TILE_SIZE } from '../terrain/heightField'

/**
 * What a moving body can ask the world: ground height, the surface you'd
 * stand on (ground plus moss cushions, twigs, and branches to climb over),
 * and obstacles that block you (trunks, the fly agaric, mushroom stems).
 *
 * Reads the same data the scene draws: the tile manager's sampler and
 * trunk field, the fly agaric's placement, and each tile's scattered cover
 * (registered with setTile as the cover renderer receives it). Nothing is
 * generated here, so every viewpoint meets the same obstacles.
 */

// Twig and branch tube radius per metre of length (coverMeshes.js).
const TWIG_RADIUS = 0.018
const BRANCH_RADIUS = 0.022
// Mushroom stem radius per metre of height (coverMeshes.js).
const MUSHROOM_STEM = 0.085
// Leaf half-width and curl height per metre of length (coverMeshes.js).
const LEAF_WIDTH = 0.3
const LEAF_CURL = 0.02
// Fly agaric stem base and cap (flyAgaric.js).
const AGARIC = { stem: 0.017, cap: 0.039, height: 0.122 }

const tileOf = (value) => Math.floor(value / TILE_SIZE)
const keyOf = (tx, tz) => `${tx},${tz}`

function indexTile(items) {
  const blockers = items.mushrooms.map((item) => ({
    x: item.x,
    z: item.z,
    radius: item.scale[1] * MUSHROOM_STEM,
    top: item.y + item.scale[1],
  }))
  const domes = items.moss.map((item) => ({
    x: item.x,
    z: item.z,
    y: item.y,
    radius: item.scale[0],
    height: item.scale[1],
  }))
  const stick = (radiusShare) => (item) => {
    const length = item.scale[0]
    // Local x runs along the stick; yaw turns it about the vertical.
    const dx = Math.cos(item.yaw) * length * 0.5
    const dz = -Math.sin(item.yaw) * length * 0.5
    return {
      ax: item.x - dx,
      az: item.z - dz,
      bx: item.x + dx,
      bz: item.z + dz,
      y: item.y,
      radius: length * radiusShare,
    }
  }
  const sticks = [...items.twigs.map(stick(TWIG_RADIUS)), ...items.branches.map(stick(BRANCH_RADIUS))]
  // Leaves as thin oval plates (length along local x, ~0.6 × as wide).
  const plates = items.leaves.flat().map((item) => ({
    x: item.x,
    z: item.z,
    y: item.y,
    cos: Math.cos(item.yaw),
    sin: Math.sin(item.yaw),
    half: item.scale[0] * 0.5,
    width: item.scale[0] * LEAF_WIDTH,
    top: item.scale[0] * LEAF_CURL,
  }))
  return { blockers, domes, sticks, plates }
}

function segmentDistance(px, pz, s) {
  const vx = s.bx - s.ax
  const vz = s.bz - s.az
  const t = Math.min(Math.max(((px - s.ax) * vx + (pz - s.az) * vz) / (vx * vx + vz * vz || 1), 0), 1)
  return Math.hypot(px - (s.ax + vx * t), pz - (s.az + vz * t))
}

/**
 * tiles: the tile manager; flyAgaric: () => its position (Vector3) or null.
 */
export function createWorldQueries(tiles, flyAgaric) {
  const index = new Map()

  // Indexed cover in the 3 × 3 tiles around a point (items reach ~12 cm
  // past their owning tile at most, so neighbours are enough).
  const nearby = (x, z, fn) => {
    const tx = tileOf(x)
    const tz = tileOf(z)
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const entry = index.get(keyOf(tx + dx, tz + dz))
        if (entry) fn(entry)
      }
    }
  }

  const queries = {
    setTile(key, items) {
      index.set(key, indexTile(items))
    },
    removeTile(key) {
      index.delete(key)
    },

    heightAt(x, z) {
      return tiles.heightAt(x, z)
    },

    /** Height you'd stand on: ground, or the top of moss / a twig here. */
    surfaceAt(x, z) {
      let top = tiles.heightAt(x, z)
      nearby(x, z, (entry) => {
        for (const dome of entry.domes) {
          const d = Math.hypot(x - dome.x, z - dome.z)
          if (d < dome.radius) top = Math.max(top, dome.y + dome.height * Math.sqrt(1 - (d / dome.radius) ** 2))
        }
        for (const stick of entry.sticks) {
          const d = segmentDistance(x, z, stick)
          if (d < stick.radius) top = Math.max(top, stick.y + stick.radius + Math.sqrt(stick.radius ** 2 - d * d))
        }
        for (const plate of entry.plates) {
          const dx = x - plate.x
          const dz = z - plate.z
          // Into the leaf's frame (yaw about the vertical).
          const along = dx * plate.cos - dz * plate.sin
          const across = dx * plate.sin + dz * plate.cos
          if ((along / plate.half) ** 2 + (across / plate.width) ** 2 < 1) top = Math.max(top, plate.y + plate.top)
        }
      })
      return top
    },

    /**
     * Push a circle of `radius` at (x, z) out of the obstacles enabled in
     * `collision` ({ trunks, flyAgaric, mushrooms }). `altitude` (m above
     * the ground) lets flyers pass over the fly agaric. Returns { x, z, hit }.
     */
    resolve(x, z, radius, collision, altitude = 0) {
      let hit = false
      const push = (cx, cz, reach) => {
        const dx = x - cx
        const dz = z - cz
        const d = Math.hypot(dx, dz)
        if (d >= reach) return
        hit = true
        // Exactly at the centre: step out along +x.
        const nx = d > 1e-9 ? dx / d : 1
        const nz = d > 1e-9 ? dz / d : 0
        x = cx + nx * reach
        z = cz + nz * reach
      }
      // Two passes settle the rare case of standing between two obstacles.
      for (let pass = 0; pass < 2; pass += 1) {
        if (collision.trunks && tiles.trunks) {
          for (const trunk of tiles.trunks.trunksNear(x, z, radius + 0.6)) push(trunk.x, trunk.z, trunk.radius + radius)
        }
        const agaric = collision.flyAgaric ? flyAgaric() : null
        if (agaric) {
          const capHeight = agaric.y + AGARIC.height - tiles.heightAt(x, z)
          if (altitude < capHeight + radius) {
            push(agaric.x, agaric.z, (altitude > 0.02 ? AGARIC.cap : AGARIC.stem) + radius)
          }
        }
        if (collision.mushrooms) {
          nearby(x, z, (entry) => {
            for (const blocker of entry.blockers) push(blocker.x, blocker.z, blocker.radius + radius)
          })
        }
      }
      return { x, z, hit }
    },
  }
  return queries
}
