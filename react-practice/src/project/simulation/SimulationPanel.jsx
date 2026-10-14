import { useState } from 'react'
import { ControlCard, EnableToggle, LabeledSlider, SegmentedButtons } from '../panel/PanelControls'
import { SPEEDS, formatClock } from './dayCycle'
import { WEATHER_PRESETS, weatherFromPreset } from './weather'
import { SEASONS } from './season'

const TABS = [
  ['day', 'Day & night'],
  ['weather', 'Weather'],
  ['season', 'Season'],
]
const SEASON_BUTTONS = Object.entries(SEASONS).map(([id, season]) => [id, season.label])
const times = (value) => `×${value.toFixed(2)}`
const PRESET_BUTTONS = Object.entries(WEATHER_PRESETS).map(([id, preset]) => [id, preset.label])
const percent = (value) => `${Math.round(value * 100)}%`
const formatPercent = (value) => `${value}%`
const formatDegrees = (value) => `${Math.round(value)}°`

/**
 * The Simulation panel: Start / End, live readouts, and the simulation's
 * settings by tab. settings: { day, weather, season }; status: the engine's
 * snapshot (running, blend, time, sun, temperatures, activity, weather).
 */
export default function SimulationPanel({ settings, status, onChange, onStart, onEnd, onTime }) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState('day')
  const running = status.running
  const day = settings.day
  const weather = settings.weather
  // Moving a weather slider makes it a custom weather (no preset lit).
  const setWeather = (key) => (value) => onChange('weather', { ...weather, preset: 'custom', [key]: value })
  const weatherSlider = (label, key, min, max, step, format) => (
    <LabeledSlider label={label} value={weather[key]} min={min} max={max} step={step} format={format} onChange={setWeather(key)} />
  )
  const stormy = weather.lightning > 0 || WEATHER_PRESETS[weather.preset]?.storm
  const season = settings.season
  const setSeason = (patch) => onChange('season', { ...season, ...patch })
  const seasonShown = running && status.season && status.season.weight > 0.01
  const setDay = (key) => (value) => onChange('day', { ...day, [key]: value })
  const daySlider = (label, key, min, max, step, format = formatPercent) => (
    <LabeledSlider label={label} value={day[key]} min={min} max={max} step={step} format={format} onChange={setDay(key)} />
  )

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
          {tab === 'season' && (
            <>
              <EnableToggle label="Use season" checked={season.apply} onChange={(apply) => setSeason({ apply })} />
              <SegmentedButtons
                items={SEASON_BUTTONS}
                value={season.from}
                onChange={(id) => setSeason({ from: id, to: id, blend: 0 })}
                className="panel-tabs element-picker"
                label="Season"
              />
              <ControlCard title="Season transition">
                <label className="control">
                  <span className="control-label">Blend toward</span>
                  <select value={season.to} onChange={(event) => setSeason({ to: event.target.value })}>
                    {SEASON_BUTTONS.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {season.to !== season.from && (
                  <LabeledSlider
                    label={`${SEASONS[season.from].label} → ${SEASONS[season.to].label}`}
                    value={season.blend}
                    min={0}
                    max={1}
                    step={0.05}
                    format={percent}
                    onChange={(blend) => setSeason({ blend })}
                  />
                )}
              </ControlCard>
              {seasonShown && (
                <p className="section-note">
                  Leaves in autumn colours {percent(status.season.autumn)} · fallen leaves {times(status.season.leaves)} ·
                  flowers {times(status.season.flowers)} · mushrooms {times(status.season.mushrooms)} · moss{' '}
                  {times(status.season.moss)} · soil wetness {percent(status.season.wetness)} · misty mornings{' '}
                  {percent(status.season.fog)} · daylight {status.season.dayLength.toFixed(1)} h (
                  {formatClock(status.sunrise)}–{formatClock(status.sunset)}) · sun warmth {percent(status.season.warmth)}
                </p>
              )}
              <p className="section-note">
                {season.apply
                  ? running
                    ? 'Cover grows or fades where it stands; nothing is regenerated.'
                    : 'Press Start to see the season.'
                  : 'Off: the forest as set in Scatter and the Day & night tab.'}
              </p>
            </>
          )}
          {tab === 'weather' && (
            <>
              <SegmentedButtons
                items={PRESET_BUTTONS}
                value={weather.preset}
                onChange={(id) => onChange('weather', weatherFromPreset(id, weather.transition))}
                className="panel-tabs element-picker weather-picker"
                label="Weather preset"
              />
              {running && (
                <p className="section-note">
                  Now: cloud {percent(status.cloud)} · rain {percent(status.rain)} · ground wet{' '}
                  {percent(status.wetness)}
                  {status.rainEnded ? ' · the rain has stopped (after rain)' : ''}
                </p>
              )}
              <ControlCard title="Sky and rain">
                {weatherSlider('Cloud coverage', 'cloud', 0, 1, 0.05, percent)}
                {weatherSlider('Rain intensity', 'rain', 0, 1, 0.05, percent)}
                {weatherSlider('Rain duration', 'rainDuration', 0, 240, 5, (value) =>
                  value === 0 ? 'until changed' : `${value} min`
                )}
                {stormy && weatherSlider('Lightning frequency', 'lightning', 0, 20, 1, (value) => `${value} / min`)}
              </ControlCard>
              <ControlCard title="Air">
                {weatherSlider('Humidity', 'humidity', 0, 1, 0.05, percent)}
                {weatherSlider('Temperature', 'temperature', -5, 35, 1, (value) => `${value} °C`)}
                {weatherSlider('Fog density', 'fog', 0, 1, 0.05, percent)}
                {weatherSlider('Fog height', 'fogHeight', 0.05, 3, 0.05, (value) => `${Math.round(value * 100)} cm`)}
                {weatherSlider('Wind strength', 'wind', 0, 1, 0.05, percent)}
              </ControlCard>
              <ControlCard title="Change">
                {weatherSlider('Transition duration', 'transition', 0, 120, 5, (value) => `${value} s`)}
              </ControlCard>
              <p className="section-note">
                Weather moves toward the chosen values over the transition. Rain duration is in simulated
                minutes; when it ends the weather turns to after rain. Wind is visual only (flowers sway, rain
                slants).
              </p>
            </>
          )}
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
                {season.apply && (
                  <p className="section-note">The season sets sunrise and sunset while it's in use.</p>
                )}
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
