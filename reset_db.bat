@echo off
echo ===============================
echo   Django Reset DB + Migrations
echo ===============================

set APP_DIR=main
set MIG_DIR=%APP_DIR%\migrations
set PREVIEW_DIR=.media\dashboard_previews

REM ---------- Clear DB ----------
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
echo Deleting database files...

if exist db.sqlite3 del db.sqlite3
if exist db.sqlite3-wal del db.sqlite3-wal
if exist db.sqlite3-shm del db.sqlite3-shm

REM ---------- Clear Media ----------
echo.
echo Cleaning dashboard previews...

if exist "%PREVIEW_DIR%" (
    echo Deleting contents of %PREVIEW_DIR% ...
    del /Q "%PREVIEW_DIR%\*"
) else (
    echo No preview directory found, skipping.
)

REM ---------- Run migrations ----------

echo Activating virtual environment
call .venv\Scripts\activate

echo.
echo Running makemigrations...
python manage.py makemigrations

echo.
echo Running migrate...
python manage.py migrate

echo.
echo Registering test data...
python manage.py register_test_objects

echo.
echo Done!
pause