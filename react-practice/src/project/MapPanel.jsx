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
const PREVIEW_OPTIONS = [
  ['off', 'Off'],
  ['height', 'Height'],
  ...HABITAT_FIELDS,
  ['exclusion', 'Exclusion zones'],
  ['tiles', 'Tile borders'],
]
const formatMm = (value) => `${value.toFixed(1)} mm`
const isField = (preview) => HABITAT_FIELDS.some(([id]) => id === preview)
const formatDegrees = (value) => `${value}°`
const formatCm = (value) => `${value} cm`
const formatTenthCm = (value) => `${value.toFixed(1)} cm`
const FLOWER_DISTRIBUTIONS = [
  ['colonies', 'Colonies'],
  ['even', 'Even spacing'],
  ['random', 'Fully random'],
]

/**
 * Map tab controls, in tabs: the ground's shape, habitat, ground cover,
 * paths, and debug previews.
 * status: { loaded, pending, refreshing, focus: [x, z], ground } from the
 * scene. habitatSettling / coverSettling: habitat or ground-cover changes
 * are still on their way to the world. onResetKeys({ ground, cover, view, habitat: [...keys] }) restores
 * just those settings to their defaults; onReset restores everything.
 */
export default function MapPanel({
  ground,
  view,
  cover,
  habitat,
  habitatSettling,
  coverSettling,
  paths,
  pathsSettling,
  zonesShowing,
  status,
  onGroundChange,
  onViewChange,
  onCoverChange,
  onHabitatChange,
  onPathsChange,
  onShowZones,
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

  // A slider for one setting of a ground-cover group (moss, flowers).
  const groupSlider = (group) => (label, key, min, max, step, format = formatPercent) => (
    <LabeledSlider
      label={label}
      value={cover[group][key]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={setGroup(group, key)}
    />
  )
  const pathSlider = (label, key, min, max, step, format = formatPercent) => (
    <LabeledSlider
      label={label}
      value={paths[key]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={(value) => onPathsChange(key, value)}
    />
  )
  const setPath = (key) => (value) => onPathsChange(key, value)
  const mossSlider = groupSlider('moss')
  const flowerSlider = groupSlider('flowers')
  const leafSlider = groupSlider('leaves')
  const colonies = cover.flowers.distribution === 'colonies'

  // Enable + Amount for one ground-cover group.
  const coverAmount = (id) => (
    <>
      <EnableToggle checked={cover[id].on} onChange={setGroup(id, 'on')} />
      {cover[id].on && percentSlider('Amount', cover[id].amount, setGroup(id, 'amount'), 100)}
    </>
  )

  const elementControls = {
    moss: (
      <>
        <EnableToggle label="Enabled" checked={cover.moss.on} onChange={setGroup('moss', 'on')} />
        {cover.moss.on && (
          <>
            {mossSlider('Amount', 'amount', 0, 100, 1)}
            {mossSlider('Patch size', 'patchSize', 5, 80, 1, formatCm)}
            {mossSlider('Patch contrast', 'patchContrast', 0, 100, 5)}
            {mossSlider('Minimum spacing', 'minSpacing', 0.5, 3, 0.1, formatTenthCm)}
            {mossSlider('Moisture preference', 'moisturePreference', 0, 100, 5)}
            {mossSlider('Shade preference', 'shadePreference', 0, 100, 5)}
            {mossSlider('Concavity preference', 'concavityPreference', 0, 100, 5)}
            {mossSlider('Scale variation', 'scaleVariation', 0, 100, 5)}
            {mossSlider('Color variation', 'colorVariation', 0, 100, 5)}
            <AdvancedSection>
              {mossSlider('Noise scale', 'noiseScale', 10, 100, 5)}
              {mossSlider('Noise threshold', 'noiseThreshold', 0, 95, 5)}
              {mossSlider('Maximum slope', 'maxSlope', 5, 60, 1, formatDegrees)}
              {mossSlider('Random offset', 'randomOffset', 0, 999, 1, (value) => value)}
            </AdvancedSection>
            <p className="section-note">
              Amount is the share of ground inside moss patches. Ground below the noise threshold
              always stays bare soil.
            </p>
          </>
        )}
      </>
    ),
    flowers: (
      <>
        <EnableToggle label="Enabled" checked={cover.flowers.on} onChange={setGroup('flowers', 'on')} />
        {cover.flowers.on && (
          <>
            <SelectMenu
              label="Distribution"
              value={cover.flowers.distribution}
              options={FLOWER_DISTRIBUTIONS}
              onChange={setGroup('flowers', 'distribution')}
            />
            {flowerSlider('Amount', 'amount', 0, 100, 1)}
            {colonies && flowerSlider('Colony count', 'colonyCount', 0.5, 15, 0.5, (value) => `${value} / m²`)}
            {colonies && flowerSlider('Colony radius', 'colonyRadius', 2, 30, 1, formatCm)}
            {colonies && flowerSlider('Flowers per colony', 'flowersPerColony', 1, 40, 1, (value) => value)}
            {flowerSlider('Minimum flower spacing', 'minSpacing', 0.5, 5, 0.1, formatTenthCm)}
            {flowerSlider('Sunlight preference', 'sunlightPreference', 0, 100, 5)}
            {flowerSlider('Moisture preference', 'moisturePreference', 0, 100, 5)}
            {flowerSlider('Maximum slope', 'maxSlope', 5, 45, 1, formatDegrees)}
            {flowerSlider('Height variation', 'heightVariation', 0, 100, 5)}
            {flowerSlider('Scale variation', 'scaleVariation', 0, 100, 5)}
            {flowerSlider('Color variation', 'colorVariation', 0, 100, 5)}
            <AdvancedSection>
              {colonies && flowerSlider('Colony falloff', 'colonyFalloff', 0, 100, 5)}
              {flowerSlider('Seed offset', 'seedOffset', 0, 999, 1, (value) => value)}
              {flowerSlider('Noise influence', 'noiseInfluence', 0, 100, 5)}
            </AdvancedSection>
            <p className="section-note">
              Flowers like sunny, moderately moist, fairly flat ground. Noise influence leaves whole
              regions without flowers.
            </p>
          </>
        )}
      </>
    ),
    twigs: coverAmount('twigs'),
    leaves: (
      <>
        <EnableToggle label="Enabled" checked={cover.leaves.on} onChange={setGroup('leaves', 'on')} />
        {cover.leaves.on && (
          <>
            {leafSlider('Amount', 'amount', 0, 100, 1)}
            {leafSlider('Drift size', 'driftSize', 5, 100, 1, formatCm)}
            {leafSlider('Drift strength', 'driftStrength', 0, 100, 5)}
            {leafSlider('Wind influence', 'windInfluence', 0, 100, 5)}
            {leafSlider('Hollow preference', 'hollowPreference', 0, 100, 5)}
            {leafSlider('Obstacle accumulation', 'obstacleAccumulation', 0, 100, 5)}
            {leafSlider('Minimum spacing', 'minSpacing', 0, 3, 0.1, formatTenthCm)}
            {leafSlider('Scale variation', 'scaleVariation', 0, 100, 5)}
            {leafSlider('Rotation variation', 'rotationVariation', 0, 100, 5)}
            {leafSlider('Autumn color amount', 'autumn', 0, 100, 5)}
            <AdvancedSection>
              {leafSlider('Deposition noise scale', 'depositionNoiseScale', 10, 100, 5)}
              {leafSlider('Deposition threshold', 'depositionThreshold', 0, 95, 5)}
              {leafSlider('Wind variation', 'windVariation', 0, 100, 5)}
              {leafSlider('Overlap amount', 'overlapAmount', 0, 100, 5)}
              {leafSlider('Seed offset', 'seedOffset', 0, 999, 1, (value) => value)}
            </AdvancedSection>
            <p className="section-note">
              Leaves gather in drifts along the wind, in hollows, and beside and downwind of trunks,
              the ant hill, pebbles and branches. Neighbouring leaves share related colours.
            </p>
          </>
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
          <p className="section-note" aria-live="polite">
            {coverSettling ? 'Updating ground cover…' : '\u00a0'}
          </p>
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
        <>
          <p className="section-note">
            The ant trail runs from the ant hill to the fly agaric. Exclusion zones keep the trail,
            the landmarks and the start view clear: large things stay out, small things fade back
            in across the soft edge.
          </p>
          <p className="section-note" aria-live="polite">
            {pathsSettling ? 'Updating paths…' : '\u00a0'}
          </p>
          <ControlCard title="Ant trail">
            <EnableToggle label="Show ant trail" checked={paths.showTrail} onChange={setPath('showTrail')} />
            {paths.showTrail && (
              <>
                {pathSlider('Trail width', 'trailWidth', 0.4, 3, 0.1, formatTenthCm)}
                {pathSlider('Trail curvature', 'trailCurvature', 0, 100, 5)}
                {pathSlider('Trail darkness', 'trailDarkness', 0, 100, 5)}
                {pathSlider('Ground compression', 'compression', 0, 4, 0.1, formatMm)}
                {pathSlider('Clearing strength', 'clearing', 0, 100, 5)}
                {pathSlider('Small-detail amount', 'detail', 0, 100, 5)}
              </>
            )}
          </ControlCard>
          <ControlCard title="Pheromones">
            <EnableToggle
              label="Show pheromones"
              checked={paths.showPheromones}
              onChange={setPath('showPheromones')}
            />
            {pathSlider('Pheromone intensity', 'pheromoneIntensity', 0, 100, 5)}
            {pathSlider('Pheromone width', 'pheromoneWidth', 25, 300, 5)}
            <p className="section-note">
              Off: only the ant smells the trails. On: every view sees them.
            </p>
          </ControlCard>
          <ControlCard title="Exclusion zones">
            {pathSlider('Ant-hill clearance', 'antHillClearance', 0, 10, 0.5, formatTenthCm)}
            {pathSlider('Fly-agaric clearance', 'agaricClearance', 0, 15, 0.5, formatTenthCm)}
            {pathSlider('Camera-spawn clearance', 'spawnClearance', 0, 15, 0.5, formatTenthCm)}
            {pathSlider('Trail clearance', 'trailClearance', 0, 5, 0.5, formatTenthCm)}
            {pathSlider('Interaction-point clearance', 'interactionClearance', 0, 5, 0.5, formatTenthCm)}
            {pathSlider('Soft-edge distance', 'softEdge', 0, 10, 0.5, formatTenthCm)}
            <button type="button" className="layer-add" onClick={onShowZones} aria-pressed={zonesShowing}>
              {zonesShowing ? 'Showing exclusion zones…' : 'Show exclusion zones'}
            </button>
            <p className="section-note">
              Red: nothing large or small. Orange: small things fade back in. Interaction points
              are the tunnel entrances.
            </p>
          </ControlCard>
        </>
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
