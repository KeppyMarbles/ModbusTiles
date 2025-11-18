import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils.translation import gettext_lazy as _

User = get_user_model()

class Device(models.Model):
    class ProtocolChoices(models.IntegerChoices):
        MODBUS_TCP = 0, _("Modbus TCP")
        MODBUS_UDP = 1, _("Modbus UDP")
        MODBUS_RTU = 2, _("Modbus Serial")

    class WordOrderChoices(models.TextChoices):
        BIG = "big", _("Big Endian")
        LITTLE = "little", _("Little Endian")

    alias = models.SlugField(max_length=100, unique=True) #TODO regular string field?
    ip_address = models.GenericIPAddressField(default="127.0.0.1")
    port = models.PositiveIntegerField(default=502)
    protocol = models.PositiveIntegerField(choices=ProtocolChoices.choices, default=ProtocolChoices.MODBUS_TCP)
    word_order = models.TextField(choices=WordOrderChoices.choices, default=WordOrderChoices.BIG)
    #poll_rate = models.FloatField(default=0.5)

    is_active = models.BooleanField(default=True)

    #created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.alias} ({self.ip_address}:{self.port})"


class Tag(models.Model):
    class ChannelChoices(models.IntegerChoices):
        COIL = 0, _("Coil")
        DISCRETE_INPUT = 1, _("Discrete Input")
        HOLDING_REGISTER = 2, _("Holding Register")
        INPUT_REGISTER = 3, _("Input Register")

    class DataTypeChoices(models.IntegerChoices):
        BOOL = 0, _("Boolean")
        INT16 = 1, _("Signed Int16")
        UINT16 = 2, _("Unsigned Int16")
        FLOAT32 = 3, _("Float32")
        INT32 = 4, _("Signed Int32")
        STRING = 5, _("String")
        #TODO multi-coil value?
        #TODO more stuff from pymodbus.constants

    #TODO alarm states
    #Could be a min or max value, value over/under a threshold for too long, too much change, etc
    #Could have different message options, or threat levels, like warning or critical failure
    #User can subscribe to notifications

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="tags")
    unit_id = models.PositiveIntegerField(default=1)

    alias = models.CharField(max_length=100)
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)
    description = models.TextField(max_length=200, blank=True)

    channel = models.PositiveIntegerField(choices=ChannelChoices.choices)
    data_type = models.PositiveIntegerField(choices=DataTypeChoices.choices)

    address = models.PositiveIntegerField(default=0)

    register_count = models.PositiveIntegerField(default=1) #TODO need a better name. Doesn't quite suit coil reading. Could maybe do the "length" abstraction

    max_history_entries = models.PositiveIntegerField(
        null=True, blank=True, 
        help_text="Keep at most N recent entries; null = unlimited",
        default=0
    )

    current_value = models.JSONField(null=True)
    is_active = models.BooleanField(default=True)

    #created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("device", "channel", "address", "unit_id")

    def __str__(self):
        return f"{self.alias} [{self.channel}:{self.address}]"


class TagHistoryEntry(models.Model):
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


class Dashboard(models.Model):
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
    class WidgetTypeChoices(models.TextChoices):
        LED = "led", _("LED Indicator")
        BOOL_LABEL = "bool_label", _("Boolean Label")
        VALUE = "val", _("Numeric Value")
        LINE_CHART = "chart", _("Time-Series Chart")
        BUTTON = "button", _("Button")
        LABEL = "label", _("Text Label")
        #("gauge", "Gauge"),
        #("slider", "Slider"),

    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="widgets")

    widget_type = models.TextField(choices=WidgetTypeChoices.choices)

    tag = models.ForeignKey(Tag, null=True, blank=True, on_delete=models.SET_NULL, related_name="widgets")
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)

    config = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.widget_type} on {self.dashboard.alias}"