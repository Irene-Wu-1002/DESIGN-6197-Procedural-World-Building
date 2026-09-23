import { useEffect, useRef, useState } from 'react'
import {
  EARTH_LAYER_PRESETS,
  MAX_EARTH_LAYERS,
  createEarthLayer,
} from '../utils/earthLayers'
import {
  colorForElevation,
  createTerrainPalette,
} from '../utils/heightMaterial'
import { getBlendedNoise } from '../utils/noise'
import NoiseTerrain from './NoiseTerrain'

const PREVIEW_SAMPLE_SIZE = 512
const BASE_WATER_LEVEL = 0.35
const WATER_AMPLITUDE = 0.22

export default function Week2Scene() {
  const heightmapRef = useRef(null)
  const simulationMapRef = useRef(null)
  const heightCacheRef = useRef(null)
  const [layers, setLayers] = useState(() =>
    EARTH_LAYER_PRESETS.slice(0, 3).map(createEarthLayer)
  )
  const [selectedLayerId, setSelectedLayerId] = useState('terrain')
  const [isSimulating, setIsSimulating] = useState(false)
  const [waterLevel, setWaterLevel] = useState(BASE_WATER_LEVEL)
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 })
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]

  // Animate flood level while the simulation is running.
  useEffect(() => {
    if (!isSimulating) return undefined

    let frameId
    const startedAt = performance.now()

    const tick = (now) => {
      const elapsed = (now - startedAt) / 1000
      const nextLevel =
        BASE_WATER_LEVEL + Math.sin(elapsed * 0.55) * WATER_AMPLITUDE
      setWaterLevel(Math.min(0.85, Math.max(0.08, nextLevel)))
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isSimulating])

  // Cache noise heights for the current scroll window; redraw grayscale map.
  useEffect(() => {
    const canvas = heightmapRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    const image = context.createImageData(canvas.width, canvas.height)
    const sampleStep = PREVIEW_SAMPLE_SIZE / canvas.width
    const heights = new Float32Array(canvas.width * canvas.height)

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const noiseValue = getBlendedNoise(
          x * sampleStep + mapOffset.x,
          y * sampleStep + mapOffset.y,
          layers
        )
        heights[y * canvas.width + x] = noiseValue
        const grayscale = Math.round((noiseValue + 1) * 0.5 * 255)
        const pixelIndex = (y * canvas.width + x) * 4

        image.data[pixelIndex] = grayscale
        image.data[pixelIndex + 1] = grayscale
        image.data[pixelIndex + 2] = grayscale
        image.data[pixelIndex + 3] = 255
      }
    }

    heightCacheRef.current = { width: canvas.width, height: canvas.height, heights }
    context.putImageData(image, 0, 0)
  }, [layers, mapOffset])

  // Simulation map: recolor from the cached heights when water level changes.
  useEffect(() => {
    const canvas = simulationMapRef.current
    const cache = heightCacheRef.current
    if (!canvas || !cache) return

    const context = canvas.getContext('2d')
    const image = context.createImageData(canvas.width, canvas.height)
    const palette = createTerrainPalette(layers)

    for (let index = 0; index < cache.heights.length; index += 1) {
      const hex = colorForElevation(cache.heights[index], palette, waterLevel)
      const pixelIndex = index * 4
      const value = hex.replace('#', '')

      image.data[pixelIndex] = parseInt(value.slice(0, 2), 16)
      image.data[pixelIndex + 1] = parseInt(value.slice(2, 4), 16)
      image.data[pixelIndex + 2] = parseInt(value.slice(4, 6), 16)
      image.data[pixelIndex + 3] = 255
    }

    context.putImageData(image, 0, 0)
  }, [layers, waterLevel, mapOffset])

  const updateSelectedLayer = (key, value) => {
    setLayers((current) =>
      current.map((layer) =>
        layer.id === selectedLayer.id ? { ...layer, [key]: value } : layer
      )
    )
  }

  const addLayer = () => {
    const nextPreset = EARTH_LAYER_PRESETS.find(
      (preset) => !layers.some((layer) => layer.id === preset.id)
    )
    if (!nextPreset || layers.length >= MAX_EARTH_LAYERS) return

    setLayers((current) => [...current, createEarthLayer(nextPreset)])
    setSelectedLayerId(nextPreset.id)
  }

  const removeSelectedLayer = () => {
    if (layers.length === 1) return
    const remainingLayers = layers.filter(
      (layer) => layer.id !== selectedLayer.id
    )
    setLayers(remainingLayers)
    setSelectedLayerId(remainingLayers[0].id)
  }

  return (
    <div className="noise-workspace">
      <NoiseTerrain
        layers={layers}
        waterLevel={waterLevel}
        mapOffset={mapOffset}
        onMapOffsetChange={setMapOffset}
      />

      <aside className="noise-panel">
        <div className="panel-title">
          <h2>Earth Layers</h2>
          <span className="panel-badge">Week 2</span>
        </div>

        <section className="navigation-section">
          <div className="layer-manager-header">
            <h3>Infinite map</h3>
            <button
              type="button"
              className="layer-add"
              onClick={() => setMapOffset({ x: 0, y: 0 })}
            >
              Reset
            </button>
          </div>
          <p className="nav-coords">
            X {mapOffset.x.toFixed(0)} · Y {mapOffset.y.toFixed(0)}
          </p>
          <div className="key-hints" aria-hidden="true">
            <span className="key">W</span>
            <span className="key-row">
              <span className="key">A</span>
              <span className="key">S</span>
              <span className="key">D</span>
            </span>
            <span className="key-sep">or</span>
            <span className="key">↑</span>
            <span className="key-row">
              <span className="key">←</span>
              <span className="key">↓</span>
              <span className="key">→</span>
            </span>
          </div>
          <p className="nav-hint">Scroll forever — noise continues in every direction.</p>
        </section>

        <figure className="noise-preview">
          <canvas
            ref={heightmapRef}
            className="noise-preview-canvas"
            width="256"
            height="256"
            aria-label="Blended noise grayscale heightmap"
          />
          <figcaption>Noise heightmap</figcaption>
        </figure>

        <section className="simulation-section">
          <div className="layer-manager-header">
            <h3>Simulation map</h3>
            <span className={`sim-status ${isSimulating ? 'running' : ''}`}>
              {isSimulating ? 'Running' : 'Stopped'}
            </span>
          </div>

          <figure className="noise-preview">
            <canvas
              ref={simulationMapRef}
              className="noise-preview-canvas"
              width="256"
              height="256"
              aria-label="Height-based material simulation map"
            />
            <figcaption>Material by height + flood</figcaption>
          </figure>

          <div className="simulation-controls">
            <button
              type="button"
              className={`sim-button start ${isSimulating ? 'active' : ''}`}
              disabled={isSimulating}
              onClick={() => setIsSimulating(true)}
            >
              Start
            </button>
            <button
              type="button"
              className={`sim-button stop ${!isSimulating ? 'active' : ''}`}
              disabled={!isSimulating}
              onClick={() => setIsSimulating(false)}
            >
              Stop
            </button>
          </div>

          <label className="control">
            <span className="control-header">
              <span className="control-label">Water level</span>
              <span className="control-value">
                {(waterLevel * 100).toFixed(0)}%
              </span>
            </span>
            <input
              type="range"
              value={waterLevel}
              min={0.05}
              max={0.9}
              step={0.01}
              disabled={isSimulating}
              onChange={(event) => setWaterLevel(Number(event.target.value))}
            />
          </label>
        </section>

        <section className="layer-manager">
          <div className="layer-manager-header">
            <h3>
              Layers <span>{layers.length}/{MAX_EARTH_LAYERS}</span>
            </h3>
            <button
              type="button"
              className="layer-add"
              disabled={layers.length >= MAX_EARTH_LAYERS}
              onClick={addLayer}
            >
              + Add
            </button>
          </div>

          <div className="layer-list">
            {layers.map((layer) => (
              <button
                type="button"
                key={layer.id}
                className={`layer-item ${
                  layer.id === selectedLayer.id ? 'active' : ''
                }`}
                onClick={() => setSelectedLayerId(layer.id)}
              >
                <span
                  className="layer-color"
                  style={{ backgroundColor: layer.color }}
                />
                <span>{layer.name}</span>
                <small>{layer.type}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="layer-controls">
          <div className="selected-layer-title">
            <span
              className="layer-color"
              style={{ backgroundColor: selectedLayer.color }}
            />
            <h3>{selectedLayer.name} parameters</h3>
          </div>

          <label className="control control-inline">
            <span className="control-label">Enabled</span>
            <input
              type="checkbox"
              checked={selectedLayer.enabled}
              onChange={(event) =>
                updateSelectedLayer('enabled', event.target.checked)
              }
            />
          </label>

          <label className="control">
            <span className="control-label">Noise equation</span>
            <select
              value={selectedLayer.type}
              onChange={(event) =>
                updateSelectedLayer('type', event.target.value)
              }
            >
              <option value="white">White Noise</option>
              <option value="perlin">Perlin Noise</option>
              <option value="cellular">Cellular Noise</option>
            </select>
          </label>

          <NoiseSlider
            label="Blend weight"
            value={selectedLayer.weight}
            min={0}
            max={1}
            step={0.05}
            displayValue={selectedLayer.weight.toFixed(2)}
            onChange={(value) => updateSelectedLayer('weight', value)}
          />
          <NoiseSlider
            label="Scale / frequency"
            value={selectedLayer.scale}
            min={0.002}
            max={0.04}
            step={0.001}
            displayValue={selectedLayer.scale.toFixed(3)}
            onChange={(value) => updateSelectedLayer('scale', value)}
          />
          <NoiseSlider
            label="Octaves"
            value={selectedLayer.octaves}
            min={1}
            max={8}
            step={1}
            onChange={(value) => updateSelectedLayer('octaves', value)}
          />
          <NoiseSlider
            label="Persistence"
            value={selectedLayer.persistence}
            min={0.1}
            max={0.9}
            step={0.05}
            displayValue={selectedLayer.persistence.toFixed(2)}
            onChange={(value) => updateSelectedLayer('persistence', value)}
          />
          <NoiseSlider
            label="Lacunarity"
            value={selectedLayer.lacunarity}
            min={1.2}
            max={4}
            step={0.1}
            displayValue={selectedLayer.lacunarity.toFixed(1)}
            onChange={(value) => updateSelectedLayer('lacunarity', value)}
          />
          <NoiseSlider
            label="Seed"
            value={selectedLayer.seed}
            min={0}
            max={9999}
            step={1}
            onChange={(value) => updateSelectedLayer('seed', value)}
          />

          <div className="layer-actions">
            <button
              className="seed-button"
              type="button"
              onClick={() =>
                updateSelectedLayer(
                  'seed',
                  Math.floor(Math.random() * 10000)
                )
              }
            >
              New seed
            </button>
            <button
              className="remove-layer"
              type="button"
              disabled={layers.length === 1}
              onClick={removeSelectedLayer}
            >
              Remove
            </button>
          </div>
        </section>

        <p className="panel-hint">
          Use <code>WASD</code> or arrow keys to scroll the infinite map.
          Start the simulation to raise and lower the flood line.
        </p>
      </aside>
    </div>
  )
}

function NoiseSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue = value,
  onChange,
}) {
  return (
    <label className="control">
      <span className="control-header">
        <span className="control-label">{label}</span>
        <span className="control-value">{displayValue}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
