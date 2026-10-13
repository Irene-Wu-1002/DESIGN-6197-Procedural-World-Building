import Slider from './Slider'

const formatPercent = (value) => `${value}%`

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

const PARTICLE_GROUPS = [
  ['leaves', 'Leaves', 'Shed by trees, coloured like the tree; land and get lifted by gusts.'],
  ['seeds', 'Seeds & pollen', 'Light fluff from sunny grass and bushes; rides updrafts.'],
  ['dust', 'Road dust', 'Puffs off the dirt roads while a gust passes.'],
]

/**
 * Wind tab. onChange(key, value) for top-level settings;
 * onGroupChange(group, key, value) for leaves / seeds / dust / sway.
 * counts: live particle counts per group.
 */
export default function WindPanel({ wind, counts, onChange, onGroupChange }) {
  return (
    <>
      <p className="section-note">
        One wind field drives everything: faster on hilltops, calm behind
        ridges and forests, rising up windward slopes, with gusts sweeping
        downwind. Windmills face into it.
      </p>

      <button
        type="button"
        className="layer-add"
        onClick={() => onChange('playing', !wind.playing)}
      >
        {wind.playing ? 'Pause wind' : 'Play wind'}
      </button>

      <Slider
        label="Wind direction (from)"
        value={wind.direction}
        min={0}
        max={359}
        step={1}
        format={(value) => `${value}°`}
        onChange={(value) => onChange('direction', value)}
      />
      <Slider
        label="Strength"
        value={wind.strength}
        min={0}
        max={15}
        step={0.5}
        format={(value) => `${value.toFixed(1)} m/s`}
        onChange={(value) => onChange('strength', value)}
      />
      <Slider
        label="Gustiness"
        value={wind.gustiness}
        min={0}
        max={100}
        step={5}
        format={formatPercent}
        onChange={(value) => onChange('gustiness', value)}
      />
      <Slider
        label="Turbulence"
        value={wind.turbulence}
        min={0}
        max={100}
        step={5}
        format={formatPercent}
        onChange={(value) => onChange('turbulence', value)}
      />
      <Slider
        label="Terrain influence"
        value={wind.terrainInfluence}
        min={0}
        max={150}
        step={5}
        format={formatPercent}
        onChange={(value) => onChange('terrainInfluence', value)}
      />
      <Toggle
        label="Show wind field"
        checked={wind.showField}
        onChange={(value) => onChange('showField', value)}
      />

      {PARTICLE_GROUPS.map(([id, label, note]) => (
        <details key={id} className="control-section scatter-layer" open>
          <summary>
            <span className="scatter-layer-name">{label}</span>
            <span className="scatter-layer-count">{counts[id]}</span>
          </summary>
          <div className="control-section-body">
            <p className="section-note">{note}</p>
            <Toggle
              label="Show"
              checked={wind[id].on}
              onChange={(value) => onGroupChange(id, 'on', value)}
            />
            {wind[id].on && (
              <Slider
                label="Amount"
                value={wind[id].amount}
                min={0}
                max={100}
                step={5}
                format={formatPercent}
                onChange={(value) => onGroupChange(id, 'amount', value)}
              />
            )}
          </div>
        </details>
      ))}

      <details className="control-section scatter-layer" open>
        <summary>
          <span className="scatter-layer-name">Tree sway</span>
        </summary>
        <div className="control-section-body">
          <p className="section-note">
            Canopies bend downwind; pines are stiffer, sheltered trees calmer.
          </p>
          <Toggle
            label="Sway"
            checked={wind.sway.on}
            onChange={(value) => onGroupChange('sway', 'on', value)}
          />
          {wind.sway.on && (
            <Slider
              label="Strength"
              value={wind.sway.strength}
              min={0}
              max={200}
              step={5}
              format={formatPercent}
              onChange={(value) => onGroupChange('sway', 'strength', value)}
            />
          )}
        </div>
      </details>
    </>
  )
}
