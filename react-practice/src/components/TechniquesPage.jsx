import { useState } from 'react'
import Annotation from './Annotation'
import LeafMark from './LeafMark'
import './TechniquesPage.css'

// Techniques: how the forest is made, as an exploded stack of layers and
// six technique cards, each saying where it shows up in the World and
// leading to the topic where it was explored.

const LAYERS = [
  { id: 'atmosphere', name: 'Atmosphere', how: 'Shaders' },
  { id: 'canopy', name: 'Canopy', how: 'Branching + Growth' },
  { id: 'cover', name: 'Ground cover', how: 'Distributions' },
  { id: 'terrain', name: 'Terrain', how: 'Noise' },
  { id: 'underground', name: 'Underground', how: 'Branching + Particles' },
]

// topic: the Exploration study it came from; null when it was built
// straight into the World.
const TECHNIQUES = [
  {
    number: '01',
    name: 'Noise',
    topic: 2,
    line: 'Natural, organic variation from layered noise.',
    where: 'slopes and hollows, the habitat fields, the gaps in the canopy.',
  },
  {
    number: '02',
    name: 'Shaders',
    topic: 4,
    line: 'Light, fog and colour worked out on the GPU.',
    where: 'the sky and haze, sunlight through the canopy, the colour grade, the ant’s eyes.',
  },
  {
    number: '03',
    name: 'Distributions',
    topic: 5,
    line: 'Rules that score the ground and scatter things where they fit.',
    where: 'trunks, moss, flowers, leaves, twigs, pebbles and mushrooms.',
  },
  {
    number: '04',
    name: 'Particles',
    topic: 5,
    line: 'Many small points pushed along by a vector field.',
    where: 'water rising toward the roots, sap climbing to the leaves.',
  },
  {
    number: '05',
    name: 'Branching',
    topic: 6,
    line: 'Trees grown from simple, repeated rules.',
    where: 'crowns by space colonization, root systems, levels of detail.',
  },
  {
    number: '06',
    name: 'Agents',
    topic: null,
    line: 'Simple creatures following local rules, together making trails.',
    where: 'ants laying and following scent on a grid that fades and spreads.',
  },
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

const COVER_DOTS = [
  [100, 30], [170, 50], [110, 80], [20, 110], [90, 120], [180, 180], [130, 40], [30, 30],
  [100, 175], [160, 90], [70, 100], [140, 180],
]

const ROOTS = [
  'M100 100 C 80 80, 60 70, 30 40',
  'M100 100 C 120 80, 150 70, 175 30',
  'M100 100 C 110 130, 140 150, 180 170',
  'M100 100 C 90 130, 60 140, 25 175',
  'M60 70 C 50 90, 35 95, 15 100',
  'M150 70 C 160 90, 175 100, 190 110',
  'M140 150 C 135 170, 130 185, 120 198',
  'M60 140 C 70 160, 75 175, 70 195',
]

const WATER_DOTS = [
  [40, 120], [55, 100], [150, 115], [165, 140], [120, 60], [80, 40], [30, 150], [130, 175],
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
    case 'canopy':
      return (
        <>
          <rect width="200" height="200" className="layer-fill canopy" />
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
    case 'cover':
      return (
        <>
          <rect width="200" height="200" className="layer-fill cover" />
          {[[50, 60, 30], [140, 130, 38], [60, 160, 20]].map(([x, y, r]) => (
            <circle key={x} cx={x} cy={y} r={r} className="layer-moss" />
          ))}
          {COVER_DOTS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3" className="layer-dot" />
          ))}
        </>
      )
    default:
      return (
        <>
          <rect width="200" height="200" className="layer-fill underground" />
          {ROOTS.map((d) => (
            <path key={d} d={d} className="layer-line" />
          ))}
          {WATER_DOTS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" className="layer-water" />
          ))}
        </>
      )
  }
}

function LayerDiagram({ active, onActive }) {
  const ys = LAYERS.map((_, index) => TOP + index * GAP)
  return (
    <svg className="layer-diagram" viewBox="0 0 680 520" role="img" aria-labelledby="layer-diagram-title">
      <title id="layer-diagram-title">
        The forest as five stacked layers: atmosphere, canopy, ground cover, terrain and underground.
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
  if (name === 'Particles') {
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <path key={row} className="faint" d={`M10 ${62 - row * 14} C 50 ${46 - row * 14}, 90 ${70 - row * 14}, 150 ${50 - row * 14}`} />
        ))}
        {[[20, 58], [44, 52], [70, 56], [98, 54], [124, 48], [34, 40], [62, 40], [92, 40], [118, 34], [140, 30], [52, 26], [84, 26], [112, 20], [136, 14]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" className="dot" />
        ))}
      </svg>
    )
  }
  if (name === 'Branching') {
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <path d="M80 68V44M80 44L62 30M80 44L98 28M62 30L52 14M62 30L70 12M98 28L92 10M98 28L114 16M80 44L80 22" />
        {[[52, 14], [70, 12], [92, 10], [114, 16], [80, 22]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="2.5" className="dot" />
        ))}
      </svg>
    )
  }
  if (name === 'Agents') {
    return (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <circle cx="22" cy="52" r="10" />
        <path className="trail" d="M32 50 C 60 40, 80 60, 108 40 S 140 22, 148 20" />
        <path className="faint" d="M30 58 C 60 64, 90 66, 120 58" />
        {[[52, 46], [80, 51], [104, 42], [130, 27]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="2.6" className="dot" />
        ))}
        <circle cx="148" cy="20" r="5" className="faint" />
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
              The forest is built from a few procedural systems. Each one adds a layer, and the
              layers feed each other: water below grows the crowns above, and the crowns shade the
              floor, so they work together as one ecosystem.
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
              <p className="technique-where">
                <span>In the World</span>
                {technique.where}
              </p>
              {technique.topic ? (
                <button type="button" className="text-link" onClick={() => onOpenWeek(technique.topic)}>
                  See it in Topic {technique.topic} <span aria-hidden="true">&rarr;</span>
                </button>
              ) : (
                <span className="technique-origin">Built in the World</span>
              )}
            </li>
          ))}
        </ul>

        <p className="techniques-aside">
          Also explored:{' '}
          <button type="button" className="text-link" onClick={() => onOpenWeek(3)}>
            Topic 3 &middot; Voxels <span aria-hidden="true">&rarr;</span>
          </button>{' '}
          Marching-cubes terrain, kept as a study. The World's ground is a noise height field instead.
        </p>
      </div>
    </div>
  )
}
