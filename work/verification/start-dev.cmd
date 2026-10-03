@echo off
cd /d "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant"
set PATH=%PATH%;C:\Users\Danie\tesseract\env\Library\bin
set TESSDATA_PREFIX=C:\Users\Danie\tesseract\env\share\tessdata
pnpm dev > "C:\Users\Danie\OneDrive\Desktop\Serramenti Assistant\work\verification\dev-server-win.log" 2>&1

