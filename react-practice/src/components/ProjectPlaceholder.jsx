// Empty Project page shown until its content is built.
export default function ProjectPlaceholder({ title, description }) {
  return (
    <div className="project-placeholder">
      <div className="project-placeholder-card">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}
