/**
 * One input state: held keys, drag look, and species actions (held,
 * toggled, or pressed once). Movement
 * strategies only read `move`, `run`, and `held(action)`; the controller
 * drains look deltas and presses each frame.
 */

const MOVE_KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right' }
const LOOK_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

export function createViewInput() {
  const keys = new Set()
  const lookKeys = new Set()
  const held = new Set()
  const look = { x: 0, y: 0 }
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
      held.clear()
      presses = []
      run = false
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
