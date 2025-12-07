from django.apps import AppConfig

class ModbusTilesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'main'

    def ready(self):
        pass