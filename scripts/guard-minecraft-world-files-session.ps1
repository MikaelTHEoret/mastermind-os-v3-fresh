$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MastermindFilesystemFileSession {
    [StructLayout(LayoutKind.Sequential)]
    public struct FILE_ATTRIBUTE_TAG_INFO { public UInt32 FileAttributes; public UInt32 ReparseTag; }
    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME { public UInt32 LowDateTime; public UInt32 HighDateTime; }
    [StructLayout(LayoutKind.Sequential)]
    public struct FILE_BASIC_INFO {
        public Int64 CreationTime;
        public Int64 LastAccessTime;
        public Int64 LastWriteTime;
        public Int64 ChangeTime;
        public UInt32 FileAttributes;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION {
        public UInt32 FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public UInt32 VolumeSerialNumber;
        public UInt32 FileSizeHigh;
        public UInt32 FileSizeLow;
        public UInt32 NumberOfLinks;
        public UInt32 FileIndexHigh;
        public UInt32 FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern SafeFileHandle CreateFileW(string name, UInt32 access, UInt32 share, IntPtr security,
        UInt32 disposition, UInt32 flags, IntPtr templateFile);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandleEx(SafeFileHandle file, Int32 infoClass, IntPtr info, UInt32 size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandle(SafeFileHandle file, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetFileInformationByHandle(SafeFileHandle file, Int32 infoClass, IntPtr info, UInt32 size);
}
'@

$MaximumGuards = 256
$MaximumLineBytes = 1048576
$guards = New-Object 'object[]' $MaximumGuards
$slotGenerations = New-Object 'long[]' $MaximumGuards
$activeCount = 0
$activePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$activeIdentities = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)

function Stop-Unsafe {
    try {
        [Console]::Out.WriteLine((@{ ok = $false; code = 'UNSAFE_FILESYSTEM' } | ConvertTo-Json -Compress))
    } catch {}
    exit 1
}

function Read-BoundedLine {
    $builder = New-Object Text.StringBuilder
    while ($true) {
        $value = [Console]::In.Read()
        if ($value -lt 0) { Stop-Unsafe }
        if ($value -eq 10) { break }
        if ($builder.Length -ge $MaximumLineBytes) { Stop-Unsafe }
        [void] $builder.Append([char] $value)
    }
    $line = $builder.ToString()
    if ($line.EndsWith("`r")) { $line = $line.Substring(0, $line.Length - 1) }
    if ($line.Length -lt 2 -or [Text.Encoding]::UTF8.GetByteCount($line) -gt $MaximumLineBytes) {
        Stop-Unsafe
    }
    return $line
}

function Test-ExactKeys($Value, [string[]] $Expected) {
    if ($null -eq $Value) { return $false }
    $keys = @($Value.PSObject.Properties.Name)
    if ($keys.Count -ne $Expected.Count) { return $false }
    foreach ($key in $Expected) { if ($keys -notcontains $key) { return $false } }
    return $true
}

function Test-ProtocolId($Value) {
    return $Value -is [string] -and $Value -match '^[a-z0-9][a-z0-9-]{0,79}$'
}

function Get-SafeFullPath($Candidate) {
    if ($Candidate -isnot [string] -or $Candidate.Length -lt 3 -or $Candidate.Length -gt 30000 `
        -or -not [IO.Path]::IsPathRooted($Candidate) -or $Candidate.Contains([char] 0)) {
        return $null
    }
    $normalized = $Candidate.Replace('/', '\')
    if ($normalized.StartsWith('\\.\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\\??\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\??\', [StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    try {
        $inputRoot = [IO.Path]::GetPathRoot($normalized)
        $inputDriveRoot = $inputRoot -match '^[A-Za-z]:\\$'
        $inputUncRoot = -not $inputRoot.Contains(':') -and $inputRoot -match '^\\\\[^\\]+\\[^\\]+\\$'
        if (-not $inputDriveRoot -and -not $inputUncRoot) { return $null }
        $relative = $normalized.Substring($inputRoot.Length)
        if ([string]::IsNullOrEmpty($relative) -or $relative.Contains(':')) { return $null }
        $components = @($relative.Split([char]'\'))
        if ($components.Count -lt 1) { return $null }
        foreach ($component in $components) {
            $deviceBase = (($component -split '\.', 2)[0] -replace '[ .:]+$', '')
            if ([string]::IsNullOrEmpty($component) -or $component -eq '.' -or $component -eq '..' `
                -or $component -match '[ .]$' -or $component -match '[\x00-\x1f<>:"|?*]' `
                -or $deviceBase -match '^(?i:(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]))$') {
                return $null
            }
        }
        $fullPath = [IO.Path]::GetFullPath($normalized)
        $root = [IO.Path]::GetPathRoot($fullPath)
    } catch {
        return $null
    }
    if ([string]::IsNullOrEmpty($root) -or $fullPath.Length -le $root.Length `
        -or $fullPath.Substring($root.Length).Contains(':') `
        -or -not [string]::Equals($fullPath, $normalized, [StringComparison]::Ordinal)) {
        return $null
    }
    $driveRoot = $root -match '^[A-Za-z]:\\$'
    $uncRoot = $root -match '^\\\\[^\\]+\\[^\\]+\\$'
    if (-not $driveRoot -and -not $uncRoot) { return $null }
    foreach ($component in @($fullPath.Substring($root.Length) -split '\\' | Where-Object { $_.Length -gt 0 })) {
        if ($component -match '[ .]$' -or $component -match '[\x00-\x1f<>"|?*]' `
            -or $component -match '^(?i:(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?)$') {
            return $null
        }
    }
    return $fullPath
}

function Assert-NoAlternateStreams($Handle) {
    $streamSize = 4096
    $streamNames = @()
    while ($true) {
        if ($streamSize -gt 1048576) { Stop-Unsafe }
        $streamBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($streamSize)
        try {
            $streamOk = [MastermindFilesystemFileSession]::GetFileInformationByHandleEx(
                $Handle, 7, $streamBuffer, $streamSize
            )
            if ($streamOk) {
                $offset = 0
                while ($true) {
                    if ($offset -lt 0 -or $offset + 24 -gt $streamSize) { Stop-Unsafe }
                    $next = [Runtime.InteropServices.Marshal]::ReadInt32($streamBuffer, $offset)
                    $nameBytes = [Runtime.InteropServices.Marshal]::ReadInt32($streamBuffer, $offset + 4)
                    if ($nameBytes -lt 0 -or ($nameBytes % 2) -ne 0 `
                        -or $offset + 24 + $nameBytes -gt $streamSize) {
                        Stop-Unsafe
                    }
                    $streamNames += [Runtime.InteropServices.Marshal]::PtrToStringUni(
                        [IntPtr]::Add($streamBuffer, $offset + 24), [int] ($nameBytes / 2)
                    )
                    if ($next -eq 0) { break }
                    if ($next -lt 24 -or $offset + $next -le $offset) { Stop-Unsafe }
                    $offset += $next
                }
                break
            }
            $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($nativeError -eq 38) { break }
            if ($nativeError -ne 234) { Stop-Unsafe }
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($streamBuffer)
        }
        $streamSize *= 2
    }
    foreach ($streamName in $streamNames) {
        if ($streamName -ne '::$DATA' -and $streamName -ne '::$INDEX_ALLOCATION') { Stop-Unsafe }
    }
}

function Get-FileEvidence($Handle) {
    $tagSize = [Runtime.InteropServices.Marshal]::SizeOf(
        [type][MastermindFilesystemFileSession+FILE_ATTRIBUTE_TAG_INFO]
    )
    $tagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
    try {
        if (-not [MastermindFilesystemFileSession]::GetFileInformationByHandleEx(
            $Handle, 9, $tagBuffer, $tagSize
        )) { Stop-Unsafe }
        $tag = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $tagBuffer, [type][MastermindFilesystemFileSession+FILE_ATTRIBUTE_TAG_INFO]
        )
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($tagBuffer)
    }
    $information = New-Object MastermindFilesystemFileSession+BY_HANDLE_FILE_INFORMATION
    if (-not [MastermindFilesystemFileSession]::GetFileInformationByHandle($Handle, [ref] $information)) {
        Stop-Unsafe
    }
    if (($tag.FileAttributes -band 0x10) -ne 0 -or ($tag.FileAttributes -band 0x400) -ne 0 `
        -or $tag.ReparseTag -ne 0 -or $information.NumberOfLinks -ne 1) {
        Stop-Unsafe
    }
    Assert-NoAlternateStreams $Handle
    $fileIndex = (([UInt64] $information.FileIndexHigh) -shl 32) -bor [UInt64] $information.FileIndexLow
    $size = (([UInt64] $information.FileSizeHigh) -shl 32) -bor [UInt64] $information.FileSizeLow
    return @{
        attributes = [UInt32] $tag.FileAttributes
        identity = ('{0:x8}:{1:x16}' -f $information.VolumeSerialNumber, $fileIndex)
        links = [UInt32] $information.NumberOfLinks
        size = $size.ToString([Globalization.CultureInfo]::InvariantCulture)
        tag = [UInt32] $tag.ReparseTag
    }
}

function Assert-SameFile($Entry) {
    $current = Get-FileEvidence $Entry.handle
    if ($current.attributes -ne $Entry.attributes -or $current.identity -ne $Entry.identity `
        -or $current.links -ne $Entry.links -or $current.size -ne $Entry.size `
        -or $current.tag -ne $Entry.tag) {
        Stop-Unsafe
    }
}

function Rename-HeldFile($Handle, [string] $Destination, [bool] $ReplaceExisting) {
    $nameBytes = [Text.Encoding]::Unicode.GetBytes($Destination)
    if ($nameBytes.Length -lt 2 -or $nameBytes.Length -gt 60000) { Stop-Unsafe }
    $rootOffset = if ([IntPtr]::Size -eq 8) { 8 } else { 4 }
    $lengthOffset = if ([IntPtr]::Size -eq 8) { 16 } else { 8 }
    $nameOffset = if ([IntPtr]::Size -eq 8) { 20 } else { 12 }
    $total = $nameOffset + $nameBytes.Length + 16
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($total)
    try {
        for ($index = 0; $index -lt $total; $index += 1) {
            [Runtime.InteropServices.Marshal]::WriteByte($buffer, $index, 0)
        }
        if ($ReplaceExisting) { [Runtime.InteropServices.Marshal]::WriteByte($buffer, 0, 1) }
        [Runtime.InteropServices.Marshal]::WriteIntPtr($buffer, $rootOffset, [IntPtr]::Zero)
        [Runtime.InteropServices.Marshal]::WriteInt32($buffer, $lengthOffset, $nameBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy(
            $nameBytes, 0, [IntPtr]::Add($buffer, $nameOffset), $nameBytes.Length
        )
        if (-not [MastermindFilesystemFileSession]::SetFileInformationByHandle(
            $Handle, 3, $buffer, $total
        )) { Stop-Unsafe }
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
}

try {
    while ($true) {
        $request = (Read-BoundedLine) | ConvertFrom-Json
        if ($request.command -isnot [string] -or -not (Test-ProtocolId $request.requestId) `
            -or -not (Test-ProtocolId $request.cohortId)) {
            Stop-Unsafe
        }

        if ($request.command -eq 'acquire') {
            if (-not (Test-ExactKeys $request @('command', 'requestId', 'cohortId', 'paths')) `
                -or $request.paths -isnot [System.Array]) {
                Stop-Unsafe
            }
            $paths = @($request.paths)
            if ($paths.Count -lt 1 -or $paths.Count -gt $MaximumGuards `
                -or $activeCount + $paths.Count -gt $MaximumGuards) {
                Stop-Unsafe
            }
            $cohortPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            $fullPaths = @()
            foreach ($requestedPath in $paths) {
                $fullPath = Get-SafeFullPath $requestedPath
                if ($null -eq $fullPath -or -not $cohortPaths.Add($fullPath) `
                    -or $activePaths.Contains($fullPath)) {
                    Stop-Unsafe
                }
                $fullPaths += $fullPath
            }
            $availableSlots = @()
            for ($slot = 0; $slot -lt $MaximumGuards -and $availableSlots.Count -lt $paths.Count; $slot += 1) {
                if ($null -eq $guards[$slot]) { $availableSlots += $slot }
            }
            if ($availableSlots.Count -ne $paths.Count) { Stop-Unsafe }

            $ready = @()
            for ($index = 0; $index -lt $fullPaths.Count; $index += 1) {
                $fullPath = $fullPaths[$index]
                $slot = [int] $availableSlots[$index]
                $handle = [MastermindFilesystemFileSession]::CreateFileW(
                    $fullPath, 0x00010180, 1, [IntPtr]::Zero, 3, 0x00200000, [IntPtr]::Zero
                )
                if ($handle.IsInvalid) { Stop-Unsafe }
                $evidence = Get-FileEvidence $handle
                if (-not $activeIdentities.Add($evidence.identity) -or -not $activePaths.Add($fullPath)) {
                    $handle.Dispose()
                    Stop-Unsafe
                }
                if ($slotGenerations[$slot] -ge 999999999999999999) { Stop-Unsafe }
                $slotGenerations[$slot] += 1
                $generation = $slotGenerations[$slot].ToString([Globalization.CultureInfo]::InvariantCulture)
                $guards[$slot] = [pscustomobject]@{
                    handle = $handle
                    attributes = $evidence.attributes
                    identity = $evidence.identity
                    links = $evidence.links
                    size = $evidence.size
                    tag = $evidence.tag
                    path = $fullPath
                    cohortId = $request.cohortId
                    generation = $generation
                }
                $activeCount += 1
                $ready += [pscustomobject]@{
                    slot = $slot
                    generation = $generation
                    identity = $evidence.identity
                    size = $evidence.size
                }
            }
            [Console]::Out.WriteLine((@{
                ok = $true
                command = 'acquire'
                requestId = $request.requestId
                cohortId = $request.cohortId
                guards = $ready
            } | ConvertTo-Json -Compress -Depth 4))
            continue
        }

        if ($request.command -eq 'close') {
            if (-not (Test-ExactKeys $request @('command', 'requestId', 'cohortId')) -or $activeCount -ne 0) {
                Stop-Unsafe
            }
            [Console]::Out.WriteLine((@{
                ok = $true
                command = 'close'
                requestId = $request.requestId
                cohortId = $request.cohortId
            } | ConvertTo-Json -Compress))
            break
        }

        $terminal = @('release', 'delete', 'rename', 'replace') -contains $request.command
        if (-not $terminal -or (($request.slot -isnot [long]) -and ($request.slot -isnot [int])) `
            -or $request.generation -isnot [string]) {
            Stop-Unsafe
        }
        if ($request.command -eq 'rename' -or $request.command -eq 'replace') {
            if (-not (Test-ExactKeys $request @(
                'command', 'requestId', 'cohortId', 'slot', 'generation', 'destination'
            ))) { Stop-Unsafe }
            $destination = Get-SafeFullPath $request.destination
            if ($null -eq $destination) { Stop-Unsafe }
        } else {
            if (-not (Test-ExactKeys $request @(
                'command', 'requestId', 'cohortId', 'slot', 'generation'
            ))) { Stop-Unsafe }
            $destination = $null
        }
        $slot = [int] $request.slot
        if ($slot -lt 0 -or $slot -ge $MaximumGuards -or $null -eq $guards[$slot]) { Stop-Unsafe }
        $entry = $guards[$slot]
        if ($entry.cohortId -ne $request.cohortId -or $entry.generation -ne $request.generation) {
            Stop-Unsafe
        }
        if ($null -ne $destination -and $destination -ne $entry.path -and $activePaths.Contains($destination)) {
            Stop-Unsafe
        }

        Assert-SameFile $entry
        if ($request.command -eq 'rename' -or $request.command -eq 'replace') {
            Rename-HeldFile $entry.handle $destination ($request.command -eq 'replace')
            Assert-SameFile $entry
        } elseif ($request.command -eq 'delete') {
            # Read-only is a normal attribute for managed immutable artifacts
            # such as family-core.jar. Clear only that attribute through the
            # already authenticated handle before marking the same file object
            # for deletion; path-based attribute mutation would reopen a race.
            if (($entry.attributes -band 0x1) -ne 0) {
                $basic = New-Object MastermindFilesystemFileSession+FILE_BASIC_INFO
                $basic.FileAttributes = [UInt32] ($entry.attributes -band (-bnot 0x1))
                if ($basic.FileAttributes -eq 0) { $basic.FileAttributes = [UInt32] 0x80 }
                $basicSize = [Runtime.InteropServices.Marshal]::SizeOf(
                    [type][MastermindFilesystemFileSession+FILE_BASIC_INFO]
                )
                $basicBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($basicSize)
                try {
                    [Runtime.InteropServices.Marshal]::StructureToPtr($basic, $basicBuffer, $false)
                    if (-not [MastermindFilesystemFileSession]::SetFileInformationByHandle(
                        $entry.handle, 0, $basicBuffer, [UInt32] $basicSize
                    )) { Stop-Unsafe }
                } finally {
                    [Runtime.InteropServices.Marshal]::FreeHGlobal($basicBuffer)
                }
            }
            $disposition = [Runtime.InteropServices.Marshal]::AllocHGlobal(1)
            try {
                [Runtime.InteropServices.Marshal]::WriteByte($disposition, 1)
                if (-not [MastermindFilesystemFileSession]::SetFileInformationByHandle(
                    $entry.handle, 4, $disposition, 1
                )) { Stop-Unsafe }
            } finally {
                [Runtime.InteropServices.Marshal]::FreeHGlobal($disposition)
            }
        }
        $entry.handle.Dispose()
        [void] $activePaths.Remove($entry.path)
        [void] $activeIdentities.Remove($entry.identity)
        $guards[$slot] = $null
        $activeCount -= 1
        [Console]::Out.WriteLine((@{
            ok = $true
            command = $request.command
            requestId = $request.requestId
            cohortId = $request.cohortId
            slot = $slot
            generation = $request.generation
        } | ConvertTo-Json -Compress))
    }
} catch {
    Stop-Unsafe
} finally {
    foreach ($entry in $guards) {
        if ($null -ne $entry -and $null -ne $entry.handle) {
            $entry.handle.Dispose()
        }
    }
}
