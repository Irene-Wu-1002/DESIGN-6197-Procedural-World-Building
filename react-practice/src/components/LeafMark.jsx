// The site's leaf mark: a small fern frond, drawn with strokes.
export default function LeafMark({ className = '' }) {
  return (
    <svg className={`leaf-mark ${className}`} viewBox="0 0 24 32" aria-hidden="true">
      <path d="M12 31V3" />
      <path d="M12 7c-2-1-4-1-6 0M12 7c2-1 4-1 6 0" />
      <path d="M12 12c-3-1.5-6-1.5-8.5 0M12 12c3-1.5 6-1.5 8.5 0" />
      <path d="M12 17c-3.4-1.6-7-1.6-9.5.2M12 17c3.4-1.6 7-1.6 9.5.2" />
      <path d="M12 22c-3-1.4-6-1.4-8 .2M12 22c3-1.4 6-1.4 8 .2" />
      <path d="M12 26.5c-2-1-4-1-5.5.2M12 26.5c2-1 4-1 5.5.2" />
    </svg>
  )
}
