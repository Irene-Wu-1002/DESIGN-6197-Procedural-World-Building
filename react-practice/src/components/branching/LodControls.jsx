import Slider from '../Slider'
import Toggle from './Toggle'
import { fixed } from './format'
import { LOD_LEVELS } from '../../utils/branching/lod'

const MODES = [
  ['auto', 'Auto'],
  ['fixed', 'Fixed level'],
  ['off', 'Off'],
]
const FOREST_SIZES = [1, 3, 5, 7, 9]

export default function LodControls({ lod, onLod, stats }) {
  return (
    <div className="control-subsection">
      <div className="control-subsection-title">Level of detail</div>

      <div className="performance-stats chunk-stats">
        <span>
          <b>{stats.fps}</b> FPS
        </span>
        <span>
          <b>{stats.calls}</b> draw calls
        </span>
        <span>
          <b>{stats.triangles.toLocaleString()}</b> triangles
        </span>
        <span>
          <b>{stats.perLevel.map((count, level) => `L${level} ${count}`).join(' · ')}</b> copies per level
        </span>
      </div>

      <div className="panel-tabs" role="tablist" aria-label="LOD mode">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={lod.mode === id}
            className={lod.mode === id ? 'active' : ''}
            onClick={() => onLod('mode', id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="section-note">
        {lod.mode === 'auto' && 'Each copy picks its level from how tall it looks on screen. Zoom out to watch them drop.'}
        {lod.mode === 'fixed' && 'Every copy uses the chosen level.'}
        {lod.mode === 'off' && 'Every copy at full detail: the cost LOD saves.'}
      </p>

      {lod.mode === 'fixed' && (
        <Slider
          label="Level"
          value={lod.level}
          min={0}
          max={LOD_LEVELS.length - 1}
          step={1}
          format={(value) => `LOD ${value}`}
          onChange={(value) => onLod('level', value)}
        />
      )}
      {lod.mode === 'auto' && (
        <Slider
          label="Detail bias"
          value={lod.bias}
          min={0.25}
          max={3}
          step={0.05}
          format={(value) => `${fixed(2)(value)}×`}
          onChange={(value) => onLod('bias', value)}
        />
      )}
      <Slider
        label="Forest size"
        value={FOREST_SIZES.indexOf(lod.forest)}
        min={0}
        max={FOREST_SIZES.length - 1}
        step={1}
        format={(index) => `${FOREST_SIZES[index]} × ${FOREST_SIZES[index]}`}
        onChange={(index) => onLod('forest', FOREST_SIZES[index])}
      />
      <Slider
        label="Twig radius"
        value={lod.twigRadius}
        min={0.004}
        max={0.05}
        step={0.001}
        format={fixed(3)}
        onChange={(value) => onLod('twigRadius', value)}
      />
      <Toggle
        label="Colour by level"
        checked={lod.colorByLevel}
        onChange={(value) => onLod('colorByLevel', value)}
      />

      <div className="lod-levels">
        {stats.levels.map(({ segments, triangles }, level) => (
          <span key={level}>
            <i style={{ background: LOD_LEVELS[level].color }} />
            <b>LOD {level}</b> {Math.round(LOD_LEVELS[level].fraction * 100)}% · {LOD_LEVELS[level].sides} sides ·{' '}
            {segments.toLocaleString()} seg · {triangles.toLocaleString()} tris
          </span>
        ))}
      </div>
    </div>
  )
}
