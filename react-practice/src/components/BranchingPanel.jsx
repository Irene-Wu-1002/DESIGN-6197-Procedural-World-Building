import Slider from './Slider'
import { BRANCHING_METHODS } from './branching/methods'
import { fixed } from './branching/format'

export default function BranchingPanel({
  method,
  onMethod,
  params,
  onParam,
  onPreset,
  onReset,
  onRandomSeed,
  onGrow,
  speed,
  onSpeed,
  tree,
  growingStep,
}) {
  const { note, presets, Controls } = BRANCHING_METHODS.find((item) => item.id === method)
  const steps = tree.maxDepth + 1

  return (
    <aside className="noise-panel voxel-panel basic-voxel-panel">
      <div className="panel-title">
        <h2>Branching System</h2>
      </div>

      <div className="panel-tabs" role="tablist">
        {BRANCHING_METHODS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={method === id}
            className={method === id ? 'active' : ''}
            onClick={() => onMethod(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel-actions">
        <button type="button" className="layer-add" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="layer-add" onClick={onRandomSeed}>
          Random Seed
        </button>
        <button type="button" className="layer-add" onClick={onGrow}>
          Grow
        </button>
      </div>

      <Slider
        label="Growth speed"
        value={speed}
        min={0.25}
        max={3}
        step={0.05}
        format={(value) => `${fixed(2)(value)}×`}
        onChange={onSpeed}
      />

      <p className="section-note">{note}</p>

      <div className="panel-actions branch-presets">
        {Object.entries(presets).map(([id, preset]) => (
          <button key={id} type="button" className="layer-add" onClick={() => onPreset(id)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="performance-stats chunk-stats">
        <span>
          <b>
            {growingStep === null
              ? 'Grown'
              : `${tree.stepName} ${Math.min(growingStep, steps)} / ${steps}`}
          </b>{' '}
          {growingStep === null ? 'press Grow to replay' : 'growing…'}
        </span>
        {tree.stats.map(([value, label]) => (
          <span key={label}>
            <b>{typeof value === 'number' ? value.toLocaleString() : value}</b> {label}
          </span>
        ))}
        {tree.capped && (
          <span>
            <b>Capped</b> size limit reached
          </span>
        )}
      </div>

      <Controls params={params} onParam={onParam} tree={tree} />
    </aside>
  )
}
