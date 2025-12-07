import json
from datetime import timedelta
from rest_framework.viewsets import ModelViewSet
from rest_framework.generics import ListAPIView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import MethodNotAllowed
from rest_framework.decorators import action
from .serializers import TagDetailSerializer, TagDropdownSerializer, TagCreateSerializer, TagUpdateSerializer, TagValueSerializer, TagWriteRequestSerializer, TagHistoryEntrySerializer
from .serializers import AlarmConfigSerializer, AlarmConfigDropdownSerializer, AlarmConfigCreateSerializer, ActivatedAlarmSerializer
from .serializers import DashboardDropdownSerializer, DashboardSerializer, DashboardWidgetSerializer, DashboardWidgetBulkSerializer
from .serializers import DeviceSerializer, DeviceDropdownSerializer
from ..models import DashboardWidget, Dashboard, Tag, Device, AlarmConfig, TagWriteRequest, TagHistoryEntry
from rest_framework.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from django.db import transaction

#TODO should the metadata views all be one class?

class DeviceViewSet(ModelViewSet):
    queryset = Device.objects.all()
    max_count = 99
    serializers = {
        "list": DeviceDropdownSerializer,
    }

    def get_serializer_class(self):
        return self.serializers.get(self.action) or DeviceSerializer

    def perform_create(self, serializer):
        if Device.objects.all().count() > self.max_count:
            raise ValidationError("Max devices reached") #TODO better error class/status code?
        
        serializer.save()


class DeviceMetadataView(APIView):
    """ Returns the available choices for protocols and word orders """
    #permission_classes = [IsAuthenticated]

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
    #permission_classes = [IsAuthenticated]

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
    #permission_classes = [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PUT/PATCH not allowed on TagWriteRequest")

    def partial_update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PATCH not allowed on TagWriteRequest")

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed("DELETE not allowed on TagWriteRequest")


class DashboardViewSet(ModelViewSet):
    lookup_field = 'alias' 
    serializer_class = DashboardSerializer

    def get_queryset(self):
        # Only see owned dashboards
        return Dashboard.objects.filter(owner=self.request.user)

    @action(detail=True, methods=['post'], url_path='save-widgets')
    def save_widgets(self, request, alias=None):
        """
        POST /api/dashboards/{alias}/save-widgets/
        Content-Type: multipart/form-data
        Form Fields:
            - widgets: JSON String '[{"tag":...}, ...]'
            - preview_image: File (optional)
        """
        dashboard = self.get_object()

        # 1. Handle Preview Image Upload
        if 'preview_image' in request.FILES:
            dashboard.preview_image = request.FILES['preview_image']
            # We save the dashboard immediately to persist the image file
            dashboard.save()

        # 2. Extract Widgets Data
        # When using FormData, the 'widgets' payload is a string we must parse.
        raw_widgets = request.data.get('widgets')
        
        # If no widgets were sent, we might just be updating the image, 
        # but usually we expect widgets. 
        if not raw_widgets:
            return Response({"status": "saved", "widgets_count": 0})
        
        try:
            widgets_data = json.loads(raw_widgets)
        except json.JSONDecodeError:
            raise ValidationError("Invalid JSON format in 'widgets' field")

        # 3. Validate Widgets
        serializer = DashboardWidgetBulkSerializer(data=widgets_data, many=True)
        serializer.is_valid(raise_exception=True)
        
        # 4. Save Widgets (Atomic Transaction)
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
    #permission_classes = [IsAuthenticated]

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
    def get(self, request):
        ids = request.query_params.get("tags", "").split(",")
        tags = list(Tag.objects.filter(external_id__in=ids))

        alarm_map = Tag.get_alarm_map(tags)

        serialized = TagValueSerializer(
            tags, many=True, context={"alarm_map": alarm_map}
        )

        return Response(serialized.data)
    

class TagHistoryView(ListAPIView):
    serializer_class = TagHistoryEntrySerializer
    
    def get_queryset(self):
        qs = TagHistoryEntry.objects.all().order_by('timestamp')
        
        # Filter by Tags
        tag_param = self.request.query_params.get('tags')
        if tag_param:
            ids = tag_param.split(',')
            qs = qs.filter(tag__external_id__in=ids)
            
        # Filter by Time
        seconds = int(self.request.query_params.get('seconds', 60))
        cutoff = timezone.now() - timedelta(seconds=seconds)
        qs = qs.filter(timestamp__gte=cutoff)
        
        return qs