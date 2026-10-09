import { useState } from 'react'
import AccountMenu from './components/AccountMenu'
import SidePanel from './components/SidePanel'
import Week1Scene from './components/Week1Scene'
import Week2Scene from './components/Week2Scene'
import Week3Scene from './components/Week3Scene'
import Week4Scene from './components/Week4Scene'
import Week5Scene from './components/Week5Scene'
import ProjectPlaceholder from './components/ProjectPlaceholder'
import './App.css'

const SECTIONS = [
  {
    id: 'exploration',
    title: 'Exploration',
    tabs: [
      { id: 1, label: 'Week 1', title: 'Three.js exploring' },
      { id: 2, label: 'Week 2', title: 'Infinite Noise Map' },
      { id: 3, label: 'Week 3', title: 'Voxel Terrain' },
      { id: 4, label: 'Week 4', title: 'Shader exploring' },
      { id: 5, label: 'Week 5', title: 'Distributions' },
    ],
  },
  {
    id: 'project',
    title: 'Project',
    tabs: [
      { id: 'concept', label: 'Project', title: 'Concept' },
      { id: 'map', label: 'Project', title: 'Map' },
    ],
  },
]

const ALL_TABS = SECTIONS.flatMap((section) =>
  section.tabs.map((tab) => ({ ...tab, section: section.id }))
)

export default function App() {
  const [activeTab, setActiveTab] = useState(3)
  // Last sub tab opened in each main tab, so switching back returns to it.
  const [lastTabBySection, setLastTabBySection] = useState({
    exploration: 3,
    project: 'concept',
  })
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

  const active = ALL_TABS.find((tab) => tab.id === activeTab) ?? ALL_TABS[0]
  const activeSection =
    SECTIONS.find((section) => section.id === active.section) ?? SECTIONS[0]

  const openTab = (tabId, sectionId) => {
    setActiveTab(tabId)
    setLastTabBySection((current) => ({ ...current, [sectionId]: tabId }))
  }

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-bar">
          <span className="site-title">Procedural World Building</span>

          <nav className="main-tabs" role="tablist" aria-label="Sections">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection.id === section.id}
                className={activeSection.id === section.id ? 'active' : ''}
                onClick={() =>
                  openTab(lastTabBySection[section.id], section.id)
                }
              >
                {section.title}
              </button>
            ))}
          </nav>

          <div className="site-meta">
            <span className="site-author">yw2785 &middot; Cornell AAP</span>
            <AccountMenu />
          </div>
        </div>

        <nav className="sub-tabs" role="tablist" aria-label={activeSection.title}>
          {activeSection.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => openTab(tab.id, activeSection.id)}
            >
              <span className="sub-tabs-label">{tab.label}</span>
              <span className="sub-tabs-title">{tab.title}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="stage">
        {activeTab === 1 && <Week1Scene settings={settings} />}
        {activeTab === 2 && <Week2Scene />}
        {activeTab === 3 && <Week3Scene />}
        {activeTab === 4 && <Week4Scene />}
        {activeTab === 5 && <Week5Scene />}
        {activeTab === 'concept' && (
          <ProjectPlaceholder
            title="Concept"
            description="The project concept, references, and design goals will live here."
          />
        )}
        {activeTab === 'map' && (
          <ProjectPlaceholder
            title="Map"
            description="The world map for the project will live here."
          />
        )}

        {activeTab === 1 && (
          <SidePanel settings={settings} onChange={setSettings} />
        )}
      </div>
    </div>
  )
}
