import random
import math
import time
import json
from ...models import Tag, Dashboard, Device
from ...services.io_csv import DeviceImporter, TagImporter, AlarmConfigImporter
from ...api.views import DashboardViewSet
from .run_simulation import Command as BaseModbusSimulator
import logging

logger = logging.getLogger(__name__)

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

    def _noise(self, tag: Tag):
        if tag.data_type == Tag.DataTypeChoices.BOOL:
            return random.choice([True, False])
        
        elif tag.data_type in [Tag.DataTypeChoices.FLOAT32, Tag.DataTypeChoices.FLOAT64]:
            # Simple sine wave based on address to desynchronize them
            base = math.sin(time.time() + tag.address) * 10
            return base + random.uniform(-1, 1)
        
        elif tag.data_type == Tag.DataTypeChoices.STRING:
            return "" #TODO
            
        return random.randint(0, 10) #TODO base off int type?
    
    def setup_simulation(self):
        user = BaseModbusSimulator.ensure_testuser()

        with open("test_data/TestDevice.csv") as file:
            DeviceImporter(file).run()

        with open("test_data/TestTags.csv") as file:
            TagImporter(file).run()

        with open("test_data/TestAlarms.csv") as file:
            AlarmConfigImporter(file).run()

        with open("test_data/TestDashboard.json") as file:
            data = json.load(file)
            dashboard, _ = Dashboard.objects.get_or_create(alias=data["alias"], owner=user)
            DashboardViewSet.update_dashboard(dashboard=dashboard, data=data)

        device = Device.objects.get(alias="TestPLC")
        self.word_order = device.word_order
        self.port = device.port