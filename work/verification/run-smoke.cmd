@echo off
cd /d "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\apps\web"
set PATH=%USERPROFILE%\.local\bin;%PATH%
set DATABASE_URL=postgresql://serramenti:serramenti_dev@127.0.0.1:5432/serramenti
set SMTP_HOST=127.0.0.1
set SMTP_PORT=1025
set SMOKE_ORIGIN=http://localhost:3000
set SERRAMENTI_DOCUMENT_WORKER_PYTHON=C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\services\document-worker\.venv\Scripts\python.exe
node --import ./tests/register.mjs tests/smoke.mjs > "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\work\verification\smoke-run.log" 2>&1
echo SMOKE_DONE >> "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\work\verification\smoke-run.log"

