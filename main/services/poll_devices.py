import asyncio
import time
import logging
from dataclasses import dataclass
from collections import defaultdict
from django.utils import timezone
from django.db import connection, close_old_connections
from pymodbus.client import AsyncModbusTcpClient, AsyncModbusUdpClient
from pymodbus.client.base import ModbusBaseClient
from channels.layers import get_channel_layer
from channels.db import database_sync_to_async
from ..models import Device, Tag, TagWriteRequest, AlarmConfig, ActivatedAlarm
from ..api.serializers import TagValueSerializer
from .notify_alarms import send_alarm_notifications #TODO use


@dataclass
class ReadBlock:
    start: int
    length: int
    tags: list[Tag]

@dataclass
class PollContext:
    updated_tags: list[Tag]
    read_tags: list[Tag]

logger = logging.getLogger(__name__)

channel_layer = get_channel_layer()
clients: dict[str, ModbusBaseClient] = {}

POLL_DURATION = 0.25
INFO_DURATION = 30

async def poll_devices():
    """ Gather tag data and process write requests at a steady rate """

    @database_sync_to_async
    def get_active_devices() -> list[Device]:
        """ Get devices enabled in the DB with prefetched tags """
        return list(Device.objects.filter(is_active=True).prefetch_related('tags'))

    @database_sync_to_async
    def update_tags(context: PollContext):
        connection.ensure_connection()

        Tag.objects.bulk_update(context.read_tags, ['last_updated'])
        Tag.objects.bulk_update(context.updated_tags, ['current_value'])
        Tag.bulk_create_history(context.updated_tags)

        AlarmConfig.update_alarms(context.updated_tags)
    
    @database_sync_to_async
    def get_tag_data(context: PollContext):
        serialized = TagValueSerializer(
            context.updated_tags, many=True, 
            context={"alarm_map": ActivatedAlarm.get_tag_map(context.updated_tags)}
        )
        return serialized.data
    
    async def log_duration(): #TODO more logging info?
        """ Notify if we're keeping up with the target frequency """
        nonlocal total_duration, iteration_count
        while True:
            if iteration_count > 0:
                avg = total_duration / iteration_count
                amt = (avg / POLL_DURATION)*100
                msg = f"Average poll duration: {avg:.3f}s ({amt:.2f}%)"
                if avg > POLL_DURATION:
                    logger.warning(msg)
                else:
                    logger.info(msg)

            total_duration = iteration_count = 0
            await asyncio.sleep(INFO_DURATION)

    logger.info("Starting Async Poller...")

    total_duration = iteration_count = 0
    asyncio.create_task(log_duration())
    
    while True:
        start_time = time.monotonic()

        devices = await get_active_devices()
        context = PollContext(updated_tags=[], read_tags=[])
        
        # Process devices concurrently
        tasks = [_poll_device(d, context) for d in devices]
        await asyncio.gather(*tasks)
        await update_tags(context)

        # Send data to the websocket using the tag serializer
        tag_data = await get_tag_data(context)
        await channel_layer.group_send(
            "poller_broadcast", {
                "type": "tag_update",
                "updates": tag_data
            }
        )

        # Sleep
        elapsed = time.monotonic() - start_time
        sleep_time = max(0, POLL_DURATION - elapsed)

        total_duration += elapsed
        iteration_count += 1

        await asyncio.sleep(sleep_time)


async def _poll_device(device: Device, context: PollContext):
    """ Process read and writes for a device """

    try:
        client = await _get_client(device) #TODO stop trying if it fails too often?
    except Exception as e:
        logger.warning(f"Error connecting to device {device}: {e}")
        return
    
    await _process_writes(client, device)
    
    tags: list[Tag] = [t for t in device.tags.all() if t.is_active]

    for block in _build_read_blocks(tags):
        await _process_block(block, client, context)


async def _get_client(device: Device) -> ModbusBaseClient | None:
    """Get or create a persistent client connection"""

    conn = clients.get(device.alias)
    if conn is None or not conn.connected:
        match device.protocol:
            case Device.ProtocolChoices.MODBUS_TCP:
                conn = AsyncModbusTcpClient(device.ip_address, port=device.port)

            case Device.ProtocolChoices.MODBUS_UDP:
                conn = AsyncModbusUdpClient(device.ip_address, port=device.port)
            #case Device.ProtocolChoices.MODBUS_RTU:
            #    conn = ModbusSerialClient(device.port)
        if await conn.connect(): #TODO only retry after set duration?
            logger.info(f"Established connection: {conn}")
        else:
            raise ConnectionError("Could not connect to PLC", conn)
    
    clients[device.alias] = conn
    return conn


def _build_read_blocks(tags: list[Tag]) -> list[ReadBlock]:
    """ Create blocks of contiguous registers in memory """
    #if not all(tag.device == tags[0].device for tag in tags):
    #    raise Exception("Tag device mismatch when building read block")

    # Group tags by channel
    grouped_tags = defaultdict(list[Tag])
    for tag in tags:
        grouped_tags[tag.channel].append(tag)

    blocks = []

    for channel, channel_tags in grouped_tags.items():
        channel_tags.sort(key=lambda x: x.address)

        MAX_GAP = 8
        MAX_SIZE = 128

        # First block
        block_tags = [channel_tags[0]]
        block_start = channel_tags[0].address
        block_end = block_start + channel_tags[0].get_read_count()

        # Create or extend blocks
        for tag in channel_tags[1:]:
            length = tag.get_read_count()

            close_enough = (tag.address - block_end) <= MAX_GAP
            within_size = (tag.address + length - block_start) <= MAX_SIZE

            if close_enough and within_size:
                # Extend current block
                block_tags.append(tag)
                block_end = max(block_end, tag.address + length)

            else:
                # Finish current block and start new block
                blocks.append(ReadBlock(block_start, block_end - block_start, block_tags))
                block_tags = [tag]
                block_start = tag.address
                block_end = block_start + length

        # Add last block
        blocks.append(ReadBlock(block_start, block_end - block_start, block_tags))

    return blocks


async def _process_block(block: ReadBlock, client: ModbusBaseClient, context: PollContext):
    """ Read the given data from the device connection and update associated tags """

    # Get register data for this block
    read_func = _get_modbus_reader(client, block.tags[0])
    try:
        rr = await read_func(block.start, count=block.length, device_id=0)
    except Exception as e:
        logger.error(f"Error reading block: {e}")
        return
    
    if rr.isError():
        logger.warning(f"Modbus error while reading block starting at {block.start}")
        return
    
    if len(rr.registers) > 0:
        block_data = rr.registers
    elif len(rr.bits) > 0:
        block_data = rr.bits
    else:
        logger.warning("Modbus response contained no data")
        return

    # For each tag, get the associated value found in the register data 
    for tag in block.tags:
        try:
            # Get memory
            offset = tag.address - block.start
            length = tag.get_read_count() #TODO

            if offset + length > len(block_data):
                logger.warning(f"Tag {tag} out of bounds in block read")
                continue
            
            raw_slice = block_data[offset : offset + length]

            # Convert the register data into typed value
            if len(rr.registers) > 0:
                values = client.convert_from_registers(
                    raw_slice, 
                    data_type=_get_modbus_datatype(client, tag),
                    word_order=tag.device.word_order
                )
            elif len(rr.bits) > 0:
                values = raw_slice if tag.read_amount > 1 else raw_slice[0]

            # Update tag
            if tag.current_value != values:
                tag.current_value = values #TODO
                context.updated_tags.append(tag)
            
            tag.last_updated = timezone.now()
            context.read_tags.append(tag)

        except Exception as e:
            logger.error(f"Error processing tag {tag.alias}: {e}")


async def _process_writes(client, device: Device):
    """ Queries all PLC write requests and attempts to fullfill them """

    @database_sync_to_async
    def get_pending_writes(device: Device):
        return list(
            TagWriteRequest.objects
            .filter(processed=False, tag__device=device)
            .select_related("tag__device")
        )
    
    @database_sync_to_async
    def save_requests(requests: list[TagWriteRequest]):
        connection.ensure_connection()
        TagWriteRequest.objects.bulk_update(requests, ['processed'])

    writes = await get_pending_writes(device)

    if not writes:
        return

    for req in writes:
        # Try to actually write the requested value
        try:
            await _write_value(client, req.tag, req.value)
            logger.info(f"Processed write request for tag {req.tag}")

        except Exception as e:
            logger.error(f"Write failed for {req.tag}: {e}") #TODO mark write status as failed

        # Mark as done
        req.processed = True

    await save_requests(writes)
        

async def _write_value(client: ModbusBaseClient, tag: Tag, values):
    """ Attempts to write a value to the tag's associated register(s) """

    # Keep it iterable
    if not isinstance(values, list) and tag.data_type != Tag.DataTypeChoices.STRING:
        values = [values]

    # Make sure that the values are set to the tag's type
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

    # Write the list to the device registers
    match tag.channel:
        case Tag.ChannelChoices.HOLDING_REGISTER:
            registers = client.convert_to_registers(values, data_type=_get_modbus_datatype(client, tag), word_order=tag.device.word_order)
            result = await client.write_registers(tag.address, registers, device_id=tag.unit_id)

        case Tag.ChannelChoices.COIL:
            result = await client.write_coils(tag.address, values, device_id=tag.unit_id)

        case _:
            logger.warning("Tried to write with a read-only tag")
            return
    
    if result.isError():
        raise Exception(f"Modbus error: {result}")
    
    
def _get_modbus_reader(client: ModbusBaseClient, tag: Tag):
    """ Returns the function needed for reading a tag """
    return {
        Tag.ChannelChoices.COIL: client.read_coils,
        Tag.ChannelChoices.DISCRETE_INPUT: client.read_discrete_inputs,
        Tag.ChannelChoices.HOLDING_REGISTER: client.read_holding_registers,
        Tag.ChannelChoices.INPUT_REGISTER: client.read_input_registers,
    }[tag.channel]


def _get_modbus_datatype(client: ModbusBaseClient, tag: Tag):
    """ Returns the equivalent pymodbus datatype of a tag's datatype """
    return {
        Tag.DataTypeChoices.BOOL: client.DATATYPE.BITS,
        Tag.DataTypeChoices.INT16: client.DATATYPE.INT16,
        Tag.DataTypeChoices.UINT16: client.DATATYPE.UINT16,
        Tag.DataTypeChoices.INT32: client.DATATYPE.INT32,
        Tag.DataTypeChoices.UINT32: client.DATATYPE.UINT32,
        Tag.DataTypeChoices.INT64: client.DATATYPE.INT64,
        Tag.DataTypeChoices.UINT64: client.DATATYPE.UINT64,
        Tag.DataTypeChoices.FLOAT32: client.DATATYPE.FLOAT32,
        Tag.DataTypeChoices.FLOAT64: client.DATATYPE.FLOAT64,
        Tag.DataTypeChoices.STRING: client.DATATYPE.STRING
    }[tag.data_type]