# Status Report

## Summary
- The project substantially implements the requested Tauri desktop offline viewer around `app/index.html`, with the product name `COR-IPHES Esqueletos Off-linea`.
- Offline catalog, SQLite storage, Dataverse sync preview/apply, local asset resolution, download queue states, and app-local opaque asset storage are present.
- The existing viewer workflows are largely preserved in the frontend: specimen search, taxonomy selection, metadata, model selection, 3D tools, and comparison modules are present.
- Automated JavaScript and Rust tests pass, confirming several local catalog, download, search, sync-manager, and model-loading behaviors.
- The final download UX follows `specimen-download-ux-brief.md`: downloads are selected by complete specimen only, and incomplete specimens are hidden from the main viewer.
- The offline download manager has been refactored into a clearer control center with global progress, local storage status, specimen-level and global queue actions, direct specimen search, active file details, and user-facing states for paused, interrupted, error, downloaded, and update-available specimens.
- The empty main viewer state now shows a clear Open downloads action instead of presenting a generic empty specimen list.
- Important remaining verification items are Windows/Linux portable artifacts and a manual GUI relaunch-with-network-disabled workflow.

## Done
- Desktop packaging foundation using Tauri is implemented.
- The first app entry point is the viewer at `app/index.html`, with no public landing page in the configured frontend dist.
- The app identity and offline marking are visible as `COR-IPHES Esqueletos Off-linea` and `Offline`.
- A native Dataverse synchronization backend is present with catalog preview, diffing, apply, and update confirmation paths.
- A local SQLite catalog schema is present for datasets, files, models, download states, byte counts, checksums, and jobs.
- Local catalog and local asset loading are implemented through the desktop bridge and Tauri asset protocol.
- Download-all and specimen-level selective download controls are implemented.
- Main viewer catalog listing is complete-specimen only by default; incomplete, queued, paused, partial, or error specimens remain available in the download manager.
- Queue, pause, resume, cancel, error state, partial state recovery, progress, current-file detail, and storage delete controls are present at specimen level, with global pause/resume/cancel controls for the active queue.
- The download manager can search specimens by label, identifier, persistent ID, or taxonomy while preserving taxonomy/state/sort filters.
- The main viewer stays focused on ready-to-view specimens; offline catalog updates, missing specimens, interrupted downloads, and error recovery are handled in the download manager.
- App-local opaque storage is implemented using hashed asset paths rather than exposing original `.obj`, `.mtl`, or texture names in the UI.
- External GBIF, CORA-RDR, and OLS links are hidden when the app detects offline state.
- macOS release artifacts were built and archived on June 8, 2026 at 11:48 CEST: `.app` and `.app.zip` under `COR-IPHES-Offline/src-tauri/target/release/bundle/macos/`.
- The macOS `.app` bundle launch smoke check passed: the bundled executable started and remained alive for 8 seconds without immediate crash.
- The canonical local release validation command `npm run validate:release:local` passes end-to-end on macOS.
- A native cross-platform release workflow is present at `COR-IPHES-Offline/.github/workflows/release-builds.yml` for macOS, Linux AppImage, and Windows portable artifacts.
- A reproducible manual GUI offline acceptance checklist is present at `COR-IPHES-Offline/docs/manual-offline-acceptance.md`.
- A reproducible external release validation checklist is present at `COR-IPHES-Offline/docs/external-release-validation.md`.
- A local release validation report is present at `COR-IPHES-Offline/docs/release-validation-report.md`.
- Documentation is consolidated around canonical `README.md` and `AGENT.MD`; obsolete `README 2.md` and `AGENT 2.MD` duplicates were removed to avoid contradictory guidance.
- Live Dataverse preview and small-model download tests pass against CORA-RDR/Dataverse.

## Not Done
- Portable Windows and Linux artifacts are not verified in the current macOS/Darwin workspace.
- Full manual GUI relaunch-with-network-disabled acceptance testing is not verified in this audit, although complete offline relaunch/asset resolution and interrupted download recovery are covered by automated Rust tests.
- Integrity/update policy behavior is partially evidenced by checksums and update states, but full release behavior is not manually verified.

## Working
- `npm test` passes local automated tests: 19 JavaScript tests and 13 Rust tests passed, with 2 live Dataverse tests ignored by the default command.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1` passes the 2 live Dataverse tests.
- `npm run tauri:build:mac` passes and produces the macOS `.app`; a fresh `.app.zip` archive was generated with `ditto`.
- `npm run validate:release:local` passes and covers `npm test`, live Dataverse tests, macOS build, archive generation, artifact checks, and launch smoke check.
- Local model source construction from downloaded catalog files is tested and passing.
- Catalog seed import, complete-only main listing, synchronized catalog listing, queueing complete specimen files, completed offline relaunch/asset resolution, interrupted download recovery after restart, and marking downloaded model files are tested and passing.
- Search text behavior, English text catalog behavior, model controller complete-specimen listing, empty offline viewer Open downloads CTA, defensive inline download enqueue/open-manager behavior, and active/error download handling are tested and passing.
- Sync manager specimen selection, direct search, specimen-level and global pause/resume/cancel/delete action rendering, active file details, error display, and main-list reload on completion are tested and passing.
- Local catalog storage deletion is tested to send only complete-specimen scope, not model-level scope.

## Not Working
- No currently verified failing behavior in the implemented complete-specimen desktop/offline scope.

## Unknown / Not Verifiable
- Whether the app launches successfully as portable artifacts on Windows and Linux is not verifiable from the current macOS workspace.
- Whether the complete GUI workflow works after closing the app, disabling internet, relaunching, and opening downloaded models was not manually verified in this audit.
- Whether packaging scripts produce the expected Windows portable archive and Linux AppImage was not verified because the release workflow has not been pushed/run on GitHub Actions from this workspace.
- Whether all existing online viewer tools behave identically in desktop/offline mode is not fully verified by the available tests.
- Whether Dataverse file-size metadata is available often enough to provide reliable download weight estimates is not verifiable from local evidence.

## Evidence (Files/Functions)
- `specimen-download-ux-brief.md`: final canonical brief for the complete-specimen download UX.
- `cor-iphes-esqueletos-off-linea-brief.md`: original desktop packaging brief; its model-level selection requirement is superseded by the final UX brief.
- `COR-IPHES-Offline/package.json`: Tauri build scripts for macOS, Linux, Windows, and full test command.
- `COR-IPHES-Offline/scripts/validate-release-local.mjs`: local release validation script for macOS.
- `COR-IPHES-Offline/README.md` and `COR-IPHES-Offline/AGENT.MD`: canonical project and agent documentation aligned with the Tauri desktop app.
- `COR-IPHES-Offline/.github/workflows/release-builds.yml`: native CI workflow for release artifacts on macOS, Linux, and Windows runners.
- `COR-IPHES-Offline/src-tauri/target/release/bundle/macos/COR-IPHES Esqueletos Off-linea.app`: verified macOS app bundle artifact.
- `COR-IPHES-Offline/src-tauri/target/release/bundle/macos/COR-IPHES-Esqueletos-Off-linea-macos.app.zip`: verified macOS portable archive artifact.
- `COR-IPHES-Offline/docs/manual-offline-acceptance.md`: manual GUI offline acceptance procedure.
- `COR-IPHES-Offline/docs/external-release-validation.md`: GitHub Actions and target-OS release validation procedure.
- `COR-IPHES-Offline/docs/release-validation-report.md`: local release validation evidence summary.
- `COR-IPHES-Offline/src-tauri/tauri.conf.json`: Tauri product name, `frontendDist` set to `../app`, app-local asset protocol scope, and bundle configuration.
- `COR-IPHES-Offline/app/index.html`: viewer-only app shell, offline badge, specimen/model selectors, external links, sync button, and 3D viewer surface.
- `COR-IPHES-Offline/src-tauri/src/lib.rs`: `AppState`, SQLite schema, `sync_preview`, `sync_apply`, `download_enqueue`, `download_pause`, `download_resume`, `download_cancel`, `download_status`, `storage_usage`, `storage_delete`, `asset_resolve`.
- `COR-IPHES-Offline/src-tauri/src/lib.rs`: `collect_request_file_ids` supports all-files and dataset-files collection by complete specimen.
- `COR-IPHES-Offline/app/public/js/data/localCatalogClient.js`: local catalog reads, local model source creation, material/texture resolution, and asset URL mapping.
- `COR-IPHES-Offline/app/public/js/data/hybridDataClient.js`: desktop-only local catalog facade and offline-aware data access.
- `COR-IPHES-Offline/app/public/js/ui/syncManager.js`: sync preview/apply UI, download-all, selected specimen download, direct specimen search, specimen/global pause/resume/cancel/delete, progress rendering, current-file/error display, global progress, and storage display.
- `COR-IPHES-Offline/app/public/js/ui/modelController.js`: complete-specimen gating in the main viewer, empty-state Open downloads CTA, and defensive inline download/open-download-manager behavior for missing, active, and error states.
- `COR-IPHES-Offline/app/public/js/ui/metadata.js`: hides GBIF, CORA-RDR, and UBERON links when `window.__COR_IPHES_ONLINE__ === false`.
- `COR-IPHES-Offline/app/public/js/ui/search.js`: avoids UBERON synonym refresh while offline.
- `COR-IPHES-Offline/tests/syncManager.test.js`: confirms specimen-level selected enqueue, search filtering by taxonomy/name, inclusion of incomplete specimens in the manager, specimen/global pause/resume/cancel behavior, error/current-file behavior, main-list reload on completion, and absence of model-level checkbox behavior.
- `COR-IPHES-Offline/tests/localCatalogClient.test.js`, `COR-IPHES-Offline/tests/modelController.test.js`, `COR-IPHES-Offline/tests/search.test.js`: passing JavaScript evidence for local asset/model source, complete-specimen storage deletion payloads, complete-only main viewer listing, empty offline viewer CTA, defensive inline download behavior, active/error manager routing, and search behavior.
- `COR-IPHES-Offline/src-tauri/src/lib.rs` tests: passing Rust evidence for seed import, complete-only catalog listing, catalog sync listing, queueing, offline relaunch/local asset resolution, interrupted download recovery, and downloaded model state.

## Recommended Next Actions
- Commit/push the local release workflow, then run and document release builds on macOS, Windows, and Linux, including artifact locations and launch checks.
- Perform a manual offline acceptance test: sync, download selected complete specimens, quit, disable network, relaunch, search, view metadata, load 3D models, and compare.
- Decide and document the update replacement, integrity verification, and cleanup policies that remain open in the brief.
