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

@dataclass
class DeviceState:
    failures: int = 0
    next_retry: float = 0.0
    disabled_until: float = 0.0

logger = logging.getLogger(__name__)

channel_layer = get_channel_layer()
clients: dict[str, ModbusBaseClient] = {}
device_states: dict[str, DeviceState] = defaultdict(DeviceState)


async def poll_devices(poll_interval=0.25, info_interval=30):
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
                amt = (avg / poll_interval)*100
                msg = f"Average poll duration: {avg:.3f}s ({amt:.2f}%)"
                if avg > poll_interval:
                    logger.warning(msg)
                else:
                    logger.info(msg)

            total_duration = iteration_count = 0
            await asyncio.sleep(info_interval)

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
        sleep_time = max(0, poll_interval - elapsed)

        total_duration += elapsed
        iteration_count += 1

        await asyncio.sleep(sleep_time)


async def _poll_device(device: Device, context: PollContext):
    """ Process read and writes for a device """
    if time.monotonic() < device_states[device.alias].disabled_until:
        return
    
    try:
        client = await _get_client(device)
    except Exception as e:
        logger.warning(f"Couldn't connect to device {device}: {e}")
        return
    
    await _process_writes(client, device)
    
    tags: list[Tag] = [t for t in device.tags.all() if t.is_active]

    for block in _build_read_blocks(tags):
        await _process_block(block, client, context)


async def _get_client(device: Device, base_backoff_seconds=2, max_backoff_seconds=60) -> ModbusBaseClient | None:
    """Get or create a persistent client connection"""

    state = device_states[device.alias]
    conn = clients.get(device.alias)

    if conn is None or not conn.connected:
        match device.protocol:
            case Device.ProtocolChoices.MODBUS_TCP:
                conn = AsyncModbusTcpClient(device.ip_address, port=device.port, retries=0)

            case Device.ProtocolChoices.MODBUS_UDP:
                conn = AsyncModbusUdpClient(device.ip_address, port=device.port, retries=0)
            #case Device.ProtocolChoices.MODBUS_RTU:
            #    conn = ModbusSerialClient(device.port)
        if await conn.connect():
            state.failures = 0
            clients[device.alias] = conn
            logger.info(f"Established connection: {conn}")
        else:
            state.failures += 1

            backoff = min(base_backoff_seconds * (2 ** (min(state.failures, 32) - 1)), max_backoff_seconds)
            state.disabled_until = time.monotonic() + backoff

            logger.warning(f"{device.alias} unreachable. Trying again in {backoff:.1f}s.")
            raise ConnectionError("Could not connect to PLC", conn)
    
    return conn


def _build_read_blocks(tags: list[Tag], max_gap=8, max_size=128) -> list[ReadBlock]:
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

        # First block
        block_tags = [channel_tags[0]]
        block_start = channel_tags[0].address
        block_end = block_start + channel_tags[0].get_read_count()

        # Create or extend blocks
        for tag in channel_tags[1:]:
            length = tag.get_read_count()

            close_enough = (tag.address - block_end) <= max_gap
            within_size = (tag.address + length - block_start) <= max_size

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

    read_func = {
        Tag.ChannelChoices.COIL: client.read_coils,
        Tag.ChannelChoices.DISCRETE_INPUT: client.read_discrete_inputs,
        Tag.ChannelChoices.HOLDING_REGISTER: client.read_holding_registers,
        Tag.ChannelChoices.INPUT_REGISTER: client.read_input_registers,
    }[block.tags[0].channel]

    # Get register data for this block
    try:
        rr = await read_func(block.start, count=block.length, device_id=0)
    except Exception as e:
        logger.error(f"Error reading block: {e}")
        return
    
    if rr.isError():
        logger.error(f"Modbus error while reading block starting at {block.start} (Tags: {block.tags})")
        return
    
    if len(rr.registers) > 0:
        block_data = rr.registers
    elif len(rr.bits) > 0:
        block_data = rr.bits
    else:
        logger.error("Modbus response contained no data")
        return

    # For each tag, get the associated value found in the register data 
    for tag in block.tags:
        try:
            # Get memory
            offset = tag.address - block.start
            length = tag.get_read_count() #TODO

            if offset + length > len(block_data):
                logger.error(f"Tag {tag} out of bounds in block read")
                continue
            
            raw_slice = block_data[offset : offset + length]

            # Convert the register data into typed value
            if len(rr.registers) > 0:
                values = client.convert_from_registers(
                    raw_slice, 
                    data_type=tag.pymodbus_datatype,
                    word_order=tag.device.word_order
                )
                # Handle bit-indexing
                if tag.is_bit_indexed:
                    values = bool((values >> tag.bit_index) & 1)

            elif len(rr.bits) > 0:
                values = raw_slice if tag.read_amount > 1 else raw_slice[0]

            # Update tag
            if tag.current_value != values:
                tag.current_value = values
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
            #TODO 

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
        logger.error(f"Data type mismatch in {tag}: trying to write {values} with type {tag.data_type}")
        return

    # Write the list to the device registers
    match tag.channel:
        case Tag.ChannelChoices.HOLDING_REGISTER:
            # Bitmask write
            if tag.is_bit_indexed:           
                bit_mask = 1 << tag.bit_index
                and_mask = 0xFFFF ^ bit_mask
                or_mask = bit_mask if values[0] else 0x0000
                result = await client.mask_write_register(address=tag.address, and_mask=and_mask, or_mask=or_mask, device_id=tag.unit_id)

            # Normal direct write
            else:
                registers = client.convert_to_registers(values, data_type=tag.pymodbus_datatype, word_order=tag.device.word_order)
                result = await client.write_registers(tag.address, registers, device_id=tag.unit_id)

        case Tag.ChannelChoices.COIL:
            result = await client.write_coils(tag.address, values, device_id=tag.unit_id)

        case _:
            logger.error("Tried to write with a read-only tag")
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