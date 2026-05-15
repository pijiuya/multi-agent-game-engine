# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules
from pathlib import Path


block_cipher = None
spec_dir = Path(SPECPATH)
repo_root = spec_dir.parent
hiddenimports = collect_submodules("agent_engine") + collect_submodules("uvicorn")
excluded_model_stack = [
    "functorch",
    "mobile_sam",
    "segment_anything",
    "tensorflow",
    "timm",
    "torch",
    "torchaudio",
    "torchvision",
]

a = Analysis(
    [str(spec_dir / "agent_engine_backend.py")],
    pathex=[str(repo_root), str(repo_root / "backend")],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excluded_model_stack,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="agent-engine-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
