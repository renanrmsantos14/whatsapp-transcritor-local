[CmdletBinding()]
param([switch]$ValidateOnly)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$required = @("server\app.py", "server\jobs.py", "server\supervisor.py", "server\requirements.lock", "extension\manifest.json", "scripts\iniciar-silencioso.vbs")
foreach ($relative in $required) { if (-not (Test-Path (Join-Path $root $relative))) { throw "Arquivo obrigatório ausente: $relative" } }
$manifest = Get-Content (Join-Path $root "extension\manifest.json") -Raw | ConvertFrom-Json
if ($manifest.version -ne "0.2.0" -or -not $manifest.key) { throw "Manifesto v0.2.0 inválido" }
if ($ValidateOnly) { Write-Host "Validação do instalador concluída: v0.2.0"; exit 0 }
$rootProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match "^pythonw?\.exe$" -and
    $_.CommandLine -match "-m\s+server\.(supervisor|launcher)" -and
    $_.CommandLine.Contains($root)
})
foreach ($rootProcess in ($rootProcesses | Sort-Object ProcessId -Descending)) { Stop-Process -Id $rootProcess.ProcessId -Force -ErrorAction SilentlyContinue }
if ($rootProcesses.Count) { Start-Sleep -Seconds 1 }
$installRoot = Join-Path $env:LOCALAPPDATA "Betinhos\WhatsAppTranscritor"
if ([IO.Path]::GetFullPath($root).TrimEnd("\") -ne [IO.Path]::GetFullPath($installRoot).TrimEnd("\")) {
    $backupRoot = Join-Path $env:LOCALAPPDATA "Betinhos\WhatsAppTranscritorBackup"
    if (Test-Path $installRoot) {
        New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
        $backup = Join-Path $backupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
        Copy-Item -LiteralPath $installRoot -Destination $backup -Recurse -Force
    }
    foreach ($folder in @("server", "extension", "scripts")) { New-Item -ItemType Directory -Force -Path (Join-Path $installRoot $folder) | Out-Null }
    Copy-Item -Path (Join-Path $root "server\*.py"), (Join-Path $root "server\requirements.*") -Destination (Join-Path $installRoot "server") -Force
    Get-ChildItem (Join-Path $root "extension") -File | Where-Object Name -ne "local-config.js" | Copy-Item -Destination (Join-Path $installRoot "extension") -Force
    Copy-Item -Path (Join-Path $root "scripts\*") -Destination (Join-Path $installRoot "scripts") -Force
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot "scripts\instalar.ps1")
    $installExitCode = $LASTEXITCODE
    $installedConfig = Join-Path $installRoot "extension\local-config.js"
    if ($installExitCode -eq 0 -and (Test-Path $installedConfig)) { Copy-Item -LiteralPath $installedConfig -Destination (Join-Path $root "extension\local-config.js") -Force }
    exit $installExitCode
}
$pythonVersion = "3.13.15"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-3.13.15-amd64.exe"
$pythonSha256 = "edec09c4853aeae9ac36efb8c9f95b6b8e2fee65eee56d9767a8b7c69c574403"
$pythonHome = Join-Path $env:LOCALAPPDATA "Programs\Python\Python313"
$pythonExe = Join-Path $pythonHome "python.exe"
$installer = Join-Path $env:TEMP "python-$pythonVersion-amd64.exe"

New-Item -ItemType Directory -Force -Path (Join-Path $root "data\models"), (Join-Path $root "logs") | Out-Null

if (-not (Test-Path $pythonExe)) {
    Write-Host "Baixando Python $pythonVersion..."
    Invoke-WebRequest -Uri $pythonUrl -OutFile $installer
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $actualHash = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($installer))) -replace "-", "").ToLowerInvariant()
    } finally { $sha.Dispose() }
    if ($actualHash -ne $pythonSha256) { throw "Hash do instalador Python inválido: $actualHash" }
    Start-Process -FilePath $installer -ArgumentList "/quiet InstallAllUsers=0 PrependPath=0 Include_launcher=1 Include_pip=1" -Wait
}
if (-not (Test-Path $pythonExe)) { throw "Python não foi instalado em $pythonHome" }

$freeKb = (Get-CimInstance -ClassName Win32_OperatingSystem).FreePhysicalMemory
$freeGb = [math]::Round(($freeKb * 1KB) / 1GB, 1)
if ($freeGb -lt 2) { Write-Warning "RAM livre abaixo de 2 GB ($freeGb GB). O modelo small será mantido." }

$venvPython = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { & $pythonExe -m venv (Join-Path $root ".venv") }
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install --require-hashes -r (Join-Path $root "server\requirements.lock")

Add-Type -AssemblyName System.Security
$tokenPath = Join-Path $root "server\.local-token"
if (Test-Path $tokenPath) { $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim() } else {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    Set-Content -LiteralPath $tokenPath -Value $token -Encoding ascii -NoNewline
}
$config = @{ token = $token; projectRoot = $root; extensionPath = (Join-Path $root "extension") } | ConvertTo-Json -Compress
$configPath = Join-Path $root "extension\local-config.js"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, "globalThis.LOCAL_CONFIG = $config;", $utf8NoBom)

Push-Location $root
try { & $venvPython -m server.warmup } finally { Pop-Location }

$listeners = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $wtOwnerProcessId = [int]$listener.OwningProcess
    if ($wtOwnerProcessId -le 0) { continue }
    try {
        $listenerProcess = Get-Process -Id $wtOwnerProcessId -ErrorAction Stop
        if ($listenerProcess.ProcessName -notmatch "^pythonw?$" ) { throw "Porta 8765 ocupada por processo inesperado: $($listenerProcess.ProcessName) (PID $wtOwnerProcessId)" }
        Stop-Process -Id $wtOwnerProcessId -Force
        Wait-Process -Id $wtOwnerProcessId -Timeout 5 -ErrorAction SilentlyContinue
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] { }
}
$portDeadline = (Get-Date).AddSeconds(10)
while ((Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $portDeadline) { Start-Sleep -Milliseconds 250 }
if (Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw "Porta 8765 permaneceu ocupada após encerrar o backend anterior" }

$backend = Start-Process -FilePath $venvPython -ArgumentList "-m server.launcher" -WorkingDirectory $root -WindowStyle Hidden -PassThru
$healthy = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $headers = @{ "X-Local-Token" = $token }
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Headers $headers -TimeoutSec 2
        if ($response.compatible -eq $true -and $response.api_version -eq 2) { $healthy = $true; break }
    } catch { }
}
if (-not $healthy) { if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }; throw "Health check falhou em http://127.0.0.1:8765/health" }

if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force; Wait-Process -Id $backend.Id -Timeout 5 -ErrorAction SilentlyContinue }
$supervisorPython = Join-Path $root ".venv\Scripts\pythonw.exe"
$supervisor = Start-Process -FilePath $supervisorPython -ArgumentList "-m server.supervisor" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
try {
    $headers = @{ "X-Local-Token" = $token }
    $persistentHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Headers $headers -TimeoutSec 3
    if ($persistentHealth.compatible -ne $true -or $persistentHealth.api_version -ne 2) { throw "Supervisor iniciou backend incompatível" }
} catch {
    if ($supervisor -and -not $supervisor.HasExited) { Stop-Process -Id $supervisor.Id -Force }
    throw
}

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "WhatsApp Transcritor Local.lnk"
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$link.TargetPath = Join-Path $root "scripts\iniciar-silencioso.vbs"
$link.WorkingDirectory = $root
$link.WindowStyle = 7
$link.Save()

Write-Host "Instalação concluída."
Write-Host "Extensão: $([IO.Path]::GetFullPath((Join-Path $root 'extension')))"
Write-Host "Diagnóstico: scripts\iniciar.bat"
