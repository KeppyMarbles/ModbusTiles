import time
import asyncio
import logging
from django.utils import timezone
from channels.db import database_sync_to_async
from ..models import TagHistoryEntry, Tag, TagWriteRequest, ActivatedAlarm


logger = logging.getLogger(__name__)


async def loop_cleanup(interval=60):
    @database_sync_to_async
    def _prune_history_entries():
        prune_history_entries()

    logger.info("Starting DB cleanup loop...")

    while True:
        start_time = time.monotonic()

        await _prune_history_entries()

        elapsed = time.monotonic() - start_time
        sleep_time = max(0, interval - elapsed)

        await asyncio.sleep(sleep_time)


def prune_history_entries():
    now = timezone.now()

    tags = Tag.objects.exclude(history_retention__isnull=True)
    del_count = 0

    for tag in tags.only("id", "history_retention"):
        if tag.history_retention.total_seconds() <= 0:
            continue

        cutoff = now - tag.history_retention

        entries = TagHistoryEntry.objects.filter(
            tag_id=tag.id,
            timestamp__lt=cutoff
        )
        count, _ = entries.delete()
        del_count += count

    logger.info(f"Deleted {del_count} history entries")


def delete_processed_writes(older_than=None):
    qs = TagWriteRequest.objects.filter(processed=True)

    if older_than:
        qs = qs.filter(timestamp__lt=older_than)

    count, _ = qs.delete()
    logger.info(f"Deleted {count} processed writes")


def delete_activated_alarms(older_than=None):
    qs = ActivatedAlarm.objects.filter(is_active=False)

    if older_than:
        qs = qs.filter(timestamp__lt=older_than)

    count, _ = qs.delete()
    logger.info(f"Deleted {count} activated alarms")