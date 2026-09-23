import Slider from './Slider'

export default function SidePanel({ settings, onChange }) {
  const update = (key) => (value) => onChange({ ...settings, [key]: value })

  return (
    <aside className="panel">
      <div className="panel-title">
        <h2>Controls</h2>
        <span className="panel-badge">Cube</span>
      </div>

      <section className="panel-section">
        <h3>Transform</h3>
        <Slider
          label="Size"
          value={settings.size}
          min={0.2}
          max={2.5}
          step={0.05}
          onChange={update('size')}
        />
        <Slider
          label="Rotation speed"
          value={settings.rotationSpeed}
          min={0}
          max={3}
          step={0.05}
          onChange={update('rotationSpeed')}
        />
        <label className="control control-inline">
          <span className="control-label">Auto rotate</span>
          <input
            type="checkbox"
            checked={settings.autoRotate}
            onChange={(event) => update('autoRotate')(event.target.checked)}
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Material</h3>
        <label className="control control-inline">
          <span className="control-label">Color</span>
          <input
            type="color"
            value={settings.color}
            onChange={(event) => update('color')(event.target.value)}
          />
        </label>
      </section>

      <p className="panel-hint">
        Drag to orbit, scroll to zoom. Add a control by dropping another
        <code>&lt;Slider /&gt;</code> into this panel and a matching key into the
        settings object in <code>App.jsx</code>.
      </p>
    </aside>
  )
}
