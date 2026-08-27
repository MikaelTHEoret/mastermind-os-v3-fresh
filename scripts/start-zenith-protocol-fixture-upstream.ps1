param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int] $SourceServerPid
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$fixtureRoot = Join-Path $env:LOCALAPPDATA 'Mastermind\staging\minecraft\zenith\protocol-fixture-upstream'
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Mastermind\staging\minecraft\zenith'))
$resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
if ((Split-Path -Parent $resolvedFixture) -ne $expectedRoot -or -not (Test-Path -LiteralPath $resolvedFixture)) {
    throw 'The isolated fixture root is unavailable.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 25567 -ErrorAction SilentlyContinue) {
    throw 'The isolated fixture port is already in use.'
}

$sourceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$SourceServerPid"
$source = $sourceProcess.CommandLine
$java = $sourceProcess.ExecutablePath
if ([string]::IsNullOrWhiteSpace($source) -or [string]::IsNullOrWhiteSpace($java)) {
    throw 'The verified launch process is unavailable.'
}
$classpathStart = $source.IndexOf(' -cp ')
$mainStart = $source.IndexOf(' net.fabricmc.loader.impl.launch.knot.KnotServer')
$gameLibrariesMatch = [regex]::Match($source, '-Dfabric\.gameLibraries=@([^ ]+)')
$gameJarMatch = [regex]::Match($source, '-Dfabric\.gameJarPath=([^ ]+)')
if ($classpathStart -lt 0 -or $mainStart -le $classpathStart -or -not $gameLibrariesMatch.Success -or -not $gameJarMatch.Success) {
    throw 'The verified launch classpath could not be parsed.'
}

$classpath = $source.Substring($classpathStart + 5, $mainStart - ($classpathStart + 5))
$gameLibraries = $gameLibrariesMatch.Groups[1].Value
$gameJar = $gameJarMatch.Groups[1].Value
foreach ($required in @($java, $gameJar, $gameLibraries, (Join-Path $resolvedFixture 'mods.list'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw 'A pinned fixture launch input is unavailable.' }
}

$mods = Join-Path $resolvedFixture 'mods'
if (-not (Test-Path -LiteralPath $mods)) { New-Item -ItemType Directory -Path $mods | Out-Null }
$arguments = @(
    '-Xms256M', '-Xmx512M',
    "-Dfabric.gameJarPath=$gameJar",
    '-Dfabric.gameVersion=26.2',
    "-Dfabric.modsFolder=$mods",
    "-Dfabric.addMods=@$(Join-Path $resolvedFixture 'mods.list')",
    "-Dfabric.gameLibraries=@$gameLibraries",
    '-cp', $classpath,
    'net.fabricmc.loader.impl.launch.knot.KnotServer', 'nogui'
)
$process = Start-Process -FilePath $java -ArgumentList $arguments -WorkingDirectory $resolvedFixture `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $resolvedFixture 'fixture-server.out.log') `
    -RedirectStandardError (Join-Path $resolvedFixture 'fixture-server.err.log') -PassThru

[pscustomobject]@{
    schemaVersion = 1
    pid = $process.Id
    root = $resolvedFixture
} | ConvertTo-Json -Compress
