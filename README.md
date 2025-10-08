# Dataverse 3D Viewer

Web application that browses 3D models hosted in the CORA-IPES Dataverse directly in the browser using Three.js. The interface helps users pick a dataset, choose an OBJ/MTL model, and explore it with dedicated tools.

## Key Features
- On-demand loading of OBJ, MTL, and texture files through the Dataverse API.
- Automatic recentering, scaling, and scene setup for each model.
- Display controls for projection mode, textures, wireframe, lighting, screenshots.
- Interactive measurement mode with visual annotations.
- Internationalisation (i18n) with English, Spanish, French, and Catalan dictionaries.
- Dataset list caching in `localStorage` to speed up subsequent loads.

## Prerequisites
- Modern browser with WebGL 2 support.
- Network access to `https://dataverse.csuc.cat`.
- Local server: Python 3 (≥ 3.9) **or** Node.js (≥ 18) to serve the static files.

## Run Locally

### Python option (fastest)
```bash
cd /path/to/COR-IPHES-viewer
python3 -m http.server 8000
```
Open `http://localhost:8000/` in any compatible browser.

### Node.js option (with auto-reload)
```bash
cd /path/to/COR-IPHES-viewer
npm install --global serve
serve . --listen 8000
```

> Tip: the viewer relies on ES modules. Serving the project over HTTP avoids the CORS issues you would encounter when opening `index.html` directly from disk.

## Project Structure
```
COR-IPHES-viewer/
├── index.html               # Application entry point
├── public/
│   ├── css/styles.css       # Core stylesheets
│   ├── js/                  # Application logic
│   │   ├── app.js           # Viewer bootstrapper
│   │   ├── 3d/viewer3d.js   # Three.js setup, measurements, materials
│   │   ├── data/dataverseClient.js  # Dataverse API access and file indexing
│   │   ├── ui/interface.js  # UI logic, selectors, i18n, status banner
│   │   ├── sidebar.js       # Responsive sidebar behaviour
│   │   └── utils/…          # Utilities (default fetch, etc.)
│   ├── i18n/*.json          # Translation dictionaries
│   └── ressources/          # Logos and static assets
└── README.md
```

## Usage
1. Pick a dataset (specimen) from the first dropdown. The initial fetch can take a few seconds because the app queries the API for each dataset.
2. Select a model from the second dropdown. The required files are downloaded and rendered automatically.
3. Use the viewer toolbar to:
   - switch between perspective and orthographic cameras,
   - toggle textures and wireframe,
   - dim or restore lighting,
   - enter measurement mode, clear measurements, capture a PNG,
   - reset the view.
4. External links (GBIF, CORA-RDR, UBERON) appear when the dataset metadata includes the relevant references.
5. The “Reload lists” button forces a dataset refresh and clears the local cache.

## Internationalisation
- Translations are handled by `public/js/i18n/translator.js`.
- Each language lives in its own JSON file under `public/i18n/`.
- To add a language:
  1. Append `{ code: '<lang>' }` to `SUPPORTED_LANGUAGES`.
  2. Create `public/i18n/<lang>.json` by copying the structure from `en.json`.
  3. Ensure existing strings provide meaningful fallback defaults when translations are missing.

## Datasets and Performance Notes
- Metadata is normalised and rendered in the sidebar.
- `localStorage` keeps the dataset list for 24 hours (`CACHE_TTL_MS`). Use “Reload lists” or clear browser storage to bypass the cache.
- Textures downloaded during a session remain in memory so switching models is faster.

## Deployment
The project is static and can be hosted on any file-based platform (GitHub Pages, Netlify, nginx, …):
1. Serve the repository root directory (the one containing `index.html`).
2. Enforce HTTPS whenever possible (the Dataverse API is HTTPS-only).
3. Confirm that `https://dataverse.csuc.cat` is reachable from the hosting environment (no restrictive firewalls).

## Quality Checks
- Load at least one dataset and switch across multiple models.
- Exercise the measurement workflow (create/remove points) and capture screenshots.
- Test the interface on viewports below 1024 px to validate the mobile sidebar toggle.
- Review translations whenever UI copy changes.
- Perform basic accessibility checks: keyboard navigation, visible focus, `aria-*` attributes.

## Contributing
1. Create a dedicated branch for your changes.
2. Update documentation as needed (README, targeted code comments).
3. Manually verify the core flows (dataset load, measurement tools, i18n switching).
4. Open a Pull Request describing the changes and the tests you ran.

## Licence
CC-BY-NC 4.0
