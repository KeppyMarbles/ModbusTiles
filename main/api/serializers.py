from datetime import timedelta
from rest_framework import serializers
from django.utils import timezone
from django.core.exceptions import ValidationError
from ..models import Device, Tag, AlarmConfig, ActivatedAlarm, AlarmSubscription, Dashboard, DashboardWidget, TagWriteRequest, Schedule


class DurationSecondsField(serializers.IntegerField):
    def to_internal_value(self, data):
        if data is None:
            return None

        seconds = super().to_internal_value(data)
        if seconds < 0:
            raise serializers.ValidationError("Duration must be >= 0 seconds")

        return timedelta(seconds=seconds)

    def to_representation(self, value: timedelta):
        if value is None:
            return None

        return int(value.total_seconds())
    

class CleanedModelSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        instance = self.instance or self.Meta.model()
        for attr, value in attrs.items():
            setattr(instance, attr, value)
        try:
            instance.clean()
        except ValidationError as e:
            raise serializers.ValidationError(e.message_dict)

        return attrs
    

class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = "__all__"


class AlarmConfigSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(slug_field='external_id', queryset=Tag.objects.all())
    notification_cooldown = DurationSecondsField(required=False, allow_null=True)

    class Meta:
        model = AlarmConfig
        exclude = ["owner", "last_notified"]


class ScheduleSerializer(CleanedModelSerializer):
    tag = serializers.SlugRelatedField(slug_field='external_id', queryset=Tag.objects.all())
    time = serializers.TimeField(format='%H:%M:%S', input_formats=['%H:%M', '%I:%M%p', '%I:%M %p', '%H:%M:%S'])

    class Meta:
        model = Schedule
        read_only_fields = ["owner"]
        exclude = ["last_run"]


class TagSerializer(CleanedModelSerializer):
    device = serializers.SlugRelatedField( slug_field='alias',  queryset=Device.objects.all())
    history_retention = DurationSecondsField(required=False, allow_null=True)
    history_interval = DurationSecondsField(required=False, allow_null=True)

    class Meta:
        model = Tag
        read_only_fields = ["external_id"]
        exclude = ["owner"]


class TagValueSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source='external_id', read_only=True)
    value = serializers.JSONField(source='current_value', read_only=True)
    time = serializers.DateTimeField(source='last_updated', read_only=True)
    age = serializers.SerializerMethodField(read_only=True)
    alarm = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Tag
        fields = ["id", "value", "time", "age", "alarm"]

    def get_age(self, obj: Tag):
        if(obj.last_updated is None):
            return "Infinity"
        else:
            return (timezone.now() - obj.last_updated).total_seconds() * 1000 #TODO just send the server time with the multi tag response?

    def get_alarm(self, obj: Tag):
        alarm: ActivatedAlarm = self.context.get("alarm_map", {}).get(obj.id)
        return str(alarm.config.external_id) if alarm else None
    

class TagWriteRequestSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField(slug_field='external_id', queryset=Tag.objects.all())

    class Meta:
        model = TagWriteRequest
        fields = ['tag', 'value', 'timestamp', 'processed']
        read_only_fields = ['timestamp', 'processed']
    
    def validate_tag(self, tag: Tag):
        if tag.channel in [Tag.ChannelChoices.DISCRETE_INPUT, Tag.ChannelChoices.INPUT_REGISTER]:
            raise serializers.ValidationError("This tag type is Read-Only.")
            
        return tag


class TagHistoryEntrySerializer(serializers.Serializer):
    timestamp = serializers.DateTimeField()
    value = serializers.JSONField()


class AlarmSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlarmSubscription
        fields = "__all__"


class ActivatedAlarmSerializer(serializers.ModelSerializer):
    acknowledged_by_username = serializers.CharField(source='acknowledged_by.username', read_only=True)
    config = serializers.UUIDField(source='config.external_id', read_only=True)

    class Meta:
        model = ActivatedAlarm
        fields = "__all__"
        read_only_fields = ['config', 'timestamp', 'resolved_at', 'is_active', 'acknowledged', 'acknowledged_at', 'acknowledged_by']


class DashboardSerializer(serializers.ModelSerializer):
    owner = serializers.HiddenField(default=serializers.CurrentUserDefault())

    class Meta:
        model = Dashboard
        exclude = ["preview_image"]
        read_only_fields = ["alias"]


class DashboardWidgetSerializer(serializers.ModelSerializer):
    tag = serializers.SlugRelatedField( slug_field='external_id', queryset=Tag.objects.all())

    class Meta:
        model = DashboardWidget
        fields = ["tag", "widget_type", "config"]


class DashboardWidgetBulkSerializer(serializers.Serializer):
    """ Used for the Save Dashboard payload """
    
    tag = serializers.SlugRelatedField(slug_field='external_id', queryset=Tag.objects.all(), required=False, allow_null=True)
    widget_type = serializers.ChoiceField(choices=DashboardWidget.WidgetTypeChoices.choices)
    config = serializers.JSONField()