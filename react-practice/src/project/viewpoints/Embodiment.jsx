/**
 * First-person body cues, drawn over the scene (never blocking input):
 *   human      hands at the bottom edge while walking
 *   butterfly  translucent wing edges at the sides while turning
 *   ant        antennae rising from the lower corners
 * The render loop sets CSS variables on this element (--presence, --walk,
 * --bob, --turn, --turn-abs) so nothing re-renders per frame.
 */

function Hand({ side }) {
  return (
    <svg className={`embody-hand embody-hand-${side}`} viewBox="0 0 120 160">
      <path d="M22 160c-6-30-4-58 4-80l8-46c2-9 14-9 15 0l3 38 4-56c1-10 15-10 16 0l2 56 6-50c2-10 15-9 15 1l-1 54 9-36c3-9 15-6 14 3l-8 60c-4 26-12 44-24 56Z" />
    </svg>
  )
}

function Wing({ side }) {
  return (
    <svg className={`embody-wing embody-wing-${side}`} viewBox="0 0 120 400" preserveAspectRatio="none">
      <path d="M0 0c60 20 110 70 116 150 4 60-30 110-70 150-20 22-36 60-46 100Z" />
      <path className="embody-wing-edge" d="M0 0c60 20 110 70 116 150 4 60-30 110-70 150-20 22-36 60-46 100" />
    </svg>
  )
}

function Antenna({ side }) {
  return (
    <svg className={`embody-antenna embody-antenna-${side}`} viewBox="0 0 200 300">
      <g className="embody-antenna-sway">
        <path d="M30 300C40 240 60 200 92 170" />
        <path d="M92 170c26-30 52-60 72-110" />
        <circle cx="164" cy="60" r="7" />
      </g>
    </svg>
  )
}

export default function Embodiment({ id, motion, ref }) {
  return (
    <div ref={ref} className={`embodiment embodiment-${id}`} data-motion={motion ? 'on' : 'off'} aria-hidden="true">
      {id === 'human' && (
        <>
          <Hand side="left" />
          <Hand side="right" />
        </>
      )}
      {id === 'butterfly' && (
        <>
          <Wing side="left" />
          <Wing side="right" />
        </>
      )}
      {id === 'ant' && (
        <>
          <Antenna side="left" />
          <Antenna side="right" />
        </>
      )}
    </div>
  )
}
