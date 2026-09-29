/**
 * Height-based earth material colors + simulation overlays.
 */

export function activeLayerColor(layers, id, fallbackHex) {
  const layer = layers.find((item) => item.id === id && item.enabled)
  return layer ? layer.color : fallbackHex
}

export function createTerrainPalette(layers) {
  const land = activeLayerColor(layers, 'land', '#73964a')
  const sea = activeLayerColor(layers, 'sea', '#3f83b5')
  const fog = activeLayerColor(layers, 'fog', '#b8c4ce')
  const cloud = activeLayerColor(layers, 'cloud', '#e8eef2')
  return {
    sea,
    grass: land,
    terrain: '#9a7650',
    rock: '#77736c',
    snow: cloud,
    fog,
    cloud,
    land,
  }
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

function smoothstep(edge0, edge1, value) {
  const amount = Math.max(
    0,
    Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 0.0001))
  )
  return amount * amount * (3 - 2 * amount)
}

/**
 * Base height material (land / sea / peaks).
 */
export function colorForElevation(noiseValue, palette, waterLevel = null) {
  const elevation = (noiseValue + 1) * 0.5

  if (waterLevel !== null && elevation <= waterLevel) {
    const depth = Math.min(
      1,
      (waterLevel - elevation) / Math.max(waterLevel, 0.01)
    )
    return lerpHex(palette.sea, '#1a3d5c', depth * 0.65)
  }

  if (elevation < 0.36) return palette.sea
  if (elevation < 0.44) {
    return lerpHex(palette.sea, palette.land, (elevation - 0.36) / 0.08)
  }
  if (elevation < 0.64) return palette.land
  if (elevation < 0.74) {
    return lerpHex(palette.land, palette.terrain, (elevation - 0.64) / 0.1)
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

/**
 * Apply simulation shaders (flood / cloud / rain) on top of a base color.
 */
export function applySimulationShaders(
  baseHex,
  noiseValue,
  simulationLayers,
  { waterLevel = 0.35, time = 0 } = {}
) {
  let color = baseHex
  const elevation = (noiseValue + 1) * 0.5

  for (const layer of simulationLayers) {
    const strength = layer.simulationStrength ?? 0.6
    if (layer.simulation === 'flood') {
      const level = waterLevel * (0.7 + strength * 0.5)
      const feather = 0.055
      const submerged =
        1 - smoothstep(level - feather, level + feather, elevation)
      if (submerged > 0.001) {
        color = lerpHex(
          color,
          '#3f83b5',
          submerged * (0.55 + strength * 0.35)
        )
      }
    } else if (layer.simulation === 'cloud') {
      const band = Math.max(0, 1 - Math.abs(elevation - 0.72) / 0.28)
      if (band > 0.05) {
        color = lerpHex(
          color,
          layer.color || '#e8eef2',
          band * strength * 0.85
        )
      }
    } else if (layer.simulation === 'rain') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + elevation * 12)
      const wet = Math.max(0, 0.55 - elevation) * strength * (0.65 + pulse * 0.35)
      if (wet > 0.02) {
        color = lerpHex(color, '#2f5f7a', wet)
      }
    }
  }

  return color
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  }
}
