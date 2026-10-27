// A labelled checkbox row, styled like the other Exploration panel toggles.
export default function Toggle({ label, checked, onChange }) {
  return (
    <label className="control control-inline shader-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
