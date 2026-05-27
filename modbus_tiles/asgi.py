"""
ASGI config for modbus_tiles project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import path
from main.consumers import DashboardConsumer, PollerConsumer

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'modbus_tiles.settings')

application = get_asgi_application()

application = ProtocolTypeRouter({
    # Django's ASGI application to handle traditional HTTP requests
    "http": application,

    # WebSocket handler
    "websocket": URLRouter([
        path("ws/dashboard/", DashboardConsumer.as_asgi()),
        path("ws/poller/", PollerConsumer.as_asgi()),
    ]),
})