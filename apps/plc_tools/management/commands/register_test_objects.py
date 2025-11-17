from django.core.management.base import BaseCommand, CommandError
from ...models import Device, Tag, Dashboard, DashboardWidget
from django.contrib.auth import get_user_model

User = get_user_model()

class Command(BaseCommand):
    def handle(self, *args, **options):
        device, created = Device.objects.get_or_create(
            alias="TestPLC"
        )

        tag, created = Tag.objects.get_or_create(
            device=device,
            alias="Test Coil",
            register_count=1,
            defaults={
                "channel": Tag.ChannelChoices.COIL,
                "data_type": Tag.DataTypeChoices.BOOL,
                "address": 0,
            },
        )
        tag2, created = Tag.objects.get_or_create(
            device=device,
            alias="Test Coil 2",
            register_count=1,
            defaults={
                "channel": Tag.ChannelChoices.COIL,
                "data_type": Tag.DataTypeChoices.BOOL,
                "address": 1,
            },
        )

        user, created = User.objects.get_or_create(
            username="testuser",
            defaults={
                "email": "test@example.com",
                "is_staff": True,
            }
        )
        if created:
            user.set_password("test1234")
            user.save()

        dashboard, created = Dashboard.objects.get_or_create(
            owner=user,
            alias="TestDashboard",
        )

        widget, created = DashboardWidget.objects.get_or_create(
            dashboard=dashboard,
            tag=tag,
            defaults={
                "widget_type": DashboardWidget.WidgetTypeChoices.LED,
                "config": {
                    "position_x": 100,
                    "position_y": 100,
                    "scale_x" : 3,
                    "scale_y" : 3,
                    "color_on": "green",
                    "color_off": "red",
                    "label": "Test Coil"
                }
            }
        )
        widget, created = DashboardWidget.objects.get_or_create(
            dashboard=dashboard,
            tag=tag2,
            defaults={
                "widget_type": DashboardWidget.WidgetTypeChoices.LED,
                "tag": tag2,
                "config": {
                    "position_x": 200,
                    "position_y": 100,
                    "scale_x" : 3,
                    "scale_y" : 3,
                    "color_on": "green",
                    "color_off": "red",
                    "label": "Test Coil"
                }
            }
        )
        