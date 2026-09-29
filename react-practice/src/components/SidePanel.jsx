import Slider from './Slider'

const SHAPES = [
  { id: 'box', label: 'Box' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'cone', label: 'Cone' },
  { id: 'torus', label: 'Torus' },
  { id: 'octahedron', label: 'Octahedron' },
  { id: 'dodecahedron', label: 'Dodecahedron' },
  { id: 'torusKnot', label: 'Torus Knot' },
]

const GRADIENT_DIRECTIONS = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'radial', label: 'Radial' },
]

const MATERIALS = [
  { id: 'matte', label: 'Matte' },
  { id: 'plastic', label: 'Plastic' },
  { id: 'metal', label: 'Metal' },
  { id: 'brushed', label: 'Brushed Metal' },
  { id: 'chrome', label: 'Chrome' },
  { id: 'rubber', label: 'Rubber' },
  { id: 'ceramic', label: 'Ceramic' },
]

export default function SidePanel({ settings, onChange }) {
  const update = (key) => (value) => onChange({ ...settings, [key]: value })

  return (
    <aside className="panel">
      <div className="panel-title">
        <h2>Controls</h2>
        <span className="panel-badge">Object</span>
      </div>

      <section className="panel-section">
        <h3>Shape</h3>
        <label className="control">
          <span className="control-label">Geometry</span>
          <select
            value={settings.shape}
            onChange={(event) => update('shape')(event.target.value)}
          >
            {SHAPES.map((shape) => (
              <option key={shape.id} value={shape.id}>
                {shape.label}
              </option>
            ))}
          </select>
        </label>
      </section>

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
        <label className="control">
          <span className="control-label">Preset</span>
          <select
            value={settings.material}
            onChange={(event) => update('material')(event.target.value)}
          >
            {MATERIALS.map((material) => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </select>
        </label>
        <label className="control control-inline">
          <span className="control-label">Color A</span>
          <input
            type="color"
            value={settings.color}
            onChange={(event) => update('color')(event.target.value)}
          />
        </label>
        <label className="control control-inline">
          <span className="control-label">Color B</span>
          <input
            type="color"
            value={settings.colorEnd}
            onChange={(event) => update('colorEnd')(event.target.value)}
          />
        </label>
        <label className="control">
          <span className="control-label">Gradient</span>
          <select
            value={settings.gradientDirection}
            onChange={(event) =>
              update('gradientDirection')(event.target.value)
            }
          >
            {GRADIENT_DIRECTIONS.map((direction) => (
              <option key={direction.id} value={direction.id}>
                {direction.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <p className="panel-hint">
        Pick a shape, material, and gradient. Color A blends into Color B across
        the mesh.
      </p>
    </aside>
  )
}
