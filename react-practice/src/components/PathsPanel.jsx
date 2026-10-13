import Slider from './Slider'

const formatMetres = (value) => `${value.toFixed(1)} m`

function Toggle({ label, checked, onChange }) {
  return (
    <label className="control control-inline shader-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

/**
 * Paths tab: generated rivers and the roads between windmills.
 * onChange(group, key, value) with group = 'rivers' | 'roads'.
 */
export default function PathsPanel({
  rivers,
  roads,
  riverCount,
  roadCount,
  bridgeCount,
  windmillCount,
  onChange,
}) {
  const setRiver = (key) => (value) => onChange('rivers', key, value)
  const setRoad = (key) => (value) => onChange('roads', key, value)

  return (
    <>
      <p className="section-note">
        Rivers start on high ground, carve a channel downhill, and run into a
        lake or off the map. Roads link the windmills along gentle ground,
        flatten it, and cross rivers on small bridges.
      </p>

      <details className="control-section scatter-layer" open>
        <summary>
          <span className="scatter-layer-name">Rivers</span>
          <span className="scatter-layer-count">{riverCount}</span>
        </summary>
        <div className="control-section-body">
          <Toggle label="Show rivers" checked={rivers.on} onChange={setRiver('on')} />
          {rivers.on && (
            <>
              <Slider
                label="River count"
                value={rivers.count}
                min={0}
                max={4}
                step={1}
                format={(value) => value}
                onChange={setRiver('count')}
              />
              <Slider
                label="River seed"
                value={rivers.seed}
                min={0}
                max={999}
                step={1}
                format={(value) => value}
                onChange={setRiver('seed')}
              />
              <Slider
                label="Lowest spring height"
                value={rivers.springMin}
                min={30}
                max={90}
                step={1}
                format={(value) => `${value}%`}
                onChange={setRiver('springMin')}
              />
              <Slider
                label="Width at mouth"
                value={rivers.mouthWidth}
                min={0.5}
                max={3}
                step={0.1}
                format={formatMetres}
                onChange={setRiver('mouthWidth')}
              />
              <Slider
                label="Channel depth"
                value={rivers.depth}
                min={0}
                max={1.5}
                step={0.05}
                format={formatMetres}
                onChange={setRiver('depth')}
              />
              {rivers.count > 0 && riverCount < rivers.count && (
                <p className="section-note">
                  Only {riverCount} of {rivers.count} found room: springs need
                  high ground at least 10 m apart.
                </p>
              )}
            </>
          )}
        </div>
      </details>

      <details className="control-section scatter-layer" open>
        <summary>
          <span className="scatter-layer-name">Roads</span>
          <span className="scatter-layer-count">
            {roadCount}
            {bridgeCount > 0 ? ` · ${bridgeCount} bridge${bridgeCount > 1 ? 's' : ''}` : ''}
          </span>
        </summary>
        <div className="control-section-body">
          <Toggle label="Show roads" checked={roads.on} onChange={setRoad('on')} />
          {roads.on && (
            <>
              <Toggle label="Road to map edge" checked={roads.exit} onChange={setRoad('exit')} />
              <Toggle label="Allow bridges" checked={roads.bridges} onChange={setRoad('bridges')} />
              <Slider
                label="Road width"
                value={roads.width}
                min={0.8}
                max={3}
                step={0.1}
                format={formatMetres}
                onChange={setRoad('width')}
              />
              <Slider
                label="Slope avoidance"
                value={roads.slopeAvoid}
                min={0}
                max={100}
                step={5}
                format={(value) => `${value}%`}
                onChange={setRoad('slopeAvoid')}
              />
              <p className="section-note">
                {windmillCount === 0
                  ? 'No windmills placed, so there is nothing to connect.'
                  : '0% runs straight over hills; 100% takes long, gentle detours.'}
              </p>
            </>
          )}
        </div>
      </details>
    </>
  )
}
