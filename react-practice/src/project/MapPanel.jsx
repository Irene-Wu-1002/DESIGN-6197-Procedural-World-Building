import { useState } from 'react'
import {
  AdvancedSection,
  ControlCard,
  EnableToggle,
  LabeledSlider,
  ResetButton,
  SeedButton,
  SegmentedButtons,
  SelectMenu,
} from './panel/PanelControls'
import { ELEMENT_KEYS, MAP_TABS, SCATTER_ELEMENTS, TAB_KEYS } from './panel/mapPanelLayout'
import { HABITAT_FIELDS } from './habitat/habitatFields'

const formatPercent = (value) => `${value}%`

// Full names for the scatter cards (the picker buttons use short ones).
const ELEMENT_TITLES = {
  moss: 'Moss',
  flowers: 'Wood anemones',
  leaves: 'Fallen leaves',
  twigs: 'Twigs & branches',
  pebbles: 'Pebbles',
  mushrooms: 'Mushrooms',
}

const FIELD_OPTIONS = [['off', 'Off'], ...HABITAT_FIELDS]
const PREVIEW_OPTIONS = [['off', 'Off'], ['height', 'Height'], ...HABITAT_FIELDS, ['tiles', 'Tile borders']]
const isField = (preview) => HABITAT_FIELDS.some(([id]) => id === preview)
const formatDegrees = (value) => `${value}°`

/**
 * Map tab controls, in tabs: the ground's shape, habitat, ground cover,
 * paths, and debug previews.
 * status: { loaded, pending, refreshing, focus: [x, z], ground } from the
 * scene. habitatSettling: habitat changes are still on their way to the
 * world. onResetKeys({ ground, cover, view, habitat: [...keys] }) restores
 * just those settings to their defaults; onReset restores everything.
 */
export default function MapPanel({
  ground,
  view,
  cover,
  habitat,
  habitatSettling,
  status,
  onGroundChange,
  onViewChange,
  onCoverChange,
  onHabitatChange,
  onResetKeys,
  onReset,
}) {
  const [tab, setTab] = useState('terrain')
  const [element, setElement] = useState('moss')

  const setGround = (key) => (value) => onGroundChange(key, value)
  const setView = (key) => (value) => onViewChange(key, value)
  const setGroup = (group, key) => (value) => onCoverChange(group, { ...cover[group], [key]: value })
  const habitatSlider = (label, key, min, max, step, format = formatPercent) => (
    <LabeledSlider
      label={label}
      value={habitat[key]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={(value) => onHabitatChange(key, value)}
    />
  )

  const percentSlider = (label, value, onChange, max = 200) => (
    <LabeledSlider
      label={label}
      value={value}
      min={0}
      max={max}
      step={5}
      format={formatPercent}
      onChange={onChange}
    />
  )

  // Enable + Amount for one ground-cover group.
  const coverAmount = (id) => (
    <>
      <EnableToggle checked={cover[id].on} onChange={setGroup(id, 'on')} />
      {cover[id].on && percentSlider('Amount', cover[id].amount, setGroup(id, 'amount'), 100)}
    </>
  )

  const elementControls = {
    moss: coverAmount('moss'),
    flowers: coverAmount('flowers'),
    twigs: coverAmount('twigs'),
    leaves: (
      <>
        {coverAmount('leaves')}
        {cover.leaves.on && (
          <AdvancedSection>
            {percentSlider('Autumn colours', cover.autumn, (value) => onCoverChange('autumn', value), 100)}
          </AdvancedSection>
        )}
      </>
    ),
    pebbles: percentSlider('Amount', ground.pebbles, setGround('pebbles'), 100),
    mushrooms: (
      <>
        {coverAmount('mushrooms')}
        <EnableToggle
          label="Fly agaric (needs the ant hill)"
          checked={cover.flyAgaric}
          onChange={(value) => onCoverChange('flyAgaric', value)}
        />
      </>
    ),
  }

  return (
    <aside className="noise-panel voxel-panel basic-voxel-panel">
      <div className="panel-title">
        <h2>Forest Floor</h2>
      </div>

      <SegmentedButtons items={MAP_TABS} value={tab} onChange={setTab} label="Forest floor settings" />

      <div className="panel-actions">
        <ResetButton
          label="Reset Tab"
          onReset={() => onResetKeys(TAB_KEYS[tab])}
          disabled={Object.keys(TAB_KEYS[tab]).length === 0}
        />
        <ResetButton label="Reset All" onReset={onReset} />
        <SeedButton onSeed={setGround('seed')} />
      </div>

      {tab === 'terrain' && (
        <>
          <p className="section-note">
            Real scale: one tile is 20 × 20 cm. Choose a body under <strong>View as</strong>; the
            world stays the same, only the eyes and the way you move change.
          </p>
          <ControlCard title="Ground shape">
            <LabeledSlider
              label="World seed"
              value={ground.seed}
              min={0}
              max={999}
              step={1}
              format={(value) => value}
              onChange={setGround('seed')}
            />
            {percentSlider('Slopes', ground.slopes, setGround('slopes'))}
            {percentSlider('Bumps & hollows', ground.bumps, setGround('bumps'))}
            <AdvancedSection>
              {percentSlider('Warp', ground.warp, setGround('warp'))}
              {percentSlider('Fine grain', ground.grain, setGround('grain'))}
            </AdvancedSection>
          </ControlCard>
        </>
      )}

      {tab === 'habitat' && (
        <>
          <p className="section-note">
            Moisture, sunlight, shade and wind decide where moss, mushrooms, flowers and leaves
            settle. The world updates a moment after you stop adjusting.
          </p>
          <SelectMenu
            label="Show field"
            value={isField(view.preview) ? view.preview : 'off'}
            options={FIELD_OPTIONS}
            onChange={setView('preview')}
          />
          <p className="section-note" aria-live="polite">
            {habitatSettling ? 'Updating habitat…' : '\u00a0'}
          </p>
          <ControlCard title="Moisture">
            {habitatSlider('Scale', 'moistureScale', 8, 120, 2, (value) => `${value} cm`)}
            {habitatSlider('Contrast', 'moistureContrast', 0, 200, 5)}
            {habitatSlider('Overall wetness', 'wetness', 0, 100, 5)}
          </ControlCard>
          <ControlCard title="Sunlight">
            {habitatSlider('Sun direction', 'sunDirection', 0, 359, 1, formatDegrees)}
            {habitatSlider('Sun elevation', 'sunElevation', 5, 90, 1, formatDegrees)}
            {habitatSlider('Light threshold', 'lightThreshold', 0, 100, 5)}
          </ControlCard>
          <ControlCard title="Wind">
            {habitatSlider('Direction', 'windDirection', 0, 355, 5, formatDegrees)}
            {habitatSlider('Strength', 'windStrength', 0, 100, 5)}
            {habitatSlider('Variation', 'windVariation', 0, 100, 5)}
          </ControlCard>
          <ControlCard title="Terrain influence">
            {habitatSlider('Slope influence', 'slopeInfluence', 0, 200, 10)}
            {habitatSlider('Concavity influence', 'concavityInfluence', 0, 200, 10)}
          </ControlCard>
          <p className="section-note">
            Tree trunks shade and dampen the ground around them. The ant hill brings ant trails,
            and the fly agaric grows beside it.
          </p>
          <ControlCard title="Trees & creatures">
            <EnableToggle label="Tree trunks" checked={ground.trunks} onChange={setGround('trunks')} />
            {ground.trunks && (
              <LabeledSlider
                label="Trunk spacing"
                value={ground.trunkSpacing}
                min={2}
                max={6}
                step={0.5}
                format={(value) => `${value.toFixed(1)} m`}
                onChange={setGround('trunkSpacing')}
              />
            )}
            <EnableToggle label="Ant hill" checked={ground.antHill} onChange={setGround('antHill')} />
          </ControlCard>
          <ControlCard title="Atmosphere">
            {percentSlider('Haze', view.haze, setView('haze'), 100)}
            {percentSlider('Dappled light', view.dapple, setView('dapple'), 100)}
          </ControlCard>
        </>
      )}

      {tab === 'scatter' && (
        <>
          <SegmentedButtons
            items={SCATTER_ELEMENTS}
            value={element}
            onChange={setElement}
            className="panel-tabs element-picker"
            label="Ground cover element"
          />
          <ControlCard
            title={ELEMENT_TITLES[element]}
            action={
              <ResetButton small label="Reset" onReset={() => onResetKeys(ELEMENT_KEYS[element])} />
            }
          >
            {elementControls[element]}
          </ControlCard>
        </>
      )}

      {tab === 'paths' && (
        <p className="section-note">
          No path controls yet. Ant trails are drawn from the ant hill (Habitat); rivers and roads
          will get their settings here.
        </p>
      )}

      {tab === 'debug' && (
        <>
          <ControlCard title="Rendering">
            <SelectMenu
              label="Preview"
              value={view.preview}
              options={PREVIEW_OPTIONS}
              onChange={setView('preview')}
            />
            <LabeledSlider
              label="Detail distance"
              value={view.distance}
              min={3}
              max={5}
              step={1}
              format={(value) => `${value} tiles`}
              onChange={setView('distance')}
            />
          </ControlCard>
          <p className="section-note">
            Position {status.focus[0].toFixed(2)}, {status.focus[1].toFixed(2)} m · ground{' '}
            {(status.ground * 100).toFixed(1)} cm
            <br />
            Tiles {status.near ?? status.loaded} near
            {status.middle > 0 ? ` · ${status.middle} middle` : ''}
            {status.pending > 0 ? ` · ${status.pending} building` : ''}
            {status.refreshing > 0 ? ` · ${status.refreshing} refreshing habitat` : ''}
          </p>
        </>
      )}
    </aside>
  )
}
