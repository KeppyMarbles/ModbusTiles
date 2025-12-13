from django.utils import timezone
from ..models import TagHistoryEntry, Tag, TagWriteRequest, ActivatedAlarm


def prune_history_entries():
    now = timezone.now()

    tags = Tag.objects.exclude(history_retention__isnull=True)

    for tag in tags.only("id", "history_retention"):
        cutoff = now - tag.history_retention

        TagHistoryEntry.objects.filter(
            tag_id=tag.id,
            timestamp__lt=cutoff
        ).delete()


def delete_processed_writes(older_than=None):
    qs = TagWriteRequest.objects.filter(processed=True)

    if older_than:
        qs = qs.filter(timestamp__lt=older_than)

    return qs.delete()


def delete_activated_alarms(older_than=None):
    qs = ActivatedAlarm.objects.filter(is_active=False)

    if older_than:
        qs = qs.filter(timestamp__lt=older_than)

    return qs.delete()