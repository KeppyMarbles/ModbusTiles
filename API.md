# API endpoints
The following describes the API available in the server.

## Device
Requires authentication. Writes require admin.

### `GET`, `POST` /api/devices/
List all devices or create a device in the form of [DeviceObject](#deviceobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/devices/{alias}/
Get or update a specific device in the form of [DeviceObject](#deviceobject).

### `GET` /api/tag-options/
Retrieve valid choices for the choice fields of Device in the form of [DeviceOptionsObject](#deviceoptionsobject).

## Tag
Requires authentication. Writes require admin.
Read-only fields: `external_id`

### `GET` /api/tags/?device={alias}/
Get a list of tags in the form of [TagObject](#tagobject)[], optionally specifying a device alias.

### `POST` /api/tags/
Create a tag in the form of [TagObject](#tagobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/tags/{external_id}/
Get or update a specific tag in the form of [TagObject](#tagobject).

### `GET` /api/tag-options/
Retrieve valid choices for the choice fields of Tag in the form of [TagOptionsObject](#tagoptionsobject).

### `GET` /api/values/?tags={external_ids}
Retrieve a list of values for the specified tags in the form of [TagValueObject](#tagvalueobject)[].

### `GET` /api/history/?tags={external_ids}&seconds={seconds}/
Retrieve a list of history entries for the specified tag in the form of [TagHistoryObject](#taghistoryobject)[], optionally specifying a cutoff age.

## Dashboard
Requires authentication. Can only view your own dashboards.
Alias field is made unique automatically.
Read-only fields: `alias`

### `GET`, `POST` /api/dashboards/
List all dashboards or create a dashboard in the form of [DashboardObject](#dashboardobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/dashboards/{alias}/
Get or update a specific dashboard in the form of [DashboardObject](#dashboardobject).

### `POST` /api/dashboards/{alias}/save-data/
Update a dashboard using formData, with properties of [DashboardConfigObject](#dashboardconfigobject). Can also append a `preview_image`. Response:
```typescript
{ new_alias: string }
```

## Dashboard Widget
Requires authentication. Can only view your own widgets.

### `GET` /api/dashboard-widgets/?dashboard={alias}/
List all widgets in the form of [DashboardWidgetInfoObject](#dashboardwidgetinfoobject)[], optionally specifying a dashboard alias.

## Schedule
Requires authentication. Writes require admin.

### `GET` /api/schedules/?tag={external_id}/
Get a list of schedules in the form of [ScheduleObject](#scheduleobject)[], optionally specifying a tag id.

### `POST` /api/schedules/
Create a schedule in the form of [ScheduleObject](#scheduleobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/schedules/{external_id}/
Get or update a specific schedule in the form of [ScheduleObject](#scheduleobject).

## Alarm Config
Requires authentication. Writes require admin.

### `GET` /api/alarms?tag={external_id}/
Get a list of alarm configs in the form of [AlarmConfigObject](#alarmconfigobject)[], optionally specifying a tag id.

### `POST` /api/alarms/
Create an alarm config in the form of [AlarmConfigObject](#alarmconfigobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/alarms/{external_id}/
Get or update a specific alarm config in the form of [AlarmConfigObject](#alarmconfigobject).

### `GET` /api/alarm-options/
Retrieve valid choices for the choice fields of Alarm Config in the form of [AlarmOptionsObject](#alarmoptionsobject).

## Activated Alarm
Requires authentication.

### `GET`, /api/activated-alarms/
List all activated alarms in the form of [ActivatedAlarmObject](#activatedalarmobject)[].

### `GET`, /api/activated-alarms/active_count/
Get the number of currently active alarms. Response:
```typescript
{ count: number }
```

### `POST`, /api/activated-alarms/{id}/acknowledge/
Acknowledge an alarm.

## Write Requests
Requires authentication. Updates and deletion requires admin. Can only see your own write requests.
Read-only fields: `timestamp`, `processed`, `failed`

### `GET`, `POST` /api/write-requests/
List all write requests or create a write request in the form of [TagWriteRequestObject](#tagwriterequestobject).

### `GET`, `PUT`, `PATCH`, `DELETE` /api/write-requests/{id}/
Get or update a specific write request in the form of [TagWriteRequestObject](#tagwriterequestobject).

# Data types
The following describes a set of object data types used in the API.

### ChannelType
The modbus channel used for a tag.
```typescript
'coil' | 'di' | 'hr' | 'ir'
```

### DataType
The data type of a tag.
```typescript
'bool' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64' | 'float32' | 'float64' | 'string'
```

### ThreatLevel
The threat level of an alarm.
```typescript
'low' | 'high' | 'crit'
```

### DeviceProtocol
The communication protocol used by a device.
```typescript
'tcp' | 'udp' | 'rtu'
```

### DeviceWordOrder
The word order used by a device.
```typescript
'big' | 'little'
```

### ScheduleObject
Contains the definition of a schedule.
```typescript
{
    alias: string,
    tag: string, // UUID of tag to affect
    external_id: string,
    write_value: any,
    time: string, // Time of day to write the value
    days: boolean[], // Days of the week to enable
    enabled: boolean,
}
```

### AlarmConfigObject
Contains metadata about an alarm configuration.
```typescript
{
    tag: string, // UUID of tag watched
    external_id: string,
    trigger_value: any, // Value to compare
    operator: 'equals' | 'greater_than' | 'less_than', // How to compare the tag value with the trigger value
    enabled: boolean,
    alias: string,
    message: string,
    threat_level: ThreatLevel,
}
```

### ActivatedAlarmObject
Contains metadata about an activated alarm.
```typescript
{
    config: string, // UUID of the alarm config
    is_active: boolean,
    acknowledged: boolean,
    acknowledged_by_username: string,
    acknowledged_at: string,
    timestamp: string,
    resolved_at: string,
}
```

### TagValueObject
Contains data about a tag's current value.
```typescript
{
    id: string, // UUID of the tag
    value: string | number | boolean,
    age: number, // Age in seconds of the tag value
    alarm: string, // Alarm config UUID if an alarm for this is currently active
}
```

### TagHistoryObject
Contains a time/value pair.
```typescript
{
    timestamp: string,
    value: any,
}
```

### TagWriteRequestObject
Contains metadata about a tag write request.
```typescript
{
    tag: string,
    value: any,
    timestamp: string,
    processed: boolean,
    failed: boolean,
}
```

### TagObject
Contains metadata about a tag.
```typescript
{
    device: string, // Alias of device
    external_id: string,
    alias: string,
    description: string,
    data_type: DataType,
    channel: ChannelType,
    address: number,
    bit_index?: number, // Bit to index if using boolean data type on non-boolean channel
    history_retention: number, // Max age of history entries in seconds
    history_interval: number, // Interval to save history entries in seconds
    is_active: boolean,
    restricted_write: boolean, // If the value should be write protected from non-staff users
}
```

### DeviceObject
Contains metadata about a device.
```typescript
{
    alias: string,
    protocol: DeviceProtocol,
    ip_address: string,
    port: string,
    word_order: DeviceWordOrder,
}
```

### DashboardObject
Contains metadata about a user dashboard.
```typescript
{
    alias: string,
    title: string,
    description: string,
    column_count: string,
}
```

### DashboardWidgetInfoObject
Contains metadata about a specific widget on a dashboard.
```typescript
{
    tag: string, // UUID of the tag assigned to the widget
    widget_type: string, // Name of the widget class
    config: Object,
}
```

### DashboardConfigObject
Contains dashboard metadata as well as all of its widget data.
```typescript
DashboardObject & {
    widgets: DashboardWidgetInfoObject[]
}
```