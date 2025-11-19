import time
import random
from threading import Thread
from pymodbus.server import StartTcpServer
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusDeviceContext,
    ModbusServerContext
)

store = ModbusDeviceContext(
    di=ModbusSequentialDataBlock(0, [0] * 100),
    co=ModbusSequentialDataBlock(0, [0] * 100),
    hr=ModbusSequentialDataBlock(0, [0] * 100),
    ir=ModbusSequentialDataBlock(0, [0] * 100),
)
context = ModbusServerContext(devices=store, single=True)


def test_oscillate_input(context, input_addr=0, interval=1):
    """ Toggle an input on/off forever """
    state = 0
    while True:
        state ^= 1  # toggle
        context[0].setValues(2, input_addr, [state])
        print(f"[Oscillate Input] Input {input_addr} -> {state}")
        time.sleep(interval)


def test_random_registers(context, start=0, count=5, interval=2):
    """ Write random values (0-100) to input registers """
    while True:
        values = [random.randint(0, 100) for _ in range(count)]
        context[0].setValues(4, start, values)
        print(f"[Random Registers] IR[{start}:{start+count}] = {values}")
        time.sleep(interval)


def test_ramp_register(context, reg=0, min_val=0, max_val=100, step=1, interval=0.5):
    """ Increment a register up/down like a sawtooth waveform """
    value = min_val
    direction = 1

    while True:
        context[0].setValues(4, reg, [value])
        print(f"[Ramp Register] IR[{reg}] = {value}")

        value += direction * step

        if value >= max_val:
            direction = -1
        elif value <= min_val:
            direction = 1

        time.sleep(interval)


def start_test_routine(func, *args, **kwargs):
    th = Thread(target=func, args=args, kwargs=kwargs, daemon=True)
    th.start()
    print(f"Started test routine: {func.__name__}")
    return th


if __name__ == "__main__":
    
    start_test_routine(test_oscillate_input, context, input_addr=0, interval=1)
    start_test_routine(test_oscillate_input, context, input_addr=1, interval=5)
    start_test_routine(test_ramp_register, context, reg=0, min_val=0, max_val=100, step=5, interval=0.5)
    start_test_routine(test_ramp_register, context, reg=1, min_val=0, max_val=100, step=5, interval=0.2)
    
    StartTcpServer(context, address=("127.0.0.1", 502))
    print("Started PLC server")