# Screenshot a local page with headless Edge.
#
# Edge's launcher process returns before the browser has written the PNG, and how
# long that takes varies with the page, so this polls for the file rather than
# sleeping a fixed amount. It never deletes an existing output before a new one
# has landed: a retry loop that cleaned up first could destroy a screenshot that
# was merely written late, leaving the repo with no image at all.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1440,
  [int]$Height = 1000
)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$OutFull = [System.IO.Path]::GetFullPath($Out)
for ($attempt = 1; $attempt -le 4; $attempt++) {
  $started = Get-Date
  $profile = Join-Path $env:TEMP ("dsh-wsp-shot-" + [guid]::NewGuid().ToString('N'))
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --window-size="$Width,$Height" --virtual-time-budget=8000 `
    --user-data-dir="$profile" --screenshot="$OutFull" $Url 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  $written = $false
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path -LiteralPath $OutFull) -and ((Get-Item -LiteralPath $OutFull).LastWriteTime -gt $started)) {
      $written = $true
      break
    }
    Start-Sleep -Milliseconds 150
  }
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  if ($written) {
    "ok (attempt $attempt): $OutFull $((Get-Item -LiteralPath $OutFull).Length) bytes"
    exit 0
  }
}
"failed: $OutFull"
exit 1
