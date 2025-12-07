@echo off
echo ===============================
echo   Django Reset DB + Migrations
echo ===============================

set APP_DIR=main
set MIG_DIR=%APP_DIR%\migrations
set DB_FILE=db.sqlite3

echo.
echo Cleaning migration files in %MIG_DIR% ...

if not exist "%MIG_DIR%" (
    echo ERROR: Migrations folder not found!
    exit /b
)

for %%m in ("%MIG_DIR%\*.py") do (
    if NOT "%%~nxm"=="__init__.py" (
        echo Deleting: %%m
        del "%%m"
    )
)

echo.
echo Deleting database file: %DB_FILE%
if exist %DB_FILE% del %DB_FILE%

echo Activating virtual environment
call .venv\Scripts\activate

echo.
echo Running makemigrations...
python manage.py makemigrations

echo.
echo Running migrate...
python manage.py migrate

echo.
echo Done!
pause