import random, time
from threading import Thread
from pymodbus.server import StartTcpServer
from pymodbus.datastore import ModbusSequentialDataBlock, ModbusDeviceContext, ModbusServerContext

store = ModbusDeviceContext(
    di=ModbusSequentialDataBlock(0, [0]*100),   # Discrete Inputs
    co=ModbusSequentialDataBlock(0, [0]*100),   # Coils
    hr=ModbusSequentialDataBlock(0, [0]*100),   # Holding Registers
    ir=ModbusSequentialDataBlock(0, [0]*100),   # Input Registers
)
context = ModbusServerContext(devices=store, single=True)

def update_values(context):
    while True:
        slave_id = 0
        block = 3
        
        values = context[slave_id].getValues(block, 0, count=5)

        for i in range(len(values)):
            values[i] = random.randint(0, 10)

        context[slave_id].setValues(block, 0, values)

        print("Updated holding registers:", values, "...")
        time.sleep(2)

Thread(target=update_values, args=(context,), daemon=True).start()
print("Starting PLC server")
StartTcpServer(context, address=("127.0.0.1", 502))
