# Stops and removes the O2 Support Hub scheduled task. Data, config and database are not touched.
$ErrorActionPreference = 'Stop'
$Task = 'O2 Support Hub'
if (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $Task
  Unregister-ScheduledTask -TaskName $Task -Confirm:$false
}
# The task runs cmd.exe -> node.exe; stop any node process started from this folder.
$Root = Split-Path -Parent $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$Root*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'O2 Support Hub service removed.'
