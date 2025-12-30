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

## Screenshots
<details>
<summary>Example Dashboard</summary>
<img width="1746" height="1207" alt="s1" src="https://github.com/user-attachments/assets/07354ef0-375b-4d1b-b235-9f830d9b4fbb" />
<br></br>
<img width="1746" height="1200" alt="s2" src="https://github.com/user-attachments/assets/2d765b75-4543-4796-ba7b-e0bdeaa881cc" />
</details>

## Implementation Info

#### Backend
The poller runs in the same event loop as the Django/Uvicorn server, reading blocks of data from registered devices based on Tags. Info about updated Tags are sent to the WebSocket consumer. The poller also processes write requests and alarms each cycle. An ActivatedAlarm object is created if a Tag value meets the criteria of an AlarmConfig. Endpoints are handled by django-rest-framework.


#### Frontend
Each widget is defined by its GridStack element HTML, and Widget subclass. When loading a dashboard, widget config is fetched and those objects are created. When entering view mode, Widgets are registered with the dashboard TagListener, which fetches initial needed values then sets up a WebSocket, propagating new values as they are recieved. Submitting a value through an InputWidget creates a TagWriteRequest object in the database.

## Disclaimer
This is an early stage hobbyist/educational project so I don't recommend this for any safety-critical or professional environment. It is also not feature-rich like other SCADA tools and has a lot of things unimplemented or unfinished
