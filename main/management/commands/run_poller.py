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
        parser.add_argument("--websocket", type=bool, default=True, help="If the poller should connect with the webserver")

    def handle(self, *args, **options):
        try:
            asyncio.run(self.run_poller(options["host"], options["port"], options["poll_interval"], options["refresh_interval"], options["websocket"]))
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("\nPoller stopped."))

    async def run_poller(self, host: str, port: int, poll_interval: float, refresh_interval: float, websocket: bool):
        ws_queue = asyncio.Queue(maxsize=100)
        ws_queue.connected = False

        # Start device polling and WebSocket client tasks concurrently
        poller_task = asyncio.create_task(
            poll_devices(ws_queue, poll_interval=poll_interval, refresh_interval=refresh_interval)
        )
        ws_client_task = asyncio.create_task(
            self.run_websocket_client(host, port, ws_queue)
        ) if websocket else None

        try:
            # We await the poller task (the primary work task) to run indefinitely or propagate exceptions
            await poller_task
        finally:
            # Ensure the WebSocket client task is cancelled if the poller stops or exits
            if ws_client_task:
                ws_client_task.cancel()
                try:
                    await ws_client_task
                except asyncio.CancelledError:
                    pass

    async def run_websocket_client(self, host: str, port: int, ws_queue: asyncio.Queue, retry_time=5):
        token = settings.SECRET_KEY
        url = f"ws://{host}:{port}/ws/poller/?token={token}"

        while True:
            try:
                self.stdout.write(self.style.SUCCESS(f"Connecting to server WebSocket at {url}..."))
                async with websockets.connect(url) as ws:
                    self.stdout.write(self.style.SUCCESS("Connected to server successfully!"))
                    ws_queue.connected = True
                    try:
                        while True:
                            msg = await ws_queue.get()
                            try:
                                await ws.send(msg)
                            except Exception as e:
                                # Re-raise to trigger reconnect loop
                                raise
                            finally:
                                ws_queue.task_done()
                    finally:
                        ws_queue.connected = False

            except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                self.stdout.write(self.style.WARNING(f"WebSocket disconnected or connection refused ({e}). Retrying in {retry_time} seconds..."))
                await asyncio.sleep(retry_time)

            except asyncio.CancelledError:
                break

            except Exception as e:
                logger.exception(f"Unexpected error in WebSocket client: {e}")
                self.stdout.write(self.style.ERROR(f"WebSocket client encountered unexpected error: {e}. Restarting in {retry_time} seconds..."))
                await asyncio.sleep(retry_time)
