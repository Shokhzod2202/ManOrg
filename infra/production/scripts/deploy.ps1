# Builds and starts the stack on 127.0.0.1:4317.
# Does not stop any process. Does not touch host port 5432 or 6379.
# Port checks use a socket bind. They do not load the NetTCPIP module.
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

function Test-AddressInUse {
  param($ErrorRecord)
  $current = $ErrorRecord.Exception
  while ($null -ne $current) {
    if ($current -is [System.Net.Sockets.SocketException] -and
      $current.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressAlreadyInUse) {
      return $true
    }
    $current = $current.InnerException
  }
  return $false
}

function Get-PortOwners([int]$Port) {
  $lines = & netstat.exe -ano -p TCP 2>&1
  if ($LASTEXITCODE -ne 0) {
    return "netstat.exe exited $LASTEXITCODE. The port is still occupied."
  }
  $found = @()
  foreach ($line in @($lines)) {
    $text = "$line".Trim()
    if ($text -match "^\s*TCP\s+.+:$Port\s+\S+\s+\S+\s+\d+\s*$") {
      $found += $text
    }
  }
  if ($found.Count -eq 0) {
    return "A bind to port $Port failed because the address is already in use."
  }
  return ($found -join [Environment]::NewLine)
}

function Assert-PortFree([int]$Port) {
  $addresses = @(
    [System.Net.IPAddress]::Loopback,
    [System.Net.IPAddress]::Any
  )
  foreach ($address in $addresses) {
    $listener = $null
    try {
      $listener = New-Object System.Net.Sockets.TcpListener($address, $Port)
      $listener.ExclusiveAddressUse = $true
      $listener.Start()
    } catch {
      if (Test-AddressInUse $_) {
        $owners = Get-PortOwners $Port
        throw @"
Port $Port is in use. Stop only the old bakery test app, then run this script again.
$owners
Find it with: docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"
Do not stop the process listening on port 5432.
"@
      }
      throw
    } finally {
      if ($null -ne $listener) { $listener.Stop() }
    }
  }
}

$portText = Read-EnvValue 'EDGE_PORT'
if (-not $portText) { $portText = '4317' }
$port = [int]$portText
if ($port -eq 5432 -or $port -eq 6379) {
  throw "Refusing to publish the edge on port $port. Postgres on 5432 is a different process and stays up."
}

Assert-PortFree $port

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
