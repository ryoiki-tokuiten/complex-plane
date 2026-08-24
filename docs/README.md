# Complex Function Analysis — System Atlas & Architecture Docs

This directory contains the architecture documentation and the interactive **System Atlas** for the `complex-plane` codebase.

## Documentation Structure

| File | Role | Edit it? |
|---|---|---|
| [`docs/atlas/data.mjs`](file:///home/roshan/Documents/Projects/complex-plane/docs/atlas/data.mjs) | **Single source of truth**: structures, flows, chapters, decisions, questions, performance model, prose | **Yes** (edit here) |
| [`docs/atlas/template.html`](file:///home/roshan/Documents/Projects/complex-plane/docs/atlas/template.html) + [`docs/atlas/build.mjs`](file:///home/roshan/Documents/Projects/complex-plane/docs/atlas/build.mjs) | Visualizer template & text generator | Presentation only |
| [`docs/atlas.html`](file:///home/roshan/Documents/Projects/complex-plane/docs/atlas.html) | Interactive isometric canvas visualizer with inspectable animated data packets | **No** (generated) |
| [`docs/SYSTEM.md`](file:///home/roshan/Documents/Projects/complex-plane/docs/SYSTEM.md) | Built text twin with decisions, structures, and question index | **No** (generated) |
| [`docs/CONTEXT.md`](file:///home/roshan/Documents/Projects/complex-plane/docs/CONTEXT.md) | Domain glossary (nouns, one line each) | By hand |

## Building the Atlas

Whenever architectural decisions, structures, execution steps, or question resolutions change in `docs/atlas/data.mjs`, rebuild both views:

```bash
npm run build:atlas
# or
node docs/atlas/build.mjs
```

## Viewing the Interactive Atlas

Open `docs/atlas.html` in any modern web browser or serve it locally:

```bash
npx serve docs
# or
python3 -m http.server --directory docs 8080
```

### Controls in the Atlas:
- **`Next ▸` / `◂ Back`** or **`Enter` / `]` / `[`**: Step through progressive disclosure chapters.
- **Hover on box**: Shows plain-language summary and role.
- **Click on box**: Pins panel to show deep implementation details, files, and open questions.
- **Double click / `→`**: Drills **inside** the structure to inspect its execution steps with a step packet.
- **`←` / `Come back out`**: Returns to the world view.
- **Click any moving dot**: Pauses animation and inspects the real JSON data payload for that hop.
- **`Trace one step`**: Steps packet animation forward one hop at a time.
- **Drag to pan, Scroll to zoom, `+` / `−` / `Refit`**: Full camera manipulation.
