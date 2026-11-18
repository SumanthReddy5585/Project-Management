<#
  Backs up the O2 Support Hub database (and uploaded files) into the backups folder.
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1             # one backup now
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-database.ps1 -Schedule   # daily at 01:30 (run as administrator)
  Keeps the newest -Keep backups (default 14). Restore: see README-DEPLOY-WINDOWS.md, section 8.
#>
param([switch]$Schedule, [int]$Keep = 14)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root 'config\o2.env'
$Out = Join-Path $Root 'backups'
New-Item -ItemType Directory -Force -Path $Out | Out-Null

if ($Schedule) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Keep $Keep"
  $trigger = New-ScheduledTaskTrigger -Daily -At '01:30'
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName 'O2 Support Hub backup' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host 'Daily backup scheduled at 01:30 (task "O2 Support Hub backup").'
  return
}

$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) { $pgDump = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName }
if (-not $pgDump) { throw 'pg_dump.exe not found. Install the PostgreSQL command-line tools on this server.' }

$line = (Select-String -Path $EnvFile -Pattern '^DATABASE_URL=(.+)$').Matches[0].Groups[1].Value.Trim()
$u = [Uri]$line
$user, $pass = $u.UserInfo.Split(':', 2)
$db = $u.AbsolutePath.TrimStart('/')
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$file = Join-Path $Out "o2-db-$stamp.backup"
$env:PGPASSWORD = [Uri]::UnescapeDataString($pass)
try {
  & $pgDump -h $u.Host -p $(if ($u.Port -gt 0) { $u.Port } else { 5432 }) -U ([Uri]::UnescapeDataString($user)) -d $db -Fc --no-owner -f $file
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

$uploads = Join-Path $Root 'data\uploads'
if ((Test-Path $uploads) -and (Get-ChildItem $uploads -Recurse -File | Select-Object -First 1)) {
  Compress-Archive -Path "$uploads\*" -DestinationPath (Join-Path $Out "o2-files-$stamp.zip") -Force }

Get-ChildItem $Out -Filter 'o2-db-*.backup' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
Get-ChildItem $Out -Filter 'o2-files-*.zip' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item -Force
Write-Host "Backup written: $file"
