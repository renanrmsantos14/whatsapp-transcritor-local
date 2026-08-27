$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
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
& $venvPython -m pip install -r (Join-Path $root "server\requirements.txt")

Add-Type -AssemblyName System.Security
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
Set-Content -LiteralPath (Join-Path $root "server\.local-token") -Value $token -Encoding ascii -NoNewline
Set-Content -LiteralPath (Join-Path $root "extension\local-config.js") -Value "globalThis.LOCAL_CONFIG = { token: '$token' };" -Encoding ascii

Push-Location $root
try { & $venvPython -m server.warmup } finally { Pop-Location }

$backend = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn server.app:app --host 127.0.0.1 --port 8765" -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
    $healthy = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $headers = @{ "X-Local-Token" = $token }
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Headers $headers -TimeoutSec 2
            if ($response.status -eq "ok") { $healthy = $true; break }
        } catch { }
    }
    if (-not $healthy) { throw "Health check falhou em http://127.0.0.1:8765/health" }
} finally {
    if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
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
