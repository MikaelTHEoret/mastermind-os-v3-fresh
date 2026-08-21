[CmdletBinding()]
param(
    [ValidateSet('Enable', 'Disable', 'Status')]
    [string]$Action = 'Status',

    [ValidateRange(1, 65535)]
    [int]$JavaPort = 25565,

    [ValidateSet(19132)]
    [int]$BedrockPort = 19132,

    [switch]$AllowElevation,

    [switch]$Elevated
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ruleGroup = 'Mastermind Family Server LAN'
$resultPrefix = 'MASTERMIND_LAN_RESULT:'
$ruleGenerations = @(
    [pscustomobject]@{
        Label = 'A'
        Bedrock = 'Mastermind-Family-Bedrock-UDP-A'
        Java = 'Mastermind-Family-Java-TCP-A'
    },
    [pscustomobject]@{
        Label = 'B'
        Bedrock = 'Mastermind-Family-Bedrock-UDP-B'
        Java = 'Mastermind-Family-Java-TCP-B'
    },
    [pscustomobject]@{
        Label = 'Legacy'
        Bedrock = 'Mastermind-Family-Bedrock-UDP'
        Java = 'Mastermind-Family-Java-TCP'
    }
)

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LanAddresses {
    try {
        Get-NetIPConfiguration |
            Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address } |
            ForEach-Object { $_.IPv4Address.IPAddress } |
            Where-Object { $_ -ne '127.0.0.1' -and -not $_.StartsWith('169.254.') } |
            Sort-Object -Unique
    } catch {
        Write-Output 'unavailable without additional Windows network permissions'
    }
}

function Get-DefaultLanProfile {
    $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
        Where-Object { $_.State -eq 'Alive' } |
        Sort-Object @{ Expression = { $_.RouteMetric + $_.InterfaceMetric } } |
        Select-Object -First 1
    if (-not $route) {
        throw 'Windows did not report an active IPv4 default-route adapter.'
    }
    $profile = Get-NetConnectionProfile -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop
    if (-not $profile) {
        throw 'Windows did not report a network profile for the active default-route adapter.'
    }
    return $profile
}

function Test-ExactLanRule {
    param(
        [object]$Rule,
        [string]$Protocol,
        [int]$LocalPort
    )

    if ($null -eq $Rule -or
        $Rule.Enabled.ToString() -ne 'True' -or
        $Rule.Direction.ToString() -ne 'Inbound' -or
        $Rule.Action.ToString() -ne 'Allow' -or
        $Rule.Profile.ToString() -ne 'Private') {
        return $false
    }

    $portFilters = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop)
    $addressFilters = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop)
    if ($portFilters.Count -ne 1 -or $addressFilters.Count -ne 1) {
        return $false
    }
    $localPorts = @($portFilters[0].LocalPort)
    $remoteAddresses = @($addressFilters[0].RemoteAddress)
    return $portFilters[0].Protocol.ToString() -eq $Protocol -and
        $localPorts.Count -eq 1 -and
        $localPorts[0].ToString() -eq $LocalPort.ToString([Globalization.CultureInfo]::InvariantCulture) -and
        $remoteAddresses.Count -eq 1 -and
        $remoteAddresses[0].ToString() -eq 'LocalSubnet'
}

function Test-LanGeneration {
    param([object]$Generation)

    $bedrockRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Generation.Bedrock -ErrorAction SilentlyContinue)
    $javaRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Generation.Java -ErrorAction SilentlyContinue)
    if ($bedrockRules.Count -ne 1 -or $javaRules.Count -ne 1) {
        return $false
    }
    return (Test-ExactLanRule $bedrockRules[0] 'UDP' $BedrockPort) -and
        (Test-ExactLanRule $javaRules[0] 'TCP' $JavaPort)
}

function Remove-LanGeneration {
    param([object]$Generation)

    foreach ($name in @($Generation.Bedrock, $Generation.Java)) {
        Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule -ErrorAction Stop
    }
}

function New-LanGeneration {
    param([object]$Generation)

    New-NetFirewallRule `
        -Name $Generation.Bedrock `
        -DisplayName "Mastermind Family Server - Bedrock/Geyser (UDP) [$($Generation.Label)]" `
        -Group $ruleGroup `
        -Direction Inbound `
        -Action Allow `
        -Enabled True `
        -Profile Private `
        -Protocol UDP `
        -LocalPort $BedrockPort `
        -RemoteAddress LocalSubnet | Out-Null

    New-NetFirewallRule `
        -Name $Generation.Java `
        -DisplayName "Mastermind Family Server - Java (TCP) [$($Generation.Label)]" `
        -Group $ruleGroup `
        -Direction Inbound `
        -Action Allow `
        -Enabled True `
        -Profile Private `
        -Protocol TCP `
        -LocalPort $JavaPort `
        -RemoteAddress LocalSubnet | Out-Null
}

function Show-Status {
    $rules = @(Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue)
    $addresses = @(Get-LanAddresses)
    Write-Host "Mastermind Family Server LAN rules: $($rules.Count)"
    foreach ($rule in $rules) {
        $port = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
        Write-Host "  $($rule.DisplayName): $($port.Protocol) $($port.LocalPort) [$($rule.Profile)] $($rule.Enabled)"
    }
    Write-Host "LAN address(es): $($addresses -join ', ')"
    Write-Host "Java clients: TCP $JavaPort"
    Write-Host "PS4/Bedrock via Geyser: UDP $BedrockPort"
}

if ($Action -eq 'Status') {
    try {
        Show-Status
        Write-Output "${resultPrefix}COMPLETED"
        exit 0
    } catch {
        Write-Output "${resultPrefix}ERROR"
        exit 1
    }
}

if (-not (Test-IsAdministrator)) {
    if ($Elevated -or -not $AllowElevation) {
        Write-Output "${resultPrefix}ERROR"
        exit 1
    }

    # Elevation is intentionally limited to this exact script and its validated,
    # fixed-shape arguments. No command text or caller-provided path is accepted.
    $thisScript = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    $elevationArguments = @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ('"{0}"' -f $thisScript),
        '-Action',
        $Action,
        '-JavaPort',
        $JavaPort.ToString([Globalization.CultureInfo]::InvariantCulture),
        '-BedrockPort',
        $BedrockPort.ToString([Globalization.CultureInfo]::InvariantCulture),
        '-Elevated'
    )

    try {
        $elevatedProcess = Start-Process `
            -FilePath $powerShell `
            -ArgumentList $elevationArguments `
            -Verb RunAs `
            -Wait `
            -PassThru `
            -WindowStyle Hidden `
            -ErrorAction Stop
    } catch {
        $exception = $_.Exception
        $cancelled = $false
        while ($null -ne $exception) {
            if ($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 1223) {
                $cancelled = $true
                break
            }
            $exception = $exception.InnerException
        }
        if ($cancelled) {
            Write-Output "${resultPrefix}CANCELLED"
            exit 0
        }
        Write-Output "${resultPrefix}ERROR"
        exit 1
    }

    if ($elevatedProcess.ExitCode -eq 0) {
        Write-Output "${resultPrefix}COMPLETED"
        exit 0
    }
    Write-Output "${resultPrefix}ERROR"
    exit 1
}

try {
    if ($Action -eq 'Disable') {
        Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Write-Host 'Removed the Mastermind family-server LAN firewall rules.'
        Write-Output "${resultPrefix}COMPLETED"
        exit 0
    }

    $defaultProfile = Get-DefaultLanProfile
    if ($defaultProfile.NetworkCategory -ne 'Private') {
        throw "The active default-route adapter '$($defaultProfile.Name)' is $($defaultProfile.NetworkCategory), not Private. This script will not change its network category."
    }

    # Install and validate the inactive generation before touching a currently
    # verified generation. If cleanup later fails, the verified replacement is
    # deliberately retained so an error cannot silently remove LAN connectivity.
    $verifiedGeneration = @($ruleGenerations | Where-Object { Test-LanGeneration $_ } | Select-Object -First 1)
    $targetGeneration = if ($verifiedGeneration.Count -gt 0 -and $verifiedGeneration[0].Label -eq 'A') {
        $ruleGenerations | Where-Object { $_.Label -eq 'B' } | Select-Object -First 1
    } else {
        $ruleGenerations | Where-Object { $_.Label -eq 'A' } | Select-Object -First 1
    }
    $targetReady = $false
    try {
        Remove-LanGeneration $targetGeneration
        New-LanGeneration $targetGeneration
        if (-not (Test-LanGeneration $targetGeneration)) {
            throw 'The replacement LAN firewall generation did not pass exact validation.'
        }
        $targetReady = $true

        foreach ($generation in $ruleGenerations) {
            if ($generation.Label -ne $targetGeneration.Label) {
                Remove-LanGeneration $generation
            }
        }
        if (-not (Test-LanGeneration $targetGeneration)) {
            throw 'The verified LAN firewall generation changed during cleanup.'
        }
    } catch {
        if (-not $targetReady) {
            try { Remove-LanGeneration $targetGeneration } catch { }
        }
        throw
    }

    Write-Host 'Enabled private-subnet-only firewall access for the Mastermind family server.'
    Show-Status
    Write-Host 'On PS4, open Minecraft and check Friends > LAN Games while the family server is running.'
    Write-Host 'If it is absent, check guest-Wi-Fi/AP isolation before using the documented Phantom or BedrockConnect fallback.'
    Write-Output "${resultPrefix}COMPLETED"
    exit 0
} catch {
    Write-Host 'The LAN firewall action failed. A verified rule generation was retained when available; refresh status before retrying.'
    Write-Output "${resultPrefix}ERROR"
    exit 1
}
