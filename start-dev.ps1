<#
 .SYNOPSIS
  Convenience wrapper to start backend server (Express + ws) and Vite frontend on strict port 1002.

 .DESCRIPTION
  Runs `npm install` if node_modules missing, then attempts `npm run dev:full`.
  Falls back to spawning `npm run server` and `npm run dev` in parallel if dev:full script not found.
  Designed for Windows PowerShell (v5+). Use: Right-click -> Run with PowerShell or `./start-dev.ps1`.
#>

param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

Write-Host "== Afro_Future Dev Bootstrap ==" -ForegroundColor Cyan

if (-not $SkipInstall) {
  if (-not (Test-Path node_modules)) {
    Write-Host "node_modules missing → running npm install..." -ForegroundColor Yellow
    npm install
  } else {
    Write-Host "node_modules present (use -SkipInstall to bypass check)." -ForegroundColor DarkGray
  }
} else {
  Write-Host "SkipInstall flag supplied → skipping dependency check." -ForegroundColor DarkGray
}

# Detect dev:full script
$pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
$hasDevFull = $pkgJson.scripts.PSObject.Properties.Name -contains 'dev:full'

if ($hasDevFull) {
  Write-Host "Starting combined dev:full script..." -ForegroundColor Green
  npm run dev:full
  exit $LASTEXITCODE
}

Write-Host "dev:full script not found → launching server + vite separately." -ForegroundColor Yellow

$server = Start-Process -FilePath "npm" -ArgumentList "run","server" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$frontend = Start-Process -FilePath "npm" -ArgumentList "run","dev" -PassThru -WindowStyle Hidden

Write-Host "Processes started:" -ForegroundColor Green
Write-Host "  Server  PID: $($server.Id) (port 8080 expected)"
Write-Host "  Frontend PID: $($frontend.Id) (port 1002 strict)"
Write-Host "Press Ctrl+C to terminate or close this window." -ForegroundColor Cyan

Wait-Process -Id $server.Id,$frontend.Id