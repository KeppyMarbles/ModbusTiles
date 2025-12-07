@echo off
setlocal

REM ---------- Activate Venv ----------
echo Activating virtual environment
call .venv\Scripts\activate

REM ---------- Start Simulator ----------
echo.
echo *** STARTING PLC SIMULATOR ***
start cmd /k "call .venv\Scripts\activate && python sim/start_plc.py"

REM ---------- Start Poller ----------
echo.
echo *** STARTING PLC POLLING ***
start cmd /k "call .venv\Scripts\activate && python manage.py poll_plcs"

REM ---------- Start Server ----------
echo.
echo *** STARTING DJANGO SERVER ***
python manage.py runserver 0.0.0.0:8000

pause