$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$envDirectory = Join-Path $repoRoot "apps\web\searxng"
$envFile = Join-Path $envDirectory ".env"
$composeFile = Join-Path $repoRoot "docker-compose.searxng.yml"

if (-not (Test-Path $envFile)) {
  New-Item -ItemType Directory -Force -Path $envDirectory | Out-Null
  $bytes = New-Object byte[] 48
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  }
  finally {
    $random.Dispose()
  }
  $secret = [Convert]::ToBase64String($bytes)
  [System.IO.File]::WriteAllText(
    $envFile,
    "SEARXNG_SECRET=$secret`r`n",
    [System.Text.Encoding]::ASCII
  )
}

docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose could not start the local SearXNG service."
}

$deadline = (Get-Date).AddSeconds(120)
do {
  try {
    $response = Invoke-RestMethod `
      -Uri "http://127.0.0.1:8889/search?q=lumi&format=json" `
      -TimeoutSec 8
    if ($response.PSObject.Properties.Name -contains "results") {
      Write-Output "SearXNG is ready at http://127.0.0.1:8889."
      exit 0
    }
  }
  catch {
    Start-Sleep -Seconds 3
  }
} while ((Get-Date) -lt $deadline)

throw "SearXNG did not become ready. Check Docker Desktop and run 'docker compose -f docker-compose.searxng.yml logs'."
