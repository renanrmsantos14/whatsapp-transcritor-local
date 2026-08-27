$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "extension\manifest.json") -Raw | ConvertFrom-Json
if ($manifest.version -ne "0.2.0") { throw "Versão inesperada no manifesto" }
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$package = Join-Path $dist "WhatsApp-Transcritor-Local-0.2.0-TI.zip"
$staging = Join-Path ([IO.Path]::GetTempPath()) ("wt-package-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($folder in @("server", "extension", "scripts")) { New-Item -ItemType Directory -Path (Join-Path $staging $folder) | Out-Null }
    Copy-Item -Path (Join-Path $root "server\*.py"), (Join-Path $root "server\requirements.*") -Destination (Join-Path $staging "server")
    Get-ChildItem (Join-Path $root "extension") -File | Where-Object Name -ne "local-config.js" | Copy-Item -Destination (Join-Path $staging "extension")
    Copy-Item -Path (Join-Path $root "scripts\*") -Destination (Join-Path $staging "scripts")
    Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $staging
    Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $package -Force
} finally {
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
Write-Host $package
