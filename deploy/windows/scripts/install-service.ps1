<#
  Registers O2 Support Hub as a background service (a Windows scheduled task that starts at boot,
  runs as SYSTEM with no one logged in, and restarts the app if it stops).
  Run from an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 [-OpenFirewall]
  -OpenFirewall  opens the app port in Windows Firewall (only when users connect directly, without IIS).
#>
param([switch]$OpenFirewall)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from PowerShell opened with "Run as administrator".' }
$Root = Split-Path -Parent $PSScriptRoot
$Task = 'O2 Support Hub'
if (-not (Test-Path (Join-Path $Root 'config\o2.env'))) { throw 'config\o2.env not found. Run scripts\install.ps1 first.' }
$nodeDir = Split-Path -Parent (Get-Command node).Source
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($machinePath -notlike "*$nodeDir*") { Write-Warning "Node.js ($nodeDir) is not on the system PATH; the SYSTEM account may not find it. Reinstall Node.js 'for all users'." }

$action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$Root\start-server.cmd`" service`"" -WorkingDirectory $Root
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $Task; Unregister-ScheduledTask -TaskName $Task -Confirm:$false }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$Root*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'O2 Support Hub web application (Node.js). Logs: logs\server.log' | Out-Null
Start-ScheduledTask -TaskName $Task

if ($OpenFirewall) {
  $port = (Select-String -Path (Join-Path $Root 'config\o2.env') -Pattern '^PORT=(\d+)').Matches[0].Groups[1].Value
  if (-not (Get-NetFirewallRule -DisplayName "O2 Support Hub ($port)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "O2 Support Hub ($port)" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null }
  Write-Host "Firewall: TCP $port opened."
}

Start-Sleep -Seconds 8
$port = (Select-String -Path (Join-Path $Root 'config\o2.env') -Pattern '^PORT=(\d+)').Matches[0].Groups[1].Value
try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/ready" -TimeoutSec 20; Write-Host "Service is running: http://127.0.0.1:$port ($($r.Content))" -ForegroundColor Green }
catch { Write-Warning "Service registered but not answering yet. Check $Root\logs\server.log" }
Write-Host "Manage it with:  Start-ScheduledTask / Stop-ScheduledTask -TaskName '$Task'   (or Task Scheduler)"
