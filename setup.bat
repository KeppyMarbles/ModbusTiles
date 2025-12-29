REM ---------- Activate Venv ----------
echo Activating virtual environment...
python -m venv .venv
call .venv\Scripts\activate

REM ---------- Install Dependencies ----------
echo.
echo Installing dependencies...
pip install -r requirements.txt

REM ---------- Init DB ----------
echo.
echo Running migrate...
python manage.py migrate

REM ---------- Collect Statics ----------
echo.
echo Collecting static files...
python manage.py collectstatic --noinput

REM ---------- Create User ----------
echo.
echo Create a superuser?
python manage.py createsuperuser

REM ---------- Done ----------
echo.
echo Setup Complete

pause