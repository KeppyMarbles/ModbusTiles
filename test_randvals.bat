@echo off

echo.
echo *** RESETTING DATABASE ***
if exist db.sqlite3 (
    del db.sqlite3
    echo Deleted old db.sqlite3
)

echo.
echo *** RUNNING MIGRATIONS ***
py manage.py migrate

echo.
echo *** STARTING PLC SIMULATOR ***
start cmd /k "py sim/rand_values.py"

echo.
echo *** STARTING DJANGO SERVER ***
py manage.py runserver 0.0.0.0:8000

pause