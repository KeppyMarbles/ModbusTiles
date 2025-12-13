import json
from datetime import timedelta
from rest_framework.viewsets import ModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.decorators import action
from .serializers import TagDetailSerializer, TagDropdownSerializer, TagCreateSerializer, TagUpdateSerializer, TagValueSerializer, TagWriteRequestSerializer, TagHistoryEntrySerializer
from .serializers import AlarmConfigSerializer, AlarmConfigDropdownSerializer, AlarmConfigCreateSerializer, ActivatedAlarmSerializer
from .serializers import DashboardDropdownSerializer, DashboardSerializer, DashboardWidgetSerializer, DashboardWidgetBulkSerializer
from .serializers import DeviceSerializer, DeviceDropdownSerializer
from ..models import DashboardWidget, Dashboard, Tag, Device, AlarmConfig, ActivatedAlarm, TagWriteRequest, TagHistoryEntry
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.db import transaction

#TODO should the metadata views all be one class?
#TODO better docstrings

class DeviceViewSet(ModelViewSet):
    queryset = Device.objects.all()
    max_count = 99
    serializers = {
        "list": DeviceDropdownSerializer,
    }
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        return self.serializers.get(self.action) or DeviceSerializer

    def perform_create(self, serializer):
        if Device.objects.all().count() > self.max_count:
            raise ValidationError("Max devices reached") #TODO better error class/status code?
        
        serializer.save()


class DeviceMetadataView(APIView):
    """ Returns the available choices for protocols and word orders """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "protocols": [
                {"value": k, "label": v} for k, v in Device.ProtocolChoices.choices
            ],
            "word_orders": [
                {"value": k, "label": v} for k, v in Device.WordOrderChoices.choices
            ],
        })


class TagViewSet(ModelViewSet):
    max_count = 999
    serializers = {
        "list": TagDropdownSerializer,
        "retrieve": TagDetailSerializer,
        "create": TagCreateSerializer,
        "update": TagUpdateSerializer,
        "partial_update": TagUpdateSerializer,
    }
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Tag.objects.all()

        device_alias = self.request.query_params.get("device")
        if device_alias:
            qs = qs.filter(device__alias=device_alias)

        return qs
    
    def get_serializer_class(self):
        return self.serializers.get(self.action) or TagDetailSerializer

    def perform_create(self, serializer):
        if Tag.objects.filter(owner=self.request.user).count() > self.max_count:
            raise ValidationError("Max tags reached")
        
        serializer.save(owner=self.request.user)


class TagMetadataView(APIView):
    """ Returns the available choices for Channels and Data Types """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "channels": [
                {"value": k, "label": v} for k, v in Tag.ChannelChoices.choices
            ],
            "data_types": [
                {"value": k, "label": v} for k, v in Tag.DataTypeChoices.choices
            ],
        })
    

class TagWriteRequestViewSet(ModelViewSet):
    queryset = TagWriteRequest.objects.all()
    serializer_class = TagWriteRequestSerializer
    permission_classes = [IsAuthenticated]

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

    @action(detail=True, methods=['post'], url_path='save-widgets')
    def save_widgets(self, request, alias=None):
        dashboard = self.get_object()

        # Get preview image
        if 'preview_image' in request.FILES:
            dashboard.preview_image = request.FILES['preview_image']
            dashboard.save()

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
    max_count = 99
    permission_classes = [IsAuthenticated]

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

        if DashboardWidget.objects.filter(dashboard=dashboard).count() >= self.max_count:
            raise ValidationError("Max widgets reached for dashboard")
        
        serializer.save()


class AlarmConfigViewSet(ModelViewSet):
    max_count = 999
    serializers = {
        "list": AlarmConfigDropdownSerializer,
        "create": AlarmConfigCreateSerializer,
    }
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = AlarmConfig.objects.all()

        # Get alarms for a specified tag
        tag_id = self.request.query_params.get("tag")
        if tag_id:
            qs = qs.filter(tag__external_id=tag_id)

        return qs
    
    def get_serializer_class(self):
        return self.serializers.get(self.action) or AlarmConfigSerializer
    
    def perform_create(self, serializer):
        if AlarmConfig.objects.filter(owner=self.request.user).count() > 999:
            raise ValidationError("Max alarms reached")
        
        serializer.save()


class AlarmMetadataView(APIView):
    """ Returns the available choices alarm threat levels """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "threat_levels": [
                {"value": k, "label": v} for k, v in AlarmConfig.ThreatLevelChoices.choices
            ],
            "operator_choices": [
                {"value": k, "label": v} for k, v in AlarmConfig.OperatorChoices.choices
            ],
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