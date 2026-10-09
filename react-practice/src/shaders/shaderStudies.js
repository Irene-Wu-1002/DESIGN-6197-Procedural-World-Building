export const DEFAULT_SHADER_STUDY_ID = 'default'

export const SHADER_STUDIES = Object.freeze([
  {
    id: DEFAULT_SHADER_STUDY_ID,
    label: 'Default',
    description: 'Shows the unshaded preview background for comparison.',
    inputs: 'None',
    modifies: 'None',
    why:
      'It reads no shader data and adds no effect. This gives the other studies a neutral comparison point before they are applied to the project terrain.',
    implemented: true,
  },
  {
    id: 'height-gradient',
    label: 'Height Gradient',
    description:
      'Colors the terrain from low ground to high peaks using interpolated world-space height.',
    inputs: 'World position Y',
    modifies: 'Pixels',
    why:
      'It reads world height and assigns smooth vertical colors. This separates roots, trunk neighborhoods, branches, and canopy climate without changing the generated geometry.',
    implemented: true,
  },
  {
    id: 'slope-based',
    label: 'Slope',
    description:
      'Uses the surface normal to blend moss, earth, and rock colors by steepness.',
    inputs: 'Surface normal',
    modifies: 'Pixels',
    why:
      'It reads the surface normal to estimate steepness. Flat areas receive vegetation while cliffs become bark or rock, making generated surfaces easier to understand.',
    implemented: true,
  },
  {
    id: 'biome',
    label: 'Height + Slope Biome',
    description:
      'Combines vertical biome zones with local surface steepness.',
    inputs: 'World position Y and surface normal',
    modifies: 'Pixels',
    why:
      'It reads height for the overall biome and slope for local material. This lets one generated tree contain mossy roots, warm city bark, leafy canopy, and exposed rock.',
    implemented: true,
  },
  {
    id: 'vertex-displacement',
    label: 'Vertex Displacement',
    description:
      'Adds subtle time-driven organic movement that increases toward the canopy.',
    inputs: 'World position and time',
    modifies: 'Vertices',
    why:
      'It reads vertex height and time, then gently moves upper vertices. The low ground remains stable while the peaks breathe, helping the surface feel alive.',
    implemented: true,
  },
  {
    id: 'fresnel-glow',
    label: 'Fresnel Glow',
    description: 'Adds a soft pale glow around silhouettes and grazing angles.',
    inputs: 'Surface normal and camera direction',
    modifies: 'Pixels',
    why:
      'It compares the surface normal with the camera direction. Edges glow more than front-facing areas, helping branches and canopy structures remain readable against the sky.',
    implemented: true,
  },
  {
    id: 'distance-fog',
    label: 'Distance Fog',
    description: 'Fades distant fragments into blue-green atmospheric fog.',
    inputs: 'Camera distance',
    modifies: 'Pixels',
    why:
      'It reads each fragment’s camera distance and blends far surfaces into fog. This creates depth and a humid canopy atmosphere while keeping nearby structures clear.',
    implemented: true,
  },
  {
    id: 'procedural-noise',
    label: 'Procedural Noise',
    description: 'Adds subtle organic color variation without image textures.',
    inputs: 'Surface position and time',
    modifies: 'Pixels',
    why:
      'It reads position and optional time to generate noise. The variation breaks up flat bark and terrain colors without adding image files or changing geometry.',
    implemented: true,
  },
])

export function getShaderStudy(studyId) {
  return (
    SHADER_STUDIES.find((study) => study.id === studyId) ?? SHADER_STUDIES[0]
  )
}
