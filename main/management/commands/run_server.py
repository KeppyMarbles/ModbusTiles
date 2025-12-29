from django.core.management.base import BaseCommand
import uvicorn

class Command(BaseCommand):
    help = "Run Uvicorn with background Modbus poller"

    def add_arguments(self, parser):
        parser.add_argument("--port", type=int, default=8000)

    def handle(self, *args, **options):
        port = options["port"]
        print("port:", port)

        uvicorn.run(
            "modbus_tiles.asgi_with_poller:app",
            host="0.0.0.0",
            port=port,
            reload=False,
            lifespan="off",
        )