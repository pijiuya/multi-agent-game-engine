param(
  [string]$ReleaseDir = (Join-Path (Resolve-Path "$PSScriptRoot\..\..\frontend\release") ""),
  [int]$Port = 8257,
  [int]$NarrativePort = 8258
)

$ErrorActionPreference = "Stop"

$portable = Get-ChildItem -Path $ReleaseDir -Filter "Multi-Agent Engine-*-win-portable-x64.exe" | Select-Object -First 1
if (-not $portable) {
  throw "No Windows portable artifact found in $ReleaseDir"
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mae-win-smoke-" + [System.Guid]::NewGuid().ToString("N"))
$homeDir = Join-Path $tmpRoot "home"
$appData = Join-Path $tmpRoot "AppData\Roaming"
New-Item -ItemType Directory -Force -Path $homeDir, $appData | Out-Null

$env:USERPROFILE = $homeDir
$env:APPDATA = $appData
$env:AGENT_ENGINE_PORT = "$Port"
$env:AGENT_ENGINE_NARRATIVE_PORT = "$NarrativePort"

$process = Start-Process -FilePath $portable.FullName -PassThru
try {
  $healthy = $false
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
      if ($response.ok -eq $true) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    throw "Packaged backend did not become healthy on port $Port"
  }

  $world = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/world" -TimeoutSec 5
  if ($world.agent_profiles.PSObject.Properties.Count -ne 0) {
    throw "Expected blank project with no agents, found $($world.agent_profiles.PSObject.Properties.Count)"
  }
  if ($world.map.items.Count -ne 0) {
    throw "Expected blank project with no items, found $($world.map.items.Count)"
  }
  if ($world.narrative.enabled -ne $false -or $world.narrative.dedicated_service_enabled -ne $false) {
    throw "Expected narrative to be disabled in blank project"
  }

  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$NarrativePort/healthz" -TimeoutSec 2 | Out-Null
    throw "Narrative sidecar unexpectedly started on port $NarrativePort"
  } catch {
    if ($_.Exception.Message -like "Narrative sidecar unexpectedly*") {
      throw
    }
  }

  $worldPath = Join-Path $appData "Multi-Agent Engine\runtime_project\world.sqlite"
  if (-not (Test-Path $worldPath)) {
    throw "Expected runtime database was not created at $worldPath"
  }

  Write-Host "WINDOWS_PORTABLE_SMOKE_OK"
  Write-Host "portable=$($portable.FullName)"
  Write-Host "backend_healthz=http://127.0.0.1:$Port/healthz"
  Write-Host "narrative_sidecar_default=not_started"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Recurse -Force $tmpRoot -ErrorAction SilentlyContinue
}
