import { useState } from 'react'
import { ControlCard, EnableToggle, LabeledSlider, SegmentedButtons } from '../panel/PanelControls'
import { SPEEDS, formatClock } from './dayCycle'

const TABS = [['day', 'Day & night']]
const formatPercent = (value) => `${value}%`
const formatDegrees = (value) => `${Math.round(value)}°`

/**
 * The Simulation panel: Start / End, live readouts, and the simulation's
 * settings by tab. settings: { day }; status: the engine's snapshot
 * (running, blend, time, sun, temperatures, activity).
 */
export default function SimulationPanel({ settings, status, onChange, onStart, onEnd, onTime }) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('day')
  const day = settings.day
  const setDay = (key) => (value) => onChange('day', { ...day, [key]: value })
  const daySlider = (label, key, min, max, step, format = formatPercent) => (
    <LabeledSlider label={label} value={day[key]} min={min} max={max} step={step} format={format} onChange={setDay(key)} />
  )
  const running = status.running

  return (
    <section className="noise-panel basic-voxel-panel sim-panel" aria-labelledby="sim-title">
      <div className="panel-title sim-head">
        <h2 id="sim-title">Simulation</h2>
        <button
          type="button"
          className="layer-add card-reset"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? 'Less' : 'More'}
        </button>
      </div>
      <div className="panel-actions sim-actions">
        <button type="button" className="layer-add" onClick={onStart} disabled={running}>
          Start
        </button>
        <button type="button" className="layer-add" onClick={onEnd} disabled={!running}>
          End
        </button>
        <button
          type="button"
          className="layer-add"
          onClick={() => setDay('playing')(!day.playing)}
          disabled={!running}
          aria-pressed={!day.playing}
        >
          {day.playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <p className="section-note sim-readout" aria-live="polite">
        {running
          ? `${formatClock(status.time)} · air ${status.air.toFixed(0)} °C · ground ${status.surface.toFixed(0)} °C · ` +
            `butterflies ${Math.round(status.butterflies * 100)}% · ants ${Math.round(status.ants * 100)}%`
          : 'Not running. Set it up, then press Start; End fades back to the usual forest.'}
      </p>
      {open && (
        <>
          <SegmentedButtons items={TABS} value={tab} onChange={setTab} label="Simulation settings" />
          {tab === 'day' && (
            <>
              <ControlCard title="Clock">
                <LabeledSlider
                  label="Time of day"
                  value={Math.round(status.time * 12) / 12}
                  min={0}
                  max={23.99}
                  step={1 / 12}
                  format={formatClock}
                  onChange={onTime}
                />
                <span className="control-label sim-label">Simulation speed</span>
                <SegmentedButtons
                  items={SPEEDS.map((speed) => [speed, `${speed}×`])}
                  value={day.speed}
                  onChange={setDay('speed')}
                  label="Simulation speed"
                />
                {daySlider('Day length', 'dayLength', 1, 60, 1, (value) => `${value} min`)}
                {daySlider('Sunrise', 'sunrise', 3, 10, 0.25, formatClock)}
                {daySlider('Sunset', 'sunset', 15, 22, 0.25, formatClock)}
              </ControlCard>
              <ControlCard title="Light">
                {daySlider('Sun intensity', 'sunIntensity', 0, 200, 5)}
                {daySlider('Moonlight intensity', 'moonIntensity', 0, 300, 5)}
                <EnableToggle label="Manual sun" checked={day.manualSun} onChange={setDay('manualSun')} />
                {day.manualSun && (
                  <>
                    {daySlider('Sun azimuth', 'azimuth', 0, 359, 1, formatDegrees)}
                    {daySlider('Sun elevation', 'elevation', -15, 90, 1, formatDegrees)}
                  </>
                )}
                {running && !day.manualSun && (
                  <p className="section-note">
                    Sun at {formatDegrees(status.sunAzimuth % 360)}, {formatDegrees(status.sunElevation)} up.
                  </p>
                )}
              </ControlCard>
              <p className="section-note">
                Day length is real minutes per day at 1×. Flowers close in the dark; butterflies fly in
                warm daylight; ants forage when it's mild, mostly mornings and evenings.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}
