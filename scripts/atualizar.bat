@echo off
setlocal
cd /d "%~dp0.."

echo Atualizando projeto...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Falha ao atualizar. Verifique sua conexao, credenciais ou alteracoes locais.
  exit /b 1
)

echo.
echo Projeto atualizado.
echo 1. Em chrome://extensions, clique em Recarregar na extensao.
echo 2. Na aba do WhatsApp Web, pressione Ctrl+Shift+R.
exit /b 0
