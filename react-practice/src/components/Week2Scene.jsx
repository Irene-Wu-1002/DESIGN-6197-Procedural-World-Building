import { useEffect, useRef, useState } from 'react'
import {
  EARTH_LAYER_PRESETS,
  LAYER_MODES,
  MAX_EARTH_LAYERS,
  SIMULATION_SHADERS,
  createEarthLayer,
  getFunctionLayers,
  getSimulationLayers,
} from '../utils/earthLayers'
import {
  applySimulationShaders,
  colorForElevation,
  createTerrainPalette,
} from '../utils/heightMaterial'
import { getBlendedNoise, getNoise, SHAPING_OPERATIONS } from '../utils/noise'
import NoiseTerrain from './NoiseTerrain'

const PREVIEW_SAMPLE_SIZE = 512
const BASE_WATER_LEVEL = 0.35
const WATER_AMPLITUDE = 0.22

export default function Week2Scene() {
  const layerPreviewRef = useRef(null)
  const combinedPreviewRef = useRef(null)
  const [layers, setLayers] = useState(() =>
    EARTH_LAYER_PRESETS.map(createEarthLayer)
  )
  const [selectedLayerId, setSelectedLayerId] = useState('land')
  const [isSimulating, setIsSimulating] = useState(false)
  const [waterLevel, setWaterLevel] = useState(BASE_WATER_LEVEL)
  const [simulationTime, setSimulationTime] = useState(0)
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 })
  const [gridSegments, setGridSegments] = useState(64)
  const [showWireframe, setShowWireframe] = useState(true)
  const [shaping, setShaping] = useState({
    operation: 'none',
    strength: 0.75,
  })

  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ?? layers[0]

  // Animate flood / rain while simulation is running.
  useEffect(() => {
    if (!isSimulating) return undefined

    let frameId
    const startedAt = performance.now()

    const tick = (now) => {
      const elapsed = (now - startedAt) / 1000
      setSimulationTime(elapsed)
      setWaterLevel(
        Math.min(
          0.85,
          Math.max(
            0.08,
            BASE_WATER_LEVEL + Math.sin(elapsed * 0.55) * WATER_AMPLITUDE
          )
        )
      )
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isSimulating])

  // Keyboard: F toggles wireframe (ignore when typing in inputs).
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (event.code === 'KeyF' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        setShowWireframe((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Per-layer 2D preview (Functions mode = that layer's noise).
  useEffect(() => {
    const canvas = layerPreviewRef.current
    if (!canvas || !selectedLayer) return

    const context = canvas.getContext('2d')
    const image = context.createImageData(canvas.width, canvas.height)
    const sampleStep = PREVIEW_SAMPLE_SIZE / canvas.width
    const palette = createTerrainPalette(layers)

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const sx = x * sampleStep + mapOffset.x
        const sy = y * sampleStep + mapOffset.y
        const pixelIndex = (y * canvas.width + x) * 4
        let r
        let g
        let b

        if (selectedLayer.mode === 'function') {
          const noiseValue = getNoise(sx, sy, selectedLayer)
          const gray = Math.round((noiseValue + 1) * 0.5 * 255)
          r = gray
          g = gray
          b = gray
        } else {
          const height = getBlendedNoise(
            sx,
            sy,
            getFunctionLayers(layers),
            shaping
          )
          const base = colorForElevation(height, palette, waterLevel)
          const hex = applySimulationShaders(base, height, [selectedLayer], {
            waterLevel,
            time: 0,
          })
          const value = hex.replace('#', '')
          r = parseInt(value.slice(0, 2), 16)
          g = parseInt(value.slice(2, 4), 16)
          b = parseInt(value.slice(4, 6), 16)
        }

        image.data[pixelIndex] = r
        image.data[pixelIndex + 1] = g
        image.data[pixelIndex + 2] = b
        image.data[pixelIndex + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
  }, [
    selectedLayer,
    layers,
    mapOffset,
    shaping,
    waterLevel,
  ])

  // Combined blend preview for the full stack.
  useEffect(() => {
    const canvas = combinedPreviewRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    const image = context.createImageData(canvas.width, canvas.height)
    const sampleStep = PREVIEW_SAMPLE_SIZE / canvas.width
    const palette = createTerrainPalette(layers)
    const fnLayers = getFunctionLayers(layers)
    const simLayers = getSimulationLayers(layers)

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const sx = x * sampleStep + mapOffset.x
        const sy = y * sampleStep + mapOffset.y
        const height = getBlendedNoise(sx, sy, fnLayers, shaping)
        const base = colorForElevation(height, palette, waterLevel)
        const hex = applySimulationShaders(base, height, simLayers, {
          waterLevel,
          time: 0,
        })
        const value = hex.replace('#', '')
        const pixelIndex = (y * canvas.width + x) * 4
        image.data[pixelIndex] = parseInt(value.slice(0, 2), 16)
        image.data[pixelIndex + 1] = parseInt(value.slice(2, 4), 16)
        image.data[pixelIndex + 2] = parseInt(value.slice(4, 6), 16)
        image.data[pixelIndex + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
  }, [layers, mapOffset, shaping, waterLevel])

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
    const remaining = layers.filter((layer) => layer.id !== selectedLayer.id)
    setLayers(remaining)
    setSelectedLayerId(remaining[0].id)
  }

  return (
    <div className="noise-workspace">
      <NoiseTerrain
        layers={layers}
        waterLevel={waterLevel}
        mapOffset={mapOffset}
        gridSegments={gridSegments}
        shaping={shaping}
        showWireframe={showWireframe}
        simulationTime={simulationTime}
        onMapOffsetChange={setMapOffset}
      />

      <aside className="noise-panel">
        <div className="panel-title">
          <h2>World Layers</h2>
          <span className="panel-badge">Week 2</span>
        </div>

        {/* 1. Select a world layer */}
        <section className="layer-manager">
          <div className="layer-manager-header">
            <h3>
              1. Choose a layer <span>{layers.length}/{MAX_EARTH_LAYERS}</span>
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
                <small>{layer.mode === 'function' ? 'Fn' : 'Sim'}</small>
              </button>
            ))}
          </div>
        </section>

        {/* 2. Choose how the selected layer is generated */}
        <section className="layer-controls">
          <div className="selected-layer-title">
            <span
              className="layer-color"
              style={{ backgroundColor: selectedLayer.color }}
            />
            <h3>{selectedLayer.name}</h3>
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

          <div className="generation-picker">
            <span className="control-label">2. Generate map with</span>
            <div className="generation-options">
              {LAYER_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={selectedLayer.mode === mode.id ? 'active' : ''}
                  aria-pressed={selectedLayer.mode === mode.id}
                  onClick={() => updateSelectedLayer('mode', mode.id)}
                >
                  <span>{mode.label}</span>
                  <small>
                    {mode.id === 'function'
                      ? 'Noise-based terrain'
                      : 'Height-based material'}
                  </small>
                </button>
              ))}
            </div>
          </div>

          {selectedLayer.mode === 'function' ? (
            <div className="generation-settings">
              <div className="settings-heading">
                <span>Function settings</span>
                <small>Build terrain from a noise equation</small>
              </div>
              <label className="control">
                <span className="control-label">3. Noise type</span>
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

              <figure className="noise-preview">
                <canvas
                  ref={layerPreviewRef}
                  className="noise-preview-canvas"
                  width="192"
                  height="192"
                  aria-label={`${selectedLayer.name} noise preview`}
                />
                <figcaption>{selectedLayer.name} 2D noise map</figcaption>
              </figure>

              <p className="settings-label">4. Adjust parameters</p>
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
                onChange={(value) =>
                  updateSelectedLayer('persistence', value)
                }
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
            </div>
          ) : (
            <div className="generation-settings">
              <div className="settings-heading">
                <span>Simulation settings</span>
                <small>Shade the map according to terrain height</small>
              </div>
              <label className="control">
                <span className="control-label">3. Material / shader</span>
                <select
                  value={selectedLayer.simulation}
                  onChange={(event) =>
                    updateSelectedLayer('simulation', event.target.value)
                  }
                >
                  {SIMULATION_SHADERS.map((shader) => (
                    <option key={shader.id} value={shader.id}>
                      {shader.label}
                    </option>
                  ))}
                </select>
              </label>

              <figure className="noise-preview">
                <canvas
                  ref={layerPreviewRef}
                  className="noise-preview-canvas"
                  width="192"
                  height="192"
                  aria-label={`${selectedLayer.name} simulation preview`}
                />
                <figcaption>{selectedLayer.name} height-based material</figcaption>
              </figure>

              <NoiseSlider
                label="Shader strength"
                value={selectedLayer.simulationStrength}
                min={0}
                max={1}
                step={0.05}
                displayValue={selectedLayer.simulationStrength.toFixed(2)}
                onChange={(value) =>
                  updateSelectedLayer('simulationStrength', value)
                }
              />

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

              {selectedLayer.simulation === 'flood' && (
                <NoiseSlider
                  label="Water level"
                  value={waterLevel}
                  min={0.05}
                  max={0.9}
                  step={0.01}
                  displayValue={`${(waterLevel * 100).toFixed(0)}%`}
                  disabled={isSimulating}
                  onChange={setWaterLevel}
                />
              )}
            </div>
          )}

          <div className="layer-actions">
            <button
              className="remove-layer"
              type="button"
              disabled={layers.length === 1}
              onClick={removeSelectedLayer}
            >
              Remove layer
            </button>
          </div>
        </section>

        {/* 3. Navigate and inspect the generated map */}
        <section className="navigation-section">
          <div className="layer-manager-header">
            <h3>Map navigation & view</h3>
            <button
              type="button"
              className="layer-add"
              onClick={() => setMapOffset({ x: 0, y: 0 })}
            >
              Reset position
            </button>
          </div>
          <div className="map-control-row">
            <div>
              <span className="control-label">Infinite map controller</span>
              <p className="nav-coords">
                X {mapOffset.x.toFixed(0)} · Y {mapOffset.y.toFixed(0)}
              </p>
            </div>
            <div className="key-hints" aria-label="Use W A S D or arrow keys">
              <span className="key">W</span>
              <span className="key-row">
                <span className="key">A</span>
                <span className="key">S</span>
                <span className="key">D</span>
              </span>
              <span className="key-sep">or arrows</span>
            </div>
          </div>
          <label className="control control-inline shortcut-control">
            <span>
              <span className="control-label">Wireframe</span>
              <small>Show the underlying 3D grid</small>
            </span>
            <span className="wireframe-toggle">
              <input
                type="checkbox"
                checked={showWireframe}
                onChange={(event) => setShowWireframe(event.target.checked)}
              />
              <kbd>F</kbd>
            </span>
          </label>
        </section>

        {/* Global mesh and shaping */}
        <section className="layer-manager">
          <div className="layer-manager-header">
            <h3>Grid & shaping</h3>
          </div>
          <NoiseSlider
            label="Grid resolution"
            value={gridSegments}
            min={16}
            max={128}
            step={8}
            displayValue={`${gridSegments} × ${gridSegments}`}
            onChange={setGridSegments}
          />
          <label className="control">
            <span className="control-label">Shaping operation</span>
            <select
              value={shaping.operation}
              onChange={(event) =>
                setShaping((current) => ({
                  ...current,
                  operation: event.target.value,
                }))
              }
            >
              {SHAPING_OPERATIONS.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.label}
                </option>
              ))}
            </select>
          </label>
          <NoiseSlider
            label="Shaping strength"
            value={shaping.strength}
            min={0}
            max={1}
            step={0.05}
            displayValue={shaping.strength.toFixed(2)}
            disabled={shaping.operation === 'none'}
            onChange={(value) =>
              setShaping((current) => ({ ...current, strength: value }))
            }
          />
        </section>

        <section className="simulation-section">
          <div className="layer-manager-header">
            <h3>Combined blend</h3>
          </div>
          <figure className="noise-preview">
            <canvas
              ref={combinedPreviewRef}
              className="noise-preview-canvas"
              width="192"
              height="192"
              aria-label="Combined world preview"
            />
            <figcaption>Functions + simulations</figcaption>
          </figure>
        </section>

        <p className="panel-hint">
          Layers: Land / Sea. Choose <code>Functions</code> for noise maps or{' '}
          <code>Simulation</code> for height-based shaders (flood, cloud,
          rain). Press <code>F</code> to toggle wireframe.
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
  disabled = false,
  onChange,
}) {
  return (
    <label className={`control ${disabled ? 'control-disabled' : ''}`}>
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
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
