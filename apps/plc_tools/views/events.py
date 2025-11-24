import json
import redis.asyncio as redis
from django.http import StreamingHttpResponse
from django.views.decorators.http import require_GET


@require_GET
async def tag_updates(request):
    tags_param = request.GET.get("tags", "")
    subscribed_tags = set(tags_param.split(","))

    r = redis.Redis()
    pubsub = r.pubsub()
    await pubsub.subscribe("plc_events")

    async def event_stream():
        async for message in pubsub.listen():

            if message["type"] != "message":
                continue

            data = json.loads(message["data"])
            # data format: {"tag_id": ..., "value": ...}

            # Only send updates for subscribed tags
            filtered = {tag_id: tag_data for tag_id, tag_data in data.items() if tag_id in subscribed_tags}
            if filtered:
                yield f"data: {json.dumps(filtered)}\n\n"

    return StreamingHttpResponse(event_stream(), content_type="text/event-stream")