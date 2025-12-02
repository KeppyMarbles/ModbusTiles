from rest_framework import serializers
from ..models import Device, Tag, AlarmConfig, ActivatedAlarm, AlarmSubscription, Dashboard, DashboardWidget, TagWriteRequest
from django.utils import timezone

class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = "__all__"


class DeviceDropdownSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = ["alias", "protocol"] 


class DashboardDropdownSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dashboard
        fields = ["alias", "description"]


class TagCreateSerializer(serializers.ModelSerializer):
    device = serializers.SlugRelatedField(
        slug_field='alias', 
        queryset=Device.objects.all()
    )

    class Meta:
        model = Tag
        fields = [
            "device",
            "unit_id",
            "owner",
            "alias",
            "description",
            "channel",
            "data_type",
            "address",
            "read_amount",
            "max_history_entries",
            "is_active",
        ]
        extra_kwargs = {
            "owner": {"read_only": True},
        }


class TagUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = [
            "alias",
            "description",
            "max_history_entries",
            "is_active",
        ]


class TagDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = "__all__"
        read_only_fields = [
            "external_id",
            "data_type",
            "channel",
            "address",
            "device",
            "last_updated",
            "value_changed",
            "current_value",
        ]


class TagDropdownSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = [
            "external_id",
            "alias",
            "channel",
            "data_type",
            "address",
        ]


class TagAlarmSerializer(serializers.Serializer):
    message = serializers.CharField()
    threat_level = serializers.CharField()


class TagValueSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source='external_id', read_only=True)

    value = serializers.SerializerMethodField()
    time = serializers.SerializerMethodField()
    age = serializers.SerializerMethodField()
    alarm = serializers.SerializerMethodField()

    class Meta:
        model = Tag
        fields = ["id", "value", "time", "age", "alarm"]

    def get_value(self, obj):
        return obj.current_value

    def get_time(self, obj):
        return obj.last_updated

    def get_age(self, obj):
        if(obj.last_updated is None):
            return "Infinity"
        else:
            return (timezone.now() - obj.last_updated).total_seconds() * 1000 #TODO just send the server time with the multi tag response?

    def get_alarm(self, obj): #TODO not sure if this should be the active alarm or the alarm config
        alarm_config = self.context.get("alarm_map", {}).get(obj.id)
        if not alarm_config:
            return None
        return TagAlarmSerializer(alarm_config).data
    

class TagWriteRequestSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(
        slug_field='external_id', 
        queryset=Tag.objects.all()
    )

    class Meta:
        model = TagWriteRequest
        fields = ['tag', 'value', 'timestamp', 'processed']
        read_only_fields = ['timestamp', 'processed']
    
    def validate_tag(self, tag):
        user = self.context['request'].user
        if tag.owner != user and not user.is_staff:
             raise serializers.ValidationError("You do not have permission to write to this tag.")

        if tag.channel in [Tag.ChannelChoices.DISCRETE_INPUT, Tag.ChannelChoices.INPUT_REGISTER]:
            raise serializers.ValidationError("This tag type is Read-Only.")
            
        return tag


class TagHistoryEntrySerializer(serializers.Serializer):
    timestamp = serializers.DateTimeField()
    value = serializers.JSONField()


class AlarmConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlarmConfig
        fields = "__all__"


class AlarmConfigDropdownSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlarmConfig
        fields = ["alias", "threat_level"]


class AlarmConfigCreateSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(
        slug_field='external_id', 
        queryset=Tag.objects.all()
    )
    class Meta:
        model = AlarmConfig
        fields = [
            "alias",
            "tag",
            "threat_level",
            "trigger_value",
            "message",
        ]


class AlarmConfigUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlarmConfig
        fields = [
            "tag",
            "trigger_value",
            "alias",
            "message",
            "enabled",
        ]


class AlarmSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlarmSubscription
        fields = "__all__"


class ActivatedAlarmSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivatedAlarm
        fields = "__all__"
        read_only_fields = ['config', 'timestamp', 'is_active']


class DashboardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dashboard
        fields = "__all__"


class DashboardWidgetSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(
        slug_field='external_id',
        queryset=Tag.objects.all()
    )
    class Meta:
        model = DashboardWidget
        fields = [
            "tag",
            "widget_type",
            "config",
        ]


class DashboardWidgetBulkSerializer(serializers.Serializer):
    """ Used for the Save Dashboard payload """
    
    tag = serializers.SlugRelatedField(
        slug_field='external_id',
        queryset=Tag.objects.all(),
        required=False, 
        allow_null=True
    )
    
    widget_type = serializers.ChoiceField(choices=DashboardWidget.WidgetTypeChoices.choices)
    config = serializers.JSONField()