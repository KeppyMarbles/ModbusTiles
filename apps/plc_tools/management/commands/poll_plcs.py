import time
import logging
from django.core.management.base import BaseCommand, CommandError
from pymodbus.client import ModbusTcpClient, ModbusUdpClient, ModbusSerialClient
from pymodbus.exceptions import ConnectionException, ModbusIOException
from ...models import Device, Tag, TagHistoryEntry, TagWriteRequest, AlarmConfig, ActivatedAlarm, AlarmSubscription
from django.utils import timezone

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
type ModbusClient = ModbusTcpClient | ModbusUdpClient | ModbusSerialClient
#TODO tag value type?

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
        self.connections = {}
        #TODO need to handle all the errors properly
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
                        self.connections[device.alias] = None
                        break
                    except Exception as e:
                        logger.warning(f"Modbus Error reading {tag}: {e}")
                        continue

                    if not isinstance(values, str) and len(values) == 1:
                        values = values[0] #TODO? could be confusing

                    try:
                        self._store_value(tag, values)
                    except Exception as e:
                        logger.warning(f"Couldn't save values {values} to tag {tag}: {e}")
                        continue

                    #try:
                    self._process_alarms(tag)
                    #except Exception as e:
                    #    logger.warning(f"Coudn't process alarms for tag {tag}: {e}")

            time.sleep(0.25) #TODO individual device polling rates?


    def _get_connection(self, device: Device) -> ModbusClient:
        """ Creates a device connection or returns an existing one """
        conn = self.connections.get(device.alias)
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
        
        self.connections[device.alias] = conn
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


    def _store_value(self, tag: Tag, value):
        """ Updates the tag's value and stores history if enabled """
        #TODO what if we want to store entries at a lesser resolution?
        #TODO maybe we could not store the entry if the value is the same as the previous?
        tag.current_value = value
        tag.last_updated = timezone.now()
        tag.save(update_fields=["current_value", "last_updated"])

        if tag.max_history_entries == 0:
            return

        TagHistoryEntry.objects.create(tag=tag, value=value)

        # Unlimited entries
        if tag.max_history_entries < 0:
            return

        qs = (
            TagHistoryEntry.objects
            .filter(tag=tag)
            .order_by("-timestamp")
        )

        try:
            cutoff_entry = qs[tag.max_history_entries]
        except IndexError:
            return

        # Purge
        TagHistoryEntry.objects.filter(
            tag=tag,
            timestamp__lt=cutoff_entry.timestamp
        ).delete()


    def _process_writes(self, client: ModbusClient, device: Device):
        writes = TagWriteRequest.objects.filter(processed=False, tag__device=device)
        for req in writes:
            self._write_value(client, req.tag, req.value)
            req.processed = True
            req.save()

        
    def _write_value(self, client: ModbusClient, tag: Tag, values):
        """ Attemps to write a value to the tag's associated register(s) """

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
            logging.warning(f"Tag data type mismatch: writing {values} to {tag}")
            return

        match tag.channel:
            case Tag.ChannelChoices.HOLDING_REGISTER:
                result = client.convert_to_registers(values, data_type=get_modbus_datatype(client, tag), word_order=tag.device.word_order)
                client.write_registers(tag.address, result, device_id=tag.unit_id)

            case Tag.ChannelChoices.COIL:
                client.write_coils(tag.address, values, device_id=tag.unit_id)

            case _:
                raise Exception("Tried to write with a read-only tag")
                

    def _process_alarms(self, tag: Tag):
        """ Trigger an alarm if the tag is in an alarm state """
        
        alarm_config = AlarmConfig.objects.filter(trigger_value=tag.current_value, tag=tag).first()

        if alarm_config:
            active_alarm, created = ActivatedAlarm.objects.get_or_create(
                config=alarm_config,
                is_active=True,
            )
            if(created):
                logger.info(f"Activated alarm: {active_alarm}")

            self._handle_notification(active_alarm)

            # Disable other alarms active for the same tag
            stale_alarms = ActivatedAlarm.objects.filter(
                config__tag=tag, 
                is_active=True
            ).exclude(id=active_alarm.id)

            for alarm in stale_alarms: #TODO batch?
                alarm.is_active = False
                alarm.save(update_fields=['is_active'])
                logger.info(f"Disabled alarm: {alarm}")

        else:
            active_alarms = ActivatedAlarm.objects.filter(config__tag=tag, is_active=True)
            if active_alarms.exists():
                active_alarms.update(is_active=False)
                logger.info(f"All alarms cleared for tag: {tag}")

    
    def _handle_notification(self, active_alarm: ActivatedAlarm):
        now = timezone.now()

        # Check if we ever notified, or if the cooldown has passed
        #TODO maybe the cooldown should be on the tag instead? So we don't get multiple emails about the different threat levels
        if (active_alarm.config.last_notified is None) or \
            (now - active_alarm.config.last_notified > active_alarm.config.notification_cooldown):

            #TODO batch multiple alarms into one email?
            subs = AlarmSubscription.objects.filter(
                        alarm_config=active_alarm.config, 
                        email_enabled=True
                    ).select_related('user')
            
            recipients = [sub.user.email for sub in subs if sub.user.email]
            logger.info(f"Sending Email to {recipients}: {active_alarm.config.message}")
            #TODO

            active_alarm.config.last_notified = now
            active_alarm.config.save(update_fields=['last_notified'])