# ModbusTiles
Interact with your PLCs through a web browser.

## Features
- User friendly layout editing via GridStack and a widget palette
- Real-time dashboard updates via WebSockets
- Asynchronous multi-device polling via pymodbus
- Reading/writing to user defined tags for Registers, Coils, and Discrete Inputs
- Configurable alarm states for tags
- Data persistence for tag values, tag writes, and alarm activations

## Usage
Run the setup script or a similar command set. Start the server using `python manage.py run_server` in the venv, then visit the admin page to register a device running on your local network. Go to the home page to create a new dashboard.

You can also run the test scripts to create a mock dashboard and run the simulated PLC.