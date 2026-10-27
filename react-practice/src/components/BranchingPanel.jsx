import Slider from './Slider'
import LodControls from './branching/LodControls'
import { BRANCHING_METHODS } from './branching/methods'
import { fixed } from './branching/format'

const VIEWS = [
  ['growth', 'Growth'],
  ['lod', 'LOD'],
]

export default function BranchingPanel({
  view,
  onView,
  lod,
  onLod,
  lodStats,
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

      <div className="panel-tabs" role="tablist" aria-label="View">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'active' : ''}
            onClick={() => onView(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel-tabs" role="tablist" aria-label="Method">
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

      <div className={view === 'growth' ? 'panel-actions' : 'panel-actions branch-presets'}>
        <button type="button" className="layer-add" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="layer-add" onClick={onRandomSeed}>
          Random Seed
        </button>
        {view === 'growth' && (
          <button type="button" className="layer-add" onClick={onGrow}>
            Grow
          </button>
        )}
      </div>

      {view === 'growth' && (
        <Slider
          label="Growth speed"
          value={speed}
          min={0.25}
          max={3}
          step={0.05}
          format={(value) => `${fixed(2)(value)}×`}
          onChange={onSpeed}
        />
      )}

      {view === 'lod' && <LodControls lod={lod} onLod={onLod} stats={lodStats} />}

      <p className="section-note">{note}</p>

      <div className="panel-actions branch-presets">
        {Object.entries(presets).map(([id, preset]) => (
          <button key={id} type="button" className="layer-add" onClick={() => onPreset(id)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="performance-stats chunk-stats">
        {view === 'growth' && (
          <span>
            <b>
              {growingStep === null
                ? 'Grown'
                : `${tree.stepName} ${Math.min(growingStep, steps)} / ${steps}`}
            </b>{' '}
            {growingStep === null ? 'press Grow to replay' : 'growing…'}
          </span>
        )}
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
