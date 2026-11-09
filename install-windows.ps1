# Installs: Desktop + Start Menu shortcut, and a per-user scheduled task that
#   - starts the server silently at login (keeps Tebex sync and Discord alerts running)
#   - opens the payout calculator on the 1st of every month (9:00 AM, or at login if the PC was off)
# No admin rights needed. Remove everything with uninstall-windows.ps1.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$launcher = Join-Path $root 'launcher.ps1'
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$baseArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""

# shortcuts
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Revenue Split.lnk'))
  $lnk.TargetPath = $ps; $lnk.Arguments = $baseArgs; $lnk.WorkingDirectory = $root
  $lnk.Description = 'Revenue Split: payout calculator'; $lnk.WindowStyle = 7
  $lnk.Save()
}

# scheduled task
$name = 'RevenueSplit'
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$daily = New-ScheduledTaskTrigger -Daily -At '9:00AM'
$act1 = New-ScheduledTaskAction -Execute $ps -Argument "$baseArgs -ServerOnly"
$act2 = New-ScheduledTaskAction -Execute $ps -Argument "$baseArgs -MonthlyOnly"
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
# logon runs both actions in order: server first, then the monthly check
Register-ScheduledTask -TaskName $name -Trigger @($logon, $daily) -Action @($act1, $act2) -Settings $set -Principal $principal `
  -Description 'Revenue Split: server at login, payout reminder window on the 1st' | Out-Null
Write-Host 'Installed. Shortcut: Desktop and Start Menu ("Revenue Split").'
Write-Host 'Scheduled task "RevenueSplit": server at login, calculator opens on the 1st.'
