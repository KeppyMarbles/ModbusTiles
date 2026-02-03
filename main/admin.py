from django.contrib import admin
from .models import (
    Device,
    Tag,
    TagHistoryEntry,
    TagWriteRequest,
    AlarmConfig,
    ActivatedAlarm,
    AlarmSubscription,
    Dashboard,
    DashboardWidget,
)

# Inline

class TagInline(admin.TabularInline):
    model = Tag
    extra = 0
    fields = ("alias", "channel", "address", "data_type", "is_active")
    readonly_fields = ()
    show_change_link = True


class TagHistoryInline(admin.TabularInline):
    model = TagHistoryEntry
    extra = 0
    readonly_fields = ("timestamp", "value")
    can_delete = False
    ordering = ("-timestamp",)


class AlarmConfigInline(admin.TabularInline):
    model = AlarmConfig
    extra = 0
    fields = ("alias", "message", "operator", "trigger_value", "threat_level", "enabled")
    show_change_link = True


# Device admin

@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("alias", "ip_address", "port", "protocol", "is_active")
    list_filter = ("protocol", "is_active")
    search_fields = ("alias", "ip_address")
    inlines = [TagInline]


# Tag admin

@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = (
        "alias",
        "device",
        "channel",
        "address",
        "data_type",
        "unit_id",
        "is_active",
        "last_updated",
    )
    list_filter = ("channel", "data_type", "is_active", "device")
    search_fields = ("alias", "device__alias", "external_id")
    readonly_fields = ("external_id", "last_updated", "current_value")
    inlines = [TagHistoryInline, AlarmConfigInline]


# Tag history entry

@admin.register(TagHistoryEntry)
class TagHistoryEntryAdmin(admin.ModelAdmin):
    list_display = ("tag", "timestamp", "value")
    list_filter = ("tag",)
    readonly_fields = ("timestamp",)


# Tag write request

@admin.register(TagWriteRequest)
class TagWriteRequestAdmin(admin.ModelAdmin):
    list_display = ("tag", "value", "timestamp", "processed")
    list_filter = ("processed",)
    search_fields = ("tag__alias",)
    readonly_fields = ("timestamp", "value", "user", "tag", "processed")


# Alarm config

@admin.register(AlarmConfig)
class AlarmConfigAdmin(admin.ModelAdmin):
    list_display = (
        "alias",
        "tag",
        "operator",
        "trigger_value",
        "threat_level",
        "enabled",
        "owner",
    )
    list_filter = ("threat_level", "enabled")
    search_fields = ("alias", "message", "tag__alias")
    inlines = []


# Activated alarm

@admin.register(ActivatedAlarm)
class ActivatedAlarmAdmin(admin.ModelAdmin):
    list_display = ("config", "timestamp", "is_active")
    list_filter = ("is_active", "config__threat_level")
    search_fields = ("config__alias", "config__tag__alias")
    readonly_fields = ("config", "timestamp",)


# Alarm subscription

@admin.register(AlarmSubscription)
class AlarmSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "alarm_config", "email_enabled", "sms_enabled")
    list_filter = ("email_enabled", "sms_enabled")
    search_fields = ("user__username", "alarm_config__alias")


# Widgets

class DashboardWidgetInline(admin.TabularInline):
    model = DashboardWidget
    extra = 0
    fields = ("widget_type", "tag", "external_id")
    readonly_fields = ("external_id",)
    show_change_link = True


@admin.register(DashboardWidget)
class DashboardWidgetAdmin(admin.ModelAdmin):
    list_display = ("widget_type", "dashboard", "tag", "external_id")
    search_fields = ("dashboard__alias", "tag__alias")
    readonly_fields = ("external_id",)


# Dashboard

@admin.register(Dashboard)
class DashboardAdmin(admin.ModelAdmin):
    list_display = ("alias", "owner", "description")
    search_fields = ("alias", "owner__username")
    inlines = [DashboardWidgetInline]