// A handwritten note with a sketched arrow, floating over a page.
// `arrow` picks the arrow's direction; `style` positions the note.

const ARROWS = {
  // Each arrow is drawn in a 90 × 60 box, starting near the text.
  down: { path: 'M30 4 C 62 10, 74 30, 62 54', head: 'M54 46 L62 55 L68 44' },
  right: { path: 'M4 14 C 30 44, 60 46, 86 30', head: 'M76 26 L86 30 L79 39' },
  left: { path: 'M86 14 C 60 44, 30 46, 4 30', head: 'M14 26 L4 30 L11 39' },
  'down-left': { path: 'M70 6 C 66 34, 44 50, 10 52', head: 'M20 44 L9 52 L20 59' },
  'up-left': { path: 'M80 54 C 60 50, 30 34, 12 8', head: 'M10 20 L11 7 L22 12' },
}

export default function Annotation({ children, arrow, arrowFirst = false, className = '', style }) {
  const shape = ARROWS[arrow]
  const svg = shape && (
    <svg className="annotation-arrow" viewBox="0 0 90 60" aria-hidden="true">
      <path d={shape.path} />
      <path d={shape.head} />
    </svg>
  )
  return (
    <div className={`annotation ${className}`} style={style} aria-hidden="true">
      {arrowFirst && svg}
      <p>{children}</p>
      {!arrowFirst && svg}
    </div>
  )
}
