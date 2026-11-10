# Consume The @ljkt/* SDK (Build A New App)

## Scope

You are building a **separate app** that consumes `@ljkt/*` packages via `npm install` — not working inside the LJKT monorepo. If you are customizing the LJKT product itself, use [extend-cookbook.md](extend-cookbook.md) instead.

The SDK is early-stage (`0.x`). Versions below are current as of this writing — confirm against the registry when you install.

## Package Quick Reference

| Package | Version | Purpose | Key Exports | Peer Deps |
|---|---|---|---|---|
| `@ljkt/dsl` | 0.8.0 | The slide **contract** — types + JSON schema. Zero runtime deps. | `Slide`, `PPTElement`, `./schema/*` | none |
| `@ljkt/renderer` | 0.1.0 | Render slides to DOM (read-only). | `SlideCanvas`, `./snapshot`→`slideToPng` | react ≥18, react-dom ≥18, motion ≥11, tailwindcss ≥4; **optional:** echarts ≥5, shiki ≥1 |
| `@ljkt/editor` | 0.0.2 | Editable slide surface + prosemirror editor. | `EditableSlideCanvasWithUI` (from `./ui`) | react ≥18, react-dom ≥18 **+ renderer's full peer stack transitively** |
| `@ljkt/generation` | 0.3.0 | LLM-driven scene/lesson generation. | `generateSceneContent` | none |
| `@ljkt/storage` | 0.2.5 | Document / Runtime / Asset / KV stores (Browser · HTTP · PG · S3). | see table below | **optional:** `@aws-sdk/client-s3` |
| `@ljkt/importer` | 0.1.2 | Import PPTX / PDF into the DSL. | `importPptx` | none |

> `editor` is `0.0.2`. Its own `peerDependencies` list only `react`/`react-dom`, but it `dependencies` on `@ljkt/renderer`, so you must also satisfy the renderer's peers (tailwindcss v4, motion, and optionally echarts/shiki) or it breaks at render time.

## Minimal Starter — Render A Slide

1. Install peers and the package (pin exact versions for `0.x`):
   ```bash
   npm i @ljkt/dsl@0.8.0 @ljkt/renderer@0.1.0 \
         react@^18 react-dom@^18 motion@^11 tailwindcss@^4
   # only if you render charts / code-highlighted blocks:
   npm i echarts@^5 shiki@^1
   ```
2. Mandatory CSS — without it the canvas renders unstyled:
   ```css
   @import 'tailwindcss';
   @import '@ljkt/renderer/fonts.css';
   ```
   ...and ensure Tailwind v4 scans the renderer's classes, e.g. `@source '../node_modules/@ljkt/renderer/dist';` in your globals. (`fonts.css` is generated and fetches CJK woff2 on demand from `https://file.maic.chat/fonts/<name>.woff2` — relevant for offline/custom-font needs.)
3. Render:
   ```tsx
   import { SlideCanvas } from '@ljkt/renderer';
   import type { Slide } from '@ljkt/dsl';
   ```
   For a working example of props/usage, read `components/slide-renderer/SlideThumbnail.tsx` in the LJKT repo.

## Precise Import Paths

| Want | Import |
|---|---|
| Slide / element types | `@ljkt/dsl` (`Slide`, `PPTElement`) |
| JSON schema (validation) | `@ljkt/dsl/schema/*` |
| Render a slide | `@ljkt/renderer` (`SlideCanvas`) |
| Snapshot a slide → PNG | `@ljkt/renderer/snapshot` (`slideToPng`) |
| Editable slide surface | `@ljkt/editor/ui` (`EditableSlideCanvasWithUI`) |
| Generate lesson content | `@ljkt/generation` (`generateSceneContent`) |
| Import a PPTX | `@ljkt/importer` (`importPptx`) |
| Storage backends | see table below |

## Storage Backends — Exact Subpaths

There is **no** bare `@ljkt/storage/document`, `/runtime`, or `/asset` subpath — always use the **backend-suffixed** form. The main barrel (`@ljkt/storage`) is asymmetric:

| Domain | Browser | HTTP | PG | S3 |
|---|---|---|---|---|
| **Document** | barrel `.` | `./document/http` | `./document/pg` | — |
| **Runtime** | barrel `.` | `./runtime/http` ⚠️ | `./runtime/pg` ⚠️ | — |
| **Asset** | barrel `.` | `./asset/http` | `./asset/pg`, `./asset/pg-bytes` | `./asset/s3-bytes` |
| **KV** | barrel `.` | `./kv/http` | — | — |
| Server helpers | `./server`, `./server/reference` | | | |

⚠️ **Runtime asymmetry (the main gotcha):** `HttpRuntimeStore` and `PgRuntimeStore` are **only** reachable via `@ljkt/storage/runtime/http` and `@ljkt/storage/runtime/pg` — they are **not** in the main barrel. `BrowserRuntimeStore` is. Document/Asset/KV backends are all in the barrel. Importing `PgRuntimeStore` from `@ljkt/storage` will fail with "not exported".

PG backends ship an `ensureSchema` (plus a `*_PG_SCHEMA` constant) you must run once. S3 needs `@aws-sdk/client-s3` installed.

## Version Pinning

All six packages are `0.x`. Pin **exact** versions (e.g. `"@ljkt/renderer": "0.1.0"`), not `^` ranges — `0.x` semver treats minor bumps as breaking, and these packages are still moving fast.

## If You Need To Change The SDK Itself

Consuming via `npm install` means you treat the SDK as a black box. To modify SDK behavior, the path is heavier:

1. Fork `THU-MAIC/LJKT`, edit the package source under `packages/@ljkt/*`, rebuild its `dist/`.
2. Produce an installable artifact for **just that subpackage** and consume it in your app — e.g. `npm pack` the modified package and `npm install` the tarball, or publish it under a private/different package name and depend on that. ⚠️ A plain Git dependency or npm `overrides` / `resolutions` pointing at the repo **won't work**: a Git dependency resolves to the repository's root package, not `packages/@ljkt/<name>`.
3. Keep your fork's diff small and track upstream — the SDK is actively versioned.
