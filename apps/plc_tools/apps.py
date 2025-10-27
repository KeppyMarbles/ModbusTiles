from django.apps import AppConfig
import sys, os

class PlcToolsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.plc_tools'

    def ready(self):
        if os.environ.get('RUN_MAIN') == 'true':
            from .services.plc_manager import plc_manager
            try:
                print("Attempting to start PLC polling")
                plc_manager.start_polling(1)
            except Exception as e:
                print(f"PLC polling failed to start: {e}")