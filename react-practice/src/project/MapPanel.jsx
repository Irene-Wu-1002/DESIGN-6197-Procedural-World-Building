import Slider from '../components/Slider'

const formatPercent = (value) => `${value}%`

/**
 * Map tab controls: the ground's shape, view distance, and previews.
 * status: { loaded, pending, focus: [x, z], ground } from the scene.
 */
export default function MapPanel({ ground, view, status, onGroundChange, onViewChange, onReset }) {
  const setGround = (key) => (value) => onGroundChange(key, value)

  return (
    <aside className="noise-panel voxel-panel basic-voxel-panel">
      <div className="panel-title">
        <h2>Forest Floor</h2>
      </div>
      <p className="section-note">
        Real scale: one tile is 20 × 20 cm. Walk with <strong>W A S D</strong>{' '}
        (Shift to run); drag to look around, scroll to zoom.
      </p>

      <div className="panel-actions">
        <button type="button" className="layer-add" onClick={onReset}>
          Reset All
        </button>
        <button
          type="button"
          className="layer-add"
          onClick={() => onGroundChange('seed', Math.floor(Math.random() * 1000))}
        >
          Random Seed
        </button>
      </div>

      <Slider
        label="World seed"
        value={ground.seed}
        min={0}
        max={999}
        step={1}
        format={(value) => value}
        onChange={setGround('seed')}
      />
      <Slider
        label="Slopes"
        value={ground.slopes}
        min={0}
        max={200}
        step={5}
        format={formatPercent}
        onChange={setGround('slopes')}
      />
      <Slider
        label="Bumps & hollows"
        value={ground.bumps}
        min={0}
        max={200}
        step={5}
        format={formatPercent}
        onChange={setGround('bumps')}
      />
      <Slider
        label="Warp"
        value={ground.warp}
        min={0}
        max={200}
        step={5}
        format={formatPercent}
        onChange={setGround('warp')}
      />
      <Slider
        label="Fine grain"
        value={ground.grain}
        min={0}
        max={200}
        step={5}
        format={formatPercent}
        onChange={setGround('grain')}
      />
      <Slider
        label="Pebbles"
        value={ground.pebbles}
        min={0}
        max={100}
        step={5}
        format={formatPercent}
        onChange={setGround('pebbles')}
      />
      <label className="control control-inline shader-toggle">
        <span>Ant hill</span>
        <input
          type="checkbox"
          checked={ground.antHill}
          onChange={(event) => onGroundChange('antHill', event.target.checked)}
        />
      </label>

      <Slider
        label="Detail distance"
        value={view.distance}
        min={3}
        max={5}
        step={1}
        format={(value) => `${value} tiles`}
        onChange={(value) => onViewChange('distance', value)}
      />
      <Slider
        label="Haze"
        value={view.haze}
        min={0}
        max={100}
        step={5}
        format={formatPercent}
        onChange={(value) => onViewChange('haze', value)}
      />
      <Slider
        label="Dappled light"
        value={view.dapple}
        min={0}
        max={100}
        step={5}
        format={formatPercent}
        onChange={(value) => onViewChange('dapple', value)}
      />
      <label className="control">
        <span className="control-label">Preview</span>
        <select
          value={view.preview}
          onChange={(event) => onViewChange('preview', event.target.value)}
        >
          <option value="off">Off</option>
          <option value="height">Height</option>
          <option value="slope">Slope</option>
          <option value="moisture">Moisture</option>
          <option value="tiles">Tile borders</option>
        </select>
      </label>

      <p className="section-note">
        Position {status.focus[0].toFixed(2)}, {status.focus[1].toFixed(2)} m · ground{' '}
        {(status.ground * 100).toFixed(1)} cm
        <br />
        Tiles {status.loaded} loaded
        {status.pending > 0 ? ` · ${status.pending} building` : ''}
      </p>
    </aside>
  )
}
