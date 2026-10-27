// Number formats shared by the Topic 6 control panels.
export const degrees = (value) => `${Math.round(value * 10) / 10}°`
export const whole = (value) => value
export const fixed = (digits) => (value) => value.toFixed(digits)
