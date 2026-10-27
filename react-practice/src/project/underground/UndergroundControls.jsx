import { ControlCard, EnableToggle, LabeledSlider, SegmentedButtons } from '../panel/PanelControls'

const VIEWS = [
  ['surface', 'Surface'],
  ['xray', 'X-ray'],
  ['section', 'Cross-section'],
]
const ROOT_COLORS = [
  ['natural', 'Natural'],
  ['reference', 'Glow'],
]

/**
 * The Underground tab: the X-ray view and the tree roots. locked: not in
 * the free view, so only the surface view is offered.
 * stats: { trees, surfaceTrees, pending, segments, triangles, fine, perLevel }
 * from the roots; waterStats: { particles, pockets, tableBelow } from the water.
 */
export default function UndergroundControls({ underground, locked, onChange, settling, stats, waterStats }) {
  const set = (key) => (value) => onChange(key, value)
  const slider = (label, key, min, max, step, format) => (
    <LabeledSlider
      label={label}
      value={underground[key]}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={set(key)}
    />
  )

  return (
    <>
      <p className="section-note">
        X-ray turns the ground see-through to show what grows beneath it; the cross-section cuts the
        world in front of you, so the forest and the roots in the dark below are seen together. Press{' '}
        <strong>U</strong> to switch. Both are views of the free camera, which can follow you underground in X-ray.
      </p>
      {locked && <p className="section-note">Choose Free view to see X-ray or the cross-section.</p>}
      <SegmentedButtons
        items={VIEWS}
        value={underground.view}
        onChange={(view) => onChange('view', view)}
        label="Underground view"
        disabled={locked}
      />

      <ControlCard title="X-ray">
        {slider('Ground opacity', 'opacity', 0, 60, 1, (value) => `${value}%`)}
        {slider('Depth (free view)', 'depth', 0, 100, 1, (value) => `${value} cm`)}
        <EnableToggle label="Depth guides (10 · 25 · 50 · 100 cm)" checked={underground.guides} onChange={set('guides')} />
      </ControlCard>

      <ControlCard title="Tree roots">
        <EnableToggle label="Roots" checked={underground.roots} onChange={set('roots')} />
        {underground.view === 'section' ? (
          <p className="section-note">The cross-section shows the roots glowing, as in the reference.</p>
        ) : (
          <SegmentedButtons
            items={ROOT_COLORS}
            value={underground.colors}
            onChange={set('colors')}
            label="Root colours"
          />
        )}
        {slider('Surface roots', 'surface', 0, 8, 1, (value) => value)}
        {slider('Deep roots', 'deep', 2, 10, 1, (value) => value)}
        {slider('Steepness', 'steepness', 0, 1, 0.05, (value) => value.toFixed(2))}
        {slider('Root depth', 'rootDepth', 0.4, 1.5, 0.1, (value) => `${value.toFixed(1)} m`)}
        {slider('Root reach', 'reach', 0.5, 2.5, 0.1, (value) => `${value.toFixed(1)} m`)}
        {slider('Branching', 'branching', 0, 0.6, 0.01, (value) => value.toFixed(2))}
        {slider('Fine roots', 'fine', 0, 100, 5, (value) => `${value}%`)}
        <p className="section-note">
          {settling
            ? 'Regrowing roots…'
            : underground.view !== 'surface'
              ? `${stats.trees} trees with roots${stats.pending ? ` · ${stats.pending} growing` : ''} · ` +
                `${stats.segments.toLocaleString()} segments · ${stats.triangles.toLocaleString()} triangles · ` +
                `${stats.fine.toLocaleString()} fine roots · ` +
                stats.perLevel.map((count, level) => `L${level} ${count}`).join(' ')
              : `${stats.surfaceTrees} trees with surface roots. The roots underground are grown only while X-ray is on.`}
        </p>
      </ControlCard>

      <ControlCard title="Water">
        <EnableToggle label="Water in the ground" checked={underground.water} onChange={set('water')} />
        {slider('Water table depth', 'tableDepth', 0.6, 2.5, 0.1, (value) => `${value.toFixed(1)} m`)}
        {slider('Pockets', 'pockets', 0, 100, 5, (value) => `${value}%`)}
        {slider('Particles', 'particles', 0, 200, 10, (value) => `${value}%`)}
        <EnableToggle label="Show the vector field" checked={underground.showField} onChange={set('showField')} />
        <p className="section-note">
          {!underground.water
            ? 'No water in the ground.'
            : underground.view === 'surface'
              ? 'Water rises from the water table and from pockets of wet soil toward the tree roots, as a particle system pushed by a vector field. Switch to X-ray or the cross-section to see it.'
              : `Water table ${waterStats?.tableBelow != null ? `${waterStats.tableBelow.toFixed(2)} m` : '…'} below where you look · ` +
                `${waterStats?.pockets ?? 0} pockets emitting · ${(waterStats?.particles ?? 0).toLocaleString()} particles. ` +
                'Wetter soil (Habitat tab) sends up more water.'}
        </p>
      </ControlCard>
    </>
  )
}
