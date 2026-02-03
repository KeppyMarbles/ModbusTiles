import time
import threading
import logging
from abc import ABC
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusDeviceContext,
    ModbusServerContext
)
from pymodbus.client.base import ModbusBaseClient
from ...models import Tag # Imported for Channel/DataType constants only

logger = logging.getLogger(__name__)
User = get_user_model()

class Command(BaseCommand, ABC):
    help = 'Runs a Modbus TCP simulator'

    def add_arguments(self, parser):
        parser.add_argument("--interval", type=float, default=0.1)
        parser.add_argument("--size", type=int, default=2**13)

    def handle(self, *args, **options): #TODO word order
        self.interval = options["interval"]
        size = options["size"]
        
        # Memory
        store = ModbusDeviceContext(
            di=ModbusSequentialDataBlock(0, [0] * size),
            co=ModbusSequentialDataBlock(0, [0] * size),
            hr=ModbusSequentialDataBlock(0, [0] * size),
            ir=ModbusSequentialDataBlock(0, [0] * size),
        )
        self.context = ModbusServerContext(devices=store, single=True)

        # Setup
        logger.info("Setting up simulation...")
        self.setup_simulation()

        # Sim Thread
        thread = threading.Thread(target=self._loop)
        thread.daemon = True
        thread.start()

        # Server
        logger.info(f"Simulator running on port {self.port}")
        StartTcpServer(context=self.context, address=("0.0.0.0", self.port))

    def _loop(self):
        while True:
            start_time = time.monotonic()
            try:
                self.tick()
            except Exception as e:
                logger.error(f"Simulation tick error: {e}")
            elapsed = time.monotonic() - start_time
            time.sleep(max(0, self.interval - elapsed))

    def tick(self):
        """ Called each interval """
        pass

    def setup_simulation(self):
        """ Optional hook for initialization """
        self.port = 502
        self.word_order = "big"

    def read_tag(self, tag: Tag):
        """ Direct read from memory based on Tag attributes """

        count = tag.pymodbus_datatype.value[1]
        vals = self.context[0].getValues(tag.modbus_function_code, tag.address, count=count)
        return ModbusBaseClient.convert_from_registers(vals, data_type=tag.pymodbus_datatype, word_order=self.word_order)

    def write_tag(self, tag: Tag, value):
        """ Direct write to memory based on Tag attributes """

        registers = ModbusBaseClient.convert_to_registers(value, data_type=tag.pymodbus_datatype, word_order=self.word_order)
        self.context[0].setValues(tag.modbus_function_code, tag.address, registers)

    @staticmethod
    def ensure_testuser():
        user = User.objects.filter(username="testuser").first()
        if user is None:
            username = "testuser"
            password = "test1234"
            user = User.objects.create_superuser(username=username, password=password)
            logger.info(f"Username: {username}")
            logger.info(f"Password: {password}")
            
        return user