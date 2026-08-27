$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class MastermindWorldFileNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct FILE_ATTRIBUTE_TAG_INFO {
        public UInt32 FileAttributes;
        public UInt32 ReparseTag;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME {
        public UInt32 LowDateTime;
        public UInt32 HighDateTime;
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
    public static extern SafeFileHandle CreateFileW(
        string fileName,
        UInt32 desiredAccess,
        UInt32 shareMode,
        IntPtr securityAttributes,
        UInt32 creationDisposition,
        UInt32 flagsAndAttributes,
        IntPtr templateFile
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandleEx(
        SafeFileHandle file,
        Int32 fileInformationClass,
        IntPtr fileInformation,
        UInt32 bufferSize
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out BY_HANDLE_FILE_INFORMATION fileInformation
    );
}
'@

function Fail-Safely([string] $Code) {
    [Console]::Out.WriteLine((@{ ok = $false; code = $Code } | ConvertTo-Json -Compress))
    exit 1
}

function Get-EntryEvidence([string] $LiteralPath) {
    # Desired access 0 is sufficient for metadata. Sharing read/write/delete
    # avoids disturbing Minecraft while OPEN_REPARSE_POINT prevents following
    # a final reparse target.
    $handle = [MastermindWorldFileNative]::CreateFileW(
        $LiteralPath,
        0,
        7,
        [IntPtr]::Zero,
        3,
        0x02200000,
        [IntPtr]::Zero
    )
    if ($handle.IsInvalid) { throw 'open-failed' }
    try {
        $tagSize = [Runtime.InteropServices.Marshal]::SizeOf([type][MastermindWorldFileNative+FILE_ATTRIBUTE_TAG_INFO])
        $tagBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($tagSize)
        try {
            if (-not [MastermindWorldFileNative]::GetFileInformationByHandleEx($handle, 9, $tagBuffer, $tagSize)) {
                throw 'tag-query-failed'
            }
            $tag = [Runtime.InteropServices.Marshal]::PtrToStructure(
                $tagBuffer,
                [type][MastermindWorldFileNative+FILE_ATTRIBUTE_TAG_INFO]
            )
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($tagBuffer)
        }

        if (($tag.FileAttributes -band 0x400) -ne 0 -or $tag.ReparseTag -ne 0) {
            throw 'reparse-point'
        }

        $identity = New-Object MastermindWorldFileNative+BY_HANDLE_FILE_INFORMATION
        if (-not [MastermindWorldFileNative]::GetFileInformationByHandle($handle, [ref] $identity)) {
            throw 'identity-query-failed'
        }
        if ($identity.NumberOfLinks -ne 1) { throw 'hard-link' }

        $streamSize = 4096
        $streamNames = @()
        while ($true) {
            if ($streamSize -gt 1048576) { throw 'stream-list-too-large' }
            $streamBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($streamSize)
            try {
                $streamOk = [MastermindWorldFileNative]::GetFileInformationByHandleEx($handle, 7, $streamBuffer, $streamSize)
                if ($streamOk) {
                    $offset = 0
                    while ($true) {
                        if ($offset -lt 0 -or $offset + 24 -gt $streamSize) { throw 'invalid-stream-list' }
                        $next = [Runtime.InteropServices.Marshal]::ReadInt32($streamBuffer, $offset)
                        $nameBytes = [Runtime.InteropServices.Marshal]::ReadInt32($streamBuffer, $offset + 4)
                        if ($nameBytes -lt 0 -or ($nameBytes % 2) -ne 0 -or $offset + 24 + $nameBytes -gt $streamSize) {
                            throw 'invalid-stream-list'
                        }
                        $name = [Runtime.InteropServices.Marshal]::PtrToStringUni(
                            [IntPtr]::Add($streamBuffer, $offset + 24),
                            [int] ($nameBytes / 2)
                        )
                        $streamNames += $name
                        if ($next -eq 0) { break }
                        if ($next -lt 24 -or $offset + $next -le $offset) { throw 'invalid-stream-list' }
                        $offset += $next
                    }
                    break
                }
                $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                if ($nativeError -eq 38) { break }
                if ($nativeError -ne 234) { throw 'stream-query-failed' }
            } finally {
                [Runtime.InteropServices.Marshal]::FreeHGlobal($streamBuffer)
            }
            $streamSize *= 2
        }

        foreach ($streamName in $streamNames) {
            if ($streamName -ne '::$DATA' -and $streamName -ne '::$INDEX_ALLOCATION') {
                throw 'alternate-data-stream'
            }
        }

        $fileIndex = (([UInt64] $identity.FileIndexHigh) -shl 32) -bor [UInt64] $identity.FileIndexLow
        return @{
            directory = (($tag.FileAttributes -band 0x10) -ne 0)
            identity = ('{0:x8}:{1:x16}' -f $identity.VolumeSerialNumber, $fileIndex)
        }
    } finally {
        $handle.Dispose()
    }
}

try {
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -lt 2 -or $inputText.Length -gt 32768) { Fail-Safely 'INVALID_REQUEST' }
    $request = $inputText | ConvertFrom-Json
    $properties = @($request.PSObject.Properties.Name)
    if ($properties.Count -ne 4 -or $properties -notcontains 'root' -or $properties -notcontains 'maxEntries' `
        -or $properties -notcontains 'maxDepth' -or $properties -notcontains 'recursive') {
        Fail-Safely 'INVALID_REQUEST'
    }
    $validRoot = $request.root -is [string] -and [IO.Path]::IsPathRooted($request.root) `
        -and $request.root.Length -ge 3 -and $request.root.Length -le 30000
    $validEntries = $request.maxEntries -is [int] -and $request.maxEntries -ge 1 `
        -and $request.maxEntries -le 500000
    $validDepth = $request.maxDepth -is [int] -and $request.maxDepth -ge 0 `
        -and $request.maxDepth -le 64
    if (-not $validRoot -or -not $validEntries -or -not $validDepth -or $request.recursive -isnot [bool]) {
        Fail-Safely 'INVALID_REQUEST'
    }

    $script:entryCount = 0
    function Visit-Entry([string] $LiteralPath, [int] $Depth) {
        if ($Depth -gt $request.maxDepth) { throw 'depth-limit' }
        $before = Get-EntryEvidence $LiteralPath
        if ($Depth -gt 0) {
            $script:entryCount += 1
            if ($script:entryCount -gt $request.maxEntries) { throw 'entry-limit' }
        }
        if ($before.directory -and $request.recursive) {
            foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($LiteralPath)) {
                Visit-Entry $child ($Depth + 1)
            }
        }
        $after = Get-EntryEvidence $LiteralPath
        if ($before.directory -ne $after.directory -or $before.identity -ne $after.identity) {
            throw 'identity-changed'
        }
    }

    Visit-Entry ([IO.Path]::GetFullPath($request.root)) 0
    [Console]::Out.WriteLine((@{ ok = $true; entries = $script:entryCount } | ConvertTo-Json -Compress))
} catch {
    Fail-Safely 'UNSAFE_FILESYSTEM'
}
