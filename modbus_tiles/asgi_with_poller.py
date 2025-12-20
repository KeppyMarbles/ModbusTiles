import asyncio

from main.services.poll_devices import poll_devices
from main.services.cleanup import loop_cleanup
from channels.routing import get_default_application

application = get_default_application()

async def app(scope, receive, send):
    return await application(scope, receive, send)

asyncio.create_task(poll_devices())
asyncio.create_task(loop_cleanup())