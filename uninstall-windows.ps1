# Removes the shortcuts and the scheduled task. Your data (%APPDATA%\RevenueSplit) is NOT touched.
Unregister-ScheduledTask -TaskName 'RevenueSplit' -Confirm:$false -ErrorAction SilentlyContinue
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  Remove-Item (Join-Path $dir 'Revenue Split.lnk') -ErrorAction SilentlyContinue
}
Write-Host 'Removed shortcuts and scheduled task. Data kept in' (Join-Path $env:APPDATA 'RevenueSplit')
