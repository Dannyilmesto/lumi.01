@echo off
cd /d "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\apps\web"
pnpm exec playwright install chromium > "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\work\verification\playwright-install.log" 2>&1
echo PW_DONE >> "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\work\verification\playwright-install.log"

