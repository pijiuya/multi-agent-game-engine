# Changelog

All notable changes to this project are documented here.

## v0.1.0 - 2026-05-17

Initial public GitHub release.

### Added

- Local-first multi-agent simulation engine with FastAPI backend and SQLite persistence.
- React/Vite 2D workbench with transparent panels, map editing, region tools, agent panels, item controls, and model management.
- Electron desktop shell for local desktop usage.
- LLM decision event tracing through `decision_events`.
- Agent GIF / PNG sequence animation support.
- Local model capability management for Ollama, vision labeling, image generation configuration, and embedded MobileSAM.
- Official static pages in `frontend/`: overview, docs, download, download success, and sponsor placeholder.
- Mac and Windows packaging scripts.

### Release Assets

- `Multi-Agent-Engine-0.1.0-mac-install-kit.zip`
- `Multi-Agent.Engine-0.1.0-mac-arm64.dmg`
- `Multi-Agent.Engine-0.1.0-win-installer-x64.exe`

### Known Limitations

- Mac packages are not notarized with an Apple Developer ID.
- Windows portable packaging is prepared in scripts, but the current public asset is the installer.
- The sponsor page is a placeholder and does not include a live payment endpoint.
- Real image generation requires an external compatible provider; mock and import workflows remain available.
