import json
from datetime import timedelta
from django.http import JsonResponse
from ..models import Tag, Device, AlarmConfig, DashboardWidget, Dashboard
from django.views.decorators.http import require_GET, require_POST
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from django.core.validators import validate_ipv4_address
from django.core.exceptions import ValidationError

@require_GET
def api_tag_value(request, external_id):
    """ Returns value, time, and alarm data about the tag stored in the database """

    tag = get_object_or_404(Tag, external_id=external_id)

    return JsonResponse(tag.get_client_data())


@require_GET
def api_tag_values(request): #TODO move some logic to models?
    """ Returns data for multiple tags """

    tag_ids = request.GET.get("tags", "").split(",")
    
    if not tag_ids:
        return JsonResponse({"error": "No tags specified"}, status=400)

    tags = Tag.objects.filter(external_id__in=tag_ids) #TODO get_unchanged bool?

    if not tags.exists():
        return JsonResponse({"error"}, "Requested tags not found", status=404)
    
    results = Tag.get_client_data_multiple(tags)

    return JsonResponse(results)


@require_GET
def api_tag_history(request, external_id):
    tag = get_object_or_404(Tag, external_id=external_id)
    
    seconds = int(request.GET.get('seconds', 60))
    entries = tag.get_history(timedelta(seconds=seconds))

    return JsonResponse({
        "history": list(entries)
    })


@require_POST
#@login_required
def api_write_tag(request, external_id):
    """ Adds a write request into the database for a specific tag and value """

    tag = get_object_or_404(Tag, external_id=external_id)

    data = json.loads(request.body)
    value = data.get("value")

    if value is None:
        return JsonResponse({"error": "No value supplied"}, status=400)
    else:
        tag.request_change(value)
        return JsonResponse({"status": "queued"}, status=200)
    
    
@require_GET
def api_tag_list(request):
    tags = Tag.objects.filter(is_active=True)
    device_alias = request.GET.get('device_alias')
    if device_alias:
        device = Device.objects.filter(alias=device_alias)
        tags = Tag.objects.filter(device=device).values('external_id', 'alias', 'data_type')
    return JsonResponse({"tags": list(tags)})


@require_GET
def api_device_list(request):
    devices = Device.objects.filter(is_active=True).values('alias')
    return JsonResponse({"devices": list(devices)})


@require_GET
def api_alarm_list(request):
    alarms = AlarmConfig.objects.all()
    tag_id = request.GET.get('tag')
    if tag_id:
        alarms = AlarmConfig.objects.filter(tag__external_id=tag_id).values('external_id', 'alias')
    return JsonResponse({"alarms": list(alarms)})


@require_POST
def register_widget(request):
    dashboard = get_object_or_404(Dashboard, owner=request.user, alias=data.get('alias'))

    if DashboardWidget.objects.filter(dashboard=dashboard).count() > 99: #TODO static widgets like Labels shouldn't count towards this limit; possibly inputs shouldn't either
        return JsonResponse({"error": "Max widgets reached"}, status=503)
    
    data = json.loads(request.body)
    
    widget_type = data.get('type')

    if widget_type not in DashboardWidget.WidgetTypeChoices.values:
        return JsonResponse({"error": "Invalid widget type"}, status=400)
    
    config = data.get('config')

    if all((config, widget_type)):
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            widget_type=widget_type,
            config=config,
        )
        return JsonResponse({"success": "Widget created"}, status=200) 
    else:
        return JsonResponse({"error": "Missing configuration"}, status=400)


@require_POST
def register_dashboard(request):
    if DashboardWidget.objects.filter(owner=request.user).count() > 99:
        return JsonResponse({"error": "Max dashboards reached"}, status=503)

    data = json.loads(request.body)
    alias = slugify(data.get('alias'))

    if alias:
        dashboard, created = Dashboard.objects.get_or_create(
            owner=request.user,
            alias=alias,
        )
        if(created):
            return JsonResponse({"success": "Dashboard created"}, status=200)
        else:
            return JsonResponse({"error": f"Dashboard with name {alias} already exists"}, status=400)
    else:
        return JsonResponse({"error": "Alias not provided"}, status=400)


@require_POST
def register_tag(request): #TODO is this admin only?
    if Tag.objects.filter(owner=request.user).count() > 999:
        return JsonResponse({"error": "Max tags reached"}, status=503)
    
    data = json.loads(request.body)
    device = get_object_or_404(Device, alias=data.get('device_alias'))

    channel = data.get('channel')

    if channel not in Tag.ChannelChoices.values:
        return JsonResponse({"error": "Invalid channel type"}, status=400)

    data_type = data.get('data_type')

    if data_type not in Tag.DataTypeChoices.values:
        return JsonResponse({"error": "Invalid data type"}, status=400)

    address = data.get('address')

    if all((channel, data_type, address)):
        tag, created = Tag.objects.get_or_create(
            device=device,
            channel=channel,
            address=address,
            data_type=data_type,
            defaults={
                'owner': request.user,
                'description':  data.get('description') if data.get('description') else "",
                'read_amount': data.get('read_amount') if data.get('read_amount') else 1,
                'max_history_entries': data.get('max_history_entries') if data.get('max_history_entries') else 0,
            }
        )
        if created:
            return JsonResponse({"success": "Tag created", "id": tag.external_id}, status=200)
        else:
            return JsonResponse({"error": "Tag already exists"}, status=400)
    else:
        return JsonResponse({"error": "Missing configuration"}, status=400)
    

@require_POST
def register_device(request): #TODO admin only
    if Device.objects.all().count() > 999:
        return JsonResponse({"error": "Max devices reached"}, status=503)
    
    data = json.loads(request.body)

    ip_address = data.get('ip_address')

    try:
        validate_ipv4_address(ip_address)
    except ValidationError:
        return JsonResponse({"error": "Invalid IP address"}, status=400)
    
    protocol = data.get('protocol')

    if protocol not in Device.ProtocolChoices.values:
        return JsonResponse({"error": "Invalid protocol type"}, status=400)

    port = data.get('port')
    alias = slugify(data.get('alias'))

    if all((alias, ip_address, port, protocol)):
        word_order = data.get('word_order') if data.get('word_order') else Device.WordOrderChoices.BIG
        device, created = Device.objects.get_or_create(
            alias=alias,
            defaults={
                'ip_address': ip_address,
                'port': port,
                'protocol': protocol,
                'word_order': word_order,
            }
        )
        if created:
            return JsonResponse({"success": "Device created"}, status=200)
        else:
            return JsonResponse({"error": f"Device with name {alias} already exists"}, status=400)
    else:
        return JsonResponse({"error": "Missing configuration"}, status=400)


@require_POST
def register_alarm(request):
    if AlarmConfig.objects.filter(owner=request.user).count() > 999:
        return JsonResponse({"error": "Max alarms reached"}, status=503)
    
    data = json.loads(request.body)
    tag = get_object_or_404(Tag, external_id=data.get('tag_id'))

    threat_level = data.get('threat_level')

    if threat_level not in AlarmConfig.ThreatLevelChoices.values:
        return JsonResponse({"error": "Invalid threat level type"}, status=400)

    trigger_value = data.get('trigger_value')
    alias = data.get('alias')

    if all((alias, trigger_value, threat_level)): 
        alarm, created = AlarmConfig.objects.get_or_create(
            tag=tag,
            alias=alias,
            defaults= {
                'trigger_value': trigger_value,
                'threat_level': threat_level,
                'message': data.get('message') if data.get('message') else "",
            }
        )
        if created:
            return JsonResponse({"success": "Alarm created"}, status=200)
        else:
            return JsonResponse({"error": f"Alarm with name {alias} already exists for this tag"}, status=400)
    else:
        return JsonResponse({"error": "Missing configuration"}, status=400)
