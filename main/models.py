import uuid
from datetime import timedelta
from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _

User = get_user_model()

class Device(models.Model):
    """ Represents a single PLC that should be connected to via Modbus """

    class ProtocolChoices(models.TextChoices):
        MODBUS_TCP = "tcp", _("Modbus TCP")
        MODBUS_UDP = "udp", _("Modbus UDP")
        MODBUS_RTU = "rtu", _("Modbus Serial")

    class WordOrderChoices(models.TextChoices):
        BIG = "big", _("Big Endian")
        LITTLE = "little", _("Little Endian")

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
        COIL = "coil", _("Coil")
        DISCRETE_INPUT = "di", _("Discrete Input")
        HOLDING_REGISTER = "hr", _("Holding Register")
        INPUT_REGISTER = "ir", _("Input Register")

    class DataTypeChoices(models.TextChoices):
        BOOL = "bool", _("Boolean")
        INT16 = "int16", _("Signed Int16")
        UINT16 = "uint16", _("Unsigned Int16")
        INT32 = "int32", _("Signed Int32")
        UINT32 = "uint32", _("Unsigned Int32")
        INT64 = "int64", _("Signed Int64")
        UINT64 = "uint64", _("Unsigned Int64")
        FLOAT32 = "float32", _("Float32")
        FLOAT64 = "float64", _("Float64")
        STRING = "string", _("String")

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="tags")
    unit_id = models.PositiveIntegerField(default=1)
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)

    alias = models.CharField(max_length=100) #TODO enforce uniqueness?
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    description = models.TextField(max_length=200, blank=True)

    channel = models.TextField(choices=ChannelChoices.choices)
    data_type = models.TextField(choices=DataTypeChoices.choices)

    address = models.PositiveIntegerField(default=0)

    read_amount = models.PositiveIntegerField(default=1)

    max_history_entries = models.PositiveIntegerField(
        help_text="Keep at most N recent entries; -1 = unlimited",
        default=0
    )

    last_updated = models.DateTimeField(null=True)

    current_value = models.JSONField(null=True)
    is_active = models.BooleanField(default=True)

    #created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("device", "channel", "address", "unit_id")

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
            
    def set_value(self, new_value):
            """
            Updates the value, manages 'last_updated', and handles history pruning
            """
            now = timezone.now()
            
            value_changed = (self.current_value != new_value)
            self.current_value = new_value
            self.last_updated = now
            
            self.save(update_fields=["current_value", "last_updated"])

            if self.max_history_entries == 0:
                return value_changed
            
            if value_changed: #TODO bool for saving history when not changed?
                #TODO entry interval?
                TagHistoryEntry.objects.create(tag=self, value=new_value, timestamp=now)
                self._prune_history()

    def _prune_history(self):
        """ Keep history within limits """
        if self.max_history_entries < 0:
            return

        ids_to_keep = (
            TagHistoryEntry.objects.filter(tag=self)
            .order_by('-timestamp')
            .values_list('id', flat=True)[:self.max_history_entries]
        )
        
        # Delete everything not in keep list
        TagHistoryEntry.objects.filter(tag=self).exclude(id__in=ids_to_keep).delete()

    @staticmethod
    def get_alarm_map(tags):
        alarms = (
            ActivatedAlarm.objects.filter(
                config__tag__in=tags, is_active=True
            ).select_related("config", "config__tag")
        )
        return {a.config.tag_id: a.config for a in alarms}

    def __str__(self):
        return f"{self.alias} [{self.channel}:{self.address}]"


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
            LOW = "low", _("Low")
            HIGH  = "high", _("High")
            CRITICAL = "crit", _("Critical")

    class OperatorChoices(models.TextChoices):
            EQUALS = "equals", _("Equals")
            GREATER_THAN  = "greater_than", _("Greater Than")
            LESS_THAN = "less_than", _("Less Than")

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

    def get_activation(self):
        match self.operator:
            case "equals":
                should_activate = (self.tag.current_value == self.trigger_value)
            case "greater_than":
                should_activate = (self.tag.current_value > self.trigger_value)
            case "less_than":
                should_activate = (self.tag.current_value < self.trigger_value)

        active_qs = ActivatedAlarm.objects.filter(
            config__tag=self.tag,
            is_active=True
        ).select_related("config")

        if not should_activate:
            # Deactivate
            active_qs.filter(config=self).update(is_active=False)
            return None

        # Only activate if it's higher priority than current
        threat_priority = { "low": 1, "high": 2, "crit": 3, }
        for alarm in active_qs:
            if threat_priority[alarm.config.threat_level] > threat_priority[self.threat_level]:
                return None

        # Activate, then disable other alarms for same tag
        active_alarm, _ = ActivatedAlarm.objects.get_or_create(config=self, is_active=True)
        active_qs.exclude(id=active_alarm.id).update(is_active=False)

        return active_alarm
            
    @classmethod
    def check_alarms(cls):
        for alarm_config in cls.objects.all():
            activated = alarm_config.get_activation()
            if(activated):
                activated.handle_notifications()

    class Meta: #TODO shouldn't we prevent multiple alarms for the same value?
        unique_together = ("alias", "tag")

    def __str__(self):
        signs = { "equals" : "==", "greater_than" : ">", "less_than" : "<" }
        return f"{self.tag.alias} {signs.get(self.operator)} {self.trigger_value} -> {self.message}"
    
    #TODO order by threat level?
    

class ActivatedAlarm(models.Model):
    """ Represents an alarm that was or is currently activated """
    
    config = models.ForeignKey(AlarmConfig, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)
    
    is_active = models.BooleanField(default=False)

    #TODO max history entries?

    class Meta:
        unique_together = ('config', 'timestamp')
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["config", "-timestamp"]),
        ]

    def should_notify(self):
        return (self.config.last_notified is None) or (timezone.now() - self.config.last_notified > self.config.notification_cooldown)

    def handle_notifications(self):
        if not self.should_notify():
            return
        #TODO batch multiple alarms into one email?
        subs = AlarmSubscription.objects.filter(
                    alarm_config=self.config, 
                    email_enabled=True
                ).select_related('user')
        
        recipients = [sub.user.email for sub in subs if sub.user.email] #TODO maybe return this and handle messaging elsewhere?
        print(f"Sending Email to {recipients}: {self.config.message}") #TODO logging?

        self.config.last_notified = timezone.now()
        self.config.save(update_fields=['last_notified'])

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

    alias = models.SlugField(max_length=100)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    description = models.TextField(blank=True)
    #external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    #TODO permitted users?
    #created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("owner", "alias")

    def __str__(self):
        return f"Dashboard: {self.alias} ({self.owner.username})"


class DashboardWidget(models.Model):
    """ An element on a dashboard used to interact with a tag """

    class WidgetTypeChoices(models.TextChoices):
        LED = "led", _("LED Indicator")
        BOOL_LABEL = "bool_label", _("Boolean Label")
        VALUE = "val", _("Numeric Value")
        LINE_CHART = "chart", _("Time-Series Chart")
        BUTTON = "button", _("Button")
        LABEL = "label", _("Text Label")
        SWITCH = "switch", _("Switch")
        METER = "meter", _("Meter")
        SLIDER = "slider", _("Slider")
        #("gauge", "Gauge"),

    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="widgets")

    widget_type = models.TextField(choices=WidgetTypeChoices.choices) #TODO still need this?

    tag = models.ForeignKey(Tag, null=True, blank=True, on_delete=models.SET_NULL, related_name="widgets")
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)

    config = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.widget_type} on {self.dashboard.alias}"