import time
import math
import random
import threading
import logging
import struct
from django.core.management.base import BaseCommand
from main.models import Tag
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusDeviceContext,
    ModbusServerContext
)

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Runs a Modbus TCP simulator that animates read-only tags from the DB'

    def add_arguments(self, parser):
        parser.add_argument("--port", type=int)

    def handle(self, *args, **options):
        port = options["port"]

        # Create Modbus Server
        store = ModbusDeviceContext(
            di=ModbusSequentialDataBlock(0, [0] * 1024), # Discrete Inputs
            co=ModbusSequentialDataBlock(0, [0] * 1024), # Coils
            hr=ModbusSequentialDataBlock(0, [0] * 1024), # Holding Registers
            ir=ModbusSequentialDataBlock(0, [0] * 1024), # Input Registers
        )
        context = ModbusServerContext(devices=store, single=True)

        # Simulation Thread
        sim_thread = threading.Thread(target=self.simulation_loop, args=(context,))
        sim_thread.daemon = True
        sim_thread.start()

        self.stdout.write(self.style.SUCCESS(f"--> Starting Dynamic PLC Simulator on 0.0.0.0:{port}"))
        
        # Start the server
        StartTcpServer(context=context, address=("0.0.0.0", port))

    def simulation_loop(self, context: ModbusServerContext):
        """ Background thread that updates tag values """
        
        while True:
            # Get all read-only tags
            tags = Tag.objects.filter(
                is_active=True, 
                channel__in=[Tag.ChannelChoices.INPUT_REGISTER, Tag.ChannelChoices.DISCRETE_INPUT],
                bit_index=None, #TODO implement bit animating?
            ).select_related("device")

            for tag in tags:
                try:
                    self.animate_tag(context, tag)
                except Exception as e:
                    logger.error(f"Error animating {tag}: {e}")

                time.sleep(1 / len(tags))

    def animate_tag(self, context: ModbusServerContext, tag: Tag):
        slave_id = tag.unit_id
        address = tag.address
        
        # Get type-matching value
        new_value = self.generate_random_value(tag)

        # Write to server context
        if tag.channel == Tag.ChannelChoices.DISCRETE_INPUT:
            context[slave_id].setValues(2, address, [new_value])
            
        elif tag.channel == Tag.ChannelChoices.INPUT_REGISTER:
            registers = self.pack_value(new_value, tag.data_type, tag.device.word_order)
            context[slave_id].setValues(4, address, registers)

    def generate_random_value(self, tag: Tag):
        """ Generates a random value appropriate for the data type """

        if tag.data_type == 'bool':
            return random.choice([True, False])
        
        elif 'float' in tag.data_type:
            # Noisy sine
            t = time.time()
            base = math.sin(t * 0.5 + tag.address) * 5 + 5 # Oscillate between 0 and 10
            noise = random.uniform(-2, 2)
            return base + noise

        elif 'int' in tag.data_type:
            return random.randint(0, 10)
            
        return 0

    def pack_value(self, value, data_type, word_order_str):
        """ Converts a Python value into 16-bit register list """

        word_swap = (word_order_str == "little")

        # Choose struct format
        match data_type:
            case "int16":
                fmt = ">h"
            case "uint16":
                fmt = ">H"
            case "int32":
                fmt = ">i"
            case "uint32":
                fmt = ">I"
            case "int64":
                fmt = ">q"
            case "uint64":
                fmt = ">Q"
            case "float32":
                fmt = ">f"
            case "float64":
                fmt = ">d"
            case "string":
                data = str(value).encode("ascii")
                # Pad to even number of bytes
                if len(data) % 2 == 1:
                    data += b"\x00"
                return [int.from_bytes(data[i:i+2], 'big') for i in range(0, len(data), 2)]
            case _:
                fmt = ">h"

        # pack to bytes
        data = struct.pack(fmt, value)

        # split into 16-bit registers
        regs = [int.from_bytes(data[i:i+2], 'big') for i in range(0, len(data), 2)]

        # Apply Modbus word order swap for 32/64 bit values
        if word_swap and len(regs) > 1:
            # reverse 16-bit register order
            regs = list(reversed(regs))

        return regs