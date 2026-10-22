@echo off
rem Demo mode: separate database (%APPDATA%\gym-dz-demo) filled with fake data. The real database is not touched.
rem Reset the demo: delete the folder %APPDATA%\gym-dz-demo
cd /d "%~dp0"
set GYM_DEMO=1
npx electron .
