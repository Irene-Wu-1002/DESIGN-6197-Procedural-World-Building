import Slider from '../Slider'
import Toggle from './Toggle'
import { fixed, whole } from './format'
import { COLONIZATION_SHAPES } from '../../utils/branching/spaceColonization'

export default function ColonizationControls({ params, onParam }) {
  return (
    <>
      <div className="control-subsection">
        <div className="control-subsection-title">Attraction points</div>
        <label className="control">
          <span className="control-label">Volume shape</span>
          <select value={params.shape} onChange={(event) => onParam('shape', event.target.value)}>
            {COLONIZATION_SHAPES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Slider
          label="Volume size"
          value={params.size}
          min={1}
          max={6}
          step={0.1}
          format={fixed(1)}
          onChange={(value) => onParam('size', value)}
        />
        {params.shape !== 'slab' && (
          <Slider
            label="Volume height"
            value={params.height}
            min={0}
            max={8}
            step={0.1}
            format={fixed(1)}
            onChange={(value) => onParam('height', value)}
          />
        )}
        <Slider
          label="Points"
          value={params.points}
          min={100}
          max={4000}
          step={50}
          format={whole}
          onChange={(value) => onParam('points', value)}
        />
        <Slider
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          format={whole}
          onChange={(value) => onParam('seed', value)}
        />
        <Toggle
          label="Show attraction points"
          checked={params.showAttractors}
          onChange={(value) => onParam('showAttractors', value)}
        />
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Growth</div>
        <Slider
          label="Influence radius"
          value={params.influence}
          min={0.3}
          max={3}
          step={0.05}
          onChange={(value) => onParam('influence', value)}
        />
        <Slider
          label="Kill distance"
          value={params.killDistance}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(value) => onParam('killDistance', value)}
        />
        <p className="section-note">
          A point pulls the nearest branch within the influence radius, and is removed once a branch
          comes within the kill distance.
        </p>
        <Slider
          label="Step length"
          value={params.stepLength}
          min={0.05}
          max={0.5}
          step={0.01}
          onChange={(value) => onParam('stepLength', value)}
        />
        <Slider
          label="Max iterations"
          value={params.maxIterations}
          min={50}
          max={600}
          step={10}
          format={whole}
          onChange={(value) => onParam('maxIterations', value)}
        />
        <Slider
          label="Tropism"
          value={params.tropism}
          min={-1}
          max={1}
          step={0.01}
          onChange={(value) => onParam('tropism', value)}
        />
        <Slider
          label="Start points"
          value={params.startPoints}
          min={1}
          max={6}
          step={1}
          format={whole}
          onChange={(value) => onParam('startPoints', value)}
        />
        <Toggle label="Show tips" checked={params.showTips} onChange={(value) => onParam('showTips', value)} />
      </div>
    </>
  )
}
