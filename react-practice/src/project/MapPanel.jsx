import Slider from '../components/Slider'

const formatPercent = (value) => `${value}%`

function Toggle({ label, checked, onChange }) {
  return (
    <label className="control control-inline shader-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

const COVER_GROUPS = [
  ['leaves', 'Fallen leaves'],
  ['twigs', 'Twigs & branches'],
  ['moss', 'Moss'],
  ['mushrooms', 'Mushrooms'],
]

/**
 * Map tab controls: the ground's shape, ground cover, view, and previews.
 * status: { loaded, pending, focus: [x, z], ground } from the scene.
 */
export default function MapPanel({
  ground,
  view,
  cover,
  status,
  onGroundChange,
  onViewChange,
  onCoverChange,
  onReset,
}) {
  const setGround = (key) => (value) => onGroundChange(key, value)
  const setGroup = (group, key) => (value) => onCoverChange(group, { ...cover[group], [key]: value })

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

      <details className="control-section scatter-layer" open>
        <summary>
          <span className="scatter-layer-name">Ground cover</span>
        </summary>
        <div className="control-section-body">
          <Toggle label="Tree trunks" checked={ground.trunks} onChange={setGround('trunks')} />
          {ground.trunks && (
            <Slider
              label="Trunk spacing"
              value={ground.trunkSpacing}
              min={2}
              max={6}
              step={0.5}
              format={(value) => `${value.toFixed(1)} m`}
              onChange={setGround('trunkSpacing')}
            />
          )}
          {COVER_GROUPS.map(([id, label]) => (
            <div key={id} className="control">
              <Toggle label={label} checked={cover[id].on} onChange={setGroup(id, 'on')} />
              {cover[id].on && (
                <Slider
                  label="Amount"
                  value={cover[id].amount}
                  min={0}
                  max={100}
                  step={5}
                  format={formatPercent}
                  onChange={setGroup(id, 'amount')}
                />
              )}
              {id === 'leaves' && cover.leaves.on && (
                <Slider
                  label="Autumn colours"
                  value={cover.autumn}
                  min={0}
                  max={100}
                  step={5}
                  format={formatPercent}
                  onChange={(value) => onCoverChange('autumn', value)}
                />
              )}
            </div>
          ))}
          <Toggle
            label="Fly agaric (needs the ant hill)"
            checked={cover.flyAgaric}
            onChange={(value) => onCoverChange('flyAgaric', value)}
          />
        </div>
      </details>

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
