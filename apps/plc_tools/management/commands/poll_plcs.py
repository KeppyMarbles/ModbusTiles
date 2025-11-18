import time
from django.core.management.base import BaseCommand, CommandError
from pymodbus.client import ModbusTcpClient, ModbusUdpClient, ModbusSerialClient
from pymodbus.exceptions import ConnectionException, ModbusIOException
from ...models import Device, Tag, TagHistoryEntry
from django.utils import timezone

type ModbusClient = ModbusTcpClient | ModbusUdpClient | ModbusSerialClient
#TODO tag value type?

class Command(BaseCommand):
    def handle(self, *args, **options):
        self.connections = {}
        #TODO need to handle all the errors properly
        self.__poll()

    
    def __poll(self):
        """
        Queries the database for devices and tags,
        Finds or creates a connection for each device and updates the value of active tags
        """
        while True:
            devices = Device.objects.all()

            for device in devices: 
                try:
                    client = self.__get_connection(device)

                    tags = Tag.objects.filter(device=device, is_active=True)
                    #TODO read blocks instead of individual values?
                    for tag in tags:
                        value = self.__read_tag(client, tag)
                        self.__store_value(tag, value)
                        #self.__store_value(tag.id, value)

                except (ConnectionException, ModbusIOException, ConnectionError) as e: 
                    print(f"PLC connection error: {e}")

                #except Exception as e:
                #    print(f"Unexpected error: {e}")

            time.sleep(0.25) #TODO individual device polling rates?


    def __get_connection(self, device: Device) -> ModbusClient:
        """ Creates a device connection or returns an existing one """
        conn = self.connections.get(device.alias)
        if conn is None or not conn.connected:
            match device.protocol:
                case Device.ProtocolChoices.MODBUS_TCP:
                    conn = ModbusTcpClient(device.ip_address, port=device.port)

                case Device.ProtocolChoices.MOBUS_UDP:
                    conn = ModbusUdpClient(device.ip_address, port=device.port)
                #case Device.ProtocolChoices.MODBUS_RTU:
                #    conn = ModbusSerialClient(device.port)
            if conn.connect():
                print("Established connection", conn)
            else:
                raise ConnectionError("Could not connect to PLC")

        
        self.connections[device.alias] = conn
        return conn


    def __read_tag(self, client: ModbusClient, tag: Tag):
        """ Returns the value of the register(s) or coil(s) associated with a tag """
        #TODO should the register_count be already set based on the type? This would work for everything except string.
        #TODO is there going to be widgets that make use of multiple register values that are int, float, bool, etc? Maybe instead of register count, we would have length field and scale it accordingly?
        
        read_map = {
            Tag.ChannelChoices.COIL: client.read_coils,
            Tag.ChannelChoices.DISCRETE_INPUT: client.read_discrete_inputs,
            Tag.ChannelChoices.HOLDING_REGISTER: client.read_holding_registers,
            Tag.ChannelChoices.INPUT_REGISTER: client.read_holding_registers
        }
        data_type_map  = {
            Tag.DataTypeChoices.INT16: client.DATATYPE.INT16,
            Tag.DataTypeChoices.UINT16: client.DATATYPE.UINT16,
            Tag.DataTypeChoices.FLOAT32: client.DATATYPE.FLOAT32,
            Tag.DataTypeChoices.STRING: client.DATATYPE.STRING
        }

        #print(tag.register_count)

        result = read_map[tag.channel](tag.address, count=tag.register_count, device_id=tag.unit_id)

        if result.isError():
            print("Error:", result) #TODO
            return None
        
        
        #print(result.registers)
        #print(result.bits)
        
        if len(result.registers) > 0:
            stored_value = client.convert_from_registers(result.registers, data_type=data_type_map[tag.data_type])
        elif len(result.bits) > 0:
            stored_value = bool(result.bits[0]) #if tag.register_count == 1 else result.bits #TODO

        return stored_value
        #TODO should we just always store a history entry for value fetch, but only keeping one if not tag.store_history?


    def __store_value(self, tag: Tag, value):
        """ Updates the tag's value and stores history if enabled """
        #TODO what if we want to store entries at a lesser resolution?
        tag.current_value = value
        tag.save(update_fields=["current_value"])

        if tag.max_history_entries != 0:
            TagHistoryEntry.objects.create(tag=tag, value=value)
            if tag.max_history_entries is None:
                return
            to_delete = (   
                TagHistoryEntry.objects
                .filter(tag=tag)
                .order_by("-timestamp")[tag.max_history_entries:]
            )
            if to_delete.exists():
                to_delete.delete()

        
    def __write_value(self, client: ModbusClient, tag: Tag):
        """ Attemps to write the tag's current value to the tag's associated register(s) """
        data_type_map  = {
            Tag.DataTypeChoices.INT16: client.DATATYPE.INT16,
            Tag.DataTypeChoices.UINT16: client.DATATYPE.UINT16,
            Tag.DataTypeChoices.FLOAT32: client.DATATYPE.FLOAT32,
            Tag.DataTypeChoices.STRING: client.DATATYPE.STRING
        }

        match tag.channel:
            case Tag.ChannelChoices.HOLDING_REGISTER:
                result = client.convert_to_registers(tag.current_value, data_type=data_type_map[tag.data_type], word_order=tag.device.word_order)
                client.write_registers(tag.address, result, device_id=tag.unit_id)

            case Tag.ChannelChoices.COIL:
                client.write_coils(tag.address, tag.current_value, device_id=tag.unit_id)

            case _:
                raise Exception("Tried to write with a read-only tag")

        
    
