# Release Validation Report

Generated for the current local finalization pass and last updated after `npm run validate:release:local` completed successfully.

## Environment

- Host OS: macOS 26.5.1 (`Darwin`, ARM64)
- Workspace: `COR-IPHES-Offline`
- Product: `COR-IPHES Esqueletos Off-linea`
- Canonical local validation command: `npm run validate:release:local`

## Local Validation Status

The local macOS release validation passes end-to-end.

Covered by `npm run validate:release:local`:

- JavaScript test suite.
- Rust test suite.
- Live Dataverse catalog preview test.
- Live Dataverse small-model download test.
- macOS Tauri release build.
- macOS `.app.zip` archive creation with `ditto`.
- Artifact existence and non-empty archive checks.
- macOS app launch smoke check.

## Current macOS Artifacts

- `.app`: `src-tauri/target/release/bundle/macos/COR-IPHES Esqueletos Off-linea.app`
- `.zip`: `src-tauri/target/release/bundle/macos/COR-IPHES-Esqueletos-Off-linea-macos.app.zip`
- Last verified artifact timestamp: June 8, 2026 11:48 CEST
- Last verified `.zip` size: 12,924,250 bytes

## Automated Coverage

Default local tests currently cover:

- Complete-specimen-only listing in the main viewer.
- Inclusion of incomplete specimens in the download manager.
- Absence of model-level checkbox enqueue UI.
- Complete-specimen enqueue payloads using `datasetIds`.
- Complete-specimen-only storage delete payloads.
- Local catalog model-source construction.
- Seed catalog import.
- Queueing complete specimen files.
- Download completion and local opaque asset storage.
- Restart recovery for interrupted downloads.
- Offline relaunch/local asset resolution for a downloaded specimen.

Live tests currently cover:

- Dataverse catalog preview against CORA-RDR/Dataverse.
- Small live Dataverse model download and catalog state update.

## Manual/External Validation Still Required

These checks require state outside the current macOS workspace:

- Run the `Release builds` GitHub Actions workflow after local changes are committed and pushed.
- Verify the Linux AppImage on Linux.
- Verify the Windows portable archive on Windows.
- Run the full GUI offline acceptance checklist in `docs/manual-offline-acceptance.md`.

## Related Procedures

- Full GUI checklist: `docs/manual-offline-acceptance.md`
- GitHub Actions and target-OS validation: `docs/external-release-validation.md`
