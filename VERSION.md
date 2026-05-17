# Versioning

Current release: `v0.1.0`

This project uses one public release version for the Python backend, React/Vite frontend, and Electron desktop app.

- Python package version: [`pyproject.toml`](pyproject.toml)
- Frontend / Electron version: [`frontend/package.json`](frontend/package.json)
- GitHub release tags: `vX.Y.Z`
- Release notes: [`CHANGELOG.md`](CHANGELOG.md)

Before publishing a new release:

1. Update both package versions.
2. Update `CHANGELOG.md`.
3. Build and test backend and frontend.
4. Create platform assets.
5. Publish the GitHub Release and upload assets.
