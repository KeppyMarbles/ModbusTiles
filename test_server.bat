@echo off
setlocal ENABLEDELAYEDEXPANSION

REM ---------- Simulator Selection ----------
echo Select simulator option:
echo   [1] Blank device (default)
echo   [2] Test device + test objects
echo   [3] Demo device + demo objects
echo   [4] Test + Demo devices
echo   [5] None
echo.
set /p SIM_CHOICE="Enter choice (1-5) [default: 1]: "

REM Default to 1 if no input
if "%SIM_CHOICE%"=="" set SIM_CHOICE=1

echo.

REM ---------- Activate Venv ----------
echo Activating virtual environment
call .venv\Scripts\activate

REM ---------- Start Simulators ----------
if "%SIM_CHOICE%"=="1" (
    echo *** STARTING BASIC SIMULATION ***
    start cmd /k "call .venv\Scripts\activate && python manage.py run_simulation"
) else if "%SIM_CHOICE%"=="2" (
    echo *** STARTING TEST DEVICE ***
    start cmd /k "call .venv\Scripts\activate && python manage.py run_test_device"
) else if "%SIM_CHOICE%"=="3" (
    echo *** STARTING DEMO DEVICE ***
    start cmd /k "call .venv\Scripts\activate && python manage.py run_demo_device"
) else if "%SIM_CHOICE%"=="4" (
    echo *** STARTING TEST DEVICE ***
    start cmd /k "call .venv\Scripts\activate && python manage.py run_test_device"
    timeout /t 1 >nul
    echo *** STARTING DEMO DEVICE ***
    start cmd /k "call .venv\Scripts\activate && python manage.py run_demo_device"
)

REM ---------- Collect Statics ----------
echo.
echo *** COLLECTING STATIC FILES ***
python manage.py collectstatic --noinput

REM ---------- Start Server ----------
echo.
echo *** STARTING DJANGO SERVER ***
python manage.py run_server

pause