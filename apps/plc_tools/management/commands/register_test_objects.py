from django.core.management.base import BaseCommand, CommandError
from ...models import Device, Tag, Dashboard, DashboardWidget
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
                "position_x": 100,
                "position_y": 20,
                "scale_x" : 2,
                "scale_y" : 2,
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
                "position_x": 100,
                "position_y": 100,
                "scale_x" : 3,
                "scale_y" : 3,
                "color_on": "green",
                "color_off": "red",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag,
            widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
            config = {
                "position_x": 100,
                "position_y": 150,
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
                "position_x": 100,
                "position_y": 200,
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
                "position_x": 200,
                "position_y": 100,
                "scale_x" : 3,
                "scale_y" : 3,
                "color_on": "green",
                "color_off": "red",
            }
        )
        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag2,
            widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
            config = {
                "position_x": 200,
                "position_y": 150,
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
                "position_x": 200,
                "position_y": 200,
                "scale_x" : 1,
                "scale_y" : 1,
            }
        )

        # ---------- Test Discrete Inputs ----------

        #tag = Tag.objects.create(
        #    device=device,
        #    alias="Test Discrete Input 1",
        #    description="PLC discrete input 0",
        #    channel=Tag.ChannelChoices.DISCRETE_INPUT,
        #    data_type=Tag.DataTypeChoices.BOOL,
        #    address=0,
        #)
#
        #tag2 = Tag.objects.create(
        #    device=device,
        #    alias="Test Discrete Input 2",
        #    description="PLC discrete input 1",
        #    channel=Tag.ChannelChoices.DISCRETE_INPUT,
        #    data_type=Tag.DataTypeChoices.BOOL,
        #    address=1,
        #)

        # ---------- Test Holding Registers ----------

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = {
                "position_x": 100,
                "position_y": 400,
                "scale_x" : 2,
                "scale_y" : 2,
                "text" : "Test Holding Registers",
            }
        )

        tag3 = Tag.objects.create(
            device=device,
            alias="Test Register 1",
            description="PLC holding register 0",
            channel=Tag.ChannelChoices.HOLDING_REGISTER,
            data_type=Tag.DataTypeChoices.UINT16,
            address=0,
        )

        tag4 = Tag.objects.create(
            device=device,
            alias="Test Register 2",
            description="PLC holding register 1",
            channel=Tag.ChannelChoices.HOLDING_REGISTER,
            data_type=Tag.DataTypeChoices.UINT16,
            address=1,
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag3,
            widget_type=DashboardWidget.WidgetTypeChoices.METER,
            config = {
                "position_x": 200,
                "position_y": 500,
                "scale_x" : 2,
                "scale_y" : 2,
                "min_value" : 0,
                "max_value" : 100,
                "low_value" : 30,
                "high_value" : 70,
                "optimum_value" : 100,
                "display_range" : False,
            }
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag3,
            widget_type=DashboardWidget.WidgetTypeChoices.SLIDER,
            config = {
                "position_x": 200,
                "position_y": 600,
                "scale_x" : 2,
                "scale_y" : 2,
                "min_value" : 0,
                "max_value" : 100,
                "display_range" : True,
            }
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag4,
            widget_type=DashboardWidget.WidgetTypeChoices.METER,
            config = {
                "position_x": 200,
                "position_y": 700,
                "scale_x" : 2,
                "scale_y" : 2,
                "min_value" : 0,
                "max_value" : 100,
                "low_value" : 30,
                "high_value" : 70,
                "optimum_value" : 100,
                "display_range" : False,
            }
        )

        widget = DashboardWidget.objects.create(
            dashboard=dashboard,
            tag=tag4,
            widget_type=DashboardWidget.WidgetTypeChoices.SLIDER,
            config = {
                "position_x": 200,
                "position_y": 800,
                "scale_x" : 2,
                "scale_y" : 2,
                "min_value" : 0,
                "max_value" : 100,
                "display_range" : True,
            }
        )
        



        