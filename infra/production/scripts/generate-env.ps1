# Writes infra\production\.env with locally generated secrets. Does not print secret values.
param(
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\.env'
if ((Test-Path $out) -and -not $Force) {
  throw "$out already exists. Re-run with -Force to replace it."
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

$bot = if ($env:TELEGRAM_BOT_TOKEN) { $env:TELEGRAM_BOT_TOKEN } else { '' }
$webhook = if ($env:TELEGRAM_WEBHOOK_SECRET) { $env:TELEGRAM_WEBHOOK_SECRET } else { New-Secret }
$admins = if ($env:TELEGRAM_BOOTSTRAP_ADMIN_IDS) { $env:TELEGRAM_BOOTSTRAP_ADMIN_IDS } else { '5220814834' }
$port = if ($env:EDGE_PORT) { $env:EDGE_PORT } else { '4317' }
$org = if ($env:TELEGRAM_BOOTSTRAP_ORG_NAME) { $env:TELEGRAM_BOOTSTRAP_ORG_NAME } else { 'Shohona Bakery' }
$zone = if ($env:TELEGRAM_BOOTSTRAP_TIMEZONE) { $env:TELEGRAM_BOOTSTRAP_TIMEZONE } else { 'Asia/Tashkent' }
$url = if ($env:TELEGRAM_WEBAPP_URL) { $env:TELEGRAM_WEBAPP_URL } else { 'https://bakery.haydar.store' }
$age = if ($env:TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) { $env:TELEGRAM_INIT_DATA_MAX_AGE_SECONDS } else { '900' }
$appZone = if ($env:APP_TIMEZONE_DEFAULT) { $env:APP_TIMEZONE_DEFAULT } else { 'Asia/Seoul' }
$cors = if ($env:CORS_ORIGIN) { $env:CORS_ORIGIN } else { 'https://bakery.haydar.store' }

$lines = @(
  '# Generated locally by generate-env.ps1. Do not commit.'
  "EDGE_PORT=$port"
  "POSTGRES_PASSWORD=$(New-Secret)"
  "MANORG_OWNER_PASSWORD=$(New-Secret)"
  "MANORG_APP_PASSWORD=$(New-Secret)"
  "REDIS_PASSWORD=$(New-Secret)"
  "JWT_ACCESS_SECRET=$(New-Secret)"
  "JWT_REFRESH_SECRET=$(New-Secret)"
  "TELEGRAM_BOT_TOKEN=$bot"
  "TELEGRAM_WEBHOOK_SECRET=$webhook"
  "TELEGRAM_BOOTSTRAP_ADMIN_IDS=$admins"
  "TELEGRAM_BOOTSTRAP_ORG_NAME=$org"
  "TELEGRAM_BOOTSTRAP_TIMEZONE=$zone"
  "TELEGRAM_WEBAPP_URL=$url"
  "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=$age"
  "APP_TIMEZONE_DEFAULT=$appZone"
  "CORS_ORIGIN=$cors"
)
Set-Content -Path $out -Value $lines -Encoding ascii
icacls $out /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
Write-Host "Wrote $out"
if (-not $bot) {
  Write-Host 'TELEGRAM_BOT_TOKEN is empty. Fill it locally from BotFather before starting the stack.'
}
Write-Host "Admin Telegram ids: $admins"
Write-Host "Edge port: $port"
