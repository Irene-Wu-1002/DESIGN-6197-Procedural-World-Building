export const MAX_EARTH_LAYERS = 2

export const LAYER_MODES = [
  { id: 'function', label: 'Functions' },
  { id: 'simulation', label: 'Simulation' },
]

export const SIMULATION_SHADERS = [
  { id: 'flood', label: 'Flood' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'rain', label: 'Rain' },
]

export const EARTH_LAYER_PRESETS = [
  {
    id: 'land',
    name: 'Land',
    color: '#73964a',
    mode: 'function',
    type: 'perlin',
    scale: 0.009,
    octaves: 5,
    persistence: 0.52,
    lacunarity: 2,
    seed: 42,
    weight: 1,
    enabled: true,
    simulation: 'flood',
    simulationStrength: 0.7,
  },
  {
    id: 'sea',
    name: 'Sea',
    color: '#3f83b5',
    mode: 'function',
    type: 'cellular',
    scale: 0.004,
    octaves: 2,
    persistence: 0.45,
    lacunarity: 2,
    seed: 213,
    weight: 0.4,
    enabled: true,
    simulation: 'flood',
    simulationStrength: 0.8,
  },
]

export function createEarthLayer(preset) {
  return { ...preset }
}

export function getFunctionLayers(layers) {
  return layers.filter(
    (layer) => layer.enabled && layer.mode === 'function' && layer.weight > 0
  )
}

export function getSimulationLayers(layers) {
  return layers.filter(
    (layer) => layer.enabled && layer.mode === 'simulation'
  )
}
