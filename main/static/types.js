/** @typedef {'coil' | 'di' | 'hr' | 'ir'} ChannelType */
/** @typedef {'bool' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64' | 'float32' | 'float64' | 'string'} DataType */
/** @typedef {'low' | 'high' | 'crit'} ThreatLevel */
/** @typedef {'tcp' | 'udp' | 'rtu'} DeviceProtocol */
/** @typedef {'big' | 'little'} DeviceWordOrder */
/** @typedef {'bool' | 'int' | 'number' | 'text' | 'color' | 'select' | 'enum' | 'time'} InspectorDataType */

/**
 * Object for storing an html option
 * @typedef {Object} ChoiceObject
 * @property {string} value The choice value
 * @property {string} label The choice name
 */

/**
 * Object for storting server data
 * @typedef {Object} ServerCacheObject
 * @property {Record<string, TagObject>} tags All tags registered on the server
 * @property {Record<string, AlarmConfigObject>} alarms All alarms registered on the server
 * @property {Record<string, ScheduleObject>} schedules All schedules registered on the server
 * @property {DeviceListObject[]} devices All devices registered on the server
 * @property {TagOptionsObject} tagOptions Choice collection for tag attributes
 * @property {AlarmOptionsObject} alarmOptions Choice collection for alarm attributes
*/

/** 
 * Defines a widget config property editable in the Inspector
 * @typedef {Object} InspectorFieldDefinition
 * @property {string} [name] Widget config attribute to read/write to
 * @property {InspectorDataType} type
 * @property {*} default The attribute to apply to the widget config if undefined
 * @property {string} label The text to display above the input
 * @property {string} [description] The html title to apply to the label
 * @property {ChoiceObject[]} [options]
 */

/**
 * @typedef {Object} ScheduleObject
 * @property {string} alias Name of the schedule
 * @property {string} tag The UUID of the tag
 * @property {*} write_value The value to write to the tag
 * @property {string} time The time of day the value should be written
 * @property {boolean[]} days The days of the week to enable
 * @property {boolean} enabled If the scheduled write should occur
 */

/**
 * Object recieved from `api.serializers.AlarmSerializer` through `/api/alarms/${external_id}`
 * @typedef {Object} AlarmConfigObject
 * @property {string} tag The UUID of the tag
 * @property {string} external_id The UUID of the alarm config
 * @property {*} trigger_value Value to compare with
 * @property {'equals' | 'greater_than' | 'less_than'} operator Operator for comparing tag value with trigger_value
 * @property {boolean} enabled If the alarm is triggerable
 * @property {string} alias Name of the alarm config
 * @property {string} message Message that subscribers to the alarm recieve
 * @property {ThreatLevel} threat_level The urgency of the alarm
 */

/**
 * Object recieved from `api.serializers.ActivatedAlarmSerializer` through `/api/activated-alarms/`
 * @typedef {Object} ActivatedAlarmObject
 * @property {string} config The UUID of this activation's alarm config
 * @property {boolean} is_active If the alarm is on
 * @property {boolean} acknowledged If the alarm has been marked as heard by a user
 * @property {string} acknowledged_by_username The user who heard the alarm, if any
 * @property {string} acknowledged_at The time the alarm was heard, if any
 * @property {string} timestamp The time the alarm was activated
 * @property {string} resolved_at The time the alarm was resolved, if any
 */

/**
 * Object recieved from `api.serializers.TagValueSerializer` through `/api/values/tags=${tag1},${tag2}...`
 * @typedef {Object} TagValueObject
 * @property {string} id The UUID of the tag
 * @property {string|number|boolean} value The current value of the tag
 * @property {number} age The age in seconds of the tag value
 * @property {string} alarm The alarm ID associated with this tag, if active
 */

/**
 * Object recieved from `api.serializers.TagSerializer` through `/api/tags/${external_id}/`
 * @typedef {Object} TagObject
 * @property {string} device The device alias
 * @property {string} external_id The UUID of the tag
 * @property {string} alias Human readable name (e.g. "Sump Level")
 * @property {string} description Longer description
 * @property {DataType} data_type How the value from the PLC memory is interpreted
 * @property {ChannelType} channel The register type
 * @property {number} address The 0-indexed starting register
 * @property {number} [bit_index] Optional bit index (0-15)
 * @property {number} history_retention Number of seconds that the value is stored in the DB
 * @property {number} history_interval Number of seconds between history value stores
 * @property {boolean} is_active If the tag can read/write data
 * @property {boolean} restricted_write If the tag value should be protected from non-staff users
 */

/**
 * Object recieved from `api.serializers.DeviceSerializer` through `/api/devices/`
 * @typedef {Object} DeviceObject
 * @property {string} alias Unique name of device
 * @property {DeviceProtocol} protocol The type of Modbus connection
 * @property {string} ip_address IP used for Modbus connection
 * @property {string} port Port used for Modbus connection
 * @property {DeviceWordOrder} word_order Endianness of multi-byte data in the device
 */

/**
 * Object recieved from `api.views.TagMetadataView` through `/api/tag-options/`
 * @typedef {Object} TagOptionsObject
 * @property {ChoiceObject[]} channels Choices for tag channels
 * @property {ChoiceObject[]} data_types Choices for tag datatypes
 */

/**
 * Object recieved from `api.views.AlarmMetadataView` through `/api/alarm-options/`
 * @typedef {Object} AlarmOptionsObject
 * @property {ChoiceObject[]} operator_choices Choices for alarm comparison operators
 * @property {ChoiceObject[]} threat_levels Choices for alarm threat levels
 */

/**
 * Object recieved from `api.serializers.DashboardSerializer` through `/api/dashboards/${alias}`
 * @typedef {Object} DashboardObject
 * @property {string} alias The slug field used for routing - unique to the owner
 * @property {string} title The display name
 * @property {string} description User given description of dashboard, if any
 * @property {number} column_count The number of columns in the GridStack grid
 */

/**  
 * Object recieved from `api.serializers.DashboardWidgetSerializer` through `/api/dashboard-widgets/?dashboard=${alias}`
 * @typedef {Object} DashboardWidgetInfoObject
 * @property {string} tag The UUID of the tag assigned to the widget
 * @property {string} widget_type The name of the widget class (mapped in `WidgetRegistry` in `widgets.js`)
 * @property {Object} config The config object of the widget (position, scale, default and custom fields)
 */

/**
 * Object used in `api.views.DashboardViewSet.save_data` through `/api/dashboards/${alias}/save-data/`
 * @typedef {DashboardObject & { widgets: DashboardWidgetInfoObject[] }} DashboardConfigObject
 */

export {};