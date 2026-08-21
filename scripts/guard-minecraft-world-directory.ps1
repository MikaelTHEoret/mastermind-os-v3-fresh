$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class MastermindWorldDirectoryGuard {
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
    public static extern bool SetFileInformationByHandle(SafeFileHandle file, Int32 infoClass, IntPtr info, UInt32 size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandle(SafeFileHandle file, out BY_HANDLE_FILE_INFORMATION info);
}
'@

function Fail-Safely {
    [Console]::Out.WriteLine((@{ ok = $false; code = 'UNSAFE_FILESYSTEM' } | ConvertTo-Json -Compress))
    exit 1
}

function Test-SafeGuardPath {
    param([object] $Candidate)
    if ($Candidate -isnot [string] -or -not [IO.Path]::IsPathRooted($Candidate) `
        -or $Candidate.Length -lt 3 -or $Candidate.Length -gt 30000 `
        -or $Candidate.Contains([char] 0)) { return $false }
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
    } catch { return $false }
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

function Rename-HeldEntry($Handle, [string] $Destination) {
    $fullDestination = [IO.Path]::GetFullPath($Destination)
    $nameBytes = [Text.Encoding]::Unicode.GetBytes($fullDestination)
    if ($nameBytes.Length -lt 2 -or $nameBytes.Length -gt 60000) { Fail-Safely }
    $rootOffset = if ([IntPtr]::Size -eq 8) { 8 } else { 4 }
    $lengthOffset = if ([IntPtr]::Size -eq 8) { 16 } else { 8 }
    $nameOffset = if ([IntPtr]::Size -eq 8) { 20 } else { 12 }
    # FILE_RENAME_INFO has a variable trailing WCHAR and platform alignment;
    # retain zeroed tail padding while FileNameLength binds the exact name.
    $total = $nameOffset + $nameBytes.Length + 16
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($total)
    try {
        for ($index = 0; $index -lt $total; $index += 1) {
            [Runtime.InteropServices.Marshal]::WriteByte($buffer, $index, 0)
        }
        [Runtime.InteropServices.Marshal]::WriteIntPtr($buffer, $rootOffset, [IntPtr]::Zero)
        [Runtime.InteropServices.Marshal]::WriteInt32($buffer, $lengthOffset, $nameBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy($nameBytes, 0, [IntPtr]::Add($buffer, $nameOffset), $nameBytes.Length)
        if (-not [MastermindWorldDirectoryGuard]::SetFileInformationByHandle($Handle, 3, $buffer, $total)) {
            Fail-Safely
        }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
}

$guard = $null
try {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line.Length -lt 2 -or $line.Length -gt 32768) { Fail-Safely }
    $request = $line | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    $validRequest = $keys.Count -eq 1 -and $keys[0] -eq 'path' -and (Test-SafeGuardPath $request.path)
    if (-not $validRequest) { Fail-Safely }

    # FILE_LIST_DIRECTORY | DELETE + share-read only. Denying share-write prevents another
    # handle from changing directory metadata/reparse state while the guard is
    # active; omitting share-delete prevents rename/removal. Child entries remain
    # independently accessible and are guarded by the caller during recursion.
    # OPEN_REPARSE_POINT ensures a final reparse target is never followed.
    $guard = [MastermindWorldDirectoryGuard]::CreateFileW(
        [IO.Path]::GetFullPath($request.path), 0x00010001, 1, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero
    )
    if ($guard.IsInvalid) { Fail-Safely }
    $tagSize = [Runtime.InteropServices.Marshal]::SizeOf([type][MastermindWorldDirectoryGuard+FILE_ATTRIBUTE_TAG_INFO])
    $tagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
    try {
        if (-not [MastermindWorldDirectoryGuard]::GetFileInformationByHandleEx($guard, 9, $tagBuffer, $tagSize)) { Fail-Safely }
        $tag = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $tagBuffer, [type][MastermindWorldDirectoryGuard+FILE_ATTRIBUTE_TAG_INFO]
        )
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($tagBuffer) }
    if (($tag.FileAttributes -band 0x10) -eq 0 -or ($tag.FileAttributes -band 0x400) -ne 0 -or $tag.ReparseTag -ne 0) {
        Fail-Safely
    }
    $identity = New-Object MastermindWorldDirectoryGuard+BY_HANDLE_FILE_INFORMATION
    if (-not [MastermindWorldDirectoryGuard]::GetFileInformationByHandle($guard, [ref] $identity) `
        -or $identity.NumberOfLinks -ne 1) { Fail-Safely }
    [Console]::Out.WriteLine((@{ ok = $true } | ConvertTo-Json -Compress))
    $commandLine = [Console]::In.ReadLine()
    $renamed = $false
    if ($commandLine -eq 'release' -or $commandLine -eq 'delete') {
        $command = $commandLine
    } else {
        if ($null -eq $commandLine -or $commandLine.Length -lt 2 -or $commandLine.Length -gt 32768) { Fail-Safely }
        $commandRequest = $commandLine | ConvertFrom-Json
        $commandKeys = @($commandRequest.PSObject.Properties.Name)
        if ($commandKeys.Count -ne 2 -or $commandKeys -notcontains 'command' -or $commandKeys -notcontains 'destination' `
            -or $commandRequest.command -ne 'rename' -or -not (Test-SafeGuardPath $commandRequest.destination)) {
            Fail-Safely
        }
        Rename-HeldEntry $guard $commandRequest.destination
        $command = 'rename'
        $renamed = $true
    }
    $finalTagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
    try {
        if (-not [MastermindWorldDirectoryGuard]::GetFileInformationByHandleEx($guard, 9, $finalTagBuffer, $tagSize)) {
            Fail-Safely
        }
        $finalTag = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $finalTagBuffer, [type][MastermindWorldDirectoryGuard+FILE_ATTRIBUTE_TAG_INFO]
        )
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($finalTagBuffer) }
    $finalIdentity = New-Object MastermindWorldDirectoryGuard+BY_HANDLE_FILE_INFORMATION
    if (-not [MastermindWorldDirectoryGuard]::GetFileInformationByHandle($guard, [ref] $finalIdentity)) { Fail-Safely }
    if (($finalTag.FileAttributes -band 0x10) -eq 0 -or ($finalTag.FileAttributes -band 0x400) -ne 0 `
        -or $finalTag.ReparseTag -ne 0 -or $finalIdentity.NumberOfLinks -ne 1 `
        -or $finalIdentity.VolumeSerialNumber -ne $identity.VolumeSerialNumber `
        -or $finalIdentity.FileIndexHigh -ne $identity.FileIndexHigh `
        -or $finalIdentity.FileIndexLow -ne $identity.FileIndexLow) {
        Fail-Safely
    }
    if ($command -eq 'delete') {
        $disposition = [Runtime.InteropServices.Marshal]::AllocHGlobal(1)
        try {
            [Runtime.InteropServices.Marshal]::WriteByte($disposition, 1)
            if (-not [MastermindWorldDirectoryGuard]::SetFileInformationByHandle($guard, 4, $disposition, 1)) { Fail-Safely }
        } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($disposition) }
        [Console]::Out.WriteLine((@{ ok = $true; deleted = $true } | ConvertTo-Json -Compress))
    } elseif ($renamed) {
        [Console]::Out.WriteLine((@{ ok = $true; renamed = $true } | ConvertTo-Json -Compress))
    } else {
        [Console]::Out.WriteLine((@{ ok = $true; released = $true } | ConvertTo-Json -Compress))
    }
} catch { Fail-Safely }
finally { if ($null -ne $guard) { $guard.Dispose() } }
