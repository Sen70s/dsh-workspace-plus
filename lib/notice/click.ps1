<#
.SYNOPSIS
    dsh-notice protocol launcher: turns a click on a notification into one local
    HTTP request against the running Harness.

.DESCRIPTION
    Windows resolves `dsh-notice:open?s=<session>` to the command line this plugin
    wrote under `HKCU\Software\Classes\dsh-notice\shell\open\command`, which runs
    this script. The script does exactly one thing: forwards the activated URL to
    the plugin's own loopback route, which owns the rest of the click (recording
    the conversation, bringing the desktop window forward, and telling the
    browser half to select it).

    Why a separate process at all: a URL protocol registered by an unpackaged
    application has to name an executable, and PowerShell is the one interpreter
    guaranteed to exist on Windows. The registry command passes `-WindowStyle
    Hidden`, so the console this would otherwise open never appears.

    When the host is not listening -- DSH was closed, or is restarting -- the
    request fails and the script falls back to activating `dsh://open`, which
    brings the desktop application forward if it is still alive. A click should
    never do nothing at all.

.NOTES
    `System.Net.WebClient` is used rather than `Invoke-WebRequest` because it can
    be told to ignore the system proxy outright: a proxy configured for the
    machine must not be asked to resolve a 127.0.0.1 URL.
#>
param(
    [Parameter(Position = 0)][string]$Url = '',
    [string]$Scheme = 'dsh-notice',
    [int]$Port = 0,
    [string]$Token = ''
)

$ErrorActionPreference = 'Stop'

if ($Port -le 0 -or $Token -eq '') { exit 2 }

# The whole activated URL travels as one query value; the host parses the
# session id out of it, so this script never has to agree with the host about
# the URL's internal shape.
$endpoint = "http://127.0.0.1:$Port/dsh-notice/api/open?token=$([uri]::EscapeDataString($Token))&url=$([uri]::EscapeDataString($Url))"

$delivered = $false
$client = $null
try {
    $client = New-Object System.Net.WebClient
    $client.Proxy = $null
    $null = $client.DownloadString($endpoint)
    $delivered = $true
} catch {
    $delivered = $false
} finally {
    if ($null -ne $client) { $client.Dispose() }
}

if ($delivered) { exit 0 }

# The host is gone. Bring the desktop window forward anyway, so a click on an
# older notification still lands on the application it is about.
try {
    Start-Process -FilePath 'dsh://open' -ErrorAction Stop | Out-Null
    exit 0
} catch {
    exit 1
}
