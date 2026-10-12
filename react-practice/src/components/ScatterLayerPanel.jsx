import Slider from './Slider'
import { SCATTER_LAYERS } from '../utils/scatter'

// Panel order (placement order lives in SCATTER_LAYERS).
const PANEL_ORDER = ['pine', 'round', 'bush', 'rock', 'windmill']

const layerById = Object.fromEntries(SCATTER_LAYERS.map((layer) => [layer.id, layer]))

const formatMetres = (value) => `${value.toFixed(1)} m`
const formatPercent = (value) => `${value}%`

/**
 * One collapsible section per scatter layer, holding that layer's protocol.
 * Only one section is open at a time; the open one drives the rule preview.
 */
export default function ScatterLayerPanel({
  rules,
  counts,
  openLayer,
  onOpenLayer,
  onRuleChange,
  onResetLayer,
  hasWater,
}) {
  return PANEL_ORDER.map((id) => {
    const layer = layerById[id]
    const layerRules = rules[id]
    const isOpen = openLayer === id
    const set = (key) => (value) => onRuleChange(id, key, value)

    return (
      <details key={id} className="control-section scatter-layer" open={isOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            onOpenLayer(isOpen ? null : id)
          }}
        >
          <span className="scatter-layer-name">{layer.label}</span>
          <span className="scatter-layer-count">{counts[id]}</span>
          <input
            type="checkbox"
            aria-label={`Show ${layer.label}`}
            checked={layerRules.on}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRuleChange(id, 'on', event.target.checked)}
          />
        </summary>

        {isOpen && (
          <div className="control-section-body">
            <Slider
              label={layer.isCount ? 'Count' : 'Density'}
              value={layerRules.amount}
              min={0}
              max={layer.isCount ? layer.maxCount : 100}
              step={1}
              format={layer.isCount ? (value) => value : formatPercent}
              onChange={set('amount')}
            />

            <label className="control">
              <span className="control-label">Surface</span>
              <select
                value={layerRules.surface}
                onChange={(event) => set('surface')(event.target.value)}
              >
                <option value="grass">Grass only</option>
                <option value="rock">Rock only</option>
                <option value="any">Any</option>
              </select>
            </label>

            <Slider
              label="Max slope"
              value={layerRules.maxSlope}
              min={0}
              max={90}
              step={1}
              format={(value) => `${value}°`}
              onChange={set('maxSlope')}
            />
            <Slider
              label="Lowest height"
              value={layerRules.heightMin}
              min={0}
              max={100}
              step={1}
              format={formatPercent}
              onChange={(value) => set('heightMin')(Math.min(value, layerRules.heightMax))}
            />
            <Slider
              label="Highest height"
              value={layerRules.heightMax}
              min={0}
              max={100}
              step={1}
              format={formatPercent}
              onChange={(value) => set('heightMax')(Math.max(value, layerRules.heightMin))}
            />
            <Slider
              label="Cliff buffer"
              value={layerRules.cliffBuffer}
              min={0}
              max={5}
              step={0.1}
              format={(value) => (value === 0 ? 'off' : formatMetres(value))}
              onChange={set('cliffBuffer')}
            />

            <label className="control">
              <span className="control-label">Water</span>
              <select
                value={layerRules.water}
                onChange={(event) => set('water')(event.target.value)}
              >
                <option value="avoid">Avoid (stay away)</option>
                <option value="ignore">Ignore</option>
                <option value="near">Near (shore only)</option>
              </select>
            </label>
            {layerRules.water !== 'ignore' && (
              <Slider
                label={layerRules.water === 'avoid' ? 'Min distance to water' : 'Max distance to water'}
                value={layerRules.waterDistance}
                min={0}
                max={10}
                step={0.1}
                format={formatMetres}
                onChange={set('waterDistance')}
              />
            )}
            {!hasWater && layerRules.water !== 'ignore' && (
              <p className="section-note">No water on the terrain, so this rule is off.</p>
            )}
            <label className="control control-inline shader-toggle">
              <span>Allow in shallow water</span>
              <input
                type="checkbox"
                checked={layerRules.underwater}
                onChange={(event) => set('underwater')(event.target.checked)}
              />
            </label>

            <Slider
              label="Spacing"
              value={layerRules.spacing}
              min={0.5}
              max={15}
              step={0.1}
              format={formatMetres}
              onChange={set('spacing')}
            />
            <label className="control">
              <span className="control-label">Grouping</span>
              <select
                value={layerRules.grouping}
                onChange={(event) => set('grouping')(event.target.value)}
              >
                <option value="groves">Groves</option>
                <option value="scattered">Scattered</option>
              </select>
            </label>
            {layerRules.grouping === 'groves' && (
              <Slider
                label="Clumping"
                value={layerRules.clumping}
                min={1}
                max={10}
                step={0.5}
                format={(value) => value.toFixed(1)}
                onChange={set('clumping')}
              />
            )}

            {!layer.isCount && (
              <>
                <p className="section-note scatter-layer-group">Terrain response</p>
                <Slider
                  label="Size response"
                  value={layerRules.sizeResponse}
                  min={0}
                  max={200}
                  step={5}
                  format={formatPercent}
                  onChange={set('sizeResponse')}
                />
                <Slider
                  label="Colour response"
                  value={layerRules.colorResponse}
                  min={0}
                  max={200}
                  step={5}
                  format={formatPercent}
                  onChange={set('colorResponse')}
                />
                <Slider
                  label="Density response"
                  value={layerRules.densityResponse}
                  min={0}
                  max={200}
                  step={5}
                  format={formatPercent}
                  onChange={set('densityResponse')}
                />
                <Slider
                  label="Random variation"
                  value={layerRules.randomness}
                  min={0}
                  max={100}
                  step={5}
                  format={formatPercent}
                  onChange={set('randomness')}
                />
              </>
            )}

            <button type="button" className="layer-add" onClick={() => onResetLayer(id)}>
              Reset layer
            </button>
          </div>
        )}
      </details>
    )
  })
}
