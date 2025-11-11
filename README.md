# COR-IPHES 3D Viewer

The COR-IPHES 3D Viewer is a fully static web experience built to showcase the COR-IPHES osteological reference collection. It combines a public landing page with an advanced Three.js viewer that streams models directly from the CORA Dataverse. The application emphasises accessibility, internationalisation, and tooling that make scientific 3D assets easier to explore.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Feature Highlights](#feature-highlights)
3. [Architecture](#architecture)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Getting Started](#getting-started)
7. [Development Workflow](#development-workflow)
8. [Configuration & Environment](#configuration--environment)
9. [Dataverse Integration](#dataverse-integration)
10. [Internationalisation (i18n)](#internationalisation-i18n)
11. [3D Viewer Capabilities](#3d-viewer-capabilities)
12. [Styling System](#styling-system)
13. [Performance Notes](#performance-notes)
14. [Testing & Quality Checklist](#testing--quality-checklist)
15. [Deployment](#deployment)
16. [Troubleshooting](#troubleshooting)
17. [Contributing](#contributing)
18. [License](#license)

---

## Project Overview
- **Landing page (`index.html`)** — Public-facing introduction to the COR-IPHES initiative, describing partners and providing a lightweight hero viewer that animates a cranial model.
- **Application shell (`app/`)** — Feature-rich 3D viewer with dataset browsing, measurement tools, clipping planes, and comparison mode. Everything runs client-side using native ES modules.
- **Static hosting** — No backend is required. Assets can be deployed to any static web host (GitHub Pages, Netlify, nginx, Apache, etc.).

---

## Feature Highlights
- **Direct Dataverse access**: OBJ, MTL, and texture files stream on demand from the CORA Dataverse API (`https://dataverse.csuc.cat`).
- **Automatic scene preparation**: Models are recentred, scaled, lit, and framed as soon as they load.
- **Rich tooling**: Perspective/orthographic projections, material toggles, wireframe views, scale reference cube, measurement overlays, anaglyph rendering, and rotation gizmo support.
- **Comparison workflow**: Pin a primary model and load a secondary one side-by-side, with optional normalised scaling.
- **Internationalisation**: English, Spanish, French, and Catalan dictionaries ship with the project; the viewer can switch languages at runtime.
- **Offline-friendly cache**: Dataset metadata lists are cached in `localStorage` to reduce API calls between sessions.
- **Responsive UI**: Sidebar collapses into a drawer on smaller screens, with dedicated touch affordances.

---

## Architecture
| Layer | Purpose | Key Files |
| --- | --- | --- |
| **Landing** | Presents the project and embeds a simplified viewer to animate a model in the hero section. | `index.html`, `script.js`, `styles.css`, `responsive.css`, assets in `ressources/` |
| **Viewer UI** | Provides layout, panels, toolbar, dialogs, and i18n strings. | `app/index.html`, `app/public/css/*.css`, `app/public/js/ui/*`, `app/public/js/state/*`, `app/public/js/options.js`, `app/public/js/sidebar.js`, `app/public/js/about.js` |
| **Viewer Core** | Handles Three.js scenes, measurements, clipping, export, and comparison logic. | `app/public/js/3d/*.js` |
| **Data** | Communicates with the Dataverse API, normalises metadata, prepares model manifests. | `app/public/js/data/dataverseClient.js`, `app/public/js/utils/defaultFetch.js` |
| **Translations** | Localised strings and keys for the i18n engine. | `app/public/i18n/*.json` |

All modules are written using modern ES syntax and loaded directly by the browser—no bundler is required.

---

## Project Structure
```
.
├── index.html                  # Public landing page with hero viewer
├── script.js                   # Three.js hero viewer bootstrapper
├── styles.css                  # Landing styles (layout, theme, typography)
├── responsive.css              # Landing responsive overrides
├── ressources/                 # Images & 3D assets used on the landing page
└── app/
    ├── index.html              # Viewer application shell
    ├── public/
    │   ├── css/                # Modular CSS tokens, layout, and components
    │   ├── i18n/               # Translation dictionaries
    │   └── js/
    │       ├── app.js          # Application bootstrapper (viewer + data client)
    │       ├── 3d/             # Three.js viewer, mixins, effects
    │       ├── data/           # Dataverse API client
    │       ├── state/          # Lightweight global store
    │       ├── ui/             # UI controllers, search, metadata rendering
    │       ├── options.js      # Options dialog logic
    │       ├── sidebar.js      # Sidebar responsiveness & accessibility
    │       ├── about.js        # About dialog behaviour
    │       └── utils/          # Shared utilities (fetch detection, etc.)
    └── public/ressources/      # Viewer-specific images and logos
```

---

## Prerequisites
- Modern browser with **WebGL 2** support (Chrome, Firefox, Edge, Safari ≥ 16).
- Internet access to `https://dataverse.csuc.cat`.
- A local static server to serve the files (due to module and CORS requirements).
  - **Python 3.9+** (recommended) or **Node.js 18+**.

---

## Getting Started
### 1. Clone or download the repository
```bash
git clone https://github.com/<org>/<repo>.git
cd <repo>
```

### 2. Start a local web server
<details>
<summary>Python (minimal, no install)</summary>

```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000/`.
</details>

<details>
<summary>Node.js (with live reload via <code>serve</code>)</summary>

```bash
npm install --global serve
serve . --listen 8000
```
Then open `http://localhost:8000/`.
</details>

### 3. Open the application
- `http://localhost:8000/` — landing page with hero viewer.
- `http://localhost:8000/app/index.html` — full 3D viewer application (also linked from the landing page).

---

## Development Workflow
1. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-change
   ```
2. **Make changes** inside `app/public/js` or `app/public/css`, or update landing assets.
3. **Serve locally** as described above to preview your changes.
4. **Verify core flows** (dataset loading, measurement, comparison, i18n switching).
5. **Document updates** in this README if behaviour or tooling changes.
6. **Open a Pull Request** summarising changes and validation steps.

> The project intentionally avoids bundlers. Keep modules self-contained and ensure paths remain relative.

---

## Configuration & Environment
- **Environment variables**: None required. API endpoints are hard-coded in `app/public/js/data/dataverseClient.js`.
- **Caching**: Dataset listings are cached in `localStorage` for 24 hours. Use the “Reload lists” button (options dialog) to bust cache manually.
- **Theme**: Dark theme by default. Users may toggle light/dark via the options dialog; theme selection is persisted in `localStorage`.
- **Build step**: Not required. Any optimisation (minification, bundling) would have to be scripted manually if desired for production.

---

## Dataverse Integration
`DataverseClient` performs the following:
1. Queries dataset listings from the CORA Dataverse (`/api/dataverses/<alias>/contents`).
2. For each dataset, fetches metadata to identify OBJ/MTL/texture files.
3. Builds model manifests with resolved URLs for assets.
4. Normalises metadata (taxonomy, specimen info, identifiers) for the viewer UI.

The client accepts a custom `fetch` implementation, enabling substitution during testing. Default behaviour falls back to `window.fetch`.

---

## Internationalisation (i18n)
- Translation dictionaries live in `app/public/i18n/*.json`.
- Supported languages: `en`, `es`, `fr`, `ca`.
- UI strings use the `"group.key"` notation (e.g., `"sidebar.moreInfoHeading"`).
- The translator module (`app/public/js/i18n/translator.js`) handles:
  - Loading dictionaries,
  - Updating text content and `data-i18n-attr` attributes,
  - Persisting the selected language.
- To add a language:
  1. Duplicate `en.json`, translate values, and save as `<lang>.json`.
  2. Register the new language code in `SUPPORTED_LANGUAGES`.
  3. Provide fallbacks for any new strings.

---

## 3D Viewer Capabilities
- **Model lifecycle**: Primary model management, comparison mode, screenshot capture with watermark and measurement overlays.
- **Camera controls**: Perspective/orthographic switching, orbit modes (upright vs. free), focus on active content.
- **Rendering toggles**: Textures, wireframe, lighting dimmer, scale reference cube, anaglyph stereo (adjustable eye separation).
- **Tools**:
  - Measurement mode with labelled segments,
  - Label overlays for comparison models,
  - Clipping planes with draggable handles,
  - Rotation gizmo using Three.js `TransformControls`.
- **Export**: Capture PNG screenshots with watermark (`app/public/js/3d/export.js`).

Each capability is implemented as a mixin in `app/public/js/3d/`, enhancing the core `Viewer3D` class to keep features loosely coupled.

---

## Styling System
- **Design tokens** (`app/public/css/tokens.css`) define colours, typography, spacing.
- **Modular CSS**: Styles are broken into semantic files (top bar, toolbar, metadata panel, responsive overrides).
- **Glassmorphism aesthetic**: Panels use translucent backgrounds with blur to maintain focus on the model.
- **Responsive behaviour**:
  - Sidebar collapses into an overlay below 1024 px.
  - Toolbar reflows button groups and hides secondary controls on narrow viewports.
  - Touch devices receive larger hit targets and touch-action adjustments.

---

## Performance Notes
- **Lazy loading**: Assets are fetched on demand; nothing is bundled upfront.
- **Caching**: Dataverse metadata caching reduces repeated API calls. Textures are cached per session in memory.
- **Throttle management**: Loading manager and progress events provide feedback; models may take several seconds depending on size and network.
- **Mobile considerations**: Heavy models may push memory constraints on low-end devices. Encourage users to switch to desktop for full fidelity.

---

## Testing & Quality Checklist
- [ ] Load at least one dataset and confirm the model appears with textures.
- [ ] Switch between projection modes and orbit modes.
- [ ] Enable measurement mode, create/remove measurements, and export a screenshot.
- [ ] Enter comparison mode, load a secondary model, and toggle scale normalisation.
- [ ] Test clipping planes: enable, drag handles, reset.
- [ ] Toggle each rendering option (textures, wireframe, lighting dimmer, scale reference).
- [ ] Switch languages and verify translations update dynamically.
- [ ] Resize the browser below 1024 px and confirm the sidebar toggle works.
- [ ] Test the options dialog and ensure theme switching applies correctly.

---

## Deployment
1. **Build artefacts**: Since the project is static, deployment equals copying the repository files to the hosting provider.
2. **Configure hosting**:
   - Serve from the repository root (the directory containing `index.html`).
   - Ensure the `/app/` subdirectory is available as-is.
   - Enforce HTTPS so that browser requests to `https://dataverse.csuc.cat` succeed.
3. **CDN/Cache headers**: Optional, but consider enabling caching for static assets (`.js`, `.css`, textures) while keeping HTML uncached for rapid updates.
4. **Post-deploy checks**: Validate core flows, especially Dataverse fetches (some hosts block external APIs).

---

## Troubleshooting
| Symptom | Possible Cause | Resolution |
| --- | --- | --- |
| Models fail to load | Dataverse API unreachable or CORS blocked | Confirm host allows outgoing HTTPS requests to `dataverse.csuc.cat`; check browser console for errors. |
| Blank canvas | WebGL disabled | Enable hardware acceleration or switch to a WebGL 2 compatible browser/device. |
| Landing hero model missing textures | Asset paths in `script.js` or `ressources/model/` incorrect | Verify filenames and relative paths. |
| Translation strings show placeholders | Missing keys in dictionary | Ensure each dictionary file mirrors the structure of `en.json`. |
| Sidebar stuck open on mobile | Cached `localStorage` state | Toggle the sidebar off, or clear site data/storage. |

---

## Contributing
1. Fork the repository and create a feature branch.
2. Follow the [Development Workflow](#development-workflow).
3. Keep PRs focused—documentation updates are welcome alongside code changes.
4. Describe validation steps (manual tests, browsers used, datasets loaded).
5. Ensure new features include appropriate comments and, when applicable, translation keys.

---

## License
This project is distributed under the **Creative Commons CC BY-NC 4.0** licence. Attribution to COR-IPHES and collaborators is required for derivative works; commercial use is prohibited.

---

> For questions or contributions related to the COR-IPHES collection, please contact the project maintainers or the IPHES-CERCA team.
