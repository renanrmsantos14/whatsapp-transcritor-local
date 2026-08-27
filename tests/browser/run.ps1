$ErrorActionPreference = "Stop"
$cli = Join-Path $env:APPDATA "npm\playwright-cli.cmd"
if (-not (Test-Path $cli)) { throw "playwright-cli não encontrado" }
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = Join-Path $root ".venv\Scripts\python.exe"
$server = Start-Process -FilePath $python -ArgumentList "-m", "http.server", "8876", "--bind", "127.0.0.1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 700
& $cli -s=wt-v02 open "http://127.0.0.1:8876/tests/browser/fixture.html" | Out-Null
try {
    $created = & $cli -s=wt-v02 eval "() => Boolean(document.querySelector('[data-wt-control]')) && document.querySelector('[data-wt-control]').shadowRoot === null" --raw
    if ($created.Trim() -ne "true") { throw "Shadow DOM fechado não foi criado" }
    & $cli -s=wt-v02 press Tab | Out-Null
    & $cli -s=wt-v02 press Tab | Out-Null
    & $cli -s=wt-v02 press Enter | Out-Null
    $completed = & $cli -s=wt-v02 run-code "async page => { await page.waitForTimeout(2500); return await page.evaluate(() => document.querySelector('[data-wt-control]').dataset.hasResult); }" --raw
    if ($completed.Trim() -notmatch "true") { throw "Fluxo de progresso não concluiu" }
    Write-Host "Browser fixture: captura, progresso e Shadow DOM validados."
} finally {
    & $cli -s=wt-v02 close | Out-Null
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
