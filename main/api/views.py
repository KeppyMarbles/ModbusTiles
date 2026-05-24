import json
from datetime import timedelta
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.decorators import action
from rest_framework.serializers import Serializer
from rest_framework.pagination import LimitOffsetPagination
from .serializers import TagSerializer, TagValueSerializer, TagWriteRequestSerializer, TagHistoryEntrySerializer
from .serializers import AlarmConfigSerializer, ActivatedAlarmSerializer
from .serializers import ScheduleSerializer
from .serializers import DashboardSerializer, DashboardWidgetSerializer, DashboardWidgetBulkSerializer
from .serializers import DeviceSerializer
from ..models import DashboardWidget, Dashboard, Tag, Device, AlarmConfig, ActivatedAlarm, TagWriteRequest, TagHistoryEntry, Schedule
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.db import transaction
from rest_framework.request import HttpRequest


class StaffWriteOnlyViewSet(ModelViewSet):
    """ Restrict write perms to staff """

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]


class DeviceViewSet(StaffWriteOnlyViewSet):
    queryset = Device.objects.all()
    serializer_class = DeviceSerializer
    lookup_field = 'alias'


class TagViewSet(StaffWriteOnlyViewSet):
    serializer_class = TagSerializer
    lookup_field = 'external_id'
    queryset = Tag.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()

        device_alias: str = self.request.query_params.get("device")
        if device_alias:
            qs = qs.filter(device__alias=device_alias)

        return qs
    

class TagWriteRequestViewSet(ModelViewSet):
    queryset = TagWriteRequest.objects.all()
    serializer_class = TagWriteRequestSerializer

    def get_queryset(self):
        # Only see own requests
        return super().get_queryset().filter(owner=self.request.user)

    def perform_create(self, serializer: Serializer):
        tag: Tag = serializer.validated_data['tag']
        user = self.request.user

        if tag.restricted_write and not user.is_staff:
            raise PermissionDenied("This tag is set to read-only.")

        serializer.save(user=user)

    def get_permissions(self):
        if self.action in ['update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]


class DashboardViewSet(ModelViewSet):
    lookup_field = 'alias'
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated]
    queryset = Dashboard.objects.all()

    def get_queryset(self):
        # Only see owned dashboards
        return super().get_queryset().filter(owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='save-data')
    def save_data(self, request: HttpRequest, alias=None):
        dashboard = DashboardViewSet.update_dashboard(dashboard=self.get_object(), data=request.data, request=request)
        return Response({"new_alias": dashboard.alias})

    @action(detail=True, methods=['post'], url_path='upload-preview')
    def upload_preview(self, request: HttpRequest, alias=None):
        dashboard = self.get_object()
        preview_image = request.FILES.get("preview_image")
        if preview_image:
            dashboard.preview_image = preview_image
            dashboard.save(update_fields=["preview_image"])
        return Response({"status": "preview uploaded"})
    
    @staticmethod #TODO figure out best place for this
    def update_dashboard(*, dashboard: Dashboard, data: dict, request=None) -> Dashboard:
        # Clone data dict so we can safely mutate it
        data = dict(data)

        # --- Meta ---
        meta_serializer = DashboardSerializer(dashboard, data=data, partial=True, context={"request": request})
        meta_serializer.is_valid(raise_exception=True)
        dashboard = meta_serializer.save()

        # --- Widgets ---
        widgets_data = data.get("widgets")
        if widgets_data is None:
            return dashboard

        widget_serializer = DashboardWidgetBulkSerializer(data=widgets_data, many=True)
        widget_serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            dashboard.widgets.all().delete()
            DashboardWidget.objects.bulk_create([
                DashboardWidget(dashboard=dashboard, tag=item.get("tag"), config=item["config"])
                for item in widget_serializer.validated_data
            ])

        return dashboard


class DashboardWidgetViewSet(ReadOnlyModelViewSet):
    serializer_class = DashboardWidgetSerializer
    permission_classes = [IsAuthenticated]
    queryset = DashboardWidget.objects.all()

    dashboard_max_count = 99

    def get_queryset(self):
        # Only see owned widgets
        qs = super().get_queryset().filter(dashboard__owner=self.request.user)
        
        dashboard_alias = self.request.query_params.get('dashboard')
        if dashboard_alias:
            qs = qs.filter(dashboard__alias=dashboard_alias)
            
        return qs


class ScheduleViewSet(StaffWriteOnlyViewSet):
    serializer_class = ScheduleSerializer
    lookup_field = 'external_id'
    permission_classes = [IsAuthenticated]
    queryset = Schedule.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()

        # Get schedules for a specified tag
        tag_id = self.request.query_params.get("tag") #TODO actually use this? not used in AlarmConfig either
        if tag_id:
            qs = qs.filter(tag__external_id=tag_id)

        return qs


class AlarmConfigViewSet(StaffWriteOnlyViewSet):
    serializer_class = AlarmConfigSerializer
    lookup_field = 'external_id'
    queryset = AlarmConfig.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()

        # Get alarms for a specified tag
        tag_id = self.request.query_params.get("tag")
        if tag_id:
            qs = qs.filter(tag__external_id=tag_id)

        return qs
    

class ActivatedAlarmPagination(LimitOffsetPagination):
    default_limit = 20
    max_limit = 100

    def paginate_queryset(self, queryset, request, view=None):
        limit = request.query_params.get(self.limit_query_param)
        if limit is None:
            return None
        return super().paginate_queryset(queryset, request, view)


class ActivatedAlarmViewSet(ReadOnlyModelViewSet):
    queryset = ActivatedAlarm.objects.all()
    serializer_class = ActivatedAlarmSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ActivatedAlarmPagination

    def get_queryset(self):
        qs = super().get_queryset().select_related('config', 'config__tag', 'acknowledged_by')

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            is_active_val = is_active.lower() in ['true', '1', 'yes']
            qs = qs.filter(is_active=is_active_val)

        threat_level = self.request.query_params.get('threat_level')
        if threat_level:
            qs = qs.filter(config__threat_level=threat_level)

        acknowledged = self.request.query_params.get('acknowledged')
        if acknowledged is not None:
            ack_val = acknowledged.lower() in ['true', '1', 'yes']
            qs = qs.filter(acknowledged=ack_val)

        search = self.request.query_params.get('search')
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(config__message__icontains=search) | 
                Q(config__tag__alias__icontains=search) |
                Q(config__tag__description__icontains=search)
            )

        return qs

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
    
    
class TagMultiValueView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: HttpRequest):
        ids: str = request.query_params.get("tags", "")
        tags = list(Tag.objects.filter(external_id__in=ids.split(",")))
        serialized = TagValueSerializer(tags, many=True, context={"alarm_map": ActivatedAlarm.get_tag_map(tags)})

        return Response(serialized.data)
    

class TagHistoryView(ListAPIView):
    serializer_class = TagHistoryEntrySerializer
    permission_classes = [IsAuthenticated]
    queryset = TagHistoryEntry.objects.all()

    def get_queryset(self):
        qs = super().get_queryset().order_by("timestamp")

        tags: str = self.request.query_params.get("tags")
        if tags:
            qs = qs.filter(tag__external_id__in=tags.split(","))

        seconds: str = self.request.query_params.get("seconds")
        if seconds is not None:
            cutoff = timezone.now() - timedelta(seconds=int(seconds))
            qs = qs.filter(timestamp__gte=cutoff)

        return qs