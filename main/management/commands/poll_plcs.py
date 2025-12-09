from django.core.management.base import BaseCommand
import asyncio
from ...services.poll_devices import poll_devices

class Command(BaseCommand):
    def handle(self, *args, **options):
        asyncio.run(poll_devices())