import Slider from '../Slider'
import Toggle from './Toggle'
import { degrees, fixed, whole } from './format'

export default function StochasticControls({ params, onParam }) {
  return (
    <>
      <div className="control-subsection">
        <div className="control-subsection-title">Growth</div>
        <Slider
          label="Steps"
          value={params.steps}
          min={20}
          max={250}
          step={1}
          format={whole}
          onChange={(value) => onParam('steps', value)}
        />
        <Slider
          label="Step length"
          value={params.stepLength}
          min={0.03}
          max={0.3}
          step={0.01}
          onChange={(value) => onParam('stepLength', value)}
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
        <Slider
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          format={whole}
          onChange={(value) => onParam('seed', value)}
        />
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Chances (per tip, per step)</div>
        <Slider
          label="Split chance"
          value={params.splitChance}
          min={0}
          max={0.3}
          step={0.005}
          format={fixed(3)}
          onChange={(value) => onParam('splitChance', value)}
        />
        <Slider
          label="Stop chance"
          value={params.stopChance}
          min={0}
          max={0.05}
          step={0.001}
          format={fixed(3)}
          onChange={(value) => onParam('stopChance', value)}
        />
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Direction</div>
        <Slider
          label="Wander"
          value={params.wander}
          min={0}
          max={45}
          step={1}
          format={degrees}
          onChange={(value) => onParam('wander', value)}
        />
        <Slider
          label="Split angle"
          value={params.splitAngle}
          min={10}
          max={90}
          step={1}
          format={degrees}
          onChange={(value) => onParam('splitAngle', value)}
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
          label="Flatness"
          value={params.flatness}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => onParam('flatness', value)}
        />
        <p className="section-note">Flatness 1 keeps growth in a flat layer, like mycelium in soil.</p>
        <Toggle label="Grow downward" checked={params.growDown} onChange={(value) => onParam('growDown', value)} />
        <Toggle label="Show tips" checked={params.showTips} onChange={(value) => onParam('showTips', value)} />
      </div>
    </>
  )
}
