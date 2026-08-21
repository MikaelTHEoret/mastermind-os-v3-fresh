param(
    [ValidateSet('clean', 'compile', 'test', 'build')]
    [string]$Task = 'build',
    [string]$JavaHome = $env:MASTERMIND_JAVA25_HOME
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BuildRoot = Join-Path $ProjectRoot 'build'
$MainClasses = Join-Path $BuildRoot 'classes\main'
$TestClasses = Join-Path $BuildRoot 'classes\test'
$Libs = Join-Path $BuildRoot 'libs'

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $JavaHome = $env:JAVA_HOME
    } else {
        $javacCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
        if ($null -ne $javacCommand) {
            $JavaHome = Split-Path -Parent (Split-Path -Parent $javacCommand.Source)
        }
    }
}

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    throw 'Java 25 is required. Pass -JavaHome or set MASTERMIND_JAVA25_HOME.'
}

$JavaHome = [System.IO.Path]::GetFullPath($JavaHome)
$Java = Join-Path $JavaHome 'bin\java.exe'
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Jar = Join-Path $JavaHome 'bin\jar.exe'
foreach ($Tool in @($Java, $Javac, $Jar)) {
    if (-not (Test-Path -LiteralPath $Tool -PathType Leaf)) {
        throw "Java 25 tool is missing: $Tool"
    }
}

$VersionOutput = (& $Java --version | Out-String)
if ($VersionOutput -notmatch '(?m)^(?:openjdk|java) 25(?:\.|\s)') {
    throw 'The selected Java home is not Java 25.'
}

if ($Task -eq 'clean') {
    if (Test-Path -LiteralPath $BuildRoot) {
        Remove-Item -LiteralPath $BuildRoot -Recurse -Force
    }
    return
}

if (Test-Path -LiteralPath $BuildRoot) {
    Remove-Item -LiteralPath $BuildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $MainClasses, $TestClasses, $Libs -Force | Out-Null

$MainSources = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src\main\java') -Filter '*.java' -File -Recurse | ForEach-Object FullName)
if ($MainSources.Count -eq 0) { throw 'No bootstrap Java sources were found.' }
& $Javac --release 25 -encoding UTF-8 -Xlint:all -Werror -d $MainClasses @MainSources
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap compilation failed.' }
if ($Task -eq 'compile') { return }

$TestSources = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src\test\java') -Filter '*.java' -File -Recurse | ForEach-Object FullName)
if ($TestSources.Count -eq 0) { throw 'No bootstrap Java tests were found.' }
& $Javac --release 25 -encoding UTF-8 -Xlint:all -Werror -classpath $MainClasses -d $TestClasses @TestSources
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap test compilation failed.' }
& $Java -ea -classpath "$MainClasses;$TestClasses" com.mastermind.minecraft.familyclientbootstrap.BootstrapTestSuite
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap tests failed.' }
if ($Task -eq 'test') { return }

$Artifact = Join-Path $Libs 'family-client-bootstrap-0.1.0.jar'
& $Jar --create --file $Artifact --date 2026-01-01T00:00:00Z --main-class com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap -C $MainClasses .
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap JAR creation failed.' }
Write-Output $Artifact
