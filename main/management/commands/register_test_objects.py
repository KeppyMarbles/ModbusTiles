from django.core.management.base import BaseCommand, CommandError
from ...models import Device, Tag, Dashboard, DashboardWidget, AlarmConfig, AlarmSubscription
from django.contrib.auth import get_user_model

User = get_user_model()

class Command(BaseCommand):
    def handle(self, *args, **options):
        device, created = Device.objects.get_or_create(
            alias="TestPLC"
        )
        if not created:
            print("Test objects already set up; reset the DB first")
            return

        user = User.objects.create(
            username="testuser",
            email="test@example.com",
            is_staff=True,
        )
        user.set_password("test1234")
        user.save()

        dashboard = Dashboard.objects.create(
            owner=user,
            alias="TestDashboard",
        )

        # ---------- Test Coils ----------

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = {
                "position_x": 0,
                "position_y": 0,
                "scale_x" : 2,
                "scale_y" : 1,
                "text" : "Test Coils",
            }
        )

        tag = Tag.objects.create(
            device=device,
            alias="Test Coil",
            description="PLC coil 0",
            channel=Tag.ChannelChoices.COIL,
            data_type=Tag.DataTypeChoices.BOOL,
            address=0,
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag,
            widget_type=DashboardWidget.WidgetTypeChoices.LED,
            config = {
                "position_x": 0,
                "position_y": 1,
                "scale_x" : 1,
                "scale_y" : 1,
                "color_on": "green",
                "color_off": "red",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag,
            widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
            config = {
                "position_x": 0,
                "position_y": 2,
                "scale_x" : 1,
                "scale_y" : 1,
                "text_on": "On",
                "text_off": "Off",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag,
            widget_type=DashboardWidget.WidgetTypeChoices.SWITCH,
            config = {
                "position_x": 0,
                "position_y": 3,
                "scale_x" : 1,
                "scale_y" : 1,
            }
        )

        tag2 = Tag.objects.create(
            device=device,
            alias="Test Coil 2",
            description="PLC coil 1",
            channel=Tag.ChannelChoices.COIL,
            data_type=Tag.DataTypeChoices.BOOL,
            address=1,
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag2,
            widget_type=DashboardWidget.WidgetTypeChoices.LED,
            config = {
                "position_x": 1,
                "position_y": 1,
                "scale_x" : 1,
                "scale_y" : 1,
                "color_on": "green",
                "color_off": "red",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag2,
            widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
            config = {
                "position_x": 1,
                "position_y": 2,
                "scale_x" : 1,
                "scale_y" : 1,
                "text_on": "On",
                "text_off": "Off",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag2,
            widget_type=DashboardWidget.WidgetTypeChoices.SWITCH,
            config = {
                "position_x": 1,
                "position_y": 3,
                "scale_x" : 1,
                "scale_y" : 1,
            }
        )