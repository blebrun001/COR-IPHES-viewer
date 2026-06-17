# COR-IPHES Esqueletos Off-linea

COR-IPHES Esqueletos Off-linea is a desktop-only Tauri v2 application for browsing the COR-IPHES 3D osteological collection without relying on a live web viewer or CDN-hosted assets. It wraps the static frontend in `app/index.html`, stores catalog metadata in SQLite, and downloads Dataverse assets into the application-local data directory for offline inspection.

The application is intended for teaching, research support, collection review, and field or classroom situations where network access is limited.

## Main Features

- Offline-first 3D specimen browsing through a Tauri desktop wrapper.
- Local SQLite catalog seeded on first launch and refreshed from Dataverse on demand.
- Complete-specimen download workflow with queue, pause, resume, cancel, delete, and storage usage controls.
- Three.js OBJ/MTL viewer with taxonomy search, metadata panels, anatomical labels, screenshots, measurement tools, clipping planes, anaglyph view, scale reference, and side-by-side comparison.
- Vendored browser dependencies and fonts so the app can start without CDN access.
- Native backend-only Dataverse synchronization. The browser layer never talks directly to Dataverse in the finalized desktop flow.

## Repository Layout

```text
app/
  index.html                  Static frontend entry point loaded by Tauri.
  public/css/                 UI styling split by surface and responsibility.
  public/js/                  Frontend modules for state, UI, data, and 3D logic.
  public/vendor/              Vendored browser dependencies and fonts.

src-tauri/
  src/lib.rs                  Tauri backend, SQLite catalog, sync, downloads.
  src/main.rs                 Native binary entry point.
  resources/catalog_seed.json Bundled initial catalog snapshot.
  tauri.conf.json             Desktop app and bundle configuration.

tests/                        Node test suite for frontend logic.
scripts/                      Vendor, validation, and packaging helpers.
docs/                         Release validation and project notes.
```

Vendored third-party code under `app/public/vendor/` is not maintained as part of this project. Update it through `npm run vendor:three` instead of editing it manually.

## Architecture

The app has three main layers:

1. The frontend UI in `app/public/js/ui/` manages selectors, search, sync dialogs, metadata, and user commands.
2. The viewer in `app/public/js/3d/` wraps Three.js behind an intention-focused API (`createViewerApi`) so UI code does not need direct access to renderer internals.
3. The Tauri backend in `src-tauri/src/lib.rs` owns persistence, Dataverse network access, checksum validation, download recovery, and asset resolution.

The frontend talks to the backend through `LocalCatalogClient`, which calls Tauri commands via `desktopBridge`. `HybridDataClient` is kept as a small facade around the local catalog so existing UI code can use one data client contract.

## Offline Data Flow

1. On first launch, the backend creates the app-local data directory, initializes `catalog.sqlite3`, and imports `src-tauri/resources/catalog_seed.json` when the catalog is empty.
2. The main specimen selector lists only complete downloaded specimens by default.
3. The synchronization manager can request `sync_preview` while online to inspect current Dataverse metadata.
4. Applying a sync writes remote catalog metadata into SQLite. Destructive replacements require an explicit decision from the UI.
5. Download requests enqueue the required files for complete specimens. Files are stored as opaque blobs under app-local storage, with checksums and byte counts tracked in SQLite.
6. When the viewer loads a model, the frontend asks `asset_resolve` for local paths and converts them to Tauri asset URLs. OBJ material-library references and MTL texture references are resolved against the local catalog.

Downloaded source assets are intentionally not exposed as loose `.obj`, `.mtl`, or texture files in the UI.

## Requirements

- Node.js 18 or newer
- Rust and Cargo
- Tauri v2 native prerequisites for the target operating system

Install JavaScript dependencies:

```bash
npm install
```

Refresh vendored Three.js assets from `node_modules`:

```bash
npm run vendor:three
```

## Development

Run the desktop app:

```bash
npm run tauri:dev
```

Run the full automated test suite:

```bash
npm test
```

Run frontend tests only:

```bash
npm run test:js
```

Run Rust tests only:

```bash
npm run test:rust
```

Some Rust tests exercise live Dataverse behavior and may require network access or ignored-test flags depending on the workflow under validation.

## Tauri Commands

The frontend uses these backend commands:

- `catalog_list` lists catalog entries, hiding incomplete specimens unless requested by the sync manager.
- `catalog_entry_command` returns a hydrated dataset entry with files and models.
- `sync_preview` fetches Dataverse metadata and reports catalog changes.
- `sync_apply` persists accepted catalog changes.
- `download_enqueue` queues required specimen files.
- `download_pause`, `download_resume`, and `download_cancel` manage queued or active jobs.
- `download_status` reports global, specimen-level, and file-level progress.
- `storage_usage` reports local asset storage usage.
- `storage_delete` removes downloaded assets for one specimen or all specimens.
- `network_status` checks whether the Dataverse API is reachable.
- `asset_resolve` converts a downloaded catalog file into a local asset path.

## Build and Packaging

Build targets:

```bash
npm run tauri:build:mac
npm run tauri:build:linux
npm run tauri:build:windows
```

Expected primary artifacts:

- macOS: `.app` and zipped `.app` under `src-tauri/target/release/bundle/macos/`
- Linux: `.AppImage` built on Linux
- Windows: portable archive created by `scripts/package-windows-portable.mjs` on Windows

Cross-platform release artifacts can also be produced by the `Release builds` GitHub Actions workflow in `.github/workflows/release-builds.yml`.

## Release Validation

Canonical local release validation on macOS:

```bash
npm run validate:release:local
```

This command runs the local JavaScript and Rust tests, live Dataverse checks, macOS release build, `.app.zip` creation, artifact checks, and a launch smoke check.

Additional validation material:

- `docs/release-validation-report.md` records local validation evidence.
- `docs/manual-offline-acceptance.md` describes the full GUI offline acceptance pass.
- `docs/external-release-validation.md` covers Windows, Linux, and GitHub Actions artifact validation.
- `docs/project/` contains project briefs and implementation status notes.

Manual acceptance should confirm that:

- First launch imports the bundled catalog seed.
- `sync_preview` scans Dataverse while online.
- `sync_apply` populates SQLite after user confirmation for replacements.
- Selected complete-specimen and full-catalog downloads can be queued, paused, resumed, cancelled, and deleted.
- After relaunch with network disabled, downloaded specimen metadata and 3D models still load.
- The app starts without CDN dependencies.
- Linux AppImage and Windows portable archives run on their target systems.

## Development Notes

- Keep browser-facing text in English.
- Keep frontend modules small and responsibility-oriented: state in `app/public/js/state/`, data access in `app/public/js/data/`, viewer logic in `app/public/js/3d/`, and DOM orchestration in `app/public/js/ui/`.
- Prefer the `viewerApi` facade over direct `Viewer3D` access from UI modules.
- Do not bypass the Tauri backend for Dataverse access in production desktop flows.
- Keep local assets opaque; the catalog database is the source of truth for file-to-model relationships.

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International license (`CC-BY-NC-4.0`). See `LICENSE` for the project license and `NOTICE` for third-party license notes.

Third-party dependencies keep their own licenses. In particular, vendored Three.js files under `app/public/vendor/three/` are covered by the upstream Three.js license included in that directory.
