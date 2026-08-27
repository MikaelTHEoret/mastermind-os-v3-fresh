$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MastermindFilesystemVerifierSession {
    [StructLayout(LayoutKind.Sequential)]
    public struct FILE_ATTRIBUTE_TAG_INFO { public UInt32 FileAttributes; public UInt32 ReparseTag; }
    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME { public UInt32 LowDateTime; public UInt32 HighDateTime; }
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
}
'@

$MaximumLineBytes = 1048576

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

function Test-SafeEntryName($Candidate) {
    if ($Candidate -isnot [string] -or $Candidate.Length -lt 1 -or $Candidate.Length -gt 255 `
        -or $Candidate -eq '.' -or $Candidate -eq '..' -or $Candidate -match '[ .]$' `
        -or $Candidate -match '[\\/\x00-\x1f<>:"|?*]' `
        -or $Candidate -match '^(?i:(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?)$') {
        return $false
    }
    return $true
}

function Get-EntryEvidence([string] $LiteralPath) {
    $handle = [MastermindFilesystemVerifierSession]::CreateFileW(
        $LiteralPath, 0, 7, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero
    )
    if ($handle.IsInvalid) { Stop-Unsafe }
    try {
        $tagSize = [Runtime.InteropServices.Marshal]::SizeOf(
            [type][MastermindFilesystemVerifierSession+FILE_ATTRIBUTE_TAG_INFO]
        )
        $tagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
        try {
            if (-not [MastermindFilesystemVerifierSession]::GetFileInformationByHandleEx(
                $handle, 9, $tagBuffer, $tagSize
            )) { Stop-Unsafe }
            $tag = [Runtime.InteropServices.Marshal]::PtrToStructure(
                $tagBuffer, [type][MastermindFilesystemVerifierSession+FILE_ATTRIBUTE_TAG_INFO]
            )
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($tagBuffer)
        }
        if (($tag.FileAttributes -band 0x400) -ne 0 -or $tag.ReparseTag -ne 0) { Stop-Unsafe }

        $information = New-Object MastermindFilesystemVerifierSession+BY_HANDLE_FILE_INFORMATION
        if (-not [MastermindFilesystemVerifierSession]::GetFileInformationByHandle($handle, [ref] $information) `
            -or $information.NumberOfLinks -ne 1) {
            Stop-Unsafe
        }

        $streamSize = 4096
        $streamNames = @()
        while ($true) {
            if ($streamSize -gt 1048576) { Stop-Unsafe }
            $streamBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($streamSize)
            try {
                $streamOk = [MastermindFilesystemVerifierSession]::GetFileInformationByHandleEx(
                    $handle, 7, $streamBuffer, $streamSize
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

        $fileIndex = (([UInt64] $information.FileIndexHigh) -shl 32) -bor [UInt64] $information.FileIndexLow
        return @{
            directory = (($tag.FileAttributes -band 0x10) -ne 0)
            identity = ('{0:x8}:{1:x16}' -f $information.VolumeSerialNumber, $fileIndex)
        }
    } finally {
        $handle.Dispose()
    }
}

try {
    while ($true) {
        $request = (Read-BoundedLine) | ConvertFrom-Json
        if ($request.command -isnot [string] -or -not (Test-ProtocolId $request.requestId) `
            -or -not (Test-ProtocolId $request.cohortId)) {
            Stop-Unsafe
        }
        if ($request.command -eq 'close') {
            if (-not (Test-ExactKeys $request @('command', 'requestId', 'cohortId'))) { Stop-Unsafe }
            [Console]::Out.WriteLine((@{
                ok = $true
                command = 'close'
                requestId = $request.requestId
                cohortId = $request.cohortId
            } | ConvertTo-Json -Compress))
            break
        }
        if ($request.command -ne 'verify' -or -not (Test-ExactKeys $request @(
            'command', 'requestId', 'cohortId', 'generation', 'root', 'maxEntries', 'maxDepth', 'recursive'
        )) -or $request.generation -isnot [string] -or $request.generation -notmatch '^[1-9][0-9]{0,18}$') {
            Stop-Unsafe
        }
        $root = Get-SafeFullPath $request.root
        $validEntries = (($request.maxEntries -is [int]) -or ($request.maxEntries -is [long])) `
            -and $request.maxEntries -ge 1 -and $request.maxEntries -le 500000
        $validDepth = (($request.maxDepth -is [int]) -or ($request.maxDepth -is [long])) `
            -and $request.maxDepth -ge 0 -and $request.maxDepth -le 64
        if ($null -eq $root -or -not $validEntries -or -not $validDepth `
            -or $request.recursive -isnot [bool]) {
            Stop-Unsafe
        }

        $script:entryCount = 0
        function Visit-Entry([string] $LiteralPath, [int] $Depth) {
            if ($Depth -gt $request.maxDepth) { Stop-Unsafe }
            $before = Get-EntryEvidence $LiteralPath
            if ($Depth -gt 0) {
                $script:entryCount += 1
                if ($script:entryCount -gt $request.maxEntries) { Stop-Unsafe }
            }
            if ($before.directory -and $request.recursive) {
                foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($LiteralPath)) {
                    $prefix = if ($LiteralPath.EndsWith('\')) { $LiteralPath } else { "$LiteralPath\" }
                    if (-not $child.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { Stop-Unsafe }
                    $childName = $child.Substring($prefix.Length)
                    if (-not (Test-SafeEntryName $childName)) { Stop-Unsafe }
                    Visit-Entry $child ($Depth + 1)
                }
            }
            $after = Get-EntryEvidence $LiteralPath
            if ($before.directory -ne $after.directory -or $before.identity -ne $after.identity) {
                Stop-Unsafe
            }
        }
        Visit-Entry $root 0
        [Console]::Out.WriteLine((@{
            ok = $true
            command = 'verify'
            requestId = $request.requestId
            cohortId = $request.cohortId
            generation = $request.generation
            entries = $script:entryCount
        } | ConvertTo-Json -Compress))
    }
} catch {
    Stop-Unsafe
}
