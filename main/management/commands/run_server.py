import asyncio
from uvicorn import Config, Server
from django.core.management.base import BaseCommand
from main.services.poll_devices import poll_devices
from main.services.cleanup import loop_cleanup
from main.services.scheduler import run_scheduler

class Command(BaseCommand):
    help = "Run Uvicorn with background Modbus poller"

    def add_arguments(self, parser):
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--poll-interval", type=float, default=0.25)
        parser.add_argument("--cleanup-interval", type=float, default=60)

    def handle(self, *args, **options):
        try:
            asyncio.run(self.run_async(options["port"], options["poll_interval"], options["cleanup_interval"]))
        except KeyboardInterrupt:
            pass

    async def run_async(self, port: int, poll_interval: float, cleanup_interval: float):
        config = Config("modbus_tiles.asgi:application", host="0.0.0.0", port=port, lifespan="off")
        server = Server(config)

        poll_task = asyncio.create_task(poll_devices(poll_interval=poll_interval))
        cleanup_task = asyncio.create_task(loop_cleanup(interval=cleanup_interval))
        scheduler_task = asyncio.create_task(run_scheduler())

        await server.serve()

        poll_task.cancel()
        cleanup_task.cancel()
        scheduler_task.cancel()