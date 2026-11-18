import { useState } from 'react'
import { AdvancedSection, ControlCard, EnableToggle, LabeledSlider, ResetButton } from '../panel/PanelControls'
import { FLOWER_TYPES, MORPHOLOGY } from './ecologyConfig'

const percent = (value) => `${Math.round(value)}%`
const share = (value) => `${Math.round(value * 100)}%`
const compass = (degrees) => `${Math.round(((degrees % 360) + 360) % 360)}°`
const times = (value) => `×${value.toFixed(2)}`
const between = (low, high) => (value) => `${value.toFixed(2)} ${value < 0.97 ? low : value > 1.03 ? high : ''}`.trim()

// The followed butterfly's body: one slider per morphology value (same
// ranges a body is drawn from). Proboscis is shown in mm.
const BODY_SLIDERS = [
  { key: 'wingLength', label: 'Wing length', step: 0.01, format: times },
  { key: 'wingAspect', label: 'Wing shape', step: 0.01, format: between('broad', 'slender') },
  { key: 'body', label: 'Body size', step: 0.01, format: times },
  { key: 'darkness', label: 'Wing colour', step: 0.01, format: (v) => `${Math.round(v * 100)}% ${v < 0.34 ? 'pale' : v > 0.66 ? 'dark' : ''}`.trim() },
  { key: 'eye', label: 'Eye size', step: 0.01, format: times },
  { key: 'proboscis', label: 'Proboscis', step: 0.0001, format: (v) => `${(v * 1000).toFixed(1)} mm` },
]

/**
 * Flowers & butterflies: how many butterflies, the flowers they visit, the
 * scent on screen, and following one. settings: the ecology settings;
 * flowers: the Scatter flower settings (density, mix); stats / followed:
 * the ecology's readouts.
 */
export default function EcologyPanel({
  settings,
  flowers,
  stats,
  followed,
  following,
  onChange,
  onFlowersChange,
  onFollow,
  onNext,
  onStop,
  onMorphChange,
}) {
  const [open, setOpen] = useState(true)
  const set = (key) => (value) => onChange(key, value)
  const mix = flowers.mix ?? {}
  const setMix = (id) => (value) => onFlowersChange('mix', { ...mix, [id]: value })
  const windTo = stats ? stats.from + 180 : 0

  return (
    <section className="noise-panel basic-voxel-panel sim-panel eco-panel" aria-labelledby="eco-title">
      <div className="panel-title sim-head">
        <h2 id="eco-title">Flowers &amp; butterflies</h2>
        <button type="button" className="layer-add card-reset" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Less' : 'More'}
        </button>
      </div>
      <div className="panel-actions sim-actions eco-actions">
        <button type="button" className="layer-add" onClick={following ? onNext : onFollow} disabled={!stats?.butterflies}>
          {following ? 'Next butterfly' : 'Follow a butterfly'}
        </button>
        <button type="button" className="layer-add" onClick={onStop} disabled={!following}>
          Free view
        </button>
      </div>
      <p className="section-note sim-readout" aria-live="polite">
        {following && followed
          ? `Butterfly ${followed.index + 1}: ${followed.label}.`
          : stats
            ? `${stats.butterflies} butterflies · ${stats.flying} flying · ${stats.feeding} feeding. Click one to follow it.`
            : 'Butterflies appear once the forest floor has loaded.'}
      </p>
      {open && (
        <>
          <ControlCard title="Butterflies">
            <LabeledSlider label="Butterflies" value={settings.butterflies} min={0} max={12} step={1} format={(v) => v} onChange={set('butterflies')} />
            <EnableToggle label="Show flower scent" checked={settings.showScent} onChange={set('showScent')} />
          </ControlCard>
          <ControlCard title="Flowers">
            <LabeledSlider
              label="Flower density"
              value={flowers.amount}
              min={0}
              max={100}
              step={1}
              format={percent}
              onChange={(value) => onFlowersChange('amount', value)}
            />
            {FLOWER_TYPES.map((type) => (
              <LabeledSlider key={type.id} label={type.label} value={mix[type.id] ?? 0} min={0} max={100} step={5} format={percent} onChange={setMix(type.id)} />
            ))}
            <p className="section-note">
              Anemones are open cups anyone can drink from; bellflowers hold the most nectar at the
              bottom of a deep bell; campions smell strongest but hold little.
            </p>
          </ControlCard>
          <AdvancedSection>
            {following && followed?.morph ? (
              <ControlCard
                title={`Butterfly ${followed.index + 1}'s body`}
                action={<ResetButton small label="Reset" disabled={!followed.changed} onReset={() => onMorphChange(null)} />}
              >
                {BODY_SLIDERS.map(({ key, label, step, format }) => (
                  <LabeledSlider
                    key={key}
                    label={label}
                    value={followed.morph[key]}
                    min={MORPHOLOGY[key][0]}
                    max={MORPHOLOGY[key][1]}
                    step={step}
                    format={format}
                    onChange={(value) => onMorphChange({ [key]: value })}
                  />
                ))}
                <p className="section-note">
                  {followed.looks}. Its speed, turning, energy, warmth in the sun and how the wind pushes it all
                  follow from this body; Reset gives back the body it was born with.
                </p>
              </ControlCard>
            ) : (
              <p className="section-note">Follow a butterfly to change its body and see what it can do.</p>
            )}
            <LabeledSlider
              label="Scent particles shown"
              value={settings.scentDisplay}
              min={10}
              max={100}
              step={5}
              format={percent}
              onChange={set('scentDisplay')}
            />
            <LabeledSlider
              label="Air turbulence"
              value={settings.turbulence}
              min={0}
              max={60}
              step={5}
              format={percent}
              onChange={set('turbulence')}
            />
            <EnableToggle label="Show senses (developer)" checked={settings.debug} onChange={set('debug')} />
            {/* The numbers arrive with the next readout after switching on. */}
            {settings.debug && stats?.particles !== undefined && (
              <p className="section-note eco-debug">
                {stats.particles} / {stats.capacity} scent particles (emission ×{stats.emitScale.toFixed(2)}) · {stats.flowers} flowers
                {followed?.energy !== undefined &&
                  ` · energy ${share(followed.energy)} · body ${followed.temperature.toFixed(1)} °C · proboscis ${(followed.proboscis * 1000).toFixed(1)} mm · ` +
                    `scent ${followed.attraction.toFixed(3)}${followed.smelt ? ' (smelt)' : ''} · sees ${followed.seen} flowers · ` +
                    `visits ${followed.visits} (empty ${followed.empty}, out of reach ${followed.outOfReach}) · ` +
                    `likes ${FLOWER_TYPES.map((type, k) => `${type.short.toLowerCase()} ${followed.prefs[k].toFixed(2)}`).join(', ')}`}
                {followed?.morph &&
                  ` · body: wing ${followed.morph.wingLength.toFixed(2)} × aspect ${followed.morph.wingAspect.toFixed(2)}, girth ${followed.morph.body.toFixed(2)}, ` +
                    `dark ${followed.morph.darkness.toFixed(2)}, eye ${followed.morph.eye.toFixed(2)} → mass ${followed.derived.mass.toFixed(2)}, ` +
                    `wing loading ${followed.derived.wingLoading.toFixed(2)}, cruise ${followed.derived.speed.toFixed(2)} m/s, turn ${followed.derived.turnRate.toFixed(1)} rad/s, ` +
                    `flight ${(followed.derived.flightCost * 1000).toFixed(0)} mU/s of ${followed.derived.energyCapacity.toFixed(1)} U, ` +
                    `sun ×${followed.derived.absorb.toFixed(2)}, wind drift ×${followed.derived.windDrift.toFixed(2)}`}
              </p>
            )}
            <p className="section-note">
              Turbulence is how strongly eddies stir the air, as a share of the wind speed: scent leaves a
              flower as a narrow plume and opens into a cone downwind, wider and fainter with more
              turbulence. Shown particles are only a display: the butterflies smell all of them either way. The
              overlay draws each butterfly&apos;s field of view, its two scent-sampling spheres (pink when it
              smells a flower) and its target.
            </p>
          </AdvancedSection>
          {stats && (
            <p className="section-note">
              Wind from {compass(stats.from)}, so scent drifts toward {compass(windTo)} at {(stats.wind * 100).toFixed(0)} cm/s
              (Habitat › Wind, or Simulation › Weather while it runs). Butterflies smell it, fly upwind to find
              the flower, then need to see it. Rain and strong wind send them to shelter; they bask when cool
              and roost at night.
            </p>
          )}
        </>
      )}
    </section>
  )
}
