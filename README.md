# Hyacinth’s Xanadu Folio

> A source-first code flow reader for understanding unfamiliar repositories.

Hyacinth’s Xanadu Folio is a local-first desktop application for reading code as a connected flow. Choose an entry function and expand its outgoing calls into a continuous page of real source fragments. Precise SVG bridges connect each call site to its target definition, so the code remains the primary visual language rather than being reduced to abstract graph nodes.

![Hyacinth’s Xanadu Folio standard view](docs/screenshots/standard-view.png)

## What it can do

- Open and index a local TypeScript project with the official TypeScript Compiler API.
- Search files, functions, methods, and user-defined business nodes.
- Expand calls outward one step at a time without mixing in unrelated callers.
- Trace exact call-site and definition ranges through visible source bridges.
- Inspect original files and return to the same FlowPage context.
- Filter static branches without presenting them as observed runtime paths.
- Model loops once with `LoopRegion`, back edges, exits, and conservative iteration estimates.
- Switch between standard and immersive reading modes with shared state.
- Open the overlay project drawer with `Ctrl+Space` and close it with `Esc`.
- Save FlowPages and business nodes locally and restore them after restart.

## Quick start

Requirements: Node.js 22.12 or newer and npm 11.

```powershell
npm ci
npm run dev
```

Production build and local launch:

```powershell
npm run build
npm run start
```

Run the verification suite:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run license:check
```

The bundled demo project is available at [`fixtures/order-service`](fixtures/order-service).

## Architecture

The application uses Electron, React, TypeScript, and Vite. Electron main, preload, utility indexer, and renderer are separated by typed IPC boundaries. The renderer never receives arbitrary filesystem access, and source code remains local unless the user explicitly chooses otherwise.

The core model and `LanguageAdapter` contract are language-neutral. MVP 0.1 ships with a TypeScript adapter; verified incremental indexing is tracked in [Issue #17](https://github.com/ljh2014137576-dev/hyacinths-xanadu-folio/issues/17).

See [architecture](docs/architecture.md), [requirements mapping](docs/requirements-mapping.md), and [ADRs](docs/adr/) for design details.

## Scope

This release is a static code reader. It does not implement breakpoints, variable capture, observed execution paths, threads, processes, or timeline debugging. Additional languages and runtime tracing are future work.

## License

Copyright © 2026 Hyacinth.

Licensed under the [GNU General Public License version 2](LICENSE), SPDX identifier `GPL-2.0-only`.
