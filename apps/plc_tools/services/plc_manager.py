import threading, time
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ConnectionException, ModbusIOException
from ..models import PLCRegister
from django.utils import timezone

class PLCManager:
    def __init__(self, host="127.0.0.1", port=502):
        self.host = host
        self.port = port
        self.client = None
        self.running = False
        self.data = {}
        self.last_error = None
        self.read_count = 5

    def connect(self):
        from pymodbus.client import ModbusTcpClient
        self.client = ModbusTcpClient(self.host, port=self.port)
        if not self.client.connect():
            raise ConnectionError("Could not connect to PLC")

    def start_polling(self, rate):
        if self.running:
            print("PLC already being polled...")
            return
        try:
            self.connect()
        except Exception as e:
            self.last_error = str(e)
            print(f"PLCManager: connection failed: {e}")
            return
        self.running = True
        threading.Thread(target=self._poll_loop, args=(rate,), daemon=True).start()

    def _poll_loop(self, rate):
        while self.running:
            try:
                if not self.client:
                    time.sleep(2)
                    continue
                rr = self.client.read_holding_registers(0, count=self.read_count)
                if rr.isError():
                    self.last_error = str(rr)
                    time.sleep(2)
                    continue
                    
                for addr, val in enumerate(rr.registers):
                    PLCRegister.objects.create(
                        plc_name="MainPLC",
                        address=addr,
                        value=val,
                        timestamp=timezone.now(),
                    )
                    
                self.data = rr.registers
                print("Read PLC data")
                
                self.last_error = None
            except (ConnectionException, ModbusIOException) as e:
                print(f"PLC connection error: {e}")
            except Exception as e:
                print(f"Unexpected error: {e}")
            time.sleep(rate)
            
    def stop_polling(self):
        self.running = False
        self.client.close()

    def get_registers(self):
        return self.data

    def write_register(self, address, value):
        self.client.write_register(address, value)

    #def get_status(self):
    #    return {
    #        "connected": self.client is not None,
    #        "last_error": self.last_error,
    #        "registers": self.data,
    #    }
    
plc_manager = PLCManager()
print("Created PLC Manager")