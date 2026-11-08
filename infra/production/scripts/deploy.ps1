# Builds and starts the stack on 127.0.0.1:4317.
# Does not stop any process. Does not touch host port 5432 or 6379.
param()
$ErrorActionPreference = 'Stop'
$envFile = (Resolve-Path (Join-Path $PSScriptRoot '..\.env')).Path
$composeFile = (Resolve-Path (Join-Path $PSScriptRoot '..\docker-compose.yml')).Path
if (-not (Test-Path $envFile)) {
  throw "Missing $envFile. Run generate-env.ps1 and fill TELEGRAM_BOT_TOKEN first."
}

function Read-EnvValue([string]$Name) {
  foreach ($line in Get-Content $envFile) {
    if ($line -like "$Name=*") { return $line.Substring($Name.Length + 1) }
  }
  return ''
}

$portText = Read-EnvValue 'EDGE_PORT'
if (-not $portText) { $portText = '4317' }
$port = [int]$portText
if ($port -eq 5432 -or $port -eq 6379) {
  throw "Refusing to publish the edge on port $port. Postgres on 5432 is a different process and stays up."
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  throw @"
Port $port is in use. Stop only the old bakery test app, then run this script again.
Find it with: docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"
Do not stop the process listening on port 5432.
"@
}

docker compose --env-file $envFile -f $composeFile up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose failed' }

$deadline = (Get-Date).AddMinutes(8)
do {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/v1/health/ready" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
      Write-Host "Ready at http://127.0.0.1:$port"
      Write-Host 'Postgres and Redis are not published on the host. Port 5432 was left alone.'
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 3
  }
} while ((Get-Date) -lt $deadline)

throw "The proxy did not become ready on port $port."
