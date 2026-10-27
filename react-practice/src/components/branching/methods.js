import RecursiveControls from './RecursiveControls'
import LSystemControls from './LSystemControls'
import StochasticControls from './StochasticControls'
import ColonizationControls from './ColonizationControls'
import { DEFAULT_RECURSIVE, RECURSIVE_PRESETS, growRecursive } from '../../utils/branching/recursive'
import { DEFAULT_LSYSTEM, LSYSTEM_PRESETS, growLSystem } from '../../utils/branching/lsystem'
import { DEFAULT_STOCHASTIC, STOCHASTIC_PRESETS, growStochastic } from '../../utils/branching/stochastic'
import {
  COLONIZATION_PRESETS,
  DEFAULT_COLONIZATION,
  growColonization,
} from '../../utils/branching/spaceColonization'

// The branching methods compared in Topic 6, one panel tab each. Every
// generator returns the same { segments, tips, maxDepth, stats } shape.
export const BRANCHING_METHODS = [
  {
    id: 'recursive',
    label: 'Recursive',
    note: 'Every branch ends by splitting into shorter children, which split again, down to the depth limit.',
    defaults: DEFAULT_RECURSIVE,
    presets: RECURSIVE_PRESETS,
    grow: growRecursive,
    Controls: RecursiveControls,
  },
  {
    id: 'lsystem',
    label: 'L-System',
    note: 'A text rule is rewritten again and again; a 3D turtle then walks the string and draws it.',
    defaults: DEFAULT_LSYSTEM,
    presets: LSYSTEM_PRESETS,
    grow: growLSystem,
    Controls: LSystemControls,
  },
  {
    id: 'stochastic',
    label: 'Stochastic',
    note: 'Each tip takes small random steps: it wanders, sometimes splits, and sometimes stops.',
    defaults: DEFAULT_STOCHASTIC,
    presets: STOCHASTIC_PRESETS,
    grow: growStochastic,
    Controls: StochasticControls,
  },
  {
    id: 'colonization',
    label: 'Space Col.',
    note: 'Branches grow toward attraction points scattered in a volume, eating them as they arrive.',
    defaults: DEFAULT_COLONIZATION,
    presets: COLONIZATION_PRESETS,
    grow: growColonization,
    Controls: ColonizationControls,
  },
]
