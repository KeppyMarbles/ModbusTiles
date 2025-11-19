import json
from django.http import JsonResponse
from ..models import TagHistoryEntry, Tag, DashboardWidget, TagWriteRequest
from django.views.decorators.http import require_GET, require_POST
from django.shortcuts import get_object_or_404

#def api_tag_latest(request, tag_id):
#    entry = TagHistoryEntry.objects.filter(tag_id=tag_id).order_by('-timestamp').first()
#    return JsonResponse({"value": entry.value if entry else None})

@require_GET
def api_tag_value(request, external_id):
    """ Returns the value of the tag stored in the database """

    tag = get_object_or_404(Tag, external_id=external_id)

    if not DashboardWidget.objects.filter(
        tag=tag,
        dashboard__owner=request.user
    ).exists():
        return JsonResponse({"error": "Forbidden"}, status=403)
    #TODO shared dashboard

    return JsonResponse({"value": tag.current_value})


@require_POST
#@login_required
def api_write_tag(request, external_id):
    tag = get_object_or_404(Tag, external_id=external_id)

    # permission check
    if not DashboardWidget.objects.filter(tag=tag, dashboard__owner=request.user).exists():
        return JsonResponse({"error": "Forbidden"}, status=403)

    data = json.loads(request.body)
    value = data.get("value")

    if value is None:
        return JsonResponse({"error": "No value supplied"}, status=400)
    else:
        TagWriteRequest.objects.create(
            tag=tag,
            value=data["value"],
        )
        return JsonResponse({"status": "queued"})