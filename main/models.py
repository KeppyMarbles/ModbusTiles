import uuid
import os
import logging
from datetime import timedelta
from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model
from typing import Self


User = get_user_model()
logger = logging.getLogger(__name__)


class Device(models.Model):
    """ Represents a single PLC that should be connected to via Modbus """

    class ProtocolChoices(models.TextChoices):
        MODBUS_TCP = "tcp", "Modbus TCP"
        MODBUS_UDP = "udp", "Modbus UDP"
        MODBUS_RTU = "rtu", "Modbus Serial"

    class WordOrderChoices(models.TextChoices):
        BIG = "big", "Big Endian"
        LITTLE = "little", "Little Endian"

    alias = models.SlugField(max_length=100, unique=True) #TODO regular string field?
    ip_address = models.GenericIPAddressField(default="127.0.0.1")
    port = models.PositiveIntegerField(default=502)
    protocol = models.TextField(choices=ProtocolChoices.choices, default=ProtocolChoices.MODBUS_TCP)
    word_order = models.TextField(choices=WordOrderChoices.choices, default=WordOrderChoices.BIG)
    #poll_rate = models.FloatField(default=0.5)

    is_active = models.BooleanField(default=True)

    #created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.alias} ({self.ip_address}:{self.port})"
    

class Tag(models.Model):
    """ Represents a portion of data that should be read from a PLC """

    class ChannelChoices(models.TextChoices):
        COIL = "coil", "Coil"
        DISCRETE_INPUT = "di", "Discrete Input"
        HOLDING_REGISTER = "hr", "Holding Register"
        INPUT_REGISTER = "ir", "Input Register"

    class DataTypeChoices(models.TextChoices):
        BOOL = "bool", "Boolean"
        INT16 = "int16", "Signed Int16"
        UINT16 = "uint16", "Unsigned Int16"
        INT32 = "int32", "Signed Int32"
        UINT32 = "uint32", "Unsigned Int32"
        INT64 = "int64", "Signed Int64"
        UINT64 = "uint64", "Unsigned Int64"
        FLOAT32 = "float32", "Float32"
        FLOAT64 = "float64", "Float64"
        STRING = "string", "String"

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="tags")
    unit_id = models.PositiveIntegerField(default=1)
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)

    alias = models.CharField(max_length=100) #TODO enforce uniqueness?
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    description = models.TextField(max_length=200, blank=True)

    channel = models.TextField(choices=ChannelChoices.choices)
    data_type = models.TextField(choices=DataTypeChoices.choices)

    address = models.PositiveIntegerField(default=0)
    bit_index = models.PositiveSmallIntegerField(default=0)

    read_amount = models.PositiveIntegerField(default=1)

    last_history_at = models.DateTimeField(null=True, blank=True)
    history_interval = models.DurationField(default=timedelta(seconds=1))
    history_retention = models.DurationField(default=timedelta(seconds=0))

    last_updated = models.DateTimeField(null=True)

    current_value = models.JSONField(null=True)
    is_active = models.BooleanField(default=True)
    
    restricted_write = models.BooleanField(default=False)

    class Meta:
        unique_together = ("device", "channel", "address", "unit_id", "bit_index")

    def get_read_count(self):
        from math import ceil

        match self.data_type:
            case Tag.DataTypeChoices.BOOL | Tag.DataTypeChoices.INT16 | Tag.DataTypeChoices.UINT16:
                return self.read_amount
            case Tag.DataTypeChoices.INT32 | Tag.DataTypeChoices.UINT32 | Tag.DataTypeChoices.FLOAT32:
                return 2 * self.read_amount
            case Tag.DataTypeChoices.INT64 | Tag.DataTypeChoices.UINT64 | Tag.DataTypeChoices.FLOAT64:
                return 4 * self.read_amount
            case Tag.DataTypeChoices.STRING:
                return ceil(self.read_amount / 2)
            case _:
                raise Exception("Could not determine read count of data type", self.data_type)

    @classmethod
    def bulk_create_history(cls: Self, tags: list[Self]):
        """ Log the values for the given tags """

        entries: list[TagHistoryEntry] = []
        now = timezone.now()

        for tag in tags:
            if tag.history_retention.total_seconds() <= 0:
                continue

            if tag.last_history_at and now - tag.last_history_at < tag.history_interval:
                continue

            entries.append(TagHistoryEntry( #TODO value change delta? (amount must be changed this much to save entry)
                tag=tag, 
                value=tag.current_value,
                timestamp=now
            ))

            tag.last_history_at = now
        
        if entries:
            TagHistoryEntry.objects.bulk_create(entries)
            cls.objects.bulk_update([entry.tag for entry in entries], ['last_history_at'])

    @property
    def is_bit_indexed(self):
        return self.data_type == Tag.DataTypeChoices.BOOL and self.channel in [
                Tag.ChannelChoices.HOLDING_REGISTER, 
                Tag.ChannelChoices.INPUT_REGISTER
            ]
    
    def __str__(self):
        bit = f":{self.bit_index}" if self.bit_index is not None else ""
        location = f"{self.channel}:{self.address}{bit}"
        return f"{self.alias} [{location}]"


class TagHistoryEntry(models.Model):
    """ A log entry for a tag, used for querying value history """

    tag = models.ForeignKey(Tag, on_delete=models.CASCADE, related_name="history")
    timestamp = models.DateTimeField(auto_now_add=True)

    value = models.JSONField(null=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["tag", "-timestamp"]),
        ]

    def __str__(self):
        return f"{self.tag.alias}: {self.value} @ {self.timestamp}"


class TagWriteRequest(models.Model):
    """ Stores data that should be written to a tag next polling cycle """

    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)
    value = models.JSONField()
    timestamp = models.DateTimeField(auto_now_add=True)
    processed = models.BooleanField(default=False)


class AlarmConfig(models.Model):
    """ Maps a specific Tag value to a human-readable alarm """

    class ThreatLevelChoices(models.TextChoices):
        LOW = "low", "Low"
        HIGH  = "high", "High"
        CRITICAL = "crit", "Critical"

    class OperatorChoices(models.TextChoices):
        EQUALS = "equals", "Equals"
        GREATER_THAN  = "greater_than", "Greater Than"
        LESS_THAN = "less_than", "Less Than"
    
    ALARM_PRIORITY = {
        ThreatLevelChoices.LOW: 1,
        ThreatLevelChoices.HIGH: 2,
        ThreatLevelChoices.CRITICAL: 3,
    }
    
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE, related_name="alarm_configs")
    trigger_value = models.JSONField(help_text="Value that triggers this alarm")
    #trigger_sustain = models.DurationField(default=timedelta(seconds=3))
    operator = models.TextField(default="equals", choices=OperatorChoices.choices)
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    enabled = models.BooleanField(default=True)
    
    # Enrichment data
    alias = models.CharField(max_length=100)
    message = models.CharField(default="", max_length=200, help_text="e.g., 'Sump Pump Failure - Check Breaker'")
    threat_level = models.CharField(choices=ThreatLevelChoices.choices) #TODO textField?
    
    # Notification rules
    notification_cooldown = models.DurationField(default=timedelta(minutes=1), help_text="Don't resend email for this long") #TODO should this be part of subscription instead?
    last_notified = models.DateTimeField(null=True, blank=True)

    @classmethod
    def update_alarms(cls, tags: list[Tag]):
        """ Activate or deactivate alarms for the given tags """

        if not tags:
            return
        
        # Active alarms for affected tags only
        active_map = ActivatedAlarm.get_tag_map(tags)

        # Alarm configs for affected tags
        configs_by_tag: dict[int, list[AlarmConfig]] = {}
        for config in cls.objects.filter(enabled=True, tag__in=tags):
            configs_by_tag.setdefault(config.tag_id, []).append(config)

        deactivate = []
        activate = []

        for tag in tags:
            configs = configs_by_tag.get(tag.id, [])
            if not configs:
                continue
            
            triggered = [
                c for c in configs
                if c.is_activation(tag.current_value)
            ]

            winning = max(
                triggered,
                key=lambda c: cls.ALARM_PRIORITY[c.threat_level],
                default=None,
            )

            current: ActivatedAlarm = active_map.get(tag.id)

            if current and (not winning or current.config_id != winning.id):
                # Deactivate current alarm for this tag
                current.is_active = False
                current.resolved_at = timezone.now()
                deactivate.append(current)
                logger.info(f"Alarm Deactivated: {current.config}")

            if winning and (not current or current.config_id != winning.id):
                # Activate the alarm
                alarm = ActivatedAlarm(config=winning, is_active=True)
                activate.append(alarm)
                logger.info(f"Alarm Activated: {winning}")

        ActivatedAlarm.objects.bulk_update(deactivate, ["is_active", "resolved_at"])
        ActivatedAlarm.objects.bulk_create(activate)

    def is_activation(self, value):
        try:
            match self.operator:
                case self.OperatorChoices.EQUALS:
                    return (value == self.trigger_value)
                case self.OperatorChoices.GREATER_THAN:
                    return (value > self.trigger_value)
                case self.OperatorChoices.LESS_THAN:
                    return (value < self.trigger_value)
                case _:
                    return False
        except TypeError:
            return False

    class Meta: #TODO shouldn't we prevent multiple alarms for the same value?
        unique_together = ("alias", "tag")

    def __str__(self):
        signs = { 
            self.OperatorChoices.EQUALS : "==", 
            self.OperatorChoices.GREATER_THAN : ">", 
            self.OperatorChoices.LESS_THAN : "<" 
        }
        return f"{self.tag.alias} {signs.get(self.operator)} {self.trigger_value} -> {self.message}"
    
    #TODO order by threat level?
    

class ActivatedAlarm(models.Model):
    """ Represents an alarm that was or is currently activated """

    config = models.ForeignKey(AlarmConfig, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)

    acknowledged = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="acknowledged_alarms")
    
    is_active = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('config', 'timestamp')
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["config", "-timestamp"]),
        ]

    @classmethod
    def get_tag_map(cls: Self, tags: list[Tag]) -> dict[int, Self]:
        return { 
            a.config.tag_id: a
            for a in cls.objects
                .filter(is_active=True, config__tag__in=tags)
                .select_related("config")
        }

    def should_notify(self):
        return (self.config.last_notified is None) or (timezone.now() - self.config.last_notified > self.config.notification_cooldown)

    def __str__(self):
        return f"ALARM: {self.config.tag.alias} - {self.config.message} (Level {self.config.threat_level})"
    
    
class AlarmSubscription(models.Model):
    """ Allows a user to be notified when a certain alarm becomes active """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="subscriptions")
    alarm_config = models.ForeignKey(AlarmConfig, on_delete=models.CASCADE)
    
    email_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)

    class Meta:
        unique_together = ('user', 'alarm_config')


class Dashboard(models.Model):
    """ A user-defined space to display widgets """

    alias = models.SlugField(max_length=100, blank=False)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    description = models.TextField(blank=True)
    preview_image = models.ImageField(upload_to='dashboard_previews/', null=True, blank=True)
    column_count = models.PositiveSmallIntegerField(default=20) #TODO use small integer field more often?
    #external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    #TODO permitted users?
    #created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("owner", "alias")

    def save(self, *args, **kwargs):
        try:
            old = Dashboard.objects.get(pk=self.pk).preview_image
        except Dashboard.DoesNotExist:
            old = None

        super().save(*args, **kwargs)

        # Old file exists, new file is different → delete old file
        if old and old != self.preview_image:
            if os.path.isfile(old.path):
                os.remove(old.path)

    def __str__(self):
        return f"Dashboard: {self.alias} ({self.owner.username})"


class DashboardWidget(models.Model):
    """ An element on a dashboard used to interact with a tag """

    class WidgetTypeChoices(models.TextChoices):
        LED = "led", "LED Indicator"
        BOOL_LABEL = "bool_label", "Boolean Label"
        MULTI_LABEL = "multi_label", "Multi-Value Label"
        NUMBER_LABEL = "number_label", "Number Label"
        NUMBER_INPUT = "number_input", "Number Input"
        LINE_CHART = "chart", "Time-Series Chart"
        BUTTON = "button", "Button"
        LABEL = "label", "Text Label"
        SWITCH = "switch", "Switch"
        METER = "meter", "Meter"
        SLIDER = "slider", "Slider"
        DROPDOWN = "dropdown", "Dropdown"
        GAUGE = "gauge", "Radial Gauge"

    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="widgets")

    widget_type = models.TextField(choices=WidgetTypeChoices.choices)

    tag = models.ForeignKey(Tag, null=True, blank=True, on_delete=models.SET_NULL, related_name="widgets")
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)

    config = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.widget_type} on {self.dashboard.alias}"