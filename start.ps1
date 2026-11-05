#requires -Version 5.1
# Local one-command launcher for Windows.
# Uses the installed PostgreSQL binaries to run a project-local database on
# port 55432, applies migrations and starts the API + web dev servers.
#
# Usage:
#   .\start.ps1
#
# Optional:
#   $env:PG_BIN = 'C:\path\to\PostgreSQL\bin'   # override PostgreSQL location

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $OutputEncoding = [Text.Encoding]::UTF8
} catch { }

function Fail([string]$message) {
  Write-Host ""
  Write-Host $message -ForegroundColor Red
  Write-Host ""
  exit 1
}

# Already running? Do not start a second copy on the same ports.
try {
  $health = Invoke-RestMethod -Uri 'http://localhost:4000/api/health' -TimeoutSec 2
  $web = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2
  if ($health.status -eq 'ok' -and $web.StatusCode -eq 200) {
    Write-Host ''
    Write-Host 'Сайт уже запущен: http://localhost:5173' -ForegroundColor Green
    Write-Host 'Чтобы перезапустить, сначала остановите текущий процесс (Ctrl+C в его окне).'
    Write-Host ''
    exit 0
  }
} catch { }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js не найден. Установите Node.js 20.11+ и запустите снова.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm не найден. Переустановите Node.js с npm.'
}

# --- Locate PostgreSQL -------------------------------------------------------
$pgBin = $env:PG_BIN
if (-not $pgBin) {
  $installRoot = 'C:\Program Files\PostgreSQL'
  if (Test-Path $installRoot) {
    $versions = Get-ChildItem $installRoot -Directory | Sort-Object {
      try { [version]$_.Name } catch { [version]'0.0' }
    } -Descending
    foreach ($version in $versions) {
      $candidate = Join-Path $version.FullName 'bin'
      if (Test-Path (Join-Path $candidate 'initdb.exe')) {
        $pgBin = $candidate
        break
      }
    }
  }
}
if (-not $pgBin -or -not (Test-Path (Join-Path $pgBin 'initdb.exe'))) {
  Fail @'
PostgreSQL не найден.
Установите PostgreSQL 14+ или укажите папку с бинарниками:

  $env:PG_BIN = 'C:\Program Files\PostgreSQL\16\bin'
  .\start.ps1

Либо используйте Docker (если он установлен):

  docker compose up --build
'@
}

$initdb = Join-Path $pgBin 'initdb.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'

$dataDir = Join-Path $root '.pgdata'
$logFile = Join-Path $root '.pgdata.log'
$port = 55432
$dbUser = 'poker'
$dbName = 'poker'
$databaseUrl = "postgresql://$dbUser@127.0.0.1:$port/${dbName}?schema=public"

# --- Start project-local PostgreSQL -----------------------------------------
if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  Write-Host 'Первый запуск: создаю локальную базу данных...' -ForegroundColor Cyan
  & $initdb -D $dataDir -U $dbUser -A trust -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail "Не удалось инициализировать PostgreSQL в $dataDir."
  }
}

& $pgIsReady -h 127.0.0.1 -p $port -q
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Запускаю PostgreSQL...' -ForegroundColor Cyan
  & $pgCtl -D $dataDir -o "-p $port -c listen_addresses=127.0.0.1" -l $logFile -w start
  if ($LASTEXITCODE -ne 0) {
    Fail "PostgreSQL не запустился. Подробности: $logFile"
  }
}

$env:DATABASE_URL = $databaseUrl

$dbExists = (& $psql -h 127.0.0.1 -p $port -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" | Out-String).Trim()
if ($dbExists -ne '1') {
  Write-Host 'Создаю базу poker...' -ForegroundColor Cyan
  & $createdb -h 127.0.0.1 -p $port -U $dbUser $dbName
  if ($LASTEXITCODE -ne 0) {
    Fail 'Не удалось создать базу данных poker.'
  }
}

# --- Install dependencies and apply migrations ------------------------------
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Устанавливаю зависимости...' -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { Fail 'npm install завершился с ошибкой.' }
}

Write-Host 'Готовлю Prisma и применяю миграции...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'apps\server')
try {
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { Fail 'Не удалось сгенерировать Prisma Client.' }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Fail 'Миграции не применились.' }
} finally {
  Pop-Location
}

# --- Start the app -----------------------------------------------------------
$env:PORT = '4000'
# Redis is optional. If REDIS_URL is empty or unreachable, the API falls back
# to an in-memory Socket.IO adapter and leaderboard cache.

Write-Host ""
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  Сайт:  http://localhost:5173' -ForegroundColor Green
Write-Host '  API:   http://localhost:4000/api/health' -ForegroundColor Green
Write-Host '  Остановка: Ctrl+C' -ForegroundColor DarkGray
Write-Host '============================================================' -ForegroundColor Green
Write-Host ""

npm run dev:stable
