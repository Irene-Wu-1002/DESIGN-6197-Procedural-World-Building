/** Range slider with its label and current (formatted) value. */
export { default as LabeledSlider } from '../../components/Slider'

/** On/off checkbox with its label on the left. */
export function EnableToggle({ label = 'Enable', checked, onChange }) {
  return (
    <label className="control control-inline shader-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

/** Dropdown. options: [[value, label], ...] */
export function SelectMenu({ label, value, options, onChange }) {
  return (
    <label className="control">
      <span className="control-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Collapsible group for less-used controls; closed by default. */
export function AdvancedSection({ title = 'Advanced', children }) {
  return (
    <details className="advanced-section">
      <summary>{title}</summary>
      <div className="advanced-section-body">{children}</div>
    </details>
  )
}

/** Card with a title and an optional action (e.g. a reset) in its header. */
export function ControlCard({ title, action, children }) {
  return (
    <section className="control-section control-card">
      <header className="control-card-header">
        <span>{title}</span>
        {action}
      </header>
      <div className="control-section-body">{children}</div>
    </section>
  )
}

/** Button that puts a set of settings back to their defaults. */
export function ResetButton({ label, onReset, small = false, disabled = false }) {
  return (
    <button
      type="button"
      className={small ? 'layer-add card-reset' : 'layer-add'}
      onClick={onReset}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

/** Button that picks a new random seed (0–999). */
export function SeedButton({ label = 'Random Seed', onSeed }) {
  return (
    <button type="button" className="layer-add" onClick={() => onSeed(Math.floor(Math.random() * 1000))}>
      {label}
    </button>
  )
}

/** Segmented row of buttons; used for the tabs and the element picker. */
export function SegmentedButtons({ items, value, onChange, className = 'panel-tabs', label }) {
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={value === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
