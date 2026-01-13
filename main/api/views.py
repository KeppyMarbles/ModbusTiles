import json
from datetime import timedelta
from rest_framework.viewsets import ModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.decorators import action
from rest_framework.serializers import Serializer
from .serializers import TagSerializer, TagValueSerializer, TagWriteRequestSerializer, TagHistoryEntrySerializer
from .serializers import AlarmConfigSerializer, ActivatedAlarmSerializer
from .serializers import DashboardSerializer, DashboardWidgetSerializer, DashboardWidgetBulkSerializer
from .serializers import DeviceSerializer
from ..models import DashboardWidget, Dashboard, Tag, Device, AlarmConfig, ActivatedAlarm, TagWriteRequest, TagHistoryEntry
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.db import transaction
from rest_framework.request import HttpRequest

#TODO should the metadata views all be one class?
#TODO better docstrings
#TODO figure out permissions for everything

class ReadOnlyViewSet(ModelViewSet):
    """ Restrict write perms to staff """

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]


class DeviceViewSet(ReadOnlyViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer


class DeviceMetadataView(APIView):
    """ Returns the available choices for protocols and word orders """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "protocols": [{"value": k, "label": v} for k, v in Device.ProtocolChoices.choices],
            "word_orders": [{"value": k, "label": v} for k, v in Device.WordOrderChoices.choices],
        })


class TagViewSet(ReadOnlyViewSet):
    serializer_class = TagSerializer
    lookup_field = 'external_id'

    def get_queryset(self):
        qs = Tag.objects.all()

        device_alias = self.request.query_params.get("device")
        if device_alias:
            qs = qs.filter(device__alias=device_alias)

        return qs
    

class TagMetadataView(APIView):
    """ Returns the available choices for Channels and Data Types """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "channels": [{"value": k, "label": v} for k, v in Tag.ChannelChoices.choices],
            "data_types": [{"value": k, "label": v} for k, v in Tag.DataTypeChoices.choices],
        })
    

class TagWriteRequestViewSet(ModelViewSet):
    queryset = TagWriteRequest.objects.all()
    serializer_class = TagWriteRequestSerializer

    def perform_create(self, serializer: Serializer):
        tag: Tag = serializer.validated_data['tag']
        user = self.request.user

        if tag.restricted_write and not user.is_staff:
            raise PermissionDenied("This tag is set to read-only.")

        serializer.save()

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]


class DashboardViewSet(ModelViewSet):
    lookup_field = 'alias' 
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Only see owned dashboards
        return Dashboard.objects.filter(owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='save-data')
    def save_data(self, request: HttpRequest, alias=None):
        dashboard: Dashboard = self.get_object()

        # Get meta
        meta_serializer = DashboardSerializer(dashboard, data=request.data, partial=True, context={'request': request})
        meta_serializer.is_valid(raise_exception=True)
        dashboard = meta_serializer.save()

        # Get preview image
        if 'preview_image' in request.FILES:
            dashboard.preview_image = request.FILES['preview_image']
            dashboard.save(update_fields=['preview_image'])

        # Get widget data
        raw_widgets = request.data.get('widgets')
        
        if not raw_widgets:
            return Response({"status": "saved", "widgets_count": 0})
        
        try:
            widgets_data = json.loads(raw_widgets)
        except json.JSONDecodeError:
            raise ValidationError("Invalid JSON format in 'widgets' field")

        serializer = DashboardWidgetBulkSerializer(data=widgets_data, many=True)
        serializer.is_valid(raise_exception=True)
        
        # Save widgets
        try:
            with transaction.atomic():
                # Wipe clean and add new objects
                dashboard.widgets.all().delete()
                DashboardWidget.objects.bulk_create([ 
                    DashboardWidget(dashboard=dashboard, tag=item.get('tag'), widget_type=item['widget_type'], config=item['config'])
                    for item in serializer.validated_data
                ])
                
        except Exception as e:
            raise ValidationError(f"Save failed: {str(e)}")

        return Response({ "status": "saved" })
    
    def _get_new_alias(self):
        base = "untitled"
        suffix = 0
        while True:
            candidate = f"{base}{suffix}"
            if not Dashboard.objects.filter(owner=self.request.user, alias=candidate).exists():
                return candidate
            suffix += 1
    
    def perform_create(self, serializer):
        alias = serializer.validated_data.get('alias')
        if not alias:
            alias = self._get_new_alias()

        serializer.save(owner=self.request.user, alias=alias)


class DashboardWidgetViewSet(ModelViewSet):
    serializer_class = DashboardWidgetSerializer
    permission_classes = [IsAuthenticated]

    dashboard_max_count = 99

    def get_queryset(self):
        # Only see owned widgets
        qs = DashboardWidget.objects.filter(dashboard__owner=self.request.user)
        
        dashboard_alias = self.request.query_params.get('dashboard')
        if dashboard_alias:
            qs = qs.filter(dashboard__alias=dashboard_alias)
            
        return qs

    def perform_create(self, serializer):
        dashboard = serializer.validated_data["dashboard"]

        if dashboard.owner != self.request.user:
            raise PermissionDenied("Not your dashboard")

        if DashboardWidget.objects.filter(dashboard=dashboard).count() >= self.dashboard_max_count:
            raise ValidationError("Max widgets reached for dashboard")
        
        serializer.save()


class AlarmConfigViewSet(ReadOnlyViewSet):
    serializer_class = AlarmConfigSerializer
    lookup_field = 'external_id'

    def get_queryset(self):
        qs = AlarmConfig.objects.all()

        # Get alarms for a specified tag
        tag_id = self.request.query_params.get("tag")
        if tag_id:
            qs = qs.filter(tag__external_id=tag_id)

        return qs


class ActivatedAlarmViewSet(ModelViewSet):
    queryset = ActivatedAlarm.objects.all()
    serializer_class = ActivatedAlarmSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return super().get_queryset().select_related('config', 'config__tag', 'acknowledged_by')

    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        alarm: ActivatedAlarm = self.get_object()
        
        if alarm.acknowledged:
            return Response({"status": "Already acknowledged"}, status=200)

        alarm.acknowledged = True
        alarm.acknowledged_at = timezone.now()
        alarm.acknowledged_by = request.user
        alarm.save()
        
        return Response(self.get_serializer(alarm).data)

    @action(detail=False, methods=['get'])
    def active_count(self, request):
        """ Returns count of active, unacknowledged alarms for the badge """

        count = ActivatedAlarm.objects.filter(is_active=True, acknowledged=False).count()
        return Response({"count": count})


class AlarmMetadataView(APIView):
    """ Returns the available choices alarm threat levels """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "threat_levels": [{"value": k, "label": v} for k, v in AlarmConfig.ThreatLevelChoices.choices],
            "operator_choices": [{"value": k, "label": v} for k, v in AlarmConfig.OperatorChoices.choices],
        })
    
    
class TagMultiValueView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ids = request.query_params.get("tags", "").split(",")
        tags = list(Tag.objects.filter(external_id__in=ids))

        serialized = TagValueSerializer(
            tags, many=True, context={"alarm_map": ActivatedAlarm.get_tag_map(tags)}
        )

        return Response(serialized.data)
    

class TagHistoryView(ListAPIView):
    serializer_class = TagHistoryEntrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = TagHistoryEntry.objects.order_by("timestamp")

        tags = self.request.query_params.get("tags")
        if tags:
            qs = qs.filter(tag__external_id__in=tags.split(","))

        seconds = self.request.query_params.get("seconds")
        if seconds is not None:
            cutoff = timezone.now() - timedelta(seconds=int(seconds))
            qs = qs.filter(timestamp__gte=cutoff)

        return qs