import random
import logging
import json
from django.contrib.auth import get_user_model
from .base_simulator import BaseModbusSimulator
from ...api.views import DashboardViewSet
from ...models import Tag, Dashboard, Device
from ...services.io_csv import DeviceImporter, TagImporter, AlarmConfigImporter


logger = logging.getLogger(__name__)
User = get_user_model()


class Command(BaseModbusSimulator):
    help = 'Runs the HVAC Physics Simulation'
 
    def tick(self):
        """ Background thread that runs the physics model """
        
        # Constants
        CHILLED_WATER_TEMP = 50.0
        HOT_WATER_TEMP = 160.0
        ROOM_THERMAL_MASS = 500.0
        COOLING_GAIN = 8.0
        HEATING_GAIN = 6.0
        HEAT_GAIN = 1.5
        DEADBAND = 1.0  # deg F

        fan_enable_prev = self.read_tag(self.fan_running_tag)
        room_temp = self.read_tag(self.return_temp_tag)
        setpoint = self.read_tag(self.temp_setpoint_tag)
        outdoor_temp = self.read_tag(self.outdoor_temp_tag)
        supply_temp = self.read_tag(self.supply_temp_tag)
        cool_valve_pos = self.read_tag(self.cooling_valve_tag)
        heat_valve_pos = self.read_tag(self.heating_valve_tag)
        mode = self.read_tag(self.mode_tag)

        cooling = self.cooling_active

        if mode == 0:  # OFF
            fan_enable = False

        elif mode == 1:  # COOL
            if room_temp > setpoint + DEADBAND:
                fan_enable = True
                cooling = True
            elif room_temp < setpoint - DEADBAND:
                fan_enable = False
            else:
                fan_enable = fan_enable_prev

        elif mode == 2:  # HEAT
            if room_temp < setpoint - DEADBAND:
                fan_enable = True
                cooling = False
            elif room_temp > setpoint + DEADBAND:
                fan_enable = False
            else:
                fan_enable = fan_enable_prev

        self.cooling_active = cooling

        # --- CALCULATE PHYSICS ---

        outdoor_temp += random.uniform(-0.05, 0.05)

        if fan_enable:
            if cooling:
                cool_valve_pos = max(0, min(cool_valve_pos, 100))
                target_supply = outdoor_temp - ((cool_valve_pos / 100.0) * (outdoor_temp - CHILLED_WATER_TEMP))
                supply_temp += (target_supply - supply_temp) * 0.1

                cooling = COOLING_GAIN * (room_temp - supply_temp)
                heat = HEAT_GAIN * (outdoor_temp - room_temp)
                room_temp += (heat - cooling) / ROOM_THERMAL_MASS

            else: # Heat
                cool_valve_pos = max(0, min(heat_valve_pos, 100))
                target_supply = supply_temp + (heat_valve_pos / 100.0) * (HOT_WATER_TEMP - supply_temp)
                supply_temp += (target_supply - supply_temp) * 0.15

                heating = HEATING_GAIN * (supply_temp - room_temp)
                heat_loss = HEAT_GAIN * (room_temp - outdoor_temp)
                room_temp += (heating - heat_loss) / ROOM_THERMAL_MASS

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
        self.write_tag(self.duct_pressure_tag, static_pressure)
        self.write_tag(self.freeze_alarm_tag, supply_temp < 40.0)

    def setup_simulation(self):
        user = User.objects.filter(username="testuser").first()
        if user is None:
            user = User.objects.create_superuser(
                username="testuser",
                email="test@example.com",
                password="test1234",
            )

        with open("test_data/DemoDevice.csv") as file:
            DeviceImporter(file).run()

        with open("test_data/DemoTags.csv") as file:
            TagImporter(file).run()

        with open("test_data/DemoAlarms.csv") as file:
            AlarmConfigImporter(file).run()

        with open("test_data/DemoDashboard.json") as file:
            data = json.load(file)
            dashboard, _ = Dashboard.objects.get_or_create(alias=data["alias"], owner=user)
            DashboardViewSet.update_dashboard(dashboard=dashboard, data=data)

        device = Device.objects.get(alias="Simulated_AHU")
        self.word_order = device.word_order
        self.port = device.port

        self.fan_running_tag = Tag.objects.get(alias="Fan_Running_Status")
        self.return_temp_tag = Tag.objects.get(alias="Return_Air_Temp")
        self.temp_setpoint_tag = Tag.objects.get(alias="Supply_Temp_Setpoint")
        self.outdoor_temp_tag = Tag.objects.get(alias="Outdoor_Temp")
        self.supply_temp_tag = Tag.objects.get(alias="Supply_Air_Temp")
        self.cooling_valve_tag = Tag.objects.get(alias="Cooling_Valve_Cmd")
        self.heating_valve_tag = Tag.objects.get(alias="Heating_Valve_Cmd")
        self.duct_pressure_tag = Tag.objects.get(alias="Duct_Static_Pressure")
        self.freeze_alarm_tag = Tag.objects.get(alias="Freeze_Stat_Alarm")
        self.mode_tag = Tag.objects.get(alias="HVAC_Mode")

        self.write_tag(self.supply_temp_tag, 75)
        self.write_tag(self.outdoor_temp_tag, 85)
        self.write_tag(self.return_temp_tag, 75)
        self.write_tag(self.temp_setpoint_tag, 72)
        self.write_tag(self.cooling_valve_tag, 50)
        self.write_tag(self.heating_valve_tag, 50)
        self.write_tag(self.mode_tag, 1)

        self.filter_dirt = 0.5
        self.cooling_active = False