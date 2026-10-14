import Annotation from './Annotation'
import LeafMark from './LeafMark'
import './ConceptPage.css'
import fallenLogs from '../assets/concept/fallen-logs-point-cloud.jpg'
import flyAgaric from '../assets/concept/fly-agaric-mycelium.jpg'
import forestDots from '../assets/concept/forest-dots.jpg'
import rootsBranches from '../assets/concept/roots-branches-point-cloud.jpg'
import rootsUnderground from '../assets/concept/roots-underground.jpg'

// Project > Concept: the design idea only – what the project is and why.
// Techniques, milestones, and the full scale table live in
// docs/planning/project-design.md.

const SCALE_EXAMPLES = [
  ['Pebble', '1 cm', '3.4 m boulder'],
  ['Moss clump', '2 cm', '7 m forest'],
  ['Dew drop', '3 mm', '1 m glass sphere'],
  ['Fly agaric', '20 cm', '68 m tower'],
]

const MODES = [
  {
    name: 'Human',
    line: 'The patch from above, at normal scale and in natural colours.',
    swatch: ['#5f8a3a', '#8a7350', '#d84a32'],
  },
  {
    name: 'Ant vision',
    line: 'Low, blurry, very wide view, broken into compound-eye cells and shifted toward ultraviolet.',
    swatch: ['#2f6f8f', '#5fb3a6', '#a6c8ff'],
  },
  {
    name: 'Smell',
    line: 'The world dims; pheromone trails glow as ribbons that fade over time.',
    swatch: ['#1b1d2a', '#f0a040', '#ffe08a'],
  },
  {
    name: 'Underground',
    line: 'The surface turns see-through; the fungal network pulses with light below.',
    swatch: ['#120f1a', '#7a5cff', '#b8f0ff'],
  },
]

const REFERENCES = [
  {
    title: 'In the Eyes of the Animal',
    meta: 'Marshmallow Laser Feast, 2015 · VR installation, Grizedale Forest',
    link: 'https://marshmallowlaserfeast.com/project/in-the-eyes-of-the-animal/',
    summary:
      'The same woodland seen through the senses of a mosquito, a dragonfly, a frog, and an owl, each with its own visual language.',
    images: [
      [fallenLogs, 'Fallen logs above a forest floor drawn as a dense orange point cloud', 'Fallen logs become giant bridges.'],
      [rootsBranches, 'A tangle of roots and branches as a pale point cloud, with a blurred ground in front', 'Roots and branches as fine lines; a blurred foreground.'],
      [forestDots, 'A misty forest painted with large coloured dots', 'The forest drawn as coloured dots.'],
    ],
    takeaways: [
      'One world, several senses: changing the senses changes the look, not the place.',
      'Invisible things, like smell or CO₂, can be made visible as particles and trails.',
      'A sense can be shown by what it hides, like a blurred edge, as much as by what it shows.',
    ],
  },
  {
    title: 'Poetics of Soil: Fly Agaric I',
    meta: 'Marshmallow Laser Feast, 2025 · video installation, Somerset House',
    link: 'https://marshmallowlaserfeast.com/project/poetics-of-soil-fly-agaric-i-video-installation/',
    summary:
      'The fly agaric and the fungal networks in the soil, shown as pulsing, living systems.',
    images: [
      [flyAgaric, 'A fly agaric with a red, white-spotted cap in leaf litter, with glowing mycelium threads below', 'The mushroom above, glowing threads below.'],
      [rootsUnderground, 'Roots and fungal threads spreading through dark soil, with blue spores drifting', 'Roots and threads spreading underground.'],
    ],
    takeaways: [
      'The fly agaric as the landmark: a red-and-white silhouette anyone recognises.',
      'The ground as something alive, with a hidden network pulsing underneath.',
      'The cutaway: the ground line splits the world above from the network below.',
    ],
  },
]

export default function ConceptPage({ onExplore }) {
  return (
    <div className="concept-page">
      <header className="concept-hero">
        <img
          className="concept-hero-image"
          src={flyAgaric}
          alt="A fly agaric mushroom in leaf litter, with glowing fungal threads in the soil below"
        />
        <div className="concept-hero-text">
          <LeafMark className="concept-hero-mark" />
          <div>
            <p className="page-kicker">Umwelt &middot; a micro world through an ant's eyes</p>
            <h1>
              A World
              <br />
              Beneath Your Feet
            </h1>
            <p className="concept-pitch">
              Using procedural generation to create a living forest floor, where tiny creatures,
              terrain and weather emerge from simple rules.
            </p>
            <button type="button" className="outline-button" onClick={onExplore}>
              Explore the World <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </div>
        <Annotation arrow="down" className="concept-hero-note">
          From simple rules,
          <br />
          a living world emerges.
        </Annotation>
        <span className="concept-scroll" aria-hidden="true">
          Scroll for the story
        </span>
      </header>

      <article className="concept">
        <section className="concept-section" aria-labelledby="concept-what">
          <h2 id="concept-what">
            <span className="concept-label">What</span>
          </h2>

          <h3>A whole world under our feet</h3>
          <p>
            At human scale the ground is nothing much: some soil, a few
            pebbles, fallen leaves, a clump of moss, a red fly agaric. At ant
            scale it becomes a whole landscape. Pebbles are boulders, moss is a
            dense forest, a dew drop is a lens the size of a car, and the
            mushroom is a tower reaching into the light. Under the surface, a
            fungal network and the ants' tunnels form a hidden second world.
          </p>
          <ul className="concept-scale" aria-label="Real sizes and how they feel to an ant">
            {SCALE_EXAMPLES.map(([object, real, feels]) => (
              <li key={object}>
                <span className="concept-scale-object">{object}</span>
                <span className="concept-scale-real">{real}</span>
                <span className="concept-scale-feels">{feels}</span>
              </li>
            ))}
          </ul>

          <h3>Endless</h3>
          <p>
            The viewer starts at an ant hill beside a large fly agaric and
            walks with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. New
            ground grows ahead as they move, so the forest floor never ends,
            and walking back to a place shows exactly the same ground, because
            everything comes from one seed.
          </p>

          <h3>One world, four ways of seeing it</h3>
          <p>
            The world itself never changes. Only the senses do: the same
            ground can be seen through human eyes or through the ant's.
          </p>
          <div className="concept-modes">
            {MODES.map((mode) => (
              <div key={mode.name} className="concept-mode">
                <div className="concept-swatch" aria-hidden="true">
                  {mode.swatch.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </div>
                <h4>{mode.name}</h4>
                <p>{mode.line}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="concept-section" aria-labelledby="concept-why">
          <h2 id="concept-why">
            <span className="concept-label">Why</span>
          </h2>

          <h3>Every animal lives in its own world</h3>
          <blockquote className="concept-quote">
            <p>
              A human and an ant standing in the same place do not experience
              the same place.
            </p>
            <footer>
              After Jakob von Uexküll's idea of the <em>umwelt</em>: the world
              as an animal perceives it, shaped by its senses.
            </footer>
          </blockquote>
          <p>
            The project asks what the ground under our feet is like for
            someone who lives in it. Instead of showing one "true" world, it
            lets you switch between ways of sensing it, and notice how much of
            the world depends on who is looking.
          </p>

          <h3>Why an ant</h3>
          <p>
            An ant is about 5 mm long, a person about 1.7 m: roughly{' '}
            <strong>1 : 340</strong>. That ratio turns the most ordinary
            ground into somewhere monumental and unexplored. The feeling of
            giant scale comes from the point of view, not from huge geometry,
            so a small patch of forest floor is enough to feel like a journey.
          </p>

          <h3>Inspiration</h3>
          {REFERENCES.map((reference) => (
            <div key={reference.title} className="concept-reference">
              <div className="concept-reference-heading">
                <h4>
                  <a href={reference.link} target="_blank" rel="noreferrer">
                    {reference.title}
                  </a>
                </h4>
                <p className="concept-meta">{reference.meta}</p>
              </div>
              <p>{reference.summary}</p>
              <div
                className="concept-gallery"
                style={{ '--columns': reference.images.length }}
              >
                {reference.images.map(([src, alt, caption]) => (
                  <figure key={caption}>
                    <img src={src} alt={alt} loading="lazy" />
                    <figcaption>{caption}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="concept-takeaway-title">What I take from it</p>
              <ul className="concept-takeaways">
                {reference.takeaways.map((takeaway) => (
                  <li key={takeaway}>{takeaway}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </article>
    </div>
  )
}
