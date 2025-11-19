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
        INT32 = 3, _("Signed Int32")
        UINT32 = 4, _("Unsigned Int32")
        INT64 = 5, _("Signed Int64")
        UINT64 = 6, _("Unsigned Int64")
        FLOAT32 = 7, _("Float32")
        FLOAT64 = 8, _("Float64")
        STRING = 9, _("String")

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

    read_amount = models.PositiveIntegerField(default=1)

    max_history_entries = models.PositiveIntegerField(
        null=True, blank=True, 
        help_text="Keep at most N recent entries; null = unlimited",
        default=0
    )
    #max_write_entries = models.PositiveIntegerField(
    #    null=True, blank=True,
    #    default=0
    #)

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


class TagWriteRequest(models.Model):
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)
    value = models.JSONField()
    timestamp = models.DateTimeField(auto_now_add=True)
    processed = models.BooleanField(default=False)


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
        SWITCH = "switch", _("Switch")
        METER = "meter", _("Meter")
        SLIDER = "slider", _("Slider")
        #("gauge", "Gauge"),
        #("slider", "Slider"),

    dashboard = models.ForeignKey(Dashboard, on_delete=models.CASCADE, related_name="widgets")

    widget_type = models.TextField(choices=WidgetTypeChoices.choices)

    tag = models.ForeignKey(Tag, null=True, blank=True, on_delete=models.SET_NULL, related_name="widgets")
    external_id = models.UUIDField(default=uuid.uuid4, unique=True)

    config = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.widget_type} on {self.dashboard.alias}"