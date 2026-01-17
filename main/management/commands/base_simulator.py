import time
import struct
import threading
import logging
from abc import ABC, abstractmethod
from types import SimpleNamespace
from django.core.management.base import BaseCommand
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusDeviceContext,
    ModbusServerContext
)
from pymodbus.client.base import ModbusBaseClient
from ...models import Tag # Imported for Channel/DataType constants only

logger = logging.getLogger(__name__)

class BaseModbusSimulator(BaseCommand, ABC):
    help = 'Runs a Modbus TCP simulator'

    def add_arguments(self, parser):
        parser.add_argument("--port", type=int, default=502)
        parser.add_argument("--interval", type=float, default=0.5)
        parser.add_argument("--size", type=int, default=2**13)

    def handle(self, *args, **options): #TODO word order
        self.port = options["port"]
        self.interval = options["interval"]
        size = options["size"]
        
        # 1. Setup Memory
        store = ModbusDeviceContext(
            di=ModbusSequentialDataBlock(0, [0] * size),
            co=ModbusSequentialDataBlock(0, [0] * size),
            hr=ModbusSequentialDataBlock(0, [0] * size),
            ir=ModbusSequentialDataBlock(0, [0] * size),
        )
        self.context = ModbusServerContext(devices=store, single=True)

        # 2. Hook for subclasses to init data
        self.setup_simulation()

        # 3. Background Thread
        thread = threading.Thread(target=self._loop)
        thread.daemon = True
        thread.start()

        self.stdout.write(self.style.SUCCESS(f"--> Simulator running on port {self.port}"))
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

    @abstractmethod
    def tick(self):
        """ Called each interval """
        pass

    def setup_simulation(self):
        """ Optional hook for initialization """
        pass

    # ---------- Unified I/O Logic ----------


    def read_tag(self, tag: Tag):
        """ Direct read from memory based on Tag attributes """

        count = tag.pymodbus_datatype.value[1]
        if count == 0: count = 1 # Handle strings or dynamic types if necessary

        vals = self.context[0].getValues(tag.modbus_function_code, tag.address, count=count)
        return ModbusBaseClient.convert_from_registers(vals, data_type=tag.pymodbus_datatype, word_order="big") #self.word_order

    def write_tag(self, tag: Tag, value):
        """ Direct write to memory based on Tag attributes """

        registers = ModbusBaseClient.convert_to_registers(value, data_type=tag.pymodbus_datatype, word_order="big")
        self.context[0].setValues(tag.modbus_function_code, tag.address, registers)