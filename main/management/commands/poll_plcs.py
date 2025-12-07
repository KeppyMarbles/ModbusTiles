import time
import logging
import json
from ...models import Device, Tag, TagHistoryEntry, TagWriteRequest, AlarmConfig, ActivatedAlarm, AlarmSubscription
from pymodbus.client import ModbusTcpClient, ModbusUdpClient, ModbusSerialClient
from pymodbus.exceptions import ConnectionException, ModbusIOException
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.db import connection

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

type ModbusClient = ModbusTcpClient | ModbusUdpClient | ModbusSerialClient#TODO tag value type?


def get_modbus_reader(client: ModbusClient, tag: Tag):
    """ Returns the function needed for reading a tag """
    return {
        Tag.ChannelChoices.COIL: client.read_coils,
        Tag.ChannelChoices.DISCRETE_INPUT: client.read_discrete_inputs,
        Tag.ChannelChoices.HOLDING_REGISTER: client.read_holding_registers,
        Tag.ChannelChoices.INPUT_REGISTER: client.read_input_registers,
    }[tag.channel]


def get_modbus_datatype(client: ModbusClient, tag: Tag):
    """ Returns the equivalent pymodbus datatype of a tag's datatype """
    return {
        Tag.DataTypeChoices.INT16: client.DATATYPE.INT16,
        Tag.DataTypeChoices.UINT16: client.DATATYPE.UINT16,
        Tag.DataTypeChoices.FLOAT32: client.DATATYPE.FLOAT32,
        Tag.DataTypeChoices.STRING: client.DATATYPE.STRING
    }[tag.data_type]


class Command(BaseCommand):
    def handle(self, *args, **options):
        self._connections = {}
        self._poll()

    
    def _poll(self):
        """
        Queries the database for devices and tags,
        Finds or creates a connection for each device and updates the value of active tags
        """
        while True:
            for device in Device.objects.all():
                try:
                    client = self._get_connection(device)
                except Exception as e:
                    logger.warning(f"Error connecting to device {device}: {e}")
                    continue
                
                try:
                    self._process_writes(client, device)
                except Exception as e:
                    logger.error(f"Couldn't process writes for {device}: {e}")

                tags = Tag.objects.filter(device=device, is_active=True)
                #TODO read blocks instead of individual values?
                for tag in tags:
                    try:
                        values = self._read_tag(client, tag)
                    except (ConnectionException, ConnectionError, ConnectionResetError) as e:
                        logger.error(f"No connection from {client}: {e}")
                        self._connections[device.alias] = None
                        break
                    except Exception as e:
                        logger.warning(f"Modbus Error reading {tag}: {e}")
                        continue

                    if not isinstance(values, str) and len(values) == 1:
                        values = values[0] #TODO? could be confusing

                    tag.set_value(values)

            AlarmConfig.check_alarms()
            time.sleep(0.25) #TODO individual device polling rates?


    def _get_connection(self, device: Device) -> ModbusClient:
        """ Creates a device connection or returns an existing one """
        conn = self._connections.get(device.alias)
        if conn is None or not conn.connected:
            match device.protocol:
                case Device.ProtocolChoices.MODBUS_TCP:
                    conn = ModbusTcpClient(device.ip_address, port=device.port)

                case Device.ProtocolChoices.MODBUS_UDP:
                    conn = ModbusUdpClient(device.ip_address, port=device.port)
                #case Device.ProtocolChoices.MODBUS_RTU:
                #    conn = ModbusSerialClient(device.port)
            if conn.connect():
                logger.info(f"Established connection: {conn}")
            else:
                raise ConnectionError("Could not connect to PLC", conn)
        
        self._connections[device.alias] = conn
        return conn


    def _read_tag(self, client: ModbusClient, tag: Tag):
        """ Returns the value of the register(s) or coil(s) associated with a tag """
        func = get_modbus_reader(client, tag)
        result = func(tag.address, count=tag.get_read_count(), device_id=tag.unit_id)

        if result.isError():
            raise Exception("Modbus returned an error code:", result) 
        
        # Input or holding registers
        if len(result.registers) > 0:
            values = client.convert_from_registers(result.registers, data_type=get_modbus_datatype(client, tag))

            # Ensure result is a list or a string
            if not isinstance(values, list) and not isinstance(values, str):
                values = [values]
        
        # Coils or discrete inputs
        elif len(result.bits) > 0:
            values = result.bits[:tag.read_amount]

        return values

    def _process_writes(self, client: ModbusClient, device: Device):
        """ Queries all PLC write requests and attempts to fullfill them """

        writes = TagWriteRequest.objects.filter(processed=False, tag__device=device)
        for req in writes:
            self._write_value(client, req.tag, req.value) #TODO should i try/except here instead? should i log/notify server if it fails?
            logger.info(f"Processed write request for tag {req.tag}")
            req.processed = True
            req.save()

        
    def _write_value(self, client: ModbusClient, tag: Tag, values):
        """ Attempts to write a value to the tag's associated register(s) """

        if not isinstance(values, list) and tag.data_type != Tag.DataTypeChoices.STRING:
            values = [values]

        try:
            match tag.data_type:
                case Tag.DataTypeChoices.BOOL:
                    values = [bool(value) for value in values]
                case Tag.DataTypeChoices.INT16 | Tag.DataTypeChoices.UINT16:
                    values = [int(value) for value in values]
                case Tag.DataTypeChoices.FLOAT32:
                    values = [float(value) for value in values]
        except ValueError:
            logger.warning(f"Tag data type mismatch: writing {values} to {tag}")
            return

        match tag.channel:
            case Tag.ChannelChoices.HOLDING_REGISTER:
                result = client.convert_to_registers(values, data_type=get_modbus_datatype(client, tag), word_order=tag.device.word_order)
                client.write_registers(tag.address, result, device_id=tag.unit_id)

            case Tag.ChannelChoices.COIL:
                client.write_coils(tag.address, values, device_id=tag.unit_id)

            case _:
                logger.warning("Tried to write with a read-only tag")
                return