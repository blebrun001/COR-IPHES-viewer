# External Release Validation

This document covers the validation steps that require external state not available from the current macOS workspace.

## Current Constraint

- Current host: macOS/Darwin ARM64.
- Docker is installed but the daemon is not running in the current session.
- GitHub CLI is authenticated for an account with access to the target repository.
- The remote repository currently exposes only the Pages workflow until local changes are pushed.

## Native CI Validation

After the local changes are committed and pushed to GitHub, validate cross-platform artifacts with the release workflow:

```bash
gh workflow run "Release builds" --repo blebrun001/COR-IPHES-Offline --ref <branch-or-tag>
gh run list --repo blebrun001/COR-IPHES-Offline --workflow "Release builds" --limit 5
gh run watch <run-id> --repo blebrun001/COR-IPHES-Offline --exit-status
```

Expected jobs:

- `macOS app`
- `Linux AppImage`
- `Windows portable`

Expected artifacts:

- `cor-iphes-macos`
- `cor-iphes-linux`
- `cor-iphes-windows`

## Artifact Launch Checks

Run these checks on the target operating systems.

### macOS

```bash
npm run validate:release:local
```

This is already validated in the current workspace.

### Linux

1. Download the `cor-iphes-linux` artifact from the `Release builds` workflow.
2. Make the AppImage executable.
3. Launch it directly.
4. Run the manual GUI acceptance checklist in `docs/manual-offline-acceptance.md`.

```bash
chmod +x *.AppImage
./*.AppImage
```

### Windows

1. Download the `cor-iphes-windows` artifact from the `Release builds` workflow.
2. Extract `COR-IPHES-Esqueletos-Off-linea-windows-portable.zip`.
3. Launch the executable directly.
4. Run the manual GUI acceptance checklist in `docs/manual-offline-acceptance.md`.

## Pass Criteria

- All three workflow jobs pass.
- macOS, Linux, and Windows artifacts are downloadable from GitHub Actions.
- Each platform artifact launches directly without a classic installer.
- The manual GUI offline acceptance checklist passes on at least one real user workstation, and preferably once per target OS.
