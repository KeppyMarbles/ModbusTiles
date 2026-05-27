import asyncio
import time
import logging
import json
from dataclasses import dataclass
from collections import defaultdict
from django.utils import timezone
from django.db import connection
from pymodbus.client import AsyncModbusTcpClient, AsyncModbusUdpClient
from pymodbus.client.base import ModbusBaseClient
from channels.db import database_sync_to_async
from ..models import Device, Tag, TagWriteRequest, AlarmConfig, ActivatedAlarm
from ..api.serializers import TagValueSerializer


@dataclass
class ReadBlock:
    start: int
    length: int
    tags: list[Tag]


@dataclass
class PollContext:
    updated_tags: dict[int, Tag]
    read_tags: dict[int, Tag]


@dataclass
class DeviceState:
    failures: int = 0
    next_retry: float = 0.0
    disabled_until: float = 0.0
    total_duration: float = 0.0
    iteration_count: int = 0


logger = logging.getLogger(__name__)
clients: dict[int, ModbusBaseClient] = {}
device_states: dict[int, DeviceState] = defaultdict(DeviceState)


async def poll_devices(ws_queue: asyncio.Queue = None, poll_interval=0.25, refresh_interval=5, info_interval=30):
    """ Reconcile active devices and manage device tasks """
    
    @database_sync_to_async
    def get_active_device_ids() -> list[int]:
        return list(Device.objects.filter(is_active=True).values_list('id', flat=True))
    
    async def log_performance():
        """ Periodically reports performance metrics across all active devices """
        while True:
            await asyncio.sleep(info_interval)
            for alias, state in list(device_states.items()):
                if state.iteration_count == 0:
                    continue
                
                avg = state.total_duration / state.iteration_count
                utilization = (avg / poll_interval) * 100 if poll_interval > 0 else 0
                
                msg = f"Device [{alias}] -> Avg Poll: {avg:.3f}s ({utilization:.1f}% capacity) over {state.iteration_count} cycles"
                
                if avg > poll_interval:
                    logger.warning(f"[OVERLOAD] {msg}")
                else:
                    logger.info(msg)
                
                # Reset metrics for the next interval window
                state.total_duration = 0.0
                state.iteration_count = 0

    logger.info("Starting Async Poller Supervisor...")
    
    poll_queue = asyncio.Queue()
    writer_task = asyncio.create_task(_db_and_ws_write(ws_queue, poll_queue))
    perf_task = asyncio.create_task(log_performance())
    
    device_tasks = {}
    
    try:
        while True:
            if writer_task.done():
                exc = writer_task.exception()
                if exc:
                    raise exc
                raise RuntimeError("WebSocket writer task stopped unexpectedly.")

            active_ids = await get_active_device_ids()
            active_set = set(active_ids)
            
            # Cancel tasks for devices that are no longer active
            for d_id, task in list(device_tasks.items()):
                if d_id not in active_set:
                    task.cancel()
                    del device_tasks[d_id]
            
            # Start tasks for newly active devices
            for d_id in active_ids:
                if d_id not in device_tasks:
                    device_tasks[d_id] = asyncio.create_task(
                        _poll_single_device_loop(d_id, poll_queue, poll_interval, refresh_interval)
                    )
            
            await asyncio.sleep(refresh_interval)
            
    finally:
        logger.info("Poller supervisor cancelled. Stopping tasks...")
        for task in device_tasks.values():
            task.cancel()
        writer_task.cancel()
        perf_task.cancel()


async def _db_and_ws_write(ws_queue: asyncio.Queue | None, poll_queue: asyncio.Queue):
    """ Read from the queue, merge updates, save to DB, and send updates over WebSocket """

    @database_sync_to_async
    def get_tag_data(updated_tags: list[Tag]):
        serialized = TagValueSerializer(
            updated_tags, many=True, 
            context={"alarm_map": ActivatedAlarm.get_tag_map(updated_tags)}
        )
        return serialized.data

    @database_sync_to_async
    def perform_db_update(updated_tags, read_tags):
        connection.ensure_connection()
        if read_tags:
            Tag.objects.bulk_update(read_tags, ['last_updated'])
        if updated_tags:
            Tag.objects.bulk_update(updated_tags, ['current_value'])
            Tag.bulk_create_history(updated_tags)
            AlarmConfig.update_alarms(updated_tags)

    while True:
        first_context: PollContext = await poll_queue.get()
        items_count = 1
        
        while not poll_queue.empty():
            try:
                next_context: PollContext = poll_queue.get_nowait()
                first_context.updated_tags.update(next_context.updated_tags)
                first_context.read_tags.update(next_context.read_tags)
                items_count += 1
            except asyncio.QueueEmpty:
                break
        
        updated_list = list(first_context.updated_tags.values())
        read_list = list(first_context.read_tags.values())

        if updated_list or read_list:
            try:
                await perform_db_update(updated_list, read_list)
            except Exception as e:
                logger.error(f"Error performing DB updates in poller: {e}")
        
        if updated_list and ws_queue is not None and getattr(ws_queue, "connected", False):
            try:
                tag_data = await get_tag_data(updated_list)
                msg = json.dumps({"type": "tag_update", "updates": tag_data})
                await ws_queue.put(msg) 
                
            except Exception as e:
                logger.error(f"Error preparing updates or serialization: {e}")

        for _ in range(items_count):
            poll_queue.task_done()


async def _poll_single_device_loop(device_id: int, queue: asyncio.Queue, poll_interval: float, refresh_interval: float):
    """ Loop specific to one device. """
    
    @database_sync_to_async
    def fetch_device(d_id: int):
        return Device.objects.prefetch_related('tags').filter(id=d_id).first()

    last_fetch = None

    try:
        while True:
            start_time = time.perf_counter()
            
            # Refresh device and tags config periodically
            if last_fetch is None or time.perf_counter() - last_fetch > refresh_interval:
                device = await fetch_device(device_id)
                state = device_states[device.id]
                if last_fetch is None:
                    logger.info(f"Started polling loop for {device}")
                last_fetch = time.perf_counter()
            
            context = PollContext(updated_tags={}, read_tags={})
            await _poll_device(device, context)
            await queue.put(context)
                
            elapsed = time.perf_counter() - start_time
            if elapsed > poll_interval:
                logger.warning(f"{device} poll took {elapsed:.3f}s, exceeding interval of {poll_interval}s.")

            state.total_duration += elapsed
            state.iteration_count += 1
                
            sleep_time = max(0, poll_interval - elapsed)
            await asyncio.sleep(sleep_time)
            
    except asyncio.CancelledError:
        logger.info(f"Polling loop for {device} cancelled.")
        raise


async def _poll_device(device: Device, context: PollContext):
    """ Process read and writes for a device """
    if time.monotonic() < device_states[device.id].disabled_until:
        return
    
    try:
        client = await _get_client(device)
    except Exception as e:
        logger.warning(f"Couldn't connect to device {device}: {e}")
        return
    
    await _process_writes(client, device, context)
    
    tags: list[Tag] = [t for t in device.tags.all() if t.is_active]

    for block in _build_read_blocks(tags):
        await _process_block(block, client, context)


async def _get_client(device: Device, base_backoff_seconds=2, max_backoff_seconds=60) -> ModbusBaseClient | None:
    """Get or create a persistent client connection"""

    state = device_states[device.id]
    conn = clients.get(device.id)

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
            clients[device.id] = conn
            logger.info(f"Established connection: {conn}")
        else:
            state.failures += 1

            backoff = min(base_backoff_seconds * (2 ** (min(state.failures, 32) - 1)), max_backoff_seconds)
            state.disabled_until = time.monotonic() + backoff

            logger.warning(f"{device} unreachable. Trying again in {backoff:.1f}s.")
            raise ConnectionError("Could not connect to PLC", conn)
    
    return conn


def _build_read_blocks(tags: list[Tag], max_gap=8, max_size=125) -> list[ReadBlock]:
    """ Create blocks of contiguous registers in memory """

    # Group tags by channel
    grouped_tags = defaultdict(list[Tag])
    for tag in tags:
        grouped_tags[tag.channel].append(tag)

    blocks = []

    for channel, channel_tags in grouped_tags.items():
        if not channel_tags:
            continue
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
                context.updated_tags[tag.id] = tag
            
            tag.last_updated = timezone.now()
            context.read_tags[tag.id] = tag

        except Exception as e:
            logger.error(f"Error processing {tag}: {e}")


async def _process_writes(client, device: Device, context: PollContext):
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
        TagWriteRequest.objects.bulk_update(requests, ['processed', 'failed'])

    writes = await get_pending_writes(device)

    if not writes:
        return

    for req in writes:
        # Try to actually write the requested value
        try:
            await _write_value(client, req.tag, req.value)
            logger.info(f"Processed write request for tag {req.tag}")

        except Exception as e:
            logger.error(f"Write failed for {req.tag}: {e}")
            req.failed = True
            context.updated_tags[req.tag.id] = req.tag # Send the client an update so their value is reset

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
            case Tag.DataTypeChoices.INT16 | Tag.DataTypeChoices.UINT16 | Tag.DataTypeChoices.INT32 | Tag.DataTypeChoices.UINT32  | Tag.DataTypeChoices.INT64 | Tag.DataTypeChoices.UINT64:
                values = [int(value) for value in values]
            case Tag.DataTypeChoices.FLOAT32 | Tag.DataTypeChoices.FLOAT64:
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