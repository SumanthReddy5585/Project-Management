<#
  O2 Support Hub - first-time setup on Windows Server.
  Run from an elevated PowerShell:   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1

  What it does:
    1. Checks Node.js (22 LTS or newer)
    2. Uses the bundled Windows node_modules (or runs "npm ci" if they are missing)
    3. Optionally creates the PostgreSQL database and login
    4. Writes config\o2.env from your answers
    5. Creates / upgrades the database tables
    6. Creates your organisation + first administrator (or loads demo data)
  Safe to re-run: existing config and data are kept.
#>
$ErrorActionPreference = 'Stop'
$Root    = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'app\backend'
$EnvFile = Join-Path $Root 'config\o2.env'
$Utf8    = New-Object System.Text.UTF8Encoding $false

function Say($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "    $m" -ForegroundColor Yellow }
function Ask($q, $default) {
  $a = Read-Host ("    $q" + $(if ($default) { " [$default]" } else { '' }))
  if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function AskSecret($q) {
  $s = Read-Host "    $q" -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function YesNo($q, $default) {
  $a = Ask "$q (y/n)" $default
  return $a -match '^(y|yes)$'
}
function RunNode([string[]]$NodeArgs) {
  Push-Location $Backend
  try { & node "--env-file=$EnvFile" @NodeArgs; if ($LASTEXITCODE -ne 0) { throw "node $($NodeArgs -join ' ') failed (exit $LASTEXITCODE)" } }
  finally { Pop-Location }
}
function Find-Psql {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($c) { return $c.FullName } else { return $null }
}

Write-Host "O2 Support Hub - Windows setup" -ForegroundColor Green
Write-Host "Install folder: $Root"

# 1. Node.js -------------------------------------------------------------------
Say 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed. Install Node.js 22 LTS (x64) from https://nodejs.org, open a NEW PowerShell window and run this script again.' }
$ver = (& node -v).TrimStart('v'); $major = [int]($ver.Split('.')[0])
if ($major -lt 22) { throw "Node.js $ver is too old. Install Node.js 22 LTS or newer." }
Write-Host "    Node.js $ver OK"

# 2. Dependencies ----------------------------------------------------------------
Say 'Checking application components'
if (-not (Test-Path (Join-Path $Backend 'node_modules\express'))) {
  Warn 'node_modules not found - installing from the internet (npm ci)...'
  Push-Location $Backend; & npm ci --omit=dev --no-audit --no-fund; $code = $LASTEXITCODE; Pop-Location
  if ($code -ne 0) { throw 'npm ci failed. Check internet/proxy access to registry.npmjs.org.' }
} else { Write-Host '    Bundled components found (offline install)' }

# 3 + 4. Configuration -------------------------------------------------------------
if (Test-Path $EnvFile) {
  Say 'config\o2.env already exists - keeping it (edit it by hand to change settings)'
} else {
  Say 'Database connection'
  $dbHost = Ask 'PostgreSQL host' 'localhost'
  $dbPort = Ask 'PostgreSQL port' '5432'
  $dbName = Ask 'Database name' 'o2_support_hub'
  $dbUser = Ask 'Database login used by the app' 'o2app'
  $dbPass = AskSecret "Password for $dbUser (new or existing)"
  if ([string]::IsNullOrWhiteSpace($dbPass)) { throw 'A database password is required.' }

  $psql = Find-Psql
  if ($psql -and (YesNo "Create the database '$dbName' and login '$dbUser' now? (needs the 'postgres' superuser password)" 'y')) {
    if ($dbUser -notmatch '^[a-z_][a-z0-9_]*$' -or $dbName -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Use lower-case letters, digits and _ for the database name and login.' }
    $suPass = AskSecret "Password of the PostgreSQL superuser 'postgres'"
    $env:PGPASSWORD = $suPass
    $sqlPass = $dbPass.Replace("'", "''")
    $tmp = Join-Path $env:TEMP ("o2-setup-" + [Guid]::NewGuid().ToString('N') + '.sql')
    try {
      $roleSql = "DO `$`$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$dbUser') THEN ALTER ROLE $dbUser WITH LOGIN PASSWORD '$sqlPass'; ELSE CREATE ROLE $dbUser WITH LOGIN PASSWORD '$sqlPass'; END IF; END `$`$;"
      [IO.File]::WriteAllText($tmp, $roleSql, $Utf8)
      & $psql -h $dbHost -p $dbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $tmp
      if ($LASTEXITCODE -ne 0) { throw 'Could not connect as postgres or create the login. Check the password and that PostgreSQL is running.' }
      $dbExists = & $psql -h $dbHost -p $dbPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName'"
      if ($dbExists -ne '1') {
        [IO.File]::WriteAllText($tmp, "CREATE DATABASE $dbName OWNER $dbUser ENCODING 'UTF8' TEMPLATE template0;", $Utf8)
        & $psql -h $dbHost -p $dbPort -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $tmp
        if ($LASTEXITCODE -ne 0) { throw "Could not create database $dbName." }
      }
    } finally { Remove-Item $tmp -ErrorAction SilentlyContinue; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    Write-Host "    Database '$dbName' and login '$dbUser' are ready"
  } elseif (-not $psql) {
    Warn "psql.exe not found - create the database yourself (see database\create-database.sql) if you have not already."
  }

  Say 'Web address'
  $https = YesNo 'Will users open the app over HTTPS (IIS with a certificate)? Recommended' 'y'
  $appPort = Ask 'Internal port for the app' '4000'
  $defaultUrl = if ($https) { 'https://' + [Net.Dns]::GetHostEntry('').HostName.ToLower() } else { 'http://' + $env:COMPUTERNAME.ToLower() + ':' + $appPort }
  $origin = (Ask 'Address users type in the browser (no trailing slash)' $defaultUrl).TrimEnd('/')
  $proxied = if ($https) { $true } else { YesNo 'Is there a reverse proxy (IIS) in front of the app?' 'n' }

  $url = 'postgresql://' + [Uri]::EscapeDataString($dbUser) + ':' + [Uri]::EscapeDataString($dbPass) + "@${dbHost}:${dbPort}/" + $dbName
  $text = Get-Content (Join-Path $Root 'config\o2.env.template') -Raw
  $set = @{ PORT = $appPort; DATABASE_URL = $url; APP_ORIGIN = $origin; CORS_ORIGINS = $origin
            COOKIE_SECURE = $(if ($https) { 'true' } else { 'false' }); ALLOW_INSECURE_HTTP = $(if ($https) { 'false' } else { 'true' })
            TRUST_PROXY = $(if ($proxied) { '1' } else { 'false' }) }
  foreach ($k in $set.Keys) {
    $lines = $text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].StartsWith("$k=")) { $lines[$i] = "$k=$($set[$k])" } }
    $text = $lines -join "`r`n"
  }
  [IO.File]::WriteAllText($EnvFile, $text, $Utf8)
  # Only Administrators and SYSTEM may read the file that holds the database password.
  & icacls $EnvFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
  Write-Host "    Saved config\o2.env (readable by Administrators and SYSTEM only)"
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data\uploads'), (Join-Path $Root 'logs'), (Join-Path $Root 'backups') | Out-Null

# 5. Database tables ---------------------------------------------------------------
Say 'Creating / upgrading database tables'
RunNode @('scripts\db-migrate.js')

# 6. First organisation --------------------------------------------------------------
Say 'Organisation and administrator'
Push-Location $Backend; $hasOrg = & node "--env-file=$EnvFile" scripts\org-count.js; $code = $LASTEXITCODE; Pop-Location
if ($code -ne 0) { throw 'Could not read the database. Check DATABASE_URL in config\o2.env.' }
if ([int]$hasOrg -gt 0) {
  Write-Host "    The database already has $hasOrg organisation(s) - skipping."
} else {
  Write-Host '    1) Create my organisation and first administrator (recommended for real use)'
  Write-Host '    2) Load demo data (sample projects, tickets and users) to try things out'
  Write-Host '    3) Skip for now'
  $choice = Ask 'Choose' '1'
  if ($choice -eq '1') {
    $org   = Ask 'Organisation name' 'O2 Digital Services'
    $slug  = Ask 'Short id (letters/digits/dashes)' (($org.ToLower() -replace '[^a-z0-9]+','-').Trim('-'))
    $tz    = Ask 'Time zone (IANA name)' 'Asia/Kolkata'
    $name  = Ask 'Administrator full name' 'Administrator'
    $email = ''
    while ($email -notmatch '^[^@\s]+@[^@\s]+$') { $email = Ask 'Administrator e-mail (used to sign in)' '' }
    $pw    = AskSecret 'Administrator password (min. 10 characters, letters and numbers)'
    $env:INIT_ADMIN_PASSWORD = $pw
    try { RunNode @('prisma\init-org.js', '--org', $org, '--slug', $slug, '--email', $email, '--name', $name, '--timezone', $tz) }
    finally { Remove-Item Env:INIT_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
  } elseif ($choice -eq '2') {
    $env:ALLOW_DEMO_SEED = 'true'; $env:JOBS_ENABLED = 'false'
    $env:DEMO_PASSWORD = AskSecret 'Password to give every demo account (min. 10 characters, letters and numbers)'
    try { RunNode @('prisma\seed-demo.js') }
    finally { Remove-Item Env:ALLOW_DEMO_SEED, Env:DEMO_PASSWORD, Env:JOBS_ENABLED -ErrorAction SilentlyContinue }
  }
}

Say 'Done'
Write-Host '    Try it now:        .\start-server.cmd   (Ctrl+C to stop; output goes to logs\server.log)'
Write-Host '    Run as a service:  powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1'
Write-Host '    HTTPS with IIS:    see README-DEPLOY-WINDOWS.md, section 6'
