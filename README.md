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
Run the setup script or a similar command set. Start the server and poller in the venv, then visit the admin page to register a device running on your local network. Go to the home page to create a new dashboard.

You can also run the test scripts to create a mock dashboard and run the simulated PLC.

See API guide [here](API.md).

#### Custom commands
```
python manage.py run_server [OPTIONS]

Description: start the web server, database cleanup loop, and schedule engine.
Options:
    --port
        The port to use for the Django server. [Default: 8000]
    --cleanup-interval
        Target loop period (in seconds) for deleting expired entries from the database. [Default: 60]
```
```
python manage.py run_poller [OPTIONS]

Description: start the PLC poller service. Connects to the server via WebSockets to stream updates.
Options:
    --host
        The host of the Django server. [Default: localhost]
    --port
        The port of the Django server. [Default: 8000]
    --poll-interval
        Target loop period (in seconds) for reading data from Devices. [Default: 0.25]
    --refresh-interval
        Loop period (in seconds) for refreshing Device and Tag configuration. [Default: 5]
```
```
python manage.py run_simulation [OPTIONS]

Description: start a pymodbus soft PLC for testing.
Options:
    --interval
        Target tick period. Does nothing on the default simulator. [Default: 0.1]
    --size
        Amount of bytes to allocate for each channel. [Default: 8192]
```

## Screenshots
<details>
<summary>Example Dashboard</summary>
<img width="1746" height="1207" alt="s1" src="https://github.com/user-attachments/assets/07354ef0-375b-4d1b-b235-9f830d9b4fbb" />
<br></br>
<img width="1746" height="1200" alt="s2" src="https://github.com/user-attachments/assets/2d765b75-4543-4796-ba7b-e0bdeaa881cc" />
</details>

## Implementation Info

#### Backend
The poller runs as a standalone process, connecting to the main Django/Uvicorn server via a secure WebSocket connection. It reads blocks of data from registered devices based on Tags and pushes updates. The server receives these updates and forwards them to frontend WebSocket consumers. The poller also processes write requests and alarms each cycle. An ActivatedAlarm object is created if a Tag value meets the criteria of an AlarmConfig. Endpoints are handled by django-rest-framework.

#### Frontend
Each widget is defined by its GridStack element HTML, and Widget subclass. When loading a dashboard, widget config is fetched and those objects are created. When entering view mode, Widgets are registered with the dashboard TagListener, which fetches initial needed values then sets up a WebSocket, propagating new values as they are recieved. Submitting a value through an InputWidget creates a TagWriteRequest object in the database.

## Disclaimer
This is an early stage hobbyist/educational project so I don't recommend this for any safety-critical or professional environment. It is also not feature-rich like other SCADA tools and has a lot of things unimplemented or unfinished. If using in production, remember to disable debug mode and create a new secret key (in `settings.py`).
