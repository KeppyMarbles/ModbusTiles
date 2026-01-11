import json
from datetime import timedelta
from rest_framework.viewsets import ModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.decorators import action
from .serializers import TagSerializer, TagValueSerializer, TagWriteRequestSerializer, TagHistoryEntrySerializer
from .serializers import AlarmConfigSerializer, ActivatedAlarmSerializer
from .serializers import DashboardDropdownSerializer, DashboardSerializer, DashboardWidgetSerializer, DashboardWidgetBulkSerializer
from .serializers import DeviceSerializer, DeviceDropdownSerializer
from ..models import DashboardWidget, Dashboard, Tag, Device, AlarmConfig, ActivatedAlarm, TagWriteRequest, TagHistoryEntry
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.serializers import Serializer
from django.utils import timezone
from django.db import transaction
from django.db.models import Q
from django.db.models.base import Model
from django.db.models.manager import BaseManager

#TODO should the metadata views all be one class?
#TODO better docstrings
#TODO figure out permissions for everything

class UserModelViewSet(ModelViewSet):
    """Base view for user-owned objects"""

    user_max_count = None  # None = unlimited

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        if user.is_staff:
            return qs

        return qs.filter(Q(owner=user) | Q(owner__isnull=True))

    def perform_create(self, serializer):
        if self.user_max_count is not None:
            count = self.get_queryset().count()
            if count >= self.user_max_count:
                raise PermissionDenied("Max objects for user reached")

        serializer.save(owner=self.request.user)


class DeviceViewSet(UserModelViewSet):
    queryset = Device.objects.all()
    serializers = { "list": DeviceDropdownSerializer }
    permission_classes = [IsAuthenticated]

    user_max_count = 99

    def get_serializer_class(self):
        return self.serializers.get(self.action) or DeviceSerializer


class DeviceMetadataView(APIView):
    """ Returns the available choices for protocols and word orders """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "protocols": [{"value": k, "label": v} for k, v in Device.ProtocolChoices.choices],
            "word_orders": [{"value": k, "label": v} for k, v in Device.WordOrderChoices.choices],
        })


class TagViewSet(UserModelViewSet):
    lookup_field = 'external_id'
    serializer_class = TagSerializer
    queryset = Tag.objects.all()

    user_max_count = 999

    def get_queryset(self):
        qs = super().get_queryset()

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
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        tag = serializer.validated_data['tag']
        user = self.request.user

        if tag.owner != user and not user.is_staff:
            raise PermissionDenied("You do not have permission to write to this tag.") #TODO field to allow other users to write to a tag?

        serializer.save()

    def update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PUT/PATCH not allowed on TagWriteRequest")

    def partial_update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PATCH not allowed on TagWriteRequest")

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed("DELETE not allowed on TagWriteRequest")


class DashboardViewSet(ModelViewSet):
    lookup_field = 'alias' 
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Only see owned dashboards
        return Dashboard.objects.filter(owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='save-data')
    def save_data(self, request, alias=None):
        dashboard: Dashboard = self.get_object()

        # Get meta
        meta_serializer = DashboardSerializer(
            dashboard, 
            data=request.data,
            partial=True, 
            context={'request': request}
        )

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
                # Wipe clean
                dashboard.widgets.all().delete()
                
                # Prepare new objects
                new_widgets = []
                for item in serializer.validated_data:
                    new_widgets.append(DashboardWidget(
                        dashboard=dashboard,
                        tag=item.get('tag'), # Serializer converts UUID -> Tag Object
                        widget_type=item['widget_type'],
                        config=item['config']
                    ))
                
                DashboardWidget.objects.bulk_create(new_widgets)
                
        except Exception as e:
            raise ValidationError(f"Save failed: {str(e)}")

        return Response({
            "status": "saved", 
            "widgets_count": len(new_widgets),
            "preview_updated": 'preview_image' in request.FILES
        })
    
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


class AlarmConfigViewSet(UserModelViewSet):
    lookup_field = 'external_id'
    serializer_class = AlarmConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset =  AlarmConfig.objects.all()

    user_max_count = 999

    def get_queryset(self):
        qs = super().get_queryset()

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
        # Optional: Filter for performance if table gets huge
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
        """Returns count of active, unacknowledged alarms for the badge"""
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