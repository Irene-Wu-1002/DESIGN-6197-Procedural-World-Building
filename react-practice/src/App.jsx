import { useEffect, useState } from 'react'
import AccountMenu from './components/AccountMenu'
import LeafMark from './components/LeafMark'
import SidePanel from './components/SidePanel'
import Week1Scene from './components/Week1Scene'
import Week2Scene from './components/Week2Scene'
import Week3Scene from './components/Week3Scene'
import Week4Scene from './components/Week4Scene'
import Week5Scene from './components/Week5Scene'
import ConceptPage from './components/ConceptPage'
import TechniquesPage from './components/TechniquesPage'
import ExplorationPage from './components/ExplorationPage'
import WorldPage from './components/WorldPage'
import { PAGES, readHash, writeHash } from './siteContent'
import './App.css'
import './components/site.css'

export default function App() {
  const [page, setPage] = useState(() => readHash().page)
  const [week, setWeek] = useState(() => readHash().week ?? 1)
  const [menuOpen, setMenuOpen] = useState(false)
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

  useEffect(() => {
    writeHash(page, week)
  }, [page, week])

  const openPage = (id) => {
    setPage(id)
    setMenuOpen(false)
  }

  const openWeek = (id) => {
    setWeek(id)
    openPage('exploration')
  }

  return (
    <div className={`app app-${page}`}>
      <header className="site-header">
        <button type="button" className="site-brand" onClick={() => openPage('concept')}>
          <LeafMark />
          <span>Procedural World Building</span>
        </button>

        <button
          type="button"
          className="site-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="visually-hidden">Menu</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} />
          </svg>
        </button>

        <nav id="site-nav" className={`site-nav${menuOpen ? ' open' : ''}`} aria-label="Pages">
          {PAGES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => openPage(item.id)}
            >
              {item.title}
            </button>
          ))}
        </nav>

        <div className="site-meta">
          <span className="site-author">yw2785 &middot; Cornell AAP</span>
          <AccountMenu />
        </div>
      </header>

      <main className="stage">
        {page === 'concept' && <ConceptPage onExplore={() => openPage('world')} />}
        {page === 'world' && <WorldPage />}
        {page === 'techniques' && <TechniquesPage onOpenWeek={openWeek} />}
        {page === 'exploration' && (
          <ExplorationPage week={week} onWeek={setWeek}>
            {week === 1 && (
              <>
                <Week1Scene settings={settings} />
                <SidePanel settings={settings} onChange={setSettings} />
              </>
            )}
            {week === 2 && <Week2Scene />}
            {week === 3 && <Week3Scene />}
            {week === 4 && <Week4Scene />}
            {week === 5 && <Week5Scene />}
          </ExplorationPage>
        )}
      </main>
    </div>
  )
}
