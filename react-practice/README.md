# Procedural World Building Web Prototype

[← Main study notebook](../README.md)

An interactive React, Vite, and Three.js prototype for studying procedural world-building systems.

![Cubic voxel planet](../docs/assets/screenshots/week-04-voxel-planet-cubic.png)

## Prototype Areas

| Tab | Topics |
| --- | --- |
| Week 1 — Three.js Exploring | Scene setup, primitive geometry, lighting, materials, OrbitControls, fading grid |
| Week 2 — Infinite Noise Map | Seeded noise, layered terrain, map controls, terrain materials |
| Week 3 — Voxel Terrain | Density fields, cubic voxels, sequential CSG, chunking, Marching Cubes, optimization |

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Firebase web-app configuration described in the [Firebase setup tutorial](../docs/tutorials/Firebase%20setup.md). The file is ignored by Git.

## Available Commands

```bash
npm run dev      # start the local development server
npm run lint     # check the JavaScript and JSX
npm run build    # create a production build
npm run preview  # preview the production build locally
```

## Source Structure

```text
src/
├── components/       # Week scenes, controls, and previews
├── lib/firebase.js   # Firebase and Firestore initialization only
├── utils/            # Noise, density, terrain, and material utilities
├── App.jsx           # Week-tab navigation
├── App.css           # Application and control-panel layout
└── main.jsx          # React entry point
```

## Firebase Boundary

Firebase is connected, but Save World and Load World are not implemented yet. Future persistence will store only seeds, density parameters, ordered CSG operations, chunking settings, meshing settings, and optional experiment summaries. Generated voxel arrays and meshes must remain local.

## Related Notes

- [Class 04 voxel terrain study](../docs/class-notes/week-04-voxel-terrain.md)
- [Project design](../docs/planning/project-design.md)
- [Feature backlog](../docs/planning/backlog.md)
