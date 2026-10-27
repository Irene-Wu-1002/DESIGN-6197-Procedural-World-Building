import LeafMark from './LeafMark'
import { WEEKS } from '../siteContent'

// Exploration: the weekly experiments. The chosen week's scene fills the
// page; a timeline on the left switches weeks, and a card on the right
// introduces the week above its own control panel.
export default function ExplorationPage({ week, onWeek, children }) {
  const current = WEEKS.find((item) => item.id === week) ?? WEEKS[0]

  return (
    <div className={`exploration-page exploration-week-${current.id}`}>
      {children}

      <div className="exploration-left">
        <div className="page-intro exploration-intro">
          <LeafMark className="page-intro-mark" />
          <div>
            <p className="page-kicker">Exploration lab</p>
            <h1>From Experiments to an Ecosystem</h1>
            <p>A five-topic journey through procedural generation, each topic one technique.</p>
          </div>
        </div>

        <nav className="week-timeline" aria-label="Topics">
          {WEEKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === current.id ? 'step' : undefined}
              onClick={() => onWeek(item.id)}
            >
              <span className="week-dot" aria-hidden="true" />
              <span className="week-text">
                <span className="week-label">Topic {item.id}</span>
                <span className="week-title">{item.title}</span>
              </span>
            </button>
          ))}
        </nav>
      </div>

      <section className="week-card" aria-labelledby="week-card-title">
        <p className="page-kicker">Topic {current.id}</p>
        <h2 id="week-card-title">{current.title}</h2>
        <p>{current.summary}</p>
      </section>

      <p className="scene-hint">{current.hint}</p>
    </div>
  )
}
