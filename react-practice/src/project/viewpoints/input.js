/**
 * One input state: held keys, drag look, zoom (wheel and + / −), and
 * species actions (held, toggled, or pressed once). Movement strategies
 * read `move`, `run`, `held(action)`, and `takeZoom`; the controller
 * drains look deltas and presses each frame.
 */

const MOVE_KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right' }
const LOOK_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const ZOOM_KEYS = { Equal: 'in', NumpadAdd: 'in', Minus: 'out', NumpadSubtract: 'out' }
// Zoom per wheel pixel (log of the distance factor).
const WHEEL_ZOOM = 0.0012

export function createViewInput() {
  const keys = new Set()
  const lookKeys = new Set()
  const zoomKeys = new Set()
  const held = new Set()
  const look = { x: 0, y: 0 }
  const panned = { x: 0, y: 0 }
  let wheel = 0
  let presses = []
  let run = false
  const move = { x: 0, y: 0 }

  return {
    get move() {
      move.x = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0)
      move.y = (keys.has('forward') ? 1 : 0) - (keys.has('back') ? 1 : 0)
      const length = Math.hypot(move.x, move.y)
      if (length > 1) {
        move.x /= length
        move.y /= length
      }
      return move
    },
    get run() {
      return run
    },
    held(name) {
      return held.has(name)
    },

    /**
     * A key went down or up. actions: the current viewpoint's actions.
     * Returns true when the key meant something here (so the page can
     * prevent its default, e.g. Space scrolling).
     */
    key(code, down, actions) {
      if (MOVE_KEYS[code]) {
        if (down) keys.add(MOVE_KEYS[code])
        else keys.delete(MOVE_KEYS[code])
        return true
      }
      if (LOOK_KEYS[code]) {
        if (down) lookKeys.add(LOOK_KEYS[code])
        else lookKeys.delete(LOOK_KEYS[code])
        return true
      }
      if (ZOOM_KEYS[code]) {
        if (down) zoomKeys.add(ZOOM_KEYS[code])
        else zoomKeys.delete(ZOOM_KEYS[code])
        return true
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        run = down
        return true
      }
      for (const [name, action] of Object.entries(actions)) {
        if (action.key !== code) continue
        if (action.mode === 'hold') {
          if (down) held.add(name)
          else held.delete(name)
        } else if (down) {
          presses.push(name)
        }
        return true
      }
      return false
    },

    drag(dx, dy) {
      look.x += dx
      look.y += dy
    },
    /** Pan drag (pixels): grabs the ground and slides it (free camera). */
    pan(dx, dy) {
      panned.x += dx
      panned.y += dy
    },
    /** Pan drag this frame, in pixels; drained on read. */
    takePan() {
      const amount = { x: panned.x, y: panned.y }
      panned.x = 0
      panned.y = 0
      return amount
    },
    /** Mouse wheel (deltaY in pixels; positive zooms out). */
    zoom(deltaY) {
      wheel += deltaY
    },

    /** Zoom this frame as the log of a distance factor (> 0 is out). */
    takeZoom(dt, keyRate) {
      const keysZoom = ((zoomKeys.has('out') ? 1 : 0) - (zoomKeys.has('in') ? 1 : 0)) * keyRate * dt
      const amount = wheel * WHEEL_ZOOM + keysZoom
      wheel = 0
      return amount
    },

    /** Look change this frame: { yaw, pitch } in radians. */
    takeLook(dt, dragScale, keySpeed) {
      const yaw =
        -look.x * dragScale + ((lookKeys.has('left') ? 1 : 0) - (lookKeys.has('right') ? 1 : 0)) * keySpeed * dt
      const pitch =
        -look.y * dragScale + ((lookKeys.has('up') ? 1 : 0) - (lookKeys.has('down') ? 1 : 0)) * keySpeed * dt
      look.x = 0
      look.y = 0
      return { yaw, pitch }
    },
    takePresses() {
      const list = presses
      presses = []
      return list
    },

    /** Forget everything held (window blur, viewpoint change). */
    clear() {
      keys.clear()
      lookKeys.clear()
      zoomKeys.clear()
      held.clear()
      presses = []
      run = false
      wheel = 0
      panned.x = 0
      panned.y = 0
      look.x = 0
      look.y = 0
    },
    /** Drop held actions only (they belong to the old viewpoint). */
    clearActions() {
      held.clear()
      presses = []
    },
  }
}
