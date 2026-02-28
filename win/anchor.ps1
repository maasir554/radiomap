param(
    [int]$Index,
    [string]$Id,
    [switch]$BuildOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Show-Usage {
    @"
Usage:
  .\anchor.ps1                 # interactive mode (choose BLUEPOINT-01..04)
  .\anchor.ps1 -Index 3        # starts BLUEPOINT-03
  .\anchor.ps1 -Id BLUEPOINT-01
  .\anchor.ps1 -BuildOnly
"@
}

function Resolve-AnchorIdFromIndex([int]$AnchorIndex) {
    if ($AnchorIndex -lt 1 -or $AnchorIndex -gt 99) {
        throw "Index must be between 1 and 99."
    }
    return ("BLUEPOINT-{0:D2}" -f $AnchorIndex)
}

function Validate-AnchorId([string]$AnchorId) {
    return $AnchorId -match '^BLUEPOINT-[0-9]{2}$'
}

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "dotnet SDK is not installed. Install .NET 8 SDK and retry."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir "AnchorAdvertiser\AnchorAdvertiser.csproj"

if (-not (Test-Path $projectPath)) {
    throw "Project file not found: $projectPath"
}

$anchorId = ""

if ($PSBoundParameters.ContainsKey("Id")) {
    $anchorId = $Id.Trim().ToUpperInvariant()
}
elseif ($PSBoundParameters.ContainsKey("Index")) {
    $anchorId = Resolve-AnchorIdFromIndex -AnchorIndex $Index
}
elseif (-not $BuildOnly) {
    Write-Host "Select Anchor ID:"
    Write-Host "  1) BLUEPOINT-01"
    Write-Host "  2) BLUEPOINT-02"
    Write-Host "  3) BLUEPOINT-03"
    Write-Host "  4) BLUEPOINT-04"
    $chosen = Read-Host "Enter index (1-4)"
    try {
        $chosenInt = [int]$chosen
    }
    catch {
        throw "Invalid index: $chosen"
    }
    $anchorId = Resolve-AnchorIdFromIndex -AnchorIndex $chosenInt
}

if ($BuildOnly) {
    Write-Host "Building Windows BLE advertiser..."
    dotnet build $projectPath -c Release | Out-Host
    exit $LASTEXITCODE
}

if (-not (Validate-AnchorId -AnchorId $anchorId)) {
    Show-Usage | Out-Host
    throw "Invalid anchor ID: $anchorId"
}

Write-Host "Starting advertiser for $anchorId ..."
dotnet run --project $projectPath -c Release -- --id $anchorId | Out-Host
exit $LASTEXITCODE
