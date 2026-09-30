import { useState } from 'react'
import ShaderStudyCanvas from './ShaderStudyCanvas'
import { BIOME_SHADER_DEFAULTS } from '../shaders/biomeShader'
import { DISTANCE_FOG_DEFAULTS } from '../shaders/distanceFogShader'
import { FRESNEL_SHADER_DEFAULTS } from '../shaders/fresnelShader'
import { HEIGHT_GRADIENT_DEFAULTS } from '../shaders/heightGradientShader'
import { PROCEDURAL_NOISE_DEFAULTS } from '../shaders/proceduralNoiseShader'
import {
  DEFAULT_SHADER_STUDY_ID,
  getShaderStudy,
  SHADER_STUDIES,
} from '../shaders/shaderStudies'
import { SLOPE_SHADER_DEFAULTS } from '../shaders/slopeShader'
import { VERTEX_DISPLACEMENT_DEFAULTS } from '../shaders/vertexDisplacementShader'

function RangeControl({ label, value, displayValue, ...inputProps }) {
  return (
    <label className="control">
      <span className="control-header">
        <span>{label}</span>
        <span className="control-value">{displayValue ?? value}</span>
      </span>
      <input type="range" value={value} {...inputProps} />
    </label>
  )
}

function ToggleControl({ label, checked, onChange }) {
  return (
    <label className="control-inline shader-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  )
}

function ColorControl({ label, value, onChange }) {
  return (
    <label className="control-inline shader-color-control">
      <span>{label}</span>
      <input type="color" value={value} onChange={onChange} />
    </label>
  )
}

export default function Week4Scene() {
  const [selectedStudyId, setSelectedStudyId] = useState(
    DEFAULT_SHADER_STUDY_ID,
  )
  const [settings, setSettings] = useState(() => ({
    heightGradient: { ...HEIGHT_GRADIENT_DEFAULTS },
    slope: { ...SLOPE_SHADER_DEFAULTS },
    biome: { ...BIOME_SHADER_DEFAULTS },
    displacement: { ...VERTEX_DISPLACEMENT_DEFAULTS },
    fresnel: { ...FRESNEL_SHADER_DEFAULTS },
    fog: { ...DISTANCE_FOG_DEFAULTS },
    noise: { ...PROCEDURAL_NOISE_DEFAULTS },
  }))
  const selectedStudy = getShaderStudy(selectedStudyId)

  const updateSetting = (study, property, value) => {
    setSettings((current) => ({
      ...current,
      [study]: {
        ...current[study],
        [property]: value,
      },
    }))
  }

  return (
    <main className="shape-canvas-workspace">
      <ShaderStudyCanvas
        activeStudyId={selectedStudy.id}
        settings={settings}
      />

      <aside className="panel week4-shader-panel">
        <div className="panel-title">
          <h2>Shader Studies</h2>
          <span className="panel-badge">{selectedStudy.modifies}</span>
        </div>

        <section className="panel-section">
          <label className="control">
            <span className="control-label">Shader strategy</span>
            <select
              value={selectedStudyId}
              onChange={(event) => setSelectedStudyId(event.target.value)}
            >
              {SHADER_STUDIES.map((study) => (
                <option key={study.id} value={study.id}>
                  {study.label}
                </option>
              ))}
            </select>
          </label>

          <div className="shader-study-summary" aria-live="polite">
            <span className="shader-study-kicker">Selected study</span>
            <strong>{selectedStudy.label}</strong>
            <p>{selectedStudy.description}</p>
          </div>

          <dl className="shader-study-meta">
            <div>
              <dt>Input</dt>
              <dd>{selectedStudy.inputs}</dd>
            </div>
            <div>
              <dt>Modifies</dt>
              <dd>{selectedStudy.modifies}</dd>
            </div>
          </dl>
        </section>

        {selectedStudyId === 'height-gradient' && (
          <section className="panel-section shader-study-controls">
            <h3>Height Gradient Controls</h3>
            <RangeControl
              label="Gradient intensity"
              min="0"
              max="1"
              step="0.05"
              value={settings.heightGradient.intensity}
              displayValue={settings.heightGradient.intensity.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'heightGradient',
                  'intensity',
                  Number(event.target.value),
                )
              }
            />
            <RangeControl
              label="Transition smoothness"
              min="0"
              max="1"
              step="0.05"
              value={settings.heightGradient.smoothness}
              displayValue={settings.heightGradient.smoothness.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'heightGradient',
                  'smoothness',
                  Number(event.target.value),
                )
              }
            />
            <RangeControl
              label="Minimum height"
              min="-50"
              max="80"
              step="1"
              value={settings.heightGradient.minHeight}
              onChange={(event) =>
                updateSetting(
                  'heightGradient',
                  'minHeight',
                  Math.min(
                    Number(event.target.value),
                    settings.heightGradient.maxHeight - 1,
                  ),
                )
              }
            />
            <RangeControl
              label="Maximum height"
              min="0"
              max="150"
              step="1"
              value={settings.heightGradient.maxHeight}
              onChange={(event) =>
                updateSetting(
                  'heightGradient',
                  'maxHeight',
                  Math.max(
                    Number(event.target.value),
                    settings.heightGradient.minHeight + 1,
                  ),
                )
              }
            />
            <div className="height-gradient-zones" aria-label="Height zones">
              <span title="Roots" />
              <span title="Moss and lower trunk" />
              <span title="Middle trunk city" />
              <span title="Branches" />
              <span title="Canopy" />
            </div>
          </section>
        )}

        {selectedStudyId === 'slope-based' && (
          <section className="panel-section shader-study-controls">
            <h3>Slope Controls</h3>
            <RangeControl
              label="Slope threshold 1"
              min="0.05"
              max="0.75"
              step="0.01"
              value={settings.slope.threshold1}
              displayValue={settings.slope.threshold1.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'slope',
                  'threshold1',
                  Math.min(
                    Number(event.target.value),
                    settings.slope.threshold2 - 0.01,
                  ),
                )
              }
            />
            <RangeControl
              label="Slope threshold 2"
              min="0.25"
              max="0.95"
              step="0.01"
              value={settings.slope.threshold2}
              displayValue={settings.slope.threshold2.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'slope',
                  'threshold2',
                  Math.max(
                    Number(event.target.value),
                    settings.slope.threshold1 + 0.01,
                  ),
                )
              }
            />
            <RangeControl
              label="Transition softness"
              min="0.01"
              max="0.25"
              step="0.01"
              value={settings.slope.softness}
              displayValue={settings.slope.softness.toFixed(2)}
              onChange={(event) =>
                updateSetting('slope', 'softness', Number(event.target.value))
              }
            />
            <div className="slope-gradient-zones" aria-label="Slope zones">
              <span title="Flat moss and vegetation" />
              <span title="Medium earthy slopes" />
              <span title="Steep rock and bark" />
            </div>
          </section>
        )}

        {selectedStudyId === 'biome' && (
          <section className="panel-section shader-study-controls">
            <h3>Biome Shader Controls</h3>
            <ToggleControl
              label="Visualize raw height + slope"
              checked={settings.biome.debugValues}
              onChange={(event) =>
                updateSetting('biome', 'debugValues', event.target.checked)
              }
            />
            <p className="shader-control-help">
              Debug colors: red is height and green is slope.
            </p>
          </section>
        )}

        {selectedStudyId === 'vertex-displacement' && (
          <section className="panel-section shader-study-controls">
            <h3>Vertex Displacement Controls</h3>
            <RangeControl
              label="Displacement strength"
              min="0"
              max="0.15"
              step="0.005"
              value={settings.displacement.strength}
              displayValue={settings.displacement.strength.toFixed(3)}
              onChange={(event) =>
                updateSetting(
                  'displacement',
                  'strength',
                  Number(event.target.value),
                )
              }
            />
            <RangeControl
              label="Animation speed"
              min="0"
              max="2"
              step="0.05"
              value={settings.displacement.speed}
              displayValue={settings.displacement.speed.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'displacement',
                  'speed',
                  Number(event.target.value),
                )
              }
            />
            <RangeControl
              label="Noise scale"
              min="0.5"
              max="6"
              step="0.1"
              value={settings.displacement.noiseScale}
              displayValue={settings.displacement.noiseScale.toFixed(1)}
              onChange={(event) =>
                updateSetting(
                  'displacement',
                  'noiseScale',
                  Number(event.target.value),
                )
              }
            />
            <ToggleControl
              label="Pause animation"
              checked={settings.displacement.paused}
              onChange={(event) =>
                updateSetting('displacement', 'paused', event.target.checked)
              }
            />
          </section>
        )}

        {selectedStudyId === 'fresnel-glow' && (
          <section className="panel-section shader-study-controls">
            <h3>Fresnel Glow Controls</h3>
            <RangeControl
              label="Fresnel power"
              min="1"
              max="8"
              step="0.1"
              value={settings.fresnel.power}
              displayValue={settings.fresnel.power.toFixed(1)}
              onChange={(event) =>
                updateSetting(
                  'fresnel',
                  'power',
                  Number(event.target.value),
                )
              }
            />
            <RangeControl
              label="Glow intensity"
              min="0"
              max="2"
              step="0.05"
              value={settings.fresnel.intensity}
              displayValue={settings.fresnel.intensity.toFixed(2)}
              onChange={(event) =>
                updateSetting(
                  'fresnel',
                  'intensity',
                  Number(event.target.value),
                )
              }
            />
            <ColorControl
              label="Glow color"
              value={settings.fresnel.color}
              onChange={(event) =>
                updateSetting('fresnel', 'color', event.target.value)
              }
            />
          </section>
        )}

        {selectedStudyId === 'distance-fog' && (
          <section className="panel-section shader-study-controls">
            <h3>Distance Fog Controls</h3>
            <RangeControl
              label="Fog start distance"
              min="0"
              max="30"
              step="1"
              value={settings.fog.start}
              onChange={(event) =>
                updateSetting(
                  'fog',
                  'start',
                  Math.min(Number(event.target.value), settings.fog.end - 1),
                )
              }
            />
            <RangeControl
              label="Fog end distance"
              min="5"
              max="50"
              step="1"
              value={settings.fog.end}
              onChange={(event) =>
                updateSetting(
                  'fog',
                  'end',
                  Math.max(Number(event.target.value), settings.fog.start + 1),
                )
              }
            />
            <RangeControl
              label="Fog density"
              min="0"
              max="1"
              step="0.05"
              value={settings.fog.density}
              displayValue={settings.fog.density.toFixed(2)}
              onChange={(event) =>
                updateSetting('fog', 'density', Number(event.target.value))
              }
            />
            <ColorControl
              label="Fog color"
              value={settings.fog.color}
              onChange={(event) =>
                updateSetting('fog', 'color', event.target.value)
              }
            />
          </section>
        )}

        {selectedStudyId === 'procedural-noise' && (
          <section className="panel-section shader-study-controls">
            <h3>Procedural Noise Controls</h3>
            <RangeControl
              label="Noise scale"
              min="1"
              max="12"
              step="0.1"
              value={settings.noise.scale}
              displayValue={settings.noise.scale.toFixed(1)}
              onChange={(event) =>
                updateSetting('noise', 'scale', Number(event.target.value))
              }
            />
            <RangeControl
              label="Noise strength"
              min="0"
              max="0.5"
              step="0.01"
              value={settings.noise.strength}
              displayValue={settings.noise.strength.toFixed(2)}
              onChange={(event) =>
                updateSetting('noise', 'strength', Number(event.target.value))
              }
            />
            <RangeControl
              label="Noise contrast"
              min="0.5"
              max="3"
              step="0.05"
              value={settings.noise.contrast}
              displayValue={settings.noise.contrast.toFixed(2)}
              onChange={(event) =>
                updateSetting('noise', 'contrast', Number(event.target.value))
              }
            />
            <RangeControl
              label="Animation speed"
              min="0"
              max="2"
              step="0.05"
              value={settings.noise.speed}
              displayValue={settings.noise.speed.toFixed(2)}
              onChange={(event) =>
                updateSetting('noise', 'speed', Number(event.target.value))
              }
            />
          </section>
        )}

        <section className="panel-section shader-study-why">
          <h3>Why this shader?</h3>
          <p>{selectedStudy.why}</p>
        </section>
      </aside>
    </main>
  )
}
