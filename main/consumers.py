import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class DashboardConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        """ Start accepting user subscriptions and poller updates """

        self.group_name = "poller_broadcast"
        self.subscribed_tags = set()

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """ Handle widget subscriptions """

        data = json.loads(text_data)
        
        if data.get("type") == "subscribe":
            new_tags = set(data.get("tags", []))
            self.subscribed_tags.update(new_tags)

    async def tag_update(self, event):
        """ Handle update message from poller """

        all_updates = event["updates"]
        
        # Send updates for this user's subscription
        relevant_updates = [u for u in all_updates if u["id"] in self.subscribed_tags]

        if relevant_updates:
            await self.send(text_data=json.dumps({
                "type": "tag_update",
                "data": relevant_updates
            }))


class PollerConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        """ Authorize based on SECRET_KEY and accept the connection """
        query_string = self.scope.get("query_string", b"").decode()
        params = {}
        for item in query_string.split("&"):
            if "=" in item:
                k, v = item.split("=", 1)
                params[k] = v

        token = params.get("token")
        from django.conf import settings
        if token != settings.SECRET_KEY:
            logger.warning("Rejected unauthorized poller WebSocket connection attempt.")
            await self.close(code=4003)  # Forbidden
            return

        await self.accept()

    async def receive(self, text_data):
        """ Forward data updates from the poller to the dashboard group """
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        if data.get("type") == "tag_update":
            updates = data.get("updates", [])
            await self.channel_layer.group_send(
                "poller_broadcast",
                {
                    "type": "tag_update",
                    "updates": updates
                }
            )