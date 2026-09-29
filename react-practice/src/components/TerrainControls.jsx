import { TERRAIN_SHAPING } from '../utils/noise'

function Slider({
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

/**
 * UI controls for procedural terrain parameters.
 */
export default function TerrainControls({
  params,
  onChange,
  showWireframe,
  onWireframeChange,
  preview,
}) {
  const update = (key, value) => onChange({ ...params, [key]: value })

  return (
    <aside className="noise-panel terrain-panel">
      <div className="panel-title">
        <h2>Terrain</h2>
        <span className="panel-badge">Week 2</span>
      </div>

      <p className="pipeline-note">
        2D noise map → height values → 3D terrain
      </p>

      {preview}

      <section className="layer-manager">
        <div className="layer-manager-header">
          <h3>Noise</h3>
        </div>

        <Slider
          label="Seed"
          value={params.seed}
          min={0}
          max={9999}
          step={1}
          onChange={(value) => update('seed', value)}
        />
        <button
          type="button"
          className="seed-button"
          onClick={() => update('seed', Math.floor(Math.random() * 10000))}
        >
          Random seed
        </button>

        <Slider
          label="Noise scale"
          value={params.scale}
          min={0.01}
          max={0.12}
          step={0.002}
          displayValue={params.scale.toFixed(3)}
          onChange={(value) => update('scale', value)}
        />
        <Slider
          label="Octaves"
          value={params.octaves}
          min={1}
          max={8}
          step={1}
          onChange={(value) => update('octaves', value)}
        />
        <Slider
          label="Falloff / persistence"
          value={params.persistence}
          min={0.2}
          max={0.85}
          step={0.05}
          displayValue={params.persistence.toFixed(2)}
          onChange={(value) => update('persistence', value)}
        />

        <label className="control">
          <span className="control-label">Terrain shaping</span>
          <select
            value={params.shaping}
            onChange={(event) => update('shaping', event.target.value)}
          >
            {TERRAIN_SHAPING.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="layer-manager">
        <div className="layer-manager-header">
          <h3>Mesh</h3>
        </div>

        <Slider
          label="Grid resolution"
          value={params.resolution}
          min={16}
          max={128}
          step={8}
          displayValue={`${params.resolution} × ${params.resolution}`}
          onChange={(value) => update('resolution', value)}
        />
        <Slider
          label="Terrain height / amplitude"
          value={params.amplitude}
          min={0.2}
          max={5}
          step={0.1}
          displayValue={params.amplitude.toFixed(1)}
          onChange={(value) => update('amplitude', value)}
        />

        <label className="control control-inline">
          <span className="control-label">Wireframe</span>
          <span className="wireframe-toggle">
            <input
              type="checkbox"
              checked={showWireframe}
              onChange={(event) => onWireframeChange(event.target.checked)}
            />
            <kbd>F</kbd>
          </span>
        </label>
      </section>

      <p className="panel-hint">
        Octaves stack low-frequency mountains with finer hills and detail.
        Same seed always rebuilds the same landform.
      </p>
    </aside>
  )
}
