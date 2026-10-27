import Slider from '../Slider'
import { degrees } from './format'

export default function RecursiveControls({ params, onParam }) {
  return (
    <>
      <div className="control-subsection">
        <div className="control-subsection-title">Structure</div>
        <Slider
          label="Depth"
          value={params.depth}
          min={1}
          max={9}
          step={1}
          format={(value) => value}
          onChange={(value) => onParam('depth', value)}
        />
        <Slider
          label="Children per split"
          value={params.children}
          min={1}
          max={5}
          step={1}
          format={(value) => value}
          onChange={(value) => onParam('children', value)}
        />
        <Slider
          label="Prune chance"
          value={params.prune}
          min={0}
          max={0.6}
          step={0.01}
          onChange={(value) => onParam('prune', value)}
        />
        <Slider
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          format={(value) => value}
          onChange={(value) => onParam('seed', value)}
        />
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Angles</div>
        <Slider
          label="Split angle"
          value={params.splitAngle}
          min={0}
          max={90}
          step={1}
          format={degrees}
          onChange={(value) => onParam('splitAngle', value)}
        />
        <Slider
          label="Angle jitter"
          value={params.angleJitter}
          min={0}
          max={45}
          step={1}
          format={degrees}
          onChange={(value) => onParam('angleJitter', value)}
        />
        <Slider
          label="Spread twist"
          value={params.spreadTwist}
          min={0}
          max={180}
          step={0.5}
          format={degrees}
          onChange={(value) => onParam('spreadTwist', value)}
        />
        <p className="section-note">137.5° is the golden angle: branches spread evenly, rarely overlapping.</p>
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Length &amp; direction</div>
        <Slider
          label="Trunk length"
          value={params.trunkLength}
          min={0.5}
          max={4}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={(value) => onParam('trunkLength', value)}
        />
        <Slider
          label="Length ratio"
          value={params.lengthRatio}
          min={0.4}
          max={0.95}
          step={0.01}
          onChange={(value) => onParam('lengthRatio', value)}
        />
        <Slider
          label="Length jitter"
          value={params.lengthJitter}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(value) => onParam('lengthJitter', value)}
        />
        <Slider
          label="Tropism"
          value={params.tropism}
          min={-1}
          max={1}
          step={0.01}
          onChange={(value) => onParam('tropism', value)}
        />
        <p className="section-note">Negative bends toward gravity (roots); positive toward light.</p>
        <label className="control control-inline shader-toggle">
          <span>Grow downward</span>
          <input
            type="checkbox"
            checked={params.growDown}
            onChange={(event) => onParam('growDown', event.target.checked)}
          />
        </label>
        <label className="control control-inline shader-toggle">
          <span>Show tips</span>
          <input
            type="checkbox"
            checked={params.showTips}
            onChange={(event) => onParam('showTips', event.target.checked)}
          />
        </label>
      </div>
    </>
  )
}
