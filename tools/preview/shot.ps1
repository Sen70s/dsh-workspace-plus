# Screenshot a local page with headless Edge, retrying because the browser
# intermittently exits without writing the file.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1440,
  [int]$Height = 1000
)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
for ($attempt = 1; $attempt -le 4; $attempt++) {
  if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
  $profile = Join-Path $env:TEMP ("dsh-wsp-shot-" + [guid]::NewGuid().ToString('N'))
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
    --window-size="$Width,$Height" --virtual-time-budget=8000 `
    --user-data-dir="$profile" --screenshot="$Out" $Url 2>$null | Out-Null
  Start-Sleep -Milliseconds 400
  if (Test-Path -LiteralPath $Out) {
    "ok (attempt $attempt): $Out $((Get-Item -LiteralPath $Out).Length) bytes"
    Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
"failed: $Out"
exit 1
