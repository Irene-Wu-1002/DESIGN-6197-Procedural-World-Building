import { useState } from 'react'
import { VIEWPOINTS, VIEWPOINT_ORDER, summaryOf } from './viewpointConfig'

const ICONS = {
  free: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 15 6h-2v5h5V9l3.5 3-3.5 3v-2h-5v5h2L12 21.5 9 18h2v-5H6v2l-3.5-3L6 9v2h5V6H9Z" />
    </svg>
  ),
  butterfly: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.3 8.5C9.6 4.8 6.4 3 3.6 3.6 1.9 4 2 6.5 3 8.6c.8 1.6 2.3 2.6 4 2.9-1.9.6-3 2-2.8 3.7.3 2.4 3 3.6 5 1.6 1-1 1.7-2.7 2.1-4.3V8.5Zm1.4 0c1.7-3.7 4.9-5.5 7.7-4.9 1.7.4 1.6 2.9.6 5-.8 1.6-2.3 2.6-4 2.9 1.9.6 3 2 2.8 3.7-.3 2.4-3 3.6-5 1.6-1-1-1.7-2.7-2.1-4.3V8.5Z" />
      <path d="M12 7.5v11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  ant: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="17.5" cy="13" rx="3.6" ry="2.8" />
      <ellipse cx="11.6" cy="12.5" rx="2.3" ry="1.5" />
      <circle cx="6.6" cy="11.4" r="2.2" />
      <path
        d="M5.4 9.6 3.5 6.2 1.8 7M7.5 9.5l.6-3.6-1.5-1.4M10 13.6l-2 4.2M12 13.9l.4 4.6M14 13l2 4.8M10.4 11.4 8.6 8M12.4 11.3l1-3.6M14.6 11.6l2.6-3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  ),
}

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="view-as-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/**
 * VIEW AS: choose a body, read what it perceives and how to move.
 * ui: the controller's UI state.
 */
export default function ViewAsPanel({ ui, settings, onSelect, onSettingChange, onViewBody }) {
  const [open, setOpen] = useState(true)
  const config = VIEWPOINTS[ui.id]
  // Camera modes (the butterfly: chase view by default, eye view optional).
  const hasModes = config.views?.modes?.length > 1
  const eyeView = hasModes && ui.cameraMode === 'eye'

  return (
    <section className="view-as" aria-labelledby="view-as-title" data-busy={ui.busy || undefined}>
      <div className="view-as-head">
        <h2 id="view-as-title">View as</h2>
        <button
          type="button"
          className="view-as-more"
          aria-expanded={open}
          aria-controls="view-as-details"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Less' : 'More'}
        </button>
      </div>

      <div className="view-as-choices" role="group" aria-labelledby="view-as-title">
        {VIEWPOINT_ORDER.map((id) => {
          const viewpoint = VIEWPOINTS[id]
          const selected = ui.id === id
          const pending = ui.target === id
          const locked = ui.busy && !selected
          return (
            <button
              key={id}
              type="button"
              className={`view-as-choice${pending ? ' is-pending' : ''}`}
              aria-pressed={selected}
              aria-disabled={locked || undefined}
              aria-keyshortcuts={viewpoint.shortcut}
              aria-label={`${viewpoint.label}, ${summaryOf(viewpoint).toLowerCase()}`}
              title={`${viewpoint.label} (key ${viewpoint.shortcut})`}
              onClick={() => {
                if (!locked) onSelect(id)
              }}
            >
              {ICONS[id]}
              <span>{viewpoint.label}</span>
            </button>
          )
        })}
      </div>

      <div className="view-as-summary">
        <strong>{config.label}</strong>
        <span>{summaryOf(config)}</span>
      </div>

      <div id="view-as-details" className="view-as-details" hidden={!open}>
        <p className="view-as-description">{config.description}</p>
        <dl className="view-as-controls" aria-label={`${config.label} controls`}>
          {(eyeView && config.eyeControls ? config.eyeControls : config.controls).map(([what, how]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>{how}</dd>
            </div>
          ))}
        </dl>
        <div className="view-as-actions">
          {hasModes && (
            <button
              type="button"
              className="view-as-body"
              aria-pressed={eyeView}
              aria-keyshortcuts="V"
              aria-disabled={ui.busy || undefined}
              onClick={() => {
                if (!ui.busy) onViewBody()
              }}
            >
              {eyeView ? 'Chase view' : 'Eye view'}
            </button>
          )}
          {config.body && !hasModes && (
            <button
              type="button"
              className="view-as-body"
              aria-pressed={ui.bodyView}
              aria-keyshortcuts="V"
              aria-disabled={(ui.busy && !ui.bodyView) || undefined}
              onClick={() => {
                if (!ui.busy || ui.bodyView) onViewBody()
              }}
            >
              {ui.bodyView ? 'Back to eye' : 'View body'}
            </button>
          )}
          <span className="view-as-key">
            Switch: 1 2 3{hasModes ? ` · ${eyeView ? 'Chase' : 'Eye'} view: V` : config.body ? ' · Body: V' : ''}
          </span>
        </div>
        <details className="view-as-options">
          <summary>Perception options</summary>
          <Check
            label="Compound-eye effect"
            hint="Ant facets toward the edges"
            checked={settings.compoundEye}
            onChange={(value) => onSettingChange('compoundEye', value)}
          />
          <Check
            label="Motion effects"
            hint="Banking, bob, flutter, antenna sway"
            checked={settings.motionEffects}
            onChange={(value) => onSettingChange('motionEffects', value)}
          />
          <Check
            label="Reduce motion"
            hint="Crossfade instead of camera moves"
            checked={settings.reducedMotion}
            onChange={(value) => onSettingChange('reducedMotion', value)}
          />
        </details>
      </div>
    </section>
  )
}
