@echo off
setlocal

REM ---------- Activate Venv ----------
echo Activating virtual environment
call .venv\Scripts\activate

REM ---------- Start Simulator ----------
echo.
echo *** STARTING PLC SIMULATOR 1 ***
start cmd /k "call .venv\Scripts\activate && python manage.py run_test_device --port 502"

REM ---------- Collect Statics ----------
echo.
echo *** COLLECTING STATIC FILES ***
python manage.py collectstatic --noinput

REM ---------- Start Server ----------
echo.
echo *** STARTING DJANGO SERVER ***
python manage.py run_server

pause