# Procedural World Building — yw2785

Coursework repository for **Procedural World Building** at Cornell AAP.

This repo collects everything I produce for the course: planning documents, step-by-step
tutorials I write while learning new tools, and analyses of procedural systems I study or
build. The goal by the end of the semester is a small, reusable library of procedural
tools plus a finished world that demonstrates them.

## Repository Structure

| Path | Contents |
| --- | --- |
| [`docs/planning/`](docs/planning/) | Project plans, milestones, and the feature backlog |
| [`docs/tutorials/`](docs/tutorials/) | Step-by-step guides and technique notes I write as I learn |
| [`docs/analysis/`](docs/analysis/) | Breakdowns of existing procedural systems and reviews of my own results |

## Feature Backlog

The running list of things I want to build lives in
[`docs/planning/backlog.md`](docs/planning/backlog.md). It is ordered roughly by priority
and is updated as the semester progresses.

## Tools

- **Houdini** — primary procedural authoring environment
- **Unreal Engine 5** — real-time assembly, PCG, Nanite/Lumen rendering
- **Blender** — modeling and geometry nodes for smaller assets
- **Python** — data prep, batch processing, and custom tooling

## Working Conventions

- Documents are written in Markdown so they stay diff-friendly and reviewable.
- Each tutorial and analysis is a self-contained file with a short summary at the top.
- Large binaries (`.hip`, `.blend`, `.uasset`, renders) are kept out of the repo unless a
  small example file is needed to reproduce a result.

## About

**Author:** yw2785
**Course:** Procedural World Building, Cornell AAP
**Semester:** Fall 2026
