import { useEffect, useRef } from 'react'

/**
 * Draws a grayscale height map: dark = low, light = high.
 */
export default function NoiseMapPreview({ heights, resolution, label }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !heights) return

    const size = resolution
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    const image = context.createImageData(size, size)

    for (let index = 0; index < heights.length; index += 1) {
      const gray = Math.round(((heights[index] + 1) * 0.5) * 255)
      const pixel = index * 4
      image.data[pixel] = gray
      image.data[pixel + 1] = gray
      image.data[pixel + 2] = gray
      image.data[pixel + 3] = 255
    }

    context.putImageData(image, 0, 0)
  }, [heights, resolution])

  return (
    <figure className="noise-preview">
      <canvas
        ref={canvasRef}
        className="noise-preview-canvas"
        aria-label={label || '2D Perlin noise height map'}
      />
      <figcaption>{label || '2D noise map → height'}</figcaption>
    </figure>
  )
}
