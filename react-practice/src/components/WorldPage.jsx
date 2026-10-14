import { useEffect, useState } from 'react'
import Annotation from './Annotation'
import LeafMark from './LeafMark'
import MapScene from '../project/MapScene'

// World: the live forest floor, with a short intro and handwritten notes.
// The notes fade out once the visitor starts using the scene.
export default function WorldPage() {
  const [notesVisible, setNotesVisible] = useState(true)

  useEffect(() => {
    if (!notesVisible) return undefined
    const hide = () => setNotesVisible(false)
    const timer = window.setTimeout(hide, 20000)
    window.addEventListener('pointerdown', hide, { once: true })
    window.addEventListener('keydown', hide, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', hide)
      window.removeEventListener('keydown', hide)
    }
  }, [notesVisible])

  const intro = (
    <div className="page-intro world-intro">
      <LeafMark className="page-intro-mark" />
      <div>
        <p className="page-kicker">The forest floor</p>
        <h1>Explore the World</h1>
        <p>
          A procedurally generated forest floor. Adjust the parameters and see how the world
          evolves in real time.
        </p>
      </div>
    </div>
  )

  return (
    <div className="world-page">
      <MapScene intro={intro} />
      <div className={`page-notes${notesVisible ? '' : ' hidden'}`}>
        <Annotation arrow="right" style={{ top: 'calc(var(--nav-h) + 40px)', right: 356 }}>
          Adjust the parameters
          <br />
          and watch the world evolve.
        </Annotation>
        <Annotation arrow="down-left" style={{ top: '44%', right: 400 }}>
          A tiny ecosystem,
          <br />
          grown from noise.
        </Annotation>
        <Annotation arrow="up-left" arrowFirst style={{ bottom: 64, left: 300 }}>
          Navigate the terrain
          <br />
          and explore at different scales.
        </Annotation>
      </div>
    </div>
  )
}
