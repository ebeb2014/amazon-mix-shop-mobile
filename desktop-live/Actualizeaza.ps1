$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
  $candidate = Join-Path $PSScriptRoot 'AmazonMixShop-Live.exe'
  $expected = (Get-Content (Join-Path $PSScriptRoot 'SHA256.txt') -Raw).Trim().Split(' ')[0]
  if ((Get-FileHash $candidate -Algorithm SHA256).Hash -ne $expected) { throw 'Pachet incomplet sau modificat. Descarcă din nou arhiva.' }
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Alege executabilul Amazon Mix Shop folosit la magazin'
  $dialog.Filter = 'Amazon Mix Shop (*.exe)|*.exe'
  $dialog.InitialDirectory = Join-Path $env:ProgramFiles 'Amazon Mix Shop'
  if ($dialog.ShowDialog() -ne 'OK') { exit }
  $target = $dialog.FileName
  if ((Split-Path $target -Leaf) -notmatch '^Amazon[_ ]?Mix[_ ]?Shop.*\.exe$') { throw 'Alege executabilul aplicației Amazon Mix Shop, nu installerul.' }
  if ($target -eq $candidate) { throw 'Alege aplicația instalată, nu fișierul nou de pe stick.' }
  $running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target }
  if ($running) { throw 'Închide aplicația de magazin și finalizează orice bon în curs, apoi rulează din nou actualizarea.' }
  $backup = $target + '.inainte-live-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
  $msg = "Actualizezi aplicația:`n$target`n`nSe salvează o copie a executabilului vechi. Datele și configurările rămân în locul lor.`n`nVersiunea Live cere internet înainte de emiterea bonurilor, pentru a verifica rezervările online.`n`nContinuă?"
  if ([System.Windows.Forms.MessageBox]::Show($msg,'Actualizare Amazon Mix Shop Live','YesNo','Question') -ne 'Yes') { exit }
  Copy-Item -LiteralPath $target -Destination $backup
  try {
    Copy-Item -LiteralPath $candidate -Destination ($target+'.nou')
    Move-Item -LiteralPath ($target+'.nou') -Destination $target -Force
    if ((Get-FileHash $target -Algorithm SHA256).Hash -ne $expected) { throw 'Verificarea fișierului instalat a eșuat.' }
  } catch { Copy-Item -LiteralPath $backup -Destination $target -Force; throw }
  [System.Windows.Forms.MessageBox]::Show("Actualizare terminată.`nPornește aplicația ca de obicei.`nVânzări → Comenzi online.`n`nBackup: $backup",'Amazon Mix Shop Live') | Out-Null
} catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Actualizarea nu s-a finalizat','OK','Error') | Out-Null; exit 1 }
