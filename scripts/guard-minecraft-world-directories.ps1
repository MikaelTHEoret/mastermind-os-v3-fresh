$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MastermindWorldDirectoryGuardBatch {
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
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetFileInformationByHandle(SafeFileHandle file, Int32 infoClass, IntPtr info, UInt32 size);
}
'@

$MaximumGuards = 256
$MaximumLineBytes = 1048576
$guards = @()

function Stop-Unsafe {
    try {
        [Console]::Out.WriteLine((@{ ok = $false; code = 'UNSAFE_FILESYSTEM' } | ConvertTo-Json -Compress))
    } catch {}
    exit 1
}

function Read-BoundedLine {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line.Length -lt 2 `
        -or [Text.Encoding]::UTF8.GetByteCount($line) -gt $MaximumLineBytes) {
        Stop-Unsafe
    }
    return $line
}

function Test-SafeDirectoryPath {
    param([object] $Candidate)
    if ($Candidate -isnot [string] -or -not [IO.Path]::IsPathRooted($Candidate) `
        -or $Candidate.Length -lt 3 -or $Candidate.Length -gt 30000 `
        -or $Candidate.Contains([char] 0)) {
        return $false
    }
    $normalized = $Candidate.Replace('/', '\')
    if ($normalized.StartsWith('\\.\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\\??\', [StringComparison]::OrdinalIgnoreCase) `
        -or $normalized.StartsWith('\??\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
    try {
        $inputRoot = [IO.Path]::GetPathRoot($normalized)
        $inputDriveRoot = $inputRoot -match '^[A-Za-z]:\\$'
        $inputUncRoot = -not $inputRoot.Contains(':') -and $inputRoot -match '^\\\\[^\\]+\\[^\\]+\\?$'
        if (-not $inputDriveRoot -and -not $inputUncRoot) { return $false }
        $inputTail = $normalized.Substring($inputRoot.Length)
        if ($inputDriveRoot -and $inputTail.StartsWith('\')) { return $false }
        if ($inputUncRoot) {
            if (-not $inputTail.StartsWith('\')) { return $false }
            $inputTail = $inputTail.Substring(1)
        }
        if ($inputTail.Length -eq 0) { return $false }
        foreach ($component in [string[]] $inputTail.Split([char]'\')) {
            if ($component.Length -eq 0 -or $component -eq '.' -or $component -eq '..' `
                -or $component -match '[ .]$' -or $component -match '[\x00-\x1f<>:"|?*]' `
                -or $component -match '^(?i:(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?)$') {
                return $false
            }
        }
        $fullPath = [IO.Path]::GetFullPath($Candidate)
        $root = [IO.Path]::GetPathRoot($fullPath)
    } catch {
        return $false
    }
    if ([string]::IsNullOrEmpty($root) -or $fullPath.Length -le $root.Length `
        -or $fullPath.Substring($root.Length).Contains(':')) { return $false }
    foreach ($component in @($fullPath.Substring($root.Length) -split '\\' | Where-Object { $_.Length -gt 0 })) {
        if ($component -match '[ .]$' -or $component -match '[\x00-\x1f<>:"|?*]' `
            -or $component -match '^(?i:(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?)$') {
            return $false
        }
    }
    return $true
}

function Get-DirectoryEvidence($Handle) {
    $tagSize = [Runtime.InteropServices.Marshal]::SizeOf(
        [type][MastermindWorldDirectoryGuardBatch+FILE_ATTRIBUTE_TAG_INFO]
    )
    $tagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
    try {
        if (-not [MastermindWorldDirectoryGuardBatch]::GetFileInformationByHandleEx(
            $Handle, 9, $tagBuffer, $tagSize
        )) { Stop-Unsafe }
        $tag = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $tagBuffer, [type][MastermindWorldDirectoryGuardBatch+FILE_ATTRIBUTE_TAG_INFO]
        )
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($tagBuffer)
    }
    $information = New-Object MastermindWorldDirectoryGuardBatch+BY_HANDLE_FILE_INFORMATION
    if (-not [MastermindWorldDirectoryGuardBatch]::GetFileInformationByHandle($Handle, [ref] $information)) {
        Stop-Unsafe
    }
    if (($tag.FileAttributes -band 0x10) -eq 0 -or ($tag.FileAttributes -band 0x400) -ne 0 `
        -or $tag.ReparseTag -ne 0 -or $information.NumberOfLinks -ne 1) {
        Stop-Unsafe
    }
    $fileIndex = (([UInt64] $information.FileIndexHigh) -shl 32) -bor [UInt64] $information.FileIndexLow
    return @{
        identity = ('{0:x8}:{1:x16}' -f $information.VolumeSerialNumber, $fileIndex)
        links = [UInt32] $information.NumberOfLinks
    }
}

function Assert-SameDirectory($Entry) {
    $current = Get-DirectoryEvidence $Entry.handle
    if ($current.identity -ne $Entry.identity -or $current.links -ne $Entry.links) { Stop-Unsafe }
}

function Rename-HeldDirectory($Handle, [string] $Destination) {
    $fullDestination = [IO.Path]::GetFullPath($Destination)
    $nameBytes = [Text.Encoding]::Unicode.GetBytes($fullDestination)
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
        [Runtime.InteropServices.Marshal]::WriteIntPtr($buffer, $rootOffset, [IntPtr]::Zero)
        [Runtime.InteropServices.Marshal]::WriteInt32($buffer, $lengthOffset, $nameBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy(
            $nameBytes, 0, [IntPtr]::Add($buffer, $nameOffset), $nameBytes.Length
        )
        if (-not [MastermindWorldDirectoryGuardBatch]::SetFileInformationByHandle(
            $Handle, 3, $buffer, $total
        )) { Stop-Unsafe }
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
}

try {
    $initial = (Read-BoundedLine) | ConvertFrom-Json
    $initialKeys = @($initial.PSObject.Properties.Name)
    if ($initialKeys.Count -ne 2 -or $initialKeys -notcontains 'command' -or $initialKeys -notcontains 'paths' `
        -or $initial.command -ne 'acquire' -or $initial.paths -isnot [System.Array]) {
        Stop-Unsafe
    }
    $paths = @($initial.paths)
    if ($paths.Count -lt 1 -or $paths.Count -gt $MaximumGuards) { Stop-Unsafe }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $ready = @()
    for ($id = 0; $id -lt $paths.Count; $id += 1) {
        $requestedPath = $paths[$id]
        if (-not (Test-SafeDirectoryPath $requestedPath)) {
            Stop-Unsafe
        }
        $fullPath = [IO.Path]::GetFullPath($requestedPath)
        if ($fullPath.Length -lt 3 -or $fullPath.Length -gt 30000 -or -not $seen.Add($fullPath)) {
            Stop-Unsafe
        }

        # FILE_LIST_DIRECTORY | DELETE with FILE_SHARE_READ only. The share mask
        # protects this directory object from metadata writes, rename, or deletion;
        # ordinary child objects remain independently creatable/readable/removable.
        # OPEN_REPARSE_POINT observes the final component rather than following it,
        # and BACKUP_SEMANTICS permits an exact directory handle.
        $handle = [MastermindWorldDirectoryGuardBatch]::CreateFileW(
            $fullPath, 0x00010001, 1, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero
        )
        if ($handle.IsInvalid) { Stop-Unsafe }
        $evidence = Get-DirectoryEvidence $handle
        $entry = [pscustomobject]@{
            handle = $handle
            identity = $evidence.identity
            links = $evidence.links
            active = $true
        }
        $guards += $entry
        $ready += [pscustomobject]@{ id = $id; identity = $evidence.identity }
    }
    [Console]::Out.WriteLine((@{ ok = $true; guards = $ready } | ConvertTo-Json -Compress -Depth 4))

    $activeCount = $guards.Count
    while ($activeCount -gt 0) {
        $request = (Read-BoundedLine) | ConvertFrom-Json
        $keys = @($request.PSObject.Properties.Name)
        if (($request.command -isnot [string]) `
            -or (($request.id -isnot [long]) -and ($request.id -isnot [int]))) {
            Stop-Unsafe
        }
        $command = $request.command
        if ($command -eq 'rename') {
            if ($keys.Count -ne 3 -or $keys -notcontains 'command' -or $keys -notcontains 'id' `
                -or $keys -notcontains 'destination' `
                -or -not (Test-SafeDirectoryPath $request.destination)) {
                Stop-Unsafe
            }
        } elseif ($command -eq 'release' -or $command -eq 'delete') {
            if ($keys.Count -ne 2 -or $keys -notcontains 'command' -or $keys -notcontains 'id') {
                Stop-Unsafe
            }
        } else {
            Stop-Unsafe
        }
        $id = [int] $request.id
        if ($id -lt 0 -or $id -ge $guards.Count -or -not $guards[$id].active) { Stop-Unsafe }
        $entry = $guards[$id]

        # Re-query the exact held object immediately before every terminal action.
        Assert-SameDirectory $entry
        if ($command -eq 'rename') {
            Rename-HeldDirectory $entry.handle $request.destination
            Assert-SameDirectory $entry
        } elseif ($command -eq 'delete') {
            $disposition = [Runtime.InteropServices.Marshal]::AllocHGlobal(1)
            try {
                [Runtime.InteropServices.Marshal]::WriteByte($disposition, 1)
                if (-not [MastermindWorldDirectoryGuardBatch]::SetFileInformationByHandle(
                    $entry.handle, 4, $disposition, 1
                )) { Stop-Unsafe }
            } finally {
                [Runtime.InteropServices.Marshal]::FreeHGlobal($disposition)
            }
        }

        $entry.handle.Dispose()
        $entry.active = $false
        $activeCount -= 1
        if ($command -eq 'rename') {
            [Console]::Out.WriteLine((@{ ok = $true; id = $id; renamed = $true } | ConvertTo-Json -Compress))
        } elseif ($command -eq 'delete') {
            [Console]::Out.WriteLine((@{ ok = $true; id = $id; deleted = $true } | ConvertTo-Json -Compress))
        } else {
            [Console]::Out.WriteLine((@{ ok = $true; id = $id; released = $true } | ConvertTo-Json -Compress))
        }
    }
} catch {
    Stop-Unsafe
} finally {
    foreach ($entry in $guards) {
        if ($null -ne $entry -and $entry.active -and $null -ne $entry.handle) {
            $entry.handle.Dispose()
            $entry.active = $false
        }
    }
}
