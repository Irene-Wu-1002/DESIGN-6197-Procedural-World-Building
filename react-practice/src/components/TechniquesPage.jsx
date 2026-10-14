import { useState } from 'react'
import Annotation from './Annotation'
import LeafMark from './LeafMark'
import './TechniquesPage.css'

// Techniques: how the forest is made, as an exploded stack of layers and
// four technique cards that lead to the week where each was explored.

const LAYERS = [
  { id: 'atmosphere', name: 'Atmosphere', how: 'Shaders' },
  { id: 'vegetation', name: 'Vegetation', how: 'Distributions' },
  { id: 'terrain', name: 'Terrain', how: 'Noise + Voxels' },
  { id: 'water', name: 'Water', how: 'Shaders' },
  { id: 'underground', name: 'Underground', how: 'Voxels' },
]

const TECHNIQUES = [
  { number: '01', name: 'Noise', week: 2, line: 'Generate natural, organic variation.' },
  { number: '02', name: 'Voxels', week: 3, line: 'Build 3D terrain from volumetric data.' },
  { number: '03', name: 'Shaders', week: 4, line: 'Create atmosphere with light, fog and colour.' },
  { number: '04', name: 'Distributions', week: 5, line: 'Populate the world with plants, rocks and paths.' },
]

// Diagram geometry: each layer is a 200 × 200 square drawn flat, then
// mapped onto an isometric diamond centred at (CX, y).
const CX = 230
const HALF_W = 190
const HALF_H = 66
const GAP = 92
const TOP = 86

function isometric(y) {
  const a = HALF_W / 200
  const b = HALF_H / 200
  return `matrix(${a} ${b} ${-a} ${b} ${CX} ${y - HALF_H})`
}

// Fixed positions, so the drawing is the same on every visit.
const CROWNS = [
  [30, 36, 11], [62, 22, 9], [92, 48, 13], [40, 80, 10], [130, 30, 8], [150, 70, 12],
  [80, 112, 12], [118, 104, 9], [170, 120, 10], [36, 140, 9], [70, 164, 11], [120, 150, 13],
  [160, 170, 9], [104, 184, 8], [178, 36, 9], [20, 186, 8],
]

function LayerArt({ id }) {
  switch (id) {
    case 'atmosphere':
      return (
        <>
          <rect width="200" height="200" className="layer-fill atmosphere" />
          {[[60, 70, 48], [140, 110, 56], [80, 150, 36]].map(([x, y, r]) => (
            <circle key={x} cx={x} cy={y} r={r} className="layer-cloud" />
          ))}
        </>
      )
    case 'vegetation':
      return (
        <>
          <rect width="200" height="200" className="layer-fill vegetation" />
          {CROWNS.map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className="layer-crown" />
          ))}
        </>
      )
    case 'terrain':
      return (
        <>
          <rect width="200" height="200" className="layer-fill terrain" />
          {[16, 32, 50, 70, 92].map((r) => (
            <ellipse key={r} cx="78" cy="88" rx={r * 1.15} ry={r} className="layer-line" />
          ))}
          {[12, 26, 40].map((r) => (
            <ellipse key={`b${r}`} cx="158" cy="160" rx={r} ry={r * 0.8} className="layer-line" />
          ))}
        </>
      )
    case 'water':
      return (
        <>
          <rect width="200" height="200" className="layer-fill water" />
          {[30, 60, 90, 120, 150, 180].map((y) => (
            <path
              key={y}
              d={`M0 ${y} q 25 -10 50 0 t 50 0 t 50 0 t 50 0`}
              className="layer-line water-line"
            />
          ))}
        </>
      )
    default:
      return (
        <>
          <rect width="200" height="200" className="layer-fill underground" />
          {[25, 50, 75, 100, 125, 150, 175].map((t) => (
            <g key={t}>
              <path d={`M${t} 0V200`} className="layer-line" />
              <path d={`M0 ${t}H200`} className="layer-line" />
            </g>
          ))}
        </>
      )
  }
}

function LayerDiagram({ active, onActive }) {
  const ys = LAYERS.map((_, index) => TOP + index * GAP)
  return (
    <svg className="layer-diagram" viewBox="0 0 640 520" role="img" aria-labelledby="layer-diagram-title">
      <title id="layer-diagram-title">
        The forest as five stacked layers: atmosphere, vegetation, terrain, water and underground.
      </title>
      {/* Corner guides that tie the layers into one block. */}
      {[-HALF_W, 0, HALF_W].map((dx) => (
        <path
          key={dx}
          className="layer-guide"
          d={`M${CX + dx} ${ys[0] + (dx === 0 ? HALF_H : 0)}V${ys[ys.length - 1] + (dx === 0 ? HALF_H : 0)}`}
        />
      ))}
      {LAYERS.map((layer, index) => {
        const y = ys[index]
        const isActive = active === layer.id
        return (
          <g
            key={layer.id}
            className={`layer${isActive ? ' active' : ''}${active && !isActive ? ' dim' : ''}`}
            onPointerEnter={() => onActive(layer.id)}
            onPointerLeave={() => onActive(null)}
          >
            <g transform={isometric(y)}>
              <LayerArt id={layer.id} />
              <rect width="200" height="200" className="layer-edge" />
            </g>
            <path className="layer-leader" d={`M${CX + HALF_W + 8} ${y}H${CX + HALF_W + 70}`} />
            <circle className="layer-node" cx={CX + HALF_W + 74} cy={y} r="5" />
            <text className="layer-name" x={CX + HALF_W + 90} y={y - 3}>
              {layer.name}
            </text>
            <text className="layer-how" x={CX + HALF_W + 90} y={y + 15}>
              ({layer.how})
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function TechniqueArt({ name }) {
  if (name === 'Noise') {
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
          <path
            key={row}
            d={`M${10 + row * 4} ${58 - row * 6} C 40 ${20 - row * 2}, 70 ${70 - row * 7}, 100 ${30 - row * 3} S 140 ${46 - row * 5}, ${150 - row * 2} ${40 - row * 5}`}
          />
        ))}
      </svg>
    )
  }
  if (name === 'Voxels') {
    const cubes = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 0, 1], [2, 0, 1], [2, 1, 1], [2, 0, 2]]
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        {cubes.map(([x, y, z]) => {
          const px = 80 + (x - y) * 14
          const py = 44 + (x + y) * 7 - z * 15 - 14
          return (
            <g key={`${x}${y}${z}`} transform={`translate(${px} ${py})`}>
              <path className="cube-top" d="M0 0l14 7-14 7-14-7z" />
              <path className="cube-left" d="M-14 7l14 7v15l-14-7z" />
              <path className="cube-right" d="M14 7l-14 7v15l14-7z" />
            </g>
          )
        })}
      </svg>
    )
  }
  if (name === 'Shaders') {
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <defs>
          <radialGradient id="technique-glow">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="34" r="30" fill="url(#technique-glow)" stroke="none" />
        {[-60, -40, -20, 0, 20, 40, 60].map((x) => (
          <path key={x} d={`M${80 + x} 70 L${80 + x * 0.9} ${56 - Math.abs(x) * 0.25} L${80 + x * 0.8} 70`} />
        ))}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 160 70" aria-hidden="true">
      <path d="M8 62H152" />
      {[[24, 20], [48, 30], [70, 14], [96, 26], [118, 18], [140, 30]].map(([x, h]) => (
        <path key={x} d={`M${x} 62V${62 - h}M${x - 6} ${62 - h * 0.45}L${x} ${62 - h - 8}L${x + 6} ${62 - h * 0.45}`} />
      ))}
      {[36, 60, 84, 108, 130].map((x) => (
        <circle key={x} cx={x} cy="60" r="2.5" className="dot" />
      ))}
    </svg>
  )
}

export default function TechniquesPage({ onOpenWeek }) {
  const [active, setActive] = useState(null)

  return (
    <div className="techniques-page">
      <div className="techniques">
        <div className="techniques-hero">
          <div className="techniques-text">
            <LeafMark className="page-intro-mark" />
            <p className="page-kicker">How it works</p>
            <h1>The Techniques Behind the Forest</h1>
            <p>
              The forest is built from a few procedural systems. Each one adds a layer, and every
              layer reads the ones below it, so they work together as one ecosystem.
            </p>
            <Annotation arrow="right" className="techniques-note">
              Multiple systems work together
              <br />
              to create a living ecosystem.
            </Annotation>
          </div>
          <LayerDiagram active={active} onActive={setActive} />
        </div>

        <ul className="technique-cards">
          {TECHNIQUES.map((technique) => (
            <li key={technique.name} className="technique-card">
              <h2>
                <span className="technique-number">{technique.number}</span>
                {technique.name}
              </h2>
              <div className="technique-art">
                <TechniqueArt name={technique.name} />
              </div>
              <p>{technique.line}</p>
              <button type="button" className="text-link" onClick={() => onOpenWeek(technique.week)}>
                See it in Week {technique.week} <span aria-hidden="true">&rarr;</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
