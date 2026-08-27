[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Protect', 'Unprotect')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security

function Assert-ExactProperties {
    param(
        [Parameter(Mandatory = $true)] [object]$Value,
        [Parameter(Mandatory = $true)] [string[]]$Names
    )
    if ($null -eq $Value -or $Value -is [System.Array]) {
        throw 'The DPAPI request must be a JSON object.'
    }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Names.Count) {
        throw 'The DPAPI request shape is invalid.'
    }
    foreach ($name in $Names) {
        if ($actual -cnotcontains $name) {
            throw 'The DPAPI request shape is invalid.'
        }
    }
}

$inputText = [Console]::In.ReadToEnd()
if ([Text.Encoding]::UTF8.GetByteCount($inputText) -gt 262144) {
    throw 'The DPAPI request is too large.'
}
$request = $inputText | ConvertFrom-Json
Assert-ExactProperties -Value $request -Names @('schemaVersion', 'payloadBase64')
if ($request.schemaVersion -ne 1 -or $request.payloadBase64 -isnot [string] -or $request.payloadBase64.Length -gt 349528) {
    throw 'The DPAPI request is invalid.'
}

try {
    $payload = [Convert]::FromBase64String($request.payloadBase64)
} catch {
    throw 'The DPAPI request payload is invalid.'
}
if ($payload.Length -gt 262144) {
    throw 'The DPAPI request payload is too large.'
}

$entropy = [Text.Encoding]::UTF8.GetBytes('Mastermind/FamilyMinecraftAccount/v1')
$result = $null
try {
    if ($Action -ceq 'Protect') {
        $result = [System.Security.Cryptography.ProtectedData]::Protect(
            $payload,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    } else {
        $result = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $payload,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    }
    [Console]::Out.Write((@{
        schemaVersion = 1
        payloadBase64 = [Convert]::ToBase64String($result)
    } | ConvertTo-Json -Compress))
} finally {
    if ($null -ne $payload) { [Array]::Clear($payload, 0, $payload.Length) }
    if ($null -ne $entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
    if ($null -ne $result) { [Array]::Clear($result, 0, $result.Length) }
}
