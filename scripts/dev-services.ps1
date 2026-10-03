# Avvia i servizi locali di sviluppo usati da Lumi.01.
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/dev-services.ps1
$root = $env:USERPROFILE

# PostgreSQL portatile (127.0.0.1:5432)
if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
  & "$root\PostgreSQL\17\bin\pg_ctl.exe" -D "$root\PostgreSQL\data" -l "$root\PostgreSQL\logs\postgres.log" start
  Write-Host 'PostgreSQL avviato (127.0.0.1:5432).'
} else {
  Write-Host 'PostgreSQL gia attivo (127.0.0.1:5432).'
}

# Mailpit (SMTP 1025, interfaccia su http://localhost:8025)
if (-not (Get-NetTCPConnection -LocalPort 1025 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath "$root\Mailpit\mailpit.exe" -WorkingDirectory "$root\Mailpit" -WindowStyle Hidden
  Write-Host 'Mailpit avviato (SMTP 1025, interfaccia http://localhost:8025).'
} else {
  Write-Host 'Mailpit gia attivo (SMTP 1025).'
}

# Ollama (127.0.0.1:11434) - di solito gia in esecuzione con l'app desktop
if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" -ArgumentList 'serve' -WindowStyle Hidden
  Write-Host 'Ollama avviato (127.0.0.1:11434).'
} else {
  Write-Host 'Ollama gia attivo (127.0.0.1:11434).'
}
