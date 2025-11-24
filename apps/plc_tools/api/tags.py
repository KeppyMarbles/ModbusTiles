import json
from datetime import timedelta
from django.http import JsonResponse
from ..models import TagHistoryEntry, Tag, DashboardWidget, TagWriteRequest, ActivatedAlarm
from django.views.decorators.http import require_GET, require_POST
from django.shortcuts import get_object_or_404
from django.utils import timezone
#def api_tag_latest(request, tag_id):
#    entry = TagHistoryEntry.objects.filter(tag_id=tag_id).order_by('-timestamp').first()
#    return JsonResponse({"value": entry.value if entry else None})

@require_GET
def api_tag_value(request, external_id):
    """ Returns value, time, and alarm data about the tag stored in the database """

    tag = get_object_or_404(Tag, external_id=external_id)

    return JsonResponse(tag.get_client_data())


@require_GET
def api_tag_history(request, external_id):
    tag = get_object_or_404(Tag, external_id=external_id)
    
    #TODO perms check?

    seconds = int(request.GET.get('seconds', 60))
    cutoff = timezone.now() - timedelta(seconds=seconds)

    entries = TagHistoryEntry.objects.filter(
        tag=tag, 
        timestamp__gte=cutoff
    ).values('timestamp', 'value').order_by('timestamp')

    return JsonResponse({
        "history": list(entries)
    })


@require_POST
def api_batch_tag_values(request): #TODO move some logic to models?
    """ Returns data for multiple tags """

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    tag_ids = data.get("tag_ids", [])
    
    if not tag_ids:
        return JsonResponse({"error": "No tags specified"}, status=400)

    tags = Tag.objects.filter(external_id__in=tag_ids)

    if not tags.exists():
        return JsonResponse({"error"}, "Requested tags not found", status=404)
    
    active_alarms = ActivatedAlarm.objects.filter(
        config__tag__in=tags, 
        is_active=True
    ).select_related('config', 'config__tag')

    alarm_map = {
        alarm.config.tag.external_id: alarm 
        for alarm in active_alarms
    }

    results = {}
    for tag in tags:
        tag_data = {
            "value": tag.current_value,
            "time": tag.last_updated,
            "alarm": None
        }

        # Attach alarm if present
        if tag.external_id in alarm_map:
            alarm = alarm_map[tag.external_id]
            tag_data["alarm"] = {
                "message": alarm.config.message,
                "level": alarm.config.threat_level
            }

        results[str(tag.external_id)] = tag_data

    return JsonResponse(results)


@require_POST
#@login_required
def api_write_tag(request, external_id):
    """ Adds a write request into the database for a specific tag and value """

    tag = get_object_or_404(Tag, external_id=external_id)

    #TODO perms check?

    data = json.loads(request.body)
    value = data.get("value")

    if value is None:
        return JsonResponse({"error": "No value supplied"}, status=400)
    else:
        #TODO we should probably limit these in the DB
        TagWriteRequest.objects.create(
            tag=tag,
            value=data["value"],
        )
        return JsonResponse({"status": "queued"})