import asyncio
import logging
import websockets
from django.conf import settings
from django.core.management.base import BaseCommand
from main.services.poll_devices import poll_devices

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Run standalone Modbus poller process connected to server via WebSocket"

    def add_arguments(self, parser):
        parser.add_argument("--host", type=str, default="localhost", help="Main web server host")
        parser.add_argument("--port", type=int, default=8000, help="Main web server port")
        parser.add_argument("--poll-interval", type=float, default=0.25, help="PLC polling interval in seconds")
        parser.add_argument("--refresh-interval", type=float, default=5, help="Device refresh interval in seconds")

    def handle(self, *args, **options):
        try:
            asyncio.run(self.run_poller_client(options["host"], options["port"], options["poll_interval"], options["refresh_interval"]))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nPoller stopped."))

    async def run_poller_client(self, host: str, port: int, poll_interval: float, refresh_interval: float):
        token = settings.SECRET_KEY
        url = f"ws://{host}:{port}/ws/poller/?token={token}"
        
        self.stdout.write(self.style.SUCCESS(f"Connecting to server WebSocket at {url}..."))
        
        while True:
            try:
                async with websockets.connect(url) as ws:
                    self.stdout.write(self.style.SUCCESS("Connected to server successfully! Starting polling..."))
                    await poll_devices(ws, poll_interval=poll_interval, refresh_interval=refresh_interval)

            except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                self.stdout.write(self.style.WARNING(f"WebSocket disconnected or connection refused ({e}). Retrying in 5 seconds..."))
                await asyncio.sleep(5)

            except Exception as e:
                logger.exception(f"Unexpected error in poller: {e}")
                self.stdout.write(self.style.ERROR(f"Poller encountered unexpected error: {e}. Restarting client in 5 seconds..."))
                await asyncio.sleep(5)
