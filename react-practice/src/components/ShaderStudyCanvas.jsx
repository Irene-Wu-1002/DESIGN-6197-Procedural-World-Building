import { useEffect, useRef } from 'react'
import {
  biomeFragmentShader,
  biomeVertexShader,
} from '../shaders/biomeShader'
import {
  distanceFogFragmentShader,
  distanceFogVertexShader,
} from '../shaders/distanceFogShader'
import {
  fresnelFragmentShader,
  fresnelVertexShader,
} from '../shaders/fresnelShader'
import {
  heightGradientFragmentShader,
  HEIGHT_GRADIENT_PREVIEW_RANGE,
  heightGradientVertexShader,
} from '../shaders/heightGradientShader'
import {
  proceduralNoiseFragmentShader,
  proceduralNoiseVertexShader,
} from '../shaders/proceduralNoiseShader'
import {
  slopeFragmentShader,
  slopeVertexShader,
} from '../shaders/slopeShader'
import {
  vertexDisplacementFragmentShader,
  vertexDisplacementVertexShader,
} from '../shaders/vertexDisplacementShader'
import {
  bindPositionBuffer,
  createFullscreenQuad,
  createGridMesh,
  createProgramInfo,
  hexToRgb,
} from '../shaders/webglUtils'

const PROGRAM_DEFINITIONS = {
  'height-gradient': {
    vertex: heightGradientVertexShader,
    fragment: heightGradientFragmentShader,
    uniforms: [
      'u_previewMinHeight',
      'u_previewMaxHeight',
      'u_gradientIntensity',
      'u_transitionSmoothness',
      'u_minHeight',
      'u_maxHeight',
    ],
  },
  'slope-based': {
    vertex: slopeVertexShader,
    fragment: slopeFragmentShader,
    uniforms: [
      'u_resolution',
      'u_slopeThreshold1',
      'u_slopeThreshold2',
      'u_transitionSoftness',
    ],
  },
  biome: {
    vertex: biomeVertexShader,
    fragment: biomeFragmentShader,
    uniforms: ['u_resolution', 'u_debugValues'],
  },
  'vertex-displacement': {
    vertex: vertexDisplacementVertexShader,
    fragment: vertexDisplacementFragmentShader,
    uniforms: [
      'u_aspect',
      'u_time',
      'u_strength',
      'u_speed',
      'u_noiseScale',
    ],
  },
  'fresnel-glow': {
    vertex: fresnelVertexShader,
    fragment: fresnelFragmentShader,
    uniforms: [
      'u_resolution',
      'u_fresnelPower',
      'u_glowIntensity',
      'u_glowColor',
    ],
  },
  'distance-fog': {
    vertex: distanceFogVertexShader,
    fragment: distanceFogFragmentShader,
    uniforms: ['u_fogStart', 'u_fogEnd', 'u_fogDensity', 'u_fogColor'],
  },
  'procedural-noise': {
    vertex: proceduralNoiseVertexShader,
    fragment: proceduralNoiseFragmentShader,
    uniforms: [
      'u_resolution',
      'u_time',
      'u_noiseScale',
      'u_noiseStrength',
      'u_noiseContrast',
      'u_animationSpeed',
    ],
  },
}

export default function ShaderStudyCanvas({ activeStudyId, settings }) {
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const settingsRef = useRef({ activeStudyId, settings })

  useEffect(() => {
    settingsRef.current = { activeStudyId, settings }
    rendererRef.current?.draw()
  }, [activeStudyId, settings])

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl', { antialias: true })

    if (!gl) {
      console.error('WebGL is not available for the shader study canvas.')
      return undefined
    }

    const programs = {}
    try {
      Object.entries(PROGRAM_DEFINITIONS).forEach(([id, definition]) => {
        programs[id] = createProgramInfo(
          gl,
          definition.vertex,
          definition.fragment,
          definition.uniforms,
        )
      })
    } catch (error) {
      console.error('Unable to compile a shader study:', error)
      return undefined
    }

    // Every fragment study shares one quad; displacement uses one reusable grid.
    const fullscreenQuad = createFullscreenQuad(gl)
    const displacementGrid = createGridMesh(gl)
    let animationTime = 0

    const drawProgram = (id, geometry, setUniforms) => {
      const programInfo = programs[id]
      bindPositionBuffer(gl, programInfo, geometry)
      setUniforms(programInfo.uniforms)
      gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount)
    }

    const draw = () => {
      const current = settingsRef.current
      const activeSettings = current.settings
      gl.clearColor(0.055, 0.063, 0.08, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      if (current.activeStudyId === 'height-gradient') {
        const values = activeSettings.heightGradient
        drawProgram('height-gradient', fullscreenQuad, (uniforms) => {
          gl.uniform1f(
            uniforms.u_previewMinHeight,
            HEIGHT_GRADIENT_PREVIEW_RANGE.min,
          )
          gl.uniform1f(
            uniforms.u_previewMaxHeight,
            HEIGHT_GRADIENT_PREVIEW_RANGE.max,
          )
          gl.uniform1f(uniforms.u_gradientIntensity, values.intensity)
          gl.uniform1f(uniforms.u_transitionSmoothness, values.smoothness)
          gl.uniform1f(uniforms.u_minHeight, values.minHeight)
          gl.uniform1f(uniforms.u_maxHeight, values.maxHeight)
        })
      }

      if (current.activeStudyId === 'slope-based') {
        const values = activeSettings.slope
        drawProgram('slope-based', fullscreenQuad, (uniforms) => {
          gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
          gl.uniform1f(uniforms.u_slopeThreshold1, values.threshold1)
          gl.uniform1f(uniforms.u_slopeThreshold2, values.threshold2)
          gl.uniform1f(uniforms.u_transitionSoftness, values.softness)
        })
      }

      if (current.activeStudyId === 'biome') {
        drawProgram('biome', fullscreenQuad, (uniforms) => {
          gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
          gl.uniform1f(
            uniforms.u_debugValues,
            activeSettings.biome.debugValues ? 1 : 0,
          )
        })
      }

      if (current.activeStudyId === 'vertex-displacement') {
        const values = activeSettings.displacement
        drawProgram('vertex-displacement', displacementGrid, (uniforms) => {
          gl.uniform1f(uniforms.u_aspect, canvas.width / canvas.height)
          gl.uniform1f(uniforms.u_time, animationTime)
          gl.uniform1f(uniforms.u_strength, values.strength)
          gl.uniform1f(uniforms.u_speed, values.speed)
          gl.uniform1f(uniforms.u_noiseScale, values.noiseScale)
        })
      }

      if (current.activeStudyId === 'fresnel-glow') {
        const values = activeSettings.fresnel
        drawProgram('fresnel-glow', fullscreenQuad, (uniforms) => {
          gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
          gl.uniform1f(uniforms.u_fresnelPower, values.power)
          gl.uniform1f(uniforms.u_glowIntensity, values.intensity)
          gl.uniform3fv(uniforms.u_glowColor, hexToRgb(values.color))
        })
      }

      if (current.activeStudyId === 'distance-fog') {
        const values = activeSettings.fog
        drawProgram('distance-fog', fullscreenQuad, (uniforms) => {
          gl.uniform1f(uniforms.u_fogStart, values.start)
          gl.uniform1f(uniforms.u_fogEnd, values.end)
          gl.uniform1f(uniforms.u_fogDensity, values.density)
          gl.uniform3fv(uniforms.u_fogColor, hexToRgb(values.color))
        })
      }

      if (current.activeStudyId === 'procedural-noise') {
        const values = activeSettings.noise
        drawProgram('procedural-noise', fullscreenQuad, (uniforms) => {
          gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
          gl.uniform1f(uniforms.u_time, animationTime)
          gl.uniform1f(uniforms.u_noiseScale, values.scale)
          gl.uniform1f(uniforms.u_noiseStrength, values.strength)
          gl.uniform1f(uniforms.u_noiseContrast, values.contrast)
          gl.uniform1f(uniforms.u_animationSpeed, values.speed)
        })
      }
    }

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio, 2)
      const drawingWidth = Math.max(1, Math.round(width * pixelRatio))
      const drawingHeight = Math.max(1, Math.round(height * pixelRatio))
      if (canvas.width !== drawingWidth || canvas.height !== drawingHeight) {
        canvas.width = drawingWidth
        canvas.height = drawingHeight
        gl.viewport(0, 0, drawingWidth, drawingHeight)
      }
      draw()
    }

    rendererRef.current = { draw }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    let frameId
    let previousTime = performance.now()
    const animate = (currentTime) => {
      const delta = Math.min((currentTime - previousTime) / 1000, 0.1)
      previousTime = currentTime
      const current = settingsRef.current
      const displacementIsMoving =
        current.activeStudyId === 'vertex-displacement' &&
        !current.settings.displacement.paused
      const noiseIsMoving =
        current.activeStudyId === 'procedural-noise' &&
        current.settings.noise.speed > 0

      if (displacementIsMoving || noiseIsMoving) {
        animationTime += delta
        draw()
      }
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      rendererRef.current = null
      gl.deleteBuffer(fullscreenQuad.buffer)
      gl.deleteBuffer(displacementGrid.buffer)
      Object.values(programs).forEach(({ program }) => {
        gl.deleteProgram(program)
      })
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label="Week 4 shader study preview"
      data-shader-study={activeStudyId}
    />
  )
}
