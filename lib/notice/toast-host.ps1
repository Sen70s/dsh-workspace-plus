<#
.SYNOPSIS
    Long-lived Windows toast daemon for the dsh-notice plugin.

.DESCRIPTION
    Reads one UTF-8 JSON command per line from stdin and answers with exactly one
    UTF-8 JSON ack per command on stdout.

    stdout is a pure ack channel: the parent Node process matches acks to commands
    strictly in order, so a single stray line on stdout would desynchronise every
    later command. All diagnostics therefore go to stderr.

    This script must be run by Windows PowerShell 5.1
    (%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe). The WinRT type
    projection that toast notifications need is only reliable in that host; pwsh 7
    projects these types differently and is not supported here.

    We keep the process long-lived because starting PowerShell and loading the
    WinRT projection costs roughly a second, which is far too slow to pay per
    notification.

    Invocation:
        powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
            -File lib\toast-host.ps1 [-Once]

    Commands (JSON objects, one per line):
        {"op":"show","id":..,"title":..,"body":..,"launch":..,"appId":..,
         "tag":..,"group":..,"silent":bool,"duration":"short"|"long",
         "buttons":[{"content":..,"arguments":..}]}
        {"op":"remove","id":..,"appId":..,"tag":..,"group":..}
        {"op":"probeAumid","id":..,"candidates":[..]}
        {"op":"ping","id":..}

    `body` is either one string or an array of strings. An array becomes one
    <text> element per entry, which is how the plugin renders its three line
    notification (kind, conversation, detail); a plain string is one line.

    Acks:
        {"id":"..","ok":true}
        {"id":"..","ok":false,"error":".."}
        {"id":"..","ok":true,"appId":"..","matched":bool,"startApps":int}
#>

[CmdletBinding()]
param(
    # Read a single command from stdin, execute it and exit. Used by the smoke
    # path and by the development test harness, which would otherwise have to
    # manage a daemon lifecycle just to prove one toast works.
    [switch]$Once
)

# Any unhandled error is a bug we want to see, but the read loop itself wraps each
# command in try/catch so that one bad command can never end the daemon.
$ErrorActionPreference = 'Stop'

# The Windows AUMID that this plugin registers for itself. CreateToastNotifier()
# without an argument fails with 0x80070490 ("Element not found") from a plain
# unpackaged process, so a registered AUMID is mandatory, not optional.
$DefaultAppId = 'com.deepseek.dsh'

# Fallback title: the toast XML schema requires at least one non-empty <text>
# element, so an empty title would produce a document that either fails to load
# or renders as an unusable blank notification.
$DefaultTitle = 'dsh-notice'

# UTF-8 without a byte order mark, forced in all three directions, because the
# plugin sends Chinese text and the default console encoding on a zh-CN machine
# is a legacy code page that would corrupt it. The BOM is omitted on purpose:
# the parent parses stdout line by line and a BOM would glue itself to the first
# ack, breaking JSON.parse on that line.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# [Console]::In / [Console]::Out cache their encoding when first used, and the
# setters discard those cached readers, so the encodings must be assigned before
# any read or write happens.
try {
    [Console]::InputEncoding = $utf8NoBom
    [Console]::OutputEncoding = $utf8NoBom
    # $OutputEncoding is what PowerShell itself uses when it pipes text to a
    # native program; it is a separate setting from [Console]::OutputEncoding.
    $OutputEncoding = $utf8NoBom
} catch {
    # A failure here degrades non-ASCII text but does not make the daemon
    # useless, so report and continue rather than refusing to start.
    [Console]::Error.WriteLine('toast-host: could not force UTF-8 console encoding: ' + $_.Exception.Message)
}

# ---------------------------------------------------------------------------
# WinRT startup
# ---------------------------------------------------------------------------

# Load the projection once, up front. A daemon that cannot show toasts has no
# reason to exist, so a failure here is fatal and must be loud: the parent reads
# the exit code and the stderr text to explain the problem to the user.
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
} catch {
    [Console]::Error.WriteLine('toast-host: failed to load the WinRT toast types: ' + $_.Exception.Message)
    exit 3
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

# Reads a property from a ConvertFrom-Json object without ever throwing: a
# missing property, a null object or a non-object value all return $null instead
# of a PropertyNotFoundException.
function Get-Field {
    param(
        $Object,
        [string]$Name
    )

    if ($null -eq $Object) { return $null }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }

    return $property.Value
}

# Returns a usable string for a field, falling back when the field is absent,
# null or whitespace only.
function Get-StringField {
    param(
        $Object,
        [string]$Name,
        [string]$Default = ''
    )

    $value = Get-Field -Object $Object -Name $Name
    if ($null -eq $value) { return $Default }

    $text = [string]$value
    if ([string]::IsNullOrWhiteSpace($text)) { return $Default }

    return $text
}

# JSON booleans arrive as real booleans, but a hand-written command line (or a
# future caller) may send the string "false" - and [bool]'false' is $true in
# PowerShell, which would silently mute nothing. Parse those spellings properly.
function ConvertTo-Boolean {
    param($Value)

    if ($null -eq $Value) { return $false }
    if ($Value -is [bool]) { return $Value }

    if ($Value -is [string]) {
        $text = $Value.Trim()
        if ($text -eq '') { return $false }
        return ($text -ieq 'true' -or $text -eq '1' -or $text -ieq 'yes')
    }

    return [bool]$Value
}

# Escapes text for XML character data and for attribute values (both need the
# same five entities, and attribute values here are always wrapped in double
# quotes). User supplied titles, bodies, launch URIs and button arguments all end
# up inside the toast XML, so this is a genuine injection surface: a body of
# "</text></binding>" must render as literal text, never as markup.
#
# Characters that XML 1.0 forbids outright (most C0 controls) are replaced with a
# space, because they cannot be escaped into validity and would otherwise make
# XmlDocument.LoadXml throw for an otherwise harmless notification.
function ConvertTo-XmlText {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) { return '' }

    $builder = New-Object System.Text.StringBuilder

    foreach ($character in $Value.ToCharArray()) {
        $code = [int]$character

        if ($code -lt 0x20 -and $code -ne 0x09 -and $code -ne 0x0A -and $code -ne 0x0D) {
            [void]$builder.Append(' ')
            continue
        }

        switch ($character) {
            '&' { [void]$builder.Append('&amp;') }
            '<' { [void]$builder.Append('&lt;') }
            '>' { [void]$builder.Append('&gt;') }
            '"' { [void]$builder.Append('&quot;') }
            "'" { [void]$builder.Append('&apos;') }
            default { [void]$builder.Append($character) }
        }
    }

    return $builder.ToString()
}

# Encodes one string as a JSON string literal, quotes included. The acks are tiny
# and have a fixed shape, so they are written by hand instead of via
# ConvertTo-Json: that keeps the output strictly single-line and independent of
# the serializer's per-version escaping quirks.
function ConvertTo-JsonString {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) { return '""' }

    $builder = New-Object System.Text.StringBuilder

    foreach ($character in $Value.ToCharArray()) {
        switch ($character) {
            '"' { [void]$builder.Append('\"') }
            '\' { [void]$builder.Append('\\') }
            "`b" { [void]$builder.Append('\b') }
            "`f" { [void]$builder.Append('\f') }
            "`n" { [void]$builder.Append('\n') }
            "`r" { [void]$builder.Append('\r') }
            "`t" { [void]$builder.Append('\t') }
            default {
                $code = [int]$character
                # Control characters must be escaped to keep the ack parseable.
                if ($code -lt 0x20 -or $code -eq 0x7F) {
                    [void]$builder.Append(('\u{0:x4}' -f $code))
                } else {
                    [void]$builder.Append($character)
                }
            }
        }
    }

    return '"' + $builder.ToString() + '"'
}

# Tracks whether the command currently being handled already produced an ack.
# Without this, an exception raised after a successful ack would emit a second
# ack for one command and desynchronise the parent's strict ordering.
$script:AckWritten = $false

# Writes exactly one already-serialised JSON ack line and flushes it immediately.
# Kept separate from Write-Ack so a command whose ack carries extra fields (the
# AUMID probe) still goes through one guarded "exactly one ack" path.
function Write-AckLine {
    param([string]$Json)

    try {
        [Console]::Out.WriteLine($Json)
        [Console]::Out.Flush()
        $script:AckWritten = $true
    } catch {
        # Last resort: keep the ack channel alive with a structurally valid line,
        # and put the real problem on stderr where it cannot corrupt stdout.
        [Console]::Error.WriteLine('toast-host: failed to write ack: ' + $_.Exception.Message)
        try {
            [Console]::Out.WriteLine('{"id":"","ok":false,"error":"ack-failure"}')
            [Console]::Out.Flush()
            $script:AckWritten = $true
        } catch {
            # stdout is gone; there is nothing left to report to.
        }
    }
}

# Writes exactly one ack line and flushes it immediately, so the parent never
# waits on a buffer. This function must never throw: an exception escaping it
# would be reported as a second ack by the caller.
function Write-Ack {
    param(
        [string]$Id,
        [bool]$Ok,
        [string]$Error
    )

    $line = '{"id":' + (ConvertTo-JsonString $Id) + ',"ok":' + $(if ($Ok) { 'true' } else { 'false' })

    if (-not $Ok -and -not [string]::IsNullOrEmpty($Error)) {
        $line += ',"error":' + (ConvertTo-JsonString $Error)
    }

    $line += '}'

    Write-AckLine -Json $line
}

# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------

# Builds the ToastGeneric document for a show command.
#
# The activationType/launch pair on <toast> is what makes clicking the toast open
# the protocol URL; without it the notification would be inert. Element order
# follows the toast schema (visual, audio, actions) because the notification
# pipeline validates the document against that schema even though
# XmlDocument.LoadXml only checks well-formedness.
function New-ToastXml {
    param($Command)

    $title = Get-StringField -Object $Command -Name 'title' -Default $DefaultTitle
    $launch = Get-StringField -Object $Command -Name 'launch'
    $silent = ConvertTo-Boolean (Get-Field -Object $Command -Name 'silent')

    # `body` is either one string or an array of strings. The plugin sends the
    # array form because its notification is three separate lines (kind,
    # conversation, detail) and ToastGeneric renders one <text> per line; a
    # single string would let PowerShell's array-to-string coercion paste the
    # parts together with spaces into one run-on line.
    $bodyLines = @()
    $bodyField = Get-Field -Object $Command -Name 'body'
    if ($null -ne $bodyField) {
        if ($bodyField -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($bodyField)) { $bodyLines = @([string]$bodyField) }
        } else {
            # @(...) normalises the two shapes ConvertFrom-Json can produce for a
            # JSON array (Object[] and, for a single element, a bare object).
            foreach ($item in @($bodyField)) {
                if ($null -eq $item) { continue }
                $text = [string]$item
                if (-not [string]::IsNullOrWhiteSpace($text)) { $bodyLines += $text }
            }
        }
    }

    # Only the two documented values are accepted; anything else is dropped rather
    # than passed into the attribute, because an unknown duration makes the toast
    # pipeline reject the whole document.
    $duration = ''
    $requestedDuration = Get-StringField -Object $Command -Name 'duration'
    if ($requestedDuration -ieq 'long' -or $requestedDuration -ieq 'short') {
        $duration = $requestedDuration.ToLowerInvariant()
    }

    $xml = New-Object System.Text.StringBuilder

    [void]$xml.Append('<toast activationType="protocol"')
    # An empty launch attribute would still be schema-valid but produces a toast
    # that silently does nothing when clicked, so it is omitted instead.
    if ($launch -ne '') {
        [void]$xml.Append(' launch="' + (ConvertTo-XmlText $launch) + '"')
    }
    if ($duration -ne '') {
        [void]$xml.Append(' duration="' + $duration + '"')
    }
    [void]$xml.Append('>')

    [void]$xml.Append('<visual><binding template="ToastGeneric">')
    [void]$xml.Append('<text>' + (ConvertTo-XmlText $title) + '</text>')
    foreach ($bodyLine in $bodyLines) {
        [void]$xml.Append('<text>' + (ConvertTo-XmlText $bodyLine) + '</text>')
    }
    [void]$xml.Append('</binding></visual>')

    if ($silent) {
        [void]$xml.Append('<audio silent="true"/>')
    }

    $buttons = Get-Field -Object $Command -Name 'buttons'
    if ($null -ne $buttons) {
        $actionXml = New-Object System.Text.StringBuilder

        # @(...) is required because a one element JSON array can arrive as a
        # bare object depending on the deserialiser path.
        foreach ($button in @($buttons)) {
            if ($null -eq $button) { continue }

            $content = Get-StringField -Object $button -Name 'content'
            $arguments = Get-StringField -Object $button -Name 'arguments'
            if ($content -eq '' -and $arguments -eq '') { continue }

            [void]$actionXml.Append('<action')
            [void]$actionXml.Append(' content="' + (ConvertTo-XmlText $content) + '"')
            [void]$actionXml.Append(' activationType="protocol"')
            [void]$actionXml.Append(' arguments="' + (ConvertTo-XmlText $arguments) + '"')
            [void]$actionXml.Append(' placement="content"')
            [void]$actionXml.Append('/>')
        }

        # An empty <actions> element is invalid, so it is only emitted when at
        # least one usable button survived.
        if ($actionXml.Length -gt 0) {
            [void]$xml.Append('<actions>' + $actionXml.ToString() + '</actions>')
        }
    }

    [void]$xml.Append('</toast>')

    return $xml.ToString()
}

function Invoke-ShowCommand {
    param($Command, [string]$Id)

    $appId = Get-StringField -Object $Command -Name 'appId' -Default $DefaultAppId
    $tag = Get-StringField -Object $Command -Name 'tag'
    $group = Get-StringField -Object $Command -Name 'group'

    try {
        $document = New-Object Windows.Data.Xml.Dom.XmlDocument
        $document.LoadXml((New-ToastXml -Command $Command))

        $toast = New-Object Windows.UI.Notifications.ToastNotification $document

        # Tag/group are what a later remove command matches on. Assigning an empty
        # string throws, and a tag that violates the length/charset rules throws
        # too, so each assignment is guarded: losing the tag only means the toast
        # cannot be retracted later, which is much better than losing the toast.
        if ($tag -ne '') {
            try {
                $toast.Tag = $tag
            } catch {
                [Console]::Error.WriteLine('toast-host: could not set tag: ' + $_.Exception.Message)
            }
        }

        if ($group -ne '') {
            try {
                $toast.Group = $group
            } catch {
                [Console]::Error.WriteLine('toast-host: could not set group: ' + $_.Exception.Message)
            }
        }

        # A registered AUMID is required; an unknown one makes CreateToastNotifier
        # or Show throw, which is reported as a failed ack rather than a crash.
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
        $notifier.Show($toast)

        Write-Ack -Id $Id -Ok $true
    } catch {
        [Console]::Error.WriteLine('toast-host: show failed: ' + $_.Exception.Message)
        Write-Ack -Id $Id -Ok $false -Error $_.Exception.Message
    }
}

function Invoke-RemoveCommand {
    param($Command, [string]$Id)
    $appId = Get-StringField -Object $Command -Name 'appId' -Default $DefaultAppId
    $tag = Get-StringField -Object $Command -Name 'tag'
    $group = Get-StringField -Object $Command -Name 'group'

    # History.Remove matches on tag plus group, and both must be non-empty or the
    # call throws; a caller that omitted them has nothing to remove.
    if ($tag -eq '' -or $group -eq '') {
        Write-Ack -Id $Id -Ok $false -Error 'remove requires a non-empty tag and group'
        return
    }

    try {
        [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($tag, $group, $appId)
        Write-Ack -Id $Id -Ok $true
    } catch {
        [Console]::Error.WriteLine('toast-host: remove failed: ' + $_.Exception.Message)
        Write-Ack -Id $Id -Ok $false -Error $_.Exception.Message
    }
}

# Cached Start Menu AppIDs. $null means "not probed yet"; an empty array means
# the probe ran and found nothing. The distinction matters because an empty list
# is evidence and an unrun probe is not.
$script:StartAppIds = $null

# Enumerates the AppUserModelIDs Windows would accept for a notification.
#
# This exists because Show() does NOT fail for an unregistered AUMID: Windows
# accepts the toast and files it in Action Center under an identity that has no
# Start Menu entry, so it appears with no application name and no icon. Waiting
# for an exception therefore never selects a fallback, and the only way to know
# whether an identity is real is to ask the Start Menu directly.
#
# @returns an array of AppIDs, or $null when the enumeration is unavailable.
function Get-StartAppIds {
    if ($null -ne $script:StartAppIds) { return $script:StartAppIds }

    try {
        $script:StartAppIds = @(Get-StartApps -ErrorAction Stop | ForEach-Object { [string]$_.AppID })
    } catch {
        [Console]::Error.WriteLine('toast-host: Get-StartApps unavailable: ' + $_.Exception.Message)
        $script:StartAppIds = $null
        return $null
    }

    return $script:StartAppIds
}

# Picks the first candidate AUMID that is actually registered on this machine.
#
# The parent sends its candidates best-attribution-first (the DeepSeek Harness
# desktop application, then the Windows PowerShell entry that every Windows
# install carries) and uses the answer to speak for a real identity rather than
# an orphaned one.
function Invoke-ProbeAumidCommand {
    param($Command, [string]$Id)

    $candidates = @()
    $field = Get-Field -Object $Command -Name 'candidates'
    if ($null -ne $field) {
        foreach ($item in @($field)) {
            if ($null -eq $item) { continue }
            $text = [string]$item
            if (-not [string]::IsNullOrWhiteSpace($text)) { $candidates += $text }
        }
    }

    if ($candidates.Count -eq 0) {
        Write-Ack -Id $Id -Ok $false -Error 'probeAumid requires a non-empty candidates array'
        return
    }

    $ids = Get-StartAppIds
    if ($null -eq $ids) {
        Write-Ack -Id $Id -Ok $false -Error 'Get-StartApps is unavailable on this machine'
        return
    }

    $matched = ''
    foreach ($candidate in $candidates) {
        if ($ids -contains $candidate) {
            $matched = $candidate
            break
        }
    }

    $json = '{"id":' + (ConvertTo-JsonString $Id) + ',"ok":true'
    $json += ',"appId":' + (ConvertTo-JsonString $matched)
    $json += ',"matched":' + $(if ($matched -ne '') { 'true' } else { 'false' })
    $json += ',"startApps":' + $ids.Count
    $json += '}'

    Write-AckLine -Json $json
}

# Dispatches one already parsed command object.
function Invoke-CommandObject {
    param($Command)

    $id = Get-StringField -Object $Command -Name 'id'
    $op = (Get-StringField -Object $Command -Name 'op' -Default 'show').ToLowerInvariant()

    switch ($op) {
        'show' { Invoke-ShowCommand -Command $Command -Id $id }
        'remove' { Invoke-RemoveCommand -Command $Command -Id $id }
        'probeaumid' { Invoke-ProbeAumidCommand -Command $Command -Id $id }
        'ping' {
            # Liveness probe: proves the daemon is up and the pipe is healthy
            # without putting anything on the user's screen.
            Write-Ack -Id $id -Ok $true
        }
        default {
            Write-Ack -Id $id -Ok $false -Error ("unsupported op '" + $op + "'")
        }
    }
}

# Handles one raw stdin line. Malformed input is answered with an error ack and
# never propagates, because a single bad line must not kill a long-lived daemon.
function Invoke-InputLine {
    param([string]$Line)

    # Blank lines are skipped without an ack: the parent never sends them, so
    # answering one would desynchronise the ack stream.
    if ([string]::IsNullOrWhiteSpace($Line)) { return }

    $script:AckWritten = $false

    $command = $null
    try {
        $command = ConvertFrom-Json -InputObject $Line -ErrorAction Stop
    } catch {
        [Console]::Error.WriteLine('toast-host: malformed JSON command: ' + $_.Exception.Message)
        Write-Ack -Id '' -Ok $false -Error ('malformed JSON: ' + $_.Exception.Message)
        return
    }

    # Anything that is not a JSON object (array, bare string, number, null) has no
    # op and no fields, so it is a protocol error rather than an empty show.
    if ($command -isnot [System.Management.Automation.PSCustomObject]) {
        Write-Ack -Id '' -Ok $false -Error 'command must be a JSON object'
        return
    }

    try {
        Invoke-CommandObject -Command $command
    } catch {
        [Console]::Error.WriteLine('toast-host: command failed: ' + $_.Exception.Message)
        if (-not $script:AckWritten) {
            Write-Ack -Id (Get-StringField -Object $command -Name 'id') -Ok $false -Error $_.Exception.Message
        }
    }
}

# ---------------------------------------------------------------------------
# Read loop
# ---------------------------------------------------------------------------

if ($Once) {
    # One command, then exit. The exit code still reports transport success: a
    # command that failed keeps exit code 0 because its failure is carried by the
    # ack, while a missing command is a real invocation error.
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) {
        [Console]::Error.WriteLine('toast-host: -Once was set but stdin was empty')
        exit 1
    }

    Invoke-InputLine -Line $line
    exit 0
}

while ($true) {
    # ReadLine returns $null only at end of input, which is how the parent shuts
    # the daemon down by closing its stdin.
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }

    Invoke-InputLine -Line $line
}

exit 0
