import time
import random
import threading
import struct
import logging
from datetime import timedelta
from types import SimpleNamespace
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusDeviceContext,
    ModbusServerContext
)
from .base_simulator import BaseModbusSimulator
from ...models import Device, Tag, Dashboard, DashboardWidget, AlarmConfig

logger = logging.getLogger(__name__)
User = get_user_model()

#TODO maybe the sim command itself should define the tags to create, maybe with some dynamically created attributes that have getters/setters

class Command(BaseModbusSimulator):
    help = 'Runs the HVAC Physics Simulation'
 
    def tick(self):
        """ Background thread that runs the physics model """
        
        # Constants
        CHILLED_WATER_TEMP = 50.0
        ROOM_THERMAL_MASS = 500.0
        COOLING_GAIN = 8.0
        HEAT_GAIN = 1.5
        DEADBAND = 1.0  # deg F

        fan_enable_prev = self.read_tag(self.fan_running_tag)
        room_temp = self.read_tag(self.return_temp_tag)
        setpoint = self.read_tag(self.temp_setpoint_tag)
        outdoor_temp = self.read_tag(self.outdoor_temp_tag)
        supply_temp = self.read_tag(self.supply_temp_tag)
        valve_pos = self.read_tag(self.cooling_valve_tag)

        if room_temp > setpoint + DEADBAND:
            fan_enable = True
        elif room_temp < setpoint - DEADBAND:
            fan_enable = False
        else:
            fan_enable = fan_enable_prev

        # --- CALCULATE PHYSICS ---

        outdoor_temp += random.uniform(-0.05, 0.05)
        
        # 2. Room Temp Calculation
        if fan_enable:
            # If valve is 100%, supply approaches 55F. If 0%, approaches Ambient (75F)
            valve_pos = max(0, min(valve_pos, 100))
            target_supply = outdoor_temp - ((valve_pos / 100.0) * (outdoor_temp - CHILLED_WATER_TEMP))
            supply_temp += (target_supply - supply_temp) * 0.1

            # Cooling Power vs Heat Load
            cooling = COOLING_GAIN * (room_temp - supply_temp)
            heat = HEAT_GAIN * (outdoor_temp - room_temp)
            room_temp += (heat - cooling) / ROOM_THERMAL_MASS
            
            # Fan Pressure Logic
            static_pressure = 1 + (self.filter_dirt * 0.5) #+ random.uniform(-0.05, 0.05)
            
            # Filter dirties over time
            self.filter_dirt += 0.0005
        else:
            supply_temp += (room_temp - supply_temp) * 0.2

            # Fan OFF: Room warms to ambient
            room_temp += (outdoor_temp - room_temp) * 0.002
            
            static_pressure = 0.0
            
            # Auto-clean filter if it gets ridiculous (for demo reset)
            if self.filter_dirt > 2.0:
                self.filter_dirt = 0.5
                logger.info("Someone cleaned the filter")

        self.write_tag(self.fan_running_tag, fan_enable)
        self.write_tag(self.return_temp_tag, room_temp)
        self.write_tag(self.temp_setpoint_tag, setpoint)
        self.write_tag(self.outdoor_temp_tag, outdoor_temp)
        self.write_tag(self.supply_temp_tag, supply_temp)
        self.write_tag(self.cooling_valve_tag, valve_pos)
        self.write_tag(self.duct_pressure_tag, static_pressure)

    def setup_simulation(self):

        logger.info("Creating Tags...")

        device, device_created = Device.objects.get_or_create(
            alias="Simulated_AHU",
            port=self.port,
        )
        
        self.outdoor_temp_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Outdoor_Temp",
            defaults={
                "channel": Tag.ChannelChoices.INPUT_REGISTER,
                "data_type": Tag.DataTypeChoices.FLOAT32,
                "address": 8,
                "description": "Current outdoor temperature",
            },
        )

        self.return_temp_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Return_Air_Temp",
            defaults={
                "channel": Tag.ChannelChoices.INPUT_REGISTER,
                "data_type": Tag.DataTypeChoices.FLOAT32,
                "address": 0,
                "description": "Current temperature of air returning to unit",
                "history_retention": timedelta(seconds=60),
                "history_interval": timedelta(seconds=3),
            },
        )

        self.supply_temp_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Supply_Air_Temp",
            defaults={
                "channel": Tag.ChannelChoices.INPUT_REGISTER,
                "data_type": Tag.DataTypeChoices.FLOAT32,
                "address": 2,
                "description": "Current temperature of air leaving unit",
            },
        )

        self.duct_pressure_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Duct_Static_Pressure",
            defaults={
                "channel": Tag.ChannelChoices.INPUT_REGISTER,
                "data_type": Tag.DataTypeChoices.FLOAT32,
                "address": 4,
                "description": "Air pressure in main duct (inches WC)",
            },
        )

        # --- Outputs (Actuators/Setpoints) ---

        self.occupancy_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Occupancy_Mode",
            defaults={
                "channel": Tag.ChannelChoices.COIL,
                "data_type": Tag.DataTypeChoices.BOOL,
                "address": 1,
                "description": "0=Unoccupied, 1=Occupied",
            },
        )

        self.cooling_valve_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Cooling_Valve_Cmd",
            defaults={
                "channel": Tag.ChannelChoices.HOLDING_REGISTER,
                "data_type": Tag.DataTypeChoices.UINT16,
                "address": 0,
                "description": "Chilled Water Valve Position (0-100%)",
            },
        )

        self.temp_setpoint_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Supply_Temp_Setpoint",
            defaults={
                "channel": Tag.ChannelChoices.HOLDING_REGISTER,
                "data_type": Tag.DataTypeChoices.FLOAT32,
                "address": 2,
                "description": "Target Supply Temperature",
            },
        )

        # --- System Status ---

        self.fan_running_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Fan_Running_Status",
            defaults={
                "channel": Tag.ChannelChoices.DISCRETE_INPUT,
                "data_type": Tag.DataTypeChoices.BOOL,
                "address": 0,
                "description": "Feedback from fan VFD",
            },
        )

        self.freeze_alarm_tag, _ = Tag.objects.update_or_create(
            device=device,
            alias="Freeze_Stat_Alarm",
            defaults={
                "channel": Tag.ChannelChoices.DISCRETE_INPUT,
                "data_type": Tag.DataTypeChoices.BOOL,
                "address": 1,
                "description": "Low temperature safety trip",
            },
        )

        self.write_tag(self.supply_temp_tag, 75)
        self.write_tag(self.outdoor_temp_tag, 85)
        self.write_tag(self.return_temp_tag, 75)
        self.write_tag(self.temp_setpoint_tag, 72)

        self.filter_dirt = 0.5

        if not device_created:
            logger.info("Test objects already set up, probably")
            return
        
        user = User.objects.filter(username="testuser").first()
        if user is None:
            user = User.objects.create_superuser(
                username="testuser",
                email="test@example.com",
                password="test1234",
            )

        dashboard, _ = Dashboard.objects.get_or_create(
            owner=user,
            alias="hvac-main",
            defaults={"title": "Main Office HVAC", "column_count": 24}
        )

        logger.info("Creating Alarms...")
        
        # Critical Safety
        AlarmConfig.objects.update_or_create(
            alias="freeze_stat_trip",
            tag=self.freeze_alarm_tag,
            defaults={
                "trigger_value": True,
                "owner": user,
                "message": "CRITICAL: AHU Freeze Protection Trip. Manual Reset Required.",
                "threat_level": "crit"
            }
        )

        # Maintenance Warning
        AlarmConfig.objects.update_or_create(
            alias="filter_dirty",
            tag=self.duct_pressure_tag,
            defaults={
                "trigger_value": 1.5, # 1.5 inches WC
                "operator": "greater_than",
                "owner": user,
                "message": "Filter Dirty - Maintenance Required",
                "threat_level": "low"
            }
        )
        
        # Comfort Warning
        AlarmConfig.objects.update_or_create(
            alias="high_temp_warning",
            tag=self.return_temp_tag,
            defaults={
                "trigger_value": 78.0,
                "operator": "greater_than",
                "owner": user,
                "message": "Space Temperature High",
                "threat_level": "high"
            }
        )

        logger.info("Building Dashboard Layout...")
        widgets = []
        
        # --- Header Section ---
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type="label",
            config={"text": "System Overview", "position_x": 0, "position_y": 0, "scale_x": 24, "scale_y": 1}
        ))

        # --- Left Col: Controls ---
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.fan_running_tag,
            widget_type="led",
            config={ 
                "position_x": 0, "position_y": 1, "scale_x": 4, "scale_y": 2, 
                "color_on": "green", "color_off": "gray", "showTagName": True
            }
        ))
        
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.occupancy_tag,
            widget_type="bool_label",
            config={"text_on": "OCCUPIED", "text_off": "UNOCCUPIED", "position_x": 4, "position_y": 1, "scale_x": 4, "scale_y": 2}
        ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.temp_setpoint_tag,
            widget_type="number_input",
            config={"position_x": 0, "position_y": 3, "scale_x": 4, "scale_y": 2, "step": 0.5, "min": 55, "max": 80}
        ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.cooling_valve_tag,
            widget_type="slider",
            config={"position_x": 4, "position_y": 3, "scale_x": 4, "scale_y": 2, "min_value": 0, "max_value": 100, "suffix": "% Open"}
        ))

        # --- Middle Col: Visuals ---
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.supply_temp_tag,
            widget_type="gauge",
            config={
                "title": "Supply Air Temp",
                "min_value": 40, "max_value": 100,
                "warning_threshold": 80, "critical_threshold": 90,
                "position_x": 8, "position_y": 1, "scale_x": 6, "scale_y": 4, "suffix": "°F"
            }
        ))
        
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.return_temp_tag,
            widget_type="chart",
            config={
                "title": "Return Air History (24h)",
                "history_seconds": 60,
                "chart_type": "area",
                "line_color": "#2ecc71",
                "position_x": 14, "position_y": 1, "scale_x": 10, "scale_y": 4,
                "y_min": 40, "y_max": 90,
            }
        ))

        # --- Bottom Row: Maintenance ---
        widgets.append(DashboardWidget(
            dashboard=dashboard,
            widget_type="label",
            config={"text": "Maintenance / Diagnostics", "position_x": 0, "position_y": 6, "scale_x": 24, "scale_y": 1}
        ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.duct_pressure_tag,
            widget_type="meter",
            config={
                "min_value": 0, "max_value": 2.0, "high_value": 1.5, "low_value": 1, "optimum_value": 0,
                "position_x": 0, "position_y": 7, "scale_x": 8, "scale_y": 2,
                "suffix": " in.WC", "display_value": True
            }
        ))

        widgets.append(DashboardWidget(
            dashboard=dashboard,
            tag=self.freeze_alarm_tag,
            widget_type="led",
            config={
                "color_on": "red", "color_off": "gray",
                "position_x": 9, "position_y": 7, "scale_x": 2, "scale_y": 2
            }
        ))
        
        DashboardWidget.objects.bulk_create(widgets)
        
        logger.info('Created HVAC Demo Dashboard')