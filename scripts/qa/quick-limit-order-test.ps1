$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $root
Set-Location $root

function Start-DevServerIfNeeded {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 2
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
      return @{ Started = $false; Pid = $null }
    }
  } catch {}

  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev -- --host 127.0.0.1 --port 5173" -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return @{ Started = $true; Pid = $proc.Id }
      }
    } catch {}
  }

  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw "Cannot start local dev server on http://127.0.0.1:5173"
}

$server = Start-DevServerIfNeeded

try {
  npx --yes --package @playwright/cli playwright-cli install | Out-Null
  npx --yes --package @playwright/cli playwright-cli open http://127.0.0.1:5173 --browser msedge | Out-Null

  $codePath = Join-Path $root "scripts/qa/quick-limit-order-test.run.js"
  $code = Get-Content -Raw $codePath
  $code = ($code -replace "`r?`n", " ")
  $output = npx --yes --package @playwright/cli playwright-cli run-code $code 2>&1
  $outputText = ($output | Out-String)

  Write-Output $outputText

  if ($LASTEXITCODE -ne 0) {
    throw "playwright-cli run-code returned non-zero exit code: $LASTEXITCODE"
  }
  if ($outputText -match "### Error") {
    throw "Deterministic quick limit test failed."
  }
  if ($outputText -notmatch '"ok"\s*:\s*true') {
    throw "Deterministic quick limit test did not return ok=true."
  }

  Write-Host "PASS: deterministic quick limit order test"
} finally {
  npx --yes --package @playwright/cli playwright-cli close-all | Out-Null
  if ($server.Started -and $server.Pid) {
    try { Stop-Process -Id $server.Pid -Force -ErrorAction SilentlyContinue } catch {}
  }
}
