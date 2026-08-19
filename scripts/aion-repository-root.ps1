# Fail-closed validation for an authoritative AION repository root.
#
# On 2026-08-19T03:09Z a restart was invoked through a Bash shell, which consumed the backslash in
# `C:\AION-HQ-main-integrate` before PowerShell ever saw it. `aion-production.ps1` accepted the
# resulting drive-relative `C:AION-HQ-main-integrate`, stopped the healthy service, and registered
# that path into the AION-Production-Launch Scheduled Task. Node could not find the entry point, both
# start paths timed out, and production was down until the task was rewritten by hand.
#
# The lesson is not "quote the path". A malformed root was accepted, persisted into durable Windows
# configuration, and outlived the session that made it. So the root is validated here, once, before
# anything is stopped and before any task is written — and an invalid root ends the script with a
# clear error and no side effect at all.
#
# Deliberately strict about one thing in particular: `C:foo` is *legal* Windows syntax meaning "foo,
# relative to the current directory on drive C:". It looks absolute to a person and resolves to
# something different for every process. It is rejected.

# No Set-StrictMode here. This file is dot-sourced, so any mode it sets leaks into the caller's
# scope — and turning strict mode on underneath `aion-production.ps1` breaks `.Count` on scalars it
# has always relied on, which stopped the service mid-restart the first time this shipped. A shared
# helper must not change how its caller's code behaves.

$script:AionRepositoryMarkers = @('.git', 'package.json', 'scripts')

function Test-AionFullyQualifiedWindowsPath {
    <#
        .SYNOPSIS
        True only for a path that names the same location from any working directory.

        Written by hand rather than with [IO.Path]::IsPathFullyQualified because these scripts run
        under Windows PowerShell 5.1, where that method does not exist.
    #>
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $value = $Path.Trim()
    # UNC: \\server\share\... — two leading separators and something after them.
    if ($value -match '^[\\/]{2}[^\\/]+[\\/][^\\/]+') { return $true }
    # Drive-absolute: X:\... or X:/... . The separator after the colon is what makes it absolute.
    if ($value -match '^[A-Za-z]:[\\/]') { return $true }
    return $false
}

function Test-AionDriveRelativePath {
    <# .SYNOPSIS True for `C:foo` — a drive letter with no separator after the colon. #>
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return ($Path.Trim() -match '^[A-Za-z]:(?![\\/])')
}

function Assert-AionRepositoryRoot {
    <#
        .SYNOPSIS
        Return the normalized repository root, or throw before anything has been changed.

        .PARAMETER Path
        The candidate root.

        .PARAMETER RequireRepositoryMarkers
        Verify the directory actually looks like the AION repository. On by default: a valid,
        existing, empty directory is still the wrong place to point production at.
    #>
    param(
        [AllowNull()][AllowEmptyString()][string]$Path,
        [bool]$RequireRepositoryMarkers = $true
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "RepositoryRoot is empty. Pass a fully qualified path, for example -RepositoryRoot `"C:\AION-HQ-main-integrate`"."
    }
    $value = $Path.Trim()

    if (Test-AionDriveRelativePath -Path $value) {
        throw "RepositoryRoot '$value' is drive-relative, not absolute. '$value' means 'relative to the current directory on that drive' and resolves differently per process. This is what a shell produces when it eats the backslash. Quote the path: -RepositoryRoot `"$($value -replace '^([A-Za-z]:)', '$1\')`"."
    }
    if (-not (Test-AionFullyQualifiedWindowsPath -Path $value)) {
        throw "RepositoryRoot '$value' is not a fully qualified Windows path. Expected a drive-absolute path such as 'C:\AION-HQ-main-integrate' or a UNC path."
    }

    $full = $null
    try { $full = [IO.Path]::GetFullPath($value) } catch {
        throw "RepositoryRoot '$value' is not a usable path: $($_.Exception.Message)"
    }
    $full = $full.TrimEnd('\', '/')
    if ([string]::IsNullOrWhiteSpace($full)) {
        throw "RepositoryRoot '$value' normalized to nothing."
    }

    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
        throw "RepositoryRoot '$full' does not exist, or is a file rather than a directory."
    }

    if ($RequireRepositoryMarkers) {
        $missing = @()
        foreach ($marker in $script:AionRepositoryMarkers) {
            if (-not (Test-Path -LiteralPath (Join-Path $full $marker))) { $missing += $marker }
        }
        if ($missing.Count -gt 0) {
            throw "RepositoryRoot '$full' does not look like the AION repository; missing: $($missing -join ', ')."
        }
    }

    return $full
}
