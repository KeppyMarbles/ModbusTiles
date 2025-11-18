@echo off
echo ===============================
echo   Django Reset DB + Migrations
echo ===============================

set APP_DIR=apps
set DB_FILE=db.sqlite3

echo.
echo Deleting migration files...

for /f "delims=" %%f in ('dir /ad /b /s "%APP_DIR%\migrations"') do (
    echo Cleaning: %%f

    for %%m in ("%%f\*.py") do (
        if NOT "%%~nxm"=="__init__.py" (
            echo Deleting: %%m
            del "%%m"
        )
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