import asyncio
from uvicorn import Config, Server
from django.core.management.base import BaseCommand
from main.services.cleanup import loop_cleanup
from main.services.scheduler import run_scheduler

class Command(BaseCommand):
    help = "Run Uvicorn with background cleanup and scheduler"

    def add_arguments(self, parser):
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--cleanup-interval", type=float, default=60)

    def handle(self, *args, **options):
        try:
            asyncio.run(self.run_async(options["port"], options["cleanup_interval"]))
        except KeyboardInterrupt:
            pass

    async def run_async(self, port: int, cleanup_interval: float):
        config = Config("modbus_tiles.asgi:application", host="0.0.0.0", port=port, lifespan="off")
        server = Server(config)

        cleanup_task = asyncio.create_task(loop_cleanup(interval=cleanup_interval))
        scheduler_task = asyncio.create_task(run_scheduler())

        await server.serve()

        cleanup_task.cancel()
        scheduler_task.cancel()