# Manual Offline Acceptance Checklist

Use this checklist for the final GUI validation that cannot be fully proven by unit tests.

## Preconditions

- Build the macOS app with `npm run tauri:build:mac`, or download the artifact from the `Release builds` workflow.
- Start with a clean app-local data directory if validating first-run behavior.
- Keep internet available for the synchronization and download steps.

## Steps

1. Launch `COR-IPHES Esqueletos Off-linea.app`.
2. Confirm the app opens directly on the viewer, not the public landing page.
3. Confirm the offline app identity is visible.
4. Open the synchronization/download dialog.
5. Run catalog preview and confirm Dataverse changes/specimens are displayed.
6. Apply the catalog update. If replacement confirmation appears, verify the app waits for user confirmation before applying it.
7. Select one or more complete specimens. Confirm there are no bone/model/file checkboxes or per-model download controls.
8. Queue the selected specimens and verify global progress, per-specimen progress, files in progress, file counts, byte counts when available, and queued/downloading states.
9. Pause downloads and confirm active work stops without losing state.
10. Resume downloads and confirm already acquired files are not restarted unnecessarily.
11. Wait until at least one selected specimen is fully downloaded.
12. Confirm the completed specimen appears in the main viewer list.
13. Confirm partial, paused, or error specimens remain absent from the main viewer list and remain manageable in the download dialog.
14. Load the downloaded specimen metadata and at least one 3D model.
15. Exercise the existing viewer tools: rotation/orbit, model selector, screenshot, clipping or measurement, and comparison if a second downloaded specimen/model is available.
16. Quit the app.
17. Disable the network connection.
18. Relaunch the app.
19. Confirm the downloaded specimen still appears in the main viewer list.
20. Confirm metadata and 3D model loading still work without network.
21. Confirm external GBIF, CORA-RDR, and OLS links are hidden or disabled while offline.
22. Reopen the download dialog and confirm incomplete specimens/jobs are still visible and manageable.

## Pass Criteria

- The main viewer shows only fully downloaded specimens.
- The download manager remains the only place where incomplete specimens are visible.
- Downloads are controlled only by complete specimen or all-catalog actions.
- Pause, resume, cancel, and delete work without corrupting persisted state.
- Relaunch without network preserves search, metadata, 3D model loading, and comparison for downloaded data.
- The app does not expose downloaded `.obj`, `.mtl`, or texture paths through the UI.

## Current Automation Coverage

- `npm test` covers complete-only listing, specimen-only enqueue payloads, local model source construction, interrupted download recovery after restart, and offline relaunch/local asset resolution at backend level.
- `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1` covers live Dataverse catalog preview and a live small-model download.
- `npm run tauri:build:mac` plus the launch smoke check verifies the macOS bundle builds and starts without immediate crash.
