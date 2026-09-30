import { useState } from 'react'
import SidePanel from './components/SidePanel'
import Week1Scene from './components/Week1Scene'
import Week2Scene from './components/Week2Scene'
import Week3Scene from './components/Week3Scene'
import Week4Scene from './components/Week4Scene'
import './App.css'

const WEEKS = [
  { id: 1, title: 'Three.js exploring' },
  { id: 2, title: 'Infinite Noise Map' },
  { id: 3, title: 'Voxel Terrain' },
  { id: 4, title: 'Shape exploring' },
]

export default function App() {
  const [activeWeek, setActiveWeek] = useState(3)
  const [settings, setSettings] = useState({
    size: 1,
    rotationSpeed: 0.6,
    autoRotate: true,
    color: '#ff8a3d',
    colorEnd: '#6ea8ff',
    gradientDirection: 'vertical',
    material: 'plastic',
    shape: 'box',
  })

  const active = WEEKS.find((week) => week.id === activeWeek) ?? WEEKS[0]

  return (
    <div className="app">
      {activeWeek === 1 && <Week1Scene settings={settings} />}
      {activeWeek === 2 && <Week2Scene />}
      {activeWeek === 3 && <Week3Scene />}
      {activeWeek === 4 && <Week4Scene />}

      <header className="titlebar">
        <h1>{active.title}</h1>
        <p>yw2785 &middot; Cornell AAP</p>
      </header>

      <nav className="week-tabs" role="tablist" aria-label="Weekly work">
        {WEEKS.map((week) => (
          <button
            key={week.id}
            type="button"
            role="tab"
            aria-selected={activeWeek === week.id}
            className={activeWeek === week.id ? 'active' : ''}
            onClick={() => setActiveWeek(week.id)}
          >
            <span className="week-tabs-label">Week {week.id}</span>
            <span className="week-tabs-title">{week.title}</span>
          </button>
        ))}
      </nav>

      {activeWeek === 1 && (
        <SidePanel settings={settings} onChange={setSettings} />
      )}
    </div>
  )
}
