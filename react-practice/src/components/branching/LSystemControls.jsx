import Slider from '../Slider'
import Toggle from './Toggle'
import { degrees, whole } from './format'

const PREVIEW_LENGTH = 120

export default function LSystemControls({ params, onParam, tree }) {
  const setRule = (index, value) =>
    onParam(
      'rules',
      params.rules.map((rule, ruleIndex) => (ruleIndex === index ? value : rule))
    )

  return (
    <>
      <div className="control-subsection">
        <div className="control-subsection-title">Rules</div>
        <label className="control branch-rule">
          <span className="control-label">Axiom</span>
          <input
            type="text"
            spellCheck={false}
            value={params.axiom}
            onChange={(event) => onParam('axiom', event.target.value)}
          />
        </label>
        {params.rules.map((rule, index) => (
          <label key={index} className="control branch-rule">
            <span className="control-label">Rule {index + 1}</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="X=F[+X]F[-X]"
              value={rule}
              onChange={(event) => setRule(index, event.target.value)}
            />
          </label>
        ))}
        <p className="section-note">
          <code>F</code> draw · <code>f</code> move · <code>+ -</code> turn · <code>&amp; ^</code> pitch ·{' '}
          <code>\ /</code> roll · <code>|</code> turn around · <code>[ ]</code> branch. Other letters
          only rewrite.
        </p>
        <Slider
          label="Iterations"
          value={params.iterations}
          min={1}
          max={7}
          step={1}
          format={whole}
          onChange={(value) => onParam('iterations', value)}
        />
        <div className="branch-string" aria-label="Rewritten string">
          {tree.string.slice(0, PREVIEW_LENGTH)}
          {tree.string.length > PREVIEW_LENGTH && '…'}
        </div>
      </div>

      <div className="control-subsection">
        <div className="control-subsection-title">Turtle</div>
        <Slider
          label="Turn angle"
          value={params.angle}
          min={0}
          max={90}
          step={0.5}
          format={degrees}
          onChange={(value) => onParam('angle', value)}
        />
        <Slider
          label="Angle jitter"
          value={params.angleJitter}
          min={0}
          max={20}
          step={0.5}
          format={degrees}
          onChange={(value) => onParam('angleJitter', value)}
        />
        <Slider
          label="Step length"
          value={params.stepLength}
          min={0.02}
          max={1}
          step={0.01}
          onChange={(value) => onParam('stepLength', value)}
        />
        <Slider
          label="Length scale per branch"
          value={params.lengthScale}
          min={0.5}
          max={1}
          step={0.01}
          onChange={(value) => onParam('lengthScale', value)}
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
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          format={whole}
          onChange={(value) => onParam('seed', value)}
        />
        <p className="section-note">
          Jitter adds a random roll at every branch, which lifts flat rules into 3D.
        </p>
        <Toggle label="Show tips" checked={params.showTips} onChange={(value) => onParam('showTips', value)} />
      </div>
    </>
  )
}

