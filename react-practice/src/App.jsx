import { useState } from 'react'
import SidePanel from './components/SidePanel'
import Week1Scene from './components/Week1Scene'
import Week2Scene from './components/Week2Scene'
import Week3Scene from './components/Week3Scene'
import './App.css'

const WEEK_TITLES = {
  1: 'Procedural World Building',
  2: 'Infinite Noise Map',
  3: 'Week 3 Workspace',
}

export default function App() {
  const [activeWeek, setActiveWeek] = useState(3)
  const [settings, setSettings] = useState({
    size: 1,
    rotationSpeed: 0.6,
    autoRotate: true,
    color: '#ff8a3d',
  })

  return (
    <div className="app">
      {activeWeek === 1 && <Week1Scene settings={settings} />}
      {activeWeek === 2 && <Week2Scene />}
      {activeWeek === 3 && <Week3Scene />}

      <header className="titlebar">
        <h1>{WEEK_TITLES[activeWeek]}</h1>
        <p>yw2785 &middot; Cornell AAP</p>
      </header>

      <nav className="week-tabs" role="tablist" aria-label="Weekly work">
        {[1, 2, 3].map((week) => (
          <button
            key={week}
            type="button"
            role="tab"
            aria-selected={activeWeek === week}
            className={activeWeek === week ? 'active' : ''}
            onClick={() => setActiveWeek(week)}
          >
            Week {week}
          </button>
        ))}
      </nav>

      {activeWeek === 1 && (
        <SidePanel settings={settings} onChange={setSettings} />
      )}
    </div>
  )
}
