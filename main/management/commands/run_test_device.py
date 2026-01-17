import random
import math
import time
from ...models import Device, Tag, Dashboard, DashboardWidget, AlarmConfig
from datetime import timedelta
from .base_simulator import BaseModbusSimulator
from django.contrib.auth import get_user_model
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

class Command(BaseModbusSimulator):
    help = 'Animates read-only tags found in the database with random noise'

    def tick(self):
        # Fetch active input tags from DB
        tags = Tag.objects.filter(
            is_active=True, 
            channel__in=[Tag.ChannelChoices.INPUT_REGISTER, Tag.ChannelChoices.DISCRETE_INPUT]
        )

        for tag in tags:
            val = self._noise(tag)
            self.write_tag(tag, val)

    def _noise(self, tag):
        if tag.data_type == Tag.DataTypeChoices.BOOL:
            return random.choice([True, False])
        
        elif tag.data_type in [Tag.DataTypeChoices.FLOAT32, Tag.DataTypeChoices.FLOAT64]:
            # Simple sine wave based on address to desynchronize them
            base = math.sin(time.time() + tag.address) * 10
            return base + random.uniform(-1, 1)
        
        elif tag.data_type == Tag.DataTypeChoices.STRING:
            return "" #TODO
            
        return random.randint(0, 10)
    
    def setup_simulation(self):
        
        # ---------- Basics ----------

        device, created = Device.objects.get_or_create(
            alias="TestPLC",
            port=self.port,
        )
        if not created:
            logger.info("Test objects already set up, probably")
            return

        user = User.objects.filter(username="testuser").first()
        if user is None:
            user = User.objects.create_superuser(
                username="testuser",
                email="test@example.com",
                password="test1234",
            )

        dashboard = Dashboard.objects.create(
            owner=user,
            alias="TestDashboard",
        )

        # ---------- Tags ----------

        coil_tags = []
        di_tags = []
        hr_tags = []
        ir_tags = []
        bitfield_hr_tags = []

        for i in range(0, 16, 2):
            coil_tags.append(Tag(
                device=device,
                alias=f"coil {i}",
                channel=Tag.ChannelChoices.COIL,
                data_type=Tag.DataTypeChoices.BOOL,
                address=i,
                description="A test coil tag",
            ))

        for i in range(0, 8):
            di_tags.append(Tag(
                device=device,
                alias=f"di {i}",
                channel=Tag.ChannelChoices.DISCRETE_INPUT,
                data_type=Tag.DataTypeChoices.BOOL,
                address=i,
                description="A test discrete input tag",
            ))

        for i in range(0, 8, 2):
            hr_tags.append(Tag(
                device=device,
                alias=f"hr float {i}",
                channel=Tag.ChannelChoices.HOLDING_REGISTER,
                data_type=Tag.DataTypeChoices.FLOAT32,
                address=i,
                description="A test holding register tag",
            ))

        for i in range(0, 4):
            ir_tags.append(Tag(
                device=device,
                alias=f"ir int {i}",
                channel=Tag.ChannelChoices.INPUT_REGISTER,
                data_type=Tag.DataTypeChoices.UINT16,
                address=i,
                description="A test input register tag",
            ))

        for i in range(0, 5):
            bitfield_hr_tags.append(Tag(
                device=device,
                alias=f"hr100 bit {i}",
                channel=Tag.ChannelChoices.HOLDING_REGISTER,
                data_type=Tag.DataTypeChoices.BOOL,
                address=100,
                bit_index=i,
                description="A test bitfield tag",
            ))

        chart_tag = Tag(
            device=device,
            alias=f"chart tag",
            channel=Tag.ChannelChoices.INPUT_REGISTER,
            data_type=Tag.DataTypeChoices.FLOAT32,
            history_retention=timedelta(seconds=60),
            history_interval=timedelta(seconds=3),
            address=32,
            description="A float tag for testing the chart",
        )

        Tag.objects.bulk_create(coil_tags + di_tags + hr_tags + ir_tags + bitfield_hr_tags + [chart_tag])

        # ---------- Test Coils ----------

        widgets = []

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = {
                "position_x": 0, "position_y": 0, "scale_x" : 2, "scale_y" : 1,
                "text" : "Test Coils",
            }
        ))

        for i in range(len(coil_tags)):
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=coil_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.LED,
                config = {
                    "position_x": i, "position_y": 1, "scale_x" : 1, "scale_y" : 1,
                    "color_on": "green", "color_off": "red",
                }
            ))
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=coil_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
                config = { 
                    "position_x": i, "position_y": 2, "scale_x" : 1, "scale_y" : 1, 
                    "text_on": "On", "text_off": "Off", "showTagName" : False,
                }
            ))
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=coil_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.SWITCH,
                config = { 
                    "position_x": i, "position_y": 3, "scale_x" : 1, "scale_y" : 1,
                    "showTagName" : False,
                }
            ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=coil_tags[0],
            widget_type=DashboardWidget.WidgetTypeChoices.BUTTON,
            config = { 
                "position_x": 0, "position_y": 4, "scale_x" : 2, "scale_y" : 1, 
                "submit_value" : True, "confirmation" : True, "button_text" : "Test Button",
            }
        ))

        # ---------- Test Discrete Inputs ----------

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = { 
                "position_x": 0, "position_y": 5, "scale_x" : 2, "scale_y" : 1,
                "text" : "Test Discrete Inputs",
            }
        ))

        for i in range(len(di_tags)):
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=di_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.LED,
                config = { 
                    "position_x": i, "position_y": 6, "scale_x" : 1, "scale_y" : 1,
                    "color_on": "green", "color_off": "red",
                }
            ))
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=di_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.BOOL_LABEL,
                config = { 
                    "position_x": i, "position_y": 7, "scale_x" : 1, "scale_y" : 1, 
                    "text_on": "On", "text_off": "Off", "showTagName" : False,
                }
            ))

        # ---------- Test Input Registers ----------

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = { 
                "position_x": 9, "position_y": 0, "scale_x" : 3, "scale_y" : 1,
                "text" : "Test Input Registers",
            }
        ))

        for i in range(len(ir_tags)):
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=ir_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.METER,
                config = { 
                    "position_x": 9, "position_y": i+1, "scale_x" : 5, "scale_y" : 1, 
                    "low_value" : 3, "high_value" : 7, "optimum_value" : 10,
                }
            ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=chart_tag,
            widget_type=DashboardWidget.WidgetTypeChoices.LINE_CHART,
            config = { 
                "position_x": 9, "position_y": 5, "scale_x" : 5, "scale_y" : 3,
            }
        ))
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=chart_tag,
            widget_type=DashboardWidget.WidgetTypeChoices.GAUGE,
            config = { 
                "position_x": 9, "position_y": 8, "scale_x" : 5, "scale_y" : 3, 
                "min_value" : 0, "max_value" : 10, "warning_threshold" : 7.5, "critical_threshold" : 9,
                "title" : "A gauge", 
            }
        ))
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=chart_tag,
            widget_type=DashboardWidget.WidgetTypeChoices.NUMBER_LABEL,
            config = { 
                "position_x": 9, "position_y": 11, "scale_x" : 2, "scale_y" : 1, 
                "precision" : 2, "prefix" : "Value: ",
            }
        ))

        # ---------- Test Holding Registers ----------

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type=DashboardWidget.WidgetTypeChoices.LABEL,
            config = { 
                "position_x": 15, "position_y": 0, "scale_x" : 3, "scale_y" : 1,
                "text" : "Test Holding Registers",
            }
        ))

        for i in range(len(hr_tags)):
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=hr_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.METER,
                config = { 
                    "position_x": 15, "position_y": 2*i+1, "scale_x" : 5, "scale_y" : 1, 
                    "low_value" : 3, "high_value" : 7, "optimum_value" : 10, "show_value" : True,
                }
            ))
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=hr_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.SLIDER,
                config = { 
                    "position_x": 15, "position_y": 2*i+2, "scale_x" : 5, "scale_y" : 1,
                    "showTagName" : False,
                }
            ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=hr_tags[-1],
            widget_type=DashboardWidget.WidgetTypeChoices.DROPDOWN,
            config = { 
                "position_x": 15, "position_y": 9, "scale_x" : 2, "scale_y" : 1,
                "dropdown_choices" : [
                    {"label" : "First Value", "value": 0 },
                    {"label" : "Second Value", "value": 1 },
                    {"label" : "Third Value", "value": 2 },
                ]
            }
        ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=hr_tags[-1],
            widget_type=DashboardWidget.WidgetTypeChoices.MULTI_LABEL,
            config = { 
                "position_x": 17, "position_y": 9, "scale_x" : 2, "scale_y" : 1,
                "label_values" : [
                    {"label" : "First Value", "value": 0 },
                    {"label" : "Second Value", "value": 1 },
                    {"label" : "Third Value", "value": 2 },
                ]
            }
        ))
        
        for i in range(len(bitfield_hr_tags)):
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=bitfield_hr_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.LED,
                config = { 
                    "position_x": 15+i, "position_y": 10, "scale_x" : 1, "scale_y" : 1,
                    "color_on": "green",
                    "color_off": "red",
                }
            ))
            widgets.append(DashboardWidget(
                dashboard=dashboard,
                tag=bitfield_hr_tags[i],
                widget_type=DashboardWidget.WidgetTypeChoices.SWITCH,
                config = { 
                    "position_x": 15+i, "position_y": 11, "scale_x" : 1, "scale_y" : 1,
                    "showTagName" : False,
                }
            ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=hr_tags[-1],
            widget_type=DashboardWidget.WidgetTypeChoices.NUMBER_INPUT,
            config = { 
                "position_x": 15, "position_y": 12, "scale_x" : 3, "scale_y" : 1,
            }
        ))

        DashboardWidget.objects.bulk_create(widgets)

        # ---------- Alarms ----------

        alarms = []

        alarms.append(AlarmConfig(
            tag=coil_tags[-3],
            trigger_value=True,
            owner=user,
            alias="test alarm 1",
            message="testing alarm 1",
            threat_level = AlarmConfig.ThreatLevelChoices.LOW,
        ))
        alarms.append(AlarmConfig(
            tag=coil_tags[-2],
            trigger_value=True,
            owner=user,
            alias="test alarm 2",
            message="testing alarm 2",
            threat_level = AlarmConfig.ThreatLevelChoices.HIGH,
        ))
        alarms.append(AlarmConfig(
            tag=coil_tags[-1],
            trigger_value=True,
            owner=user,
            alias="test alarm 3",
            message="testing alarm 3",
            threat_level = AlarmConfig.ThreatLevelChoices.CRITICAL,
        ))

        AlarmConfig.objects.bulk_create(alarms)