/**
 * Height-based earth material colors.
 * Shared by the 3D terrain and the 2D simulation map.
 */

export function activeLayerColor(layers, id, fallbackHex) {
  const layer = layers.find((item) => item.id === id && item.enabled)
  return layer ? layer.color : fallbackHex
}

export function createTerrainPalette(layers) {
  const terrain = activeLayerColor(layers, 'terrain', '#9a7650')
  const grass = activeLayerColor(layers, 'grass', terrain)
  const sea = activeLayerColor(layers, 'sea', grass)
  const rock = activeLayerColor(layers, 'rock', terrain)
  const snow = activeLayerColor(layers, 'snow', rock)
  return { sea, grass, terrain, rock, snow }
}

function lerpHex(a, b, amount) {
  const parse = (hex) => {
    const value = hex.replace('#', '')
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ]
  }
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const mix = (start, end) => Math.round(start + (end - start) * amount)
  const toHex = (channel) => channel.toString(16).padStart(2, '0')
  return `#${toHex(mix(ar, br))}${toHex(mix(ag, bg))}${toHex(mix(ab, bb))}`
}

/**
 * Map a noise value (-1..1) to an earth material color.
 * When waterLevel is set (0..1 elevation), anything below that level floods.
 */
export function colorForElevation(noiseValue, palette, waterLevel = null) {
  const elevation = (noiseValue + 1) * 0.5

  if (waterLevel !== null && elevation <= waterLevel) {
    const depth = Math.min(1, (waterLevel - elevation) / Math.max(waterLevel, 0.01))
    return lerpHex(palette.sea, '#1a3d5c', depth * 0.65)
  }

  if (elevation < 0.36) return palette.sea
  if (elevation < 0.44) {
    return lerpHex(palette.sea, palette.grass, (elevation - 0.36) / 0.08)
  }
  if (elevation < 0.64) return palette.grass
  if (elevation < 0.74) {
    return lerpHex(palette.grass, palette.terrain, (elevation - 0.64) / 0.1)
  }
  if (elevation < 0.82) return palette.terrain
  if (elevation < 0.9) {
    return lerpHex(palette.terrain, palette.rock, (elevation - 0.82) / 0.08)
  }
  if (elevation < 0.96) {
    return lerpHex(palette.rock, palette.snow, (elevation - 0.9) / 0.06)
  }
  return palette.snow
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  }
}
