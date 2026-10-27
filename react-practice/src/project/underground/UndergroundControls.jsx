import { ControlCard, EnableToggle, LabeledSlider, SegmentedButtons } from '../panel/PanelControls'

const VIEWS = [
  ['surface', 'Surface'],
  ['xray', 'X-ray'],
]

/**
 * The Underground tab: the X-ray view and the tree roots.
 * stats: { trees, pending, segments, triangles, perLevel } from the roots.
 */
export default function UndergroundControls({ underground, onChange, settling, stats }) {
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
        X-ray turns the ground see-through to show what grows beneath it. Press <strong>U</strong> to
        switch. The free camera can follow you underground; the butterfly and the ant look through
        from the surface.
      </p>
      <SegmentedButtons
        items={VIEWS}
        value={underground.xray ? 'xray' : 'surface'}
        onChange={(view) => onChange('xray', view === 'xray')}
        label="Underground view"
      />

      <ControlCard title="X-ray">
        {slider('Ground opacity', 'opacity', 0, 60, 1, (value) => `${value}%`)}
        {slider('Depth (free view)', 'depth', 0, 60, 1, (value) => `${value} cm`)}
        <EnableToggle label="Depth guides (10 · 25 · 50 cm)" checked={underground.guides} onChange={set('guides')} />
      </ControlCard>

      <ControlCard title="Tree roots">
        <EnableToggle label="Roots" checked={underground.roots} onChange={set('roots')} />
        {slider('Root reach', 'reach', 0.5, 3, 0.1, (value) => `${value.toFixed(1)} m`)}
        {slider('Structural roots', 'structural', 3, 10, 1, (value) => value)}
        {slider('Branching', 'branching', 0, 0.4, 0.01, (value) => value.toFixed(2))}
        {slider('Depth bias', 'depthBias', 0, 1, 0.05, (value) => value.toFixed(2))}
        {slider('Sinker roots', 'sinkers', 0, 4, 1, (value) => value)}
        <p className="section-note">
          {settling
            ? 'Regrowing roots…'
            : underground.xray
              ? `${stats.trees} trees with roots${stats.pending ? ` · ${stats.pending} growing` : ''} · ` +
                `${stats.segments.toLocaleString()} segments · ${stats.triangles.toLocaleString()} triangles · ` +
                stats.perLevel.map((count, level) => `L${level} ${count}`).join(' ')
              : 'Roots are grown only while X-ray is on.'}
        </p>
      </ControlCard>
    </>
  )
}
