import { serverCache, requestServer } from "./global.js";
/** @import { InspectorFieldDefinition, ChoiceObject, DataType, TagObject, ChannelType, InspectorDataType, AlarmConfigObject, ScheduleObject } from "./types.js" */
/** @import { Widget } from "./widgets.js" */
/** @import { Dashboard } from "./dashboard.js" */

//TODO might need some refactoring... we use very similar code for tag-dependent fields, create/edit/delete api calls for each object

/**
 * Manages a form to edit widgets and dashboards, or create tags and alarms
 */
export class Inspector {
    /**
     * @param {HTMLElement} container 
     */
    constructor(container) {
        /**@type {HTMLElement} The element used to display the form */
        this.container = container;
    }

    /**
     * @param {DataType} dataType 
     * @returns {InspectorDataType} The relevant form type from a Tag's datatype
     */
    static getFieldType(dataType) {
        if(dataType === "bool") 
            return "bool";
        else if(["int16", "uint16", "int32", "uint32", "int64"].includes(dataType)) 
            return "int";
        else if(["float32", "float64"].includes(dataType)) 
            return "number";
        else
            return "text";
    }

    /**
     * @param {TagObject} tag
     * @returns The string used for this tag in a dropdown
     */
    static getTagLabel(tag) {
        const bit = tag.bit_index !== null ? ":" + tag.bit_index : "";
        return `${tag.alias} (${tag.channel} ${tag.address}${bit})`;
    }

    /**
     * @param {AlarmConfigObject} alarm
     * @returns The string used for this alarm in a dropdown
     */
    static getAlarmLabel(alarm) {
        return `${alarm.alias}`;
    }

    /**
     * Remove all form contents
     */
    clear() {
        this.container.innerHTML = '';
    }

    /**
     * @param {string} text 
     */
    addTitle(text) {
        const title = document.createElement('p');
        title.innerText = text;
        title.className = "form-title";
        this.container.appendChild(title);
        return title;
    }

    /**
     * @param {string} title 
     */
    addSection(title) {
        const box = document.createElement('div');
        box.className = "form-box";
        box.innerText = title ? title : "";
        this.container.appendChild(box);
        return box;
    }

    /**
     * @param {string} title 
     * @param {()} callback 
     * @param {*} section 
     */
    addButton(title, callback, section) {
        const btn = document.createElement('button');
        btn.innerText = title ? title : "";
        btn.classList.add("form-button");
        btn.onclick = callback;
        if(!section)
            section = this.container;
        section.appendChild(btn);
        return btn;
    }

    /**
     * @param {InspectorFieldDefinition} def The field properties
     * @param {*} currentValue The value to set in the input
     * @param {(val: *)} [onChange] The callback that recieves the new data when input changes
     * @param {HTMLElement} [section] The element to append the field to, typically from `addSection`
     * @param {boolean} [isMixed] Whether the field has divergent values across multiple widgets
     */
    addField(def, currentValue, onChange, section, isMixed = false) {
        const wrapper = document.createElement('div');
        wrapper.className = "input-group";

        const label = document.createElement('label');
        label.innerText = def.label || def.name || "";
        label.className = "form-label";
        if(def.description) label.title = def.description;

        let inputObj;

        // Delegate rendering strategy
        if (def.type === "select")
            inputObj = this._createSelect(def.options, currentValue, def.default, isMixed, def.label);
        else if (def.type === "enum")
            inputObj = this._createEnum(currentValue, onChange, isMixed);
        else
            inputObj = this._createSimpleInput(def.type, currentValue, isMixed);

        if (def.type === "bool")
            label.classList.add("bool");

        // Hook up change listeners
        if (onChange && def.type !== "enum") {
            inputObj.element.addEventListener('change', () => {
                if (def.type === "bool") {
                    inputObj.element.indeterminate = false;
                }
                onChange(inputObj.getValue());
            });
        }

        // Add elements
        label.appendChild(inputObj.element);
        wrapper.appendChild(label);
        (section || this.container).appendChild(wrapper);

        return { wrapper, getValue: inputObj.getValue };
    }

    /**
     * 
     * @param {ChoiceObject[]} options 
     * @param {*} currentValue
     * @param {*} defaultValue
     * @param {boolean} isMixed
     * @param {string} label
     */
    _createSelect(options, currentValue, defaultValue, isMixed, label) {
        const select = document.createElement("select");
        select.classList.add("form-input");
        
        const defaultOption = document.createElement('option');
        if (isMixed) {
            defaultOption.text = "— Mixed Values —";
            defaultOption.value = "";
            defaultOption.selected = true;
        } else {
            defaultOption.text = "Select";
            defaultOption.value = defaultValue;
        }
        select.appendChild(defaultOption);

        if (options) {
            options.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.value;
                el.text = opt.display_name;
                if (!isMixed && opt.value === currentValue) el.selected = true;
                select.appendChild(el);
            });
        }

        return {
            element: select,
            getValue: () => select.value
        };
    }

    /**
     * 
     * @param {string} type 
     * @param {*} currentValue 
     * @param {boolean} isMixed
     */
    _createSimpleInput(type, currentValue, isMixed) {
        const input = document.createElement("input");
        input.classList.add("form-input");
        input.value = isMixed ? "" : (currentValue ?? "");

        if (isMixed && type !== "bool") {
            input.placeholder = "— Mixed Values —";
        }

        let getValue;

        switch (type) {
            case "bool":
                input.classList.add("bool");
                input.type = 'checkbox';
                if (isMixed) {
                    input.indeterminate = true;
                } else {
                    input.checked = !!currentValue;
                }
                getValue = () => input.checked;
                break;

            case "color":
                input.type = "color"; //TODO add clear button?
                getValue = () => input.value;
                break;

            case "int":
                input.type = "number";
                getValue = () => parseInt(input.value);
                break;

            case "number":
                input.type = "number";
                getValue = () => input.value === "" ? 0 : Number(input.value);
                break;

            case "time":
                input.type = "time";
                getValue = () => input.value;
                break;
                
            default:
                input.type = 'text';
                getValue = () => input.value;
                break;
        }

        return { element: input, getValue };
    }

    /**
     * Create an entry for managing multiple key/value pairs
     * @param {*} currentValue 
     * @param {(val: *)} onChange 
     * @param {boolean} isMixed
     * @returns 
     */
    _createEnum(currentValue, onChange, isMixed) {
        const container = document.createElement('div');
        const rowsContainer = document.createElement('div');

        const getValue = () => {
            /** @type {ChoiceObject[]} */
            const real_kvs = [];
            Array.from(rowsContainer.children).forEach(row => {
                if (row.key_input && row.value_input) {
                    real_kvs.push({
                        display_name: row.key_input.value,
                        value: row.value_input.value
                    });
                }
            });
            return real_kvs;
        };

        /**
         * Create a row for label, value, and minus button
         * @param {string} k 
         * @param {*} v 
         */
        const createRow = (k, v) => {
            const row = document.createElement('div');
            row.style.display = "flex";
            
            const keyInput = document.createElement("input");
            keyInput.className = "form-input"; 
            keyInput.placeholder = "Name"; 
            keyInput.value = k;
            
            const valInput = document.createElement("input");
            valInput.className = "form-input"; 
            valInput.placeholder = "Value"; 
            valInput.type = "number"; 
            valInput.value = v;

            const delBtn = document.createElement("button");
            delBtn.className = "form-input"; 
            delBtn.innerText = "-";
            
            // Events
            const triggerChange = () => onChange(getValue());
            keyInput.onchange = triggerChange;
            valInput.onchange = triggerChange;
            delBtn.onclick = () => { row.remove(); triggerChange(); };

            row.appendChild(keyInput);
            row.appendChild(valInput);
            row.appendChild(delBtn);

            // References for getValue
            row.key_input = keyInput;
            row.value_input = valInput;

            rowsContainer.appendChild(row);
        };

        if (isMixed) {
            const placeholder = document.createElement('div');
            placeholder.style.color = "var(--text-muted, gray)";
            placeholder.innerText = "— Mixed Choices —";
            rowsContainer.appendChild(placeholder);
        } else {
            // Init existing rows
            (currentValue || []).forEach(kv => createRow(kv.display_name, kv.value));
        }

        // Add Button
        const addBtn = document.createElement("button");
        addBtn.className = "form-input";
        addBtn.innerText = "+";
        addBtn.onclick = () => {
            if (isMixed) {
                rowsContainer.innerHTML = '';
                isMixed = false;
            }
            createRow("", "");
            if (onChange) onChange(getValue());
        };

        container.appendChild(rowsContainer);
        container.appendChild(addBtn);

        return { element: container, getValue };
    }

    /**
     * Populate the form with intersecting properties of multiple widgets
     * @param {Widget[]} widgets 
     */
    inspectWidgets(widgets) {
        this.clear();
        if (!widgets || widgets.length === 0) return;

        this.addTitle(widgets.length > 1 ? `Editing ${widgets.length} Widgets` : `Editing ${widgets[0].gridElem.title}`);

        const widgetClasses = widgets.map(w => w.constructor);
        const firstClass = widgetClasses[0];

        // Find channels allowed by ALL selected widgets
        const sharedChannels = firstClass.allowedChannels.filter(channel =>
            widgetClasses.every(wClass => wClass.allowedChannels.includes(channel))
        );

        // Find data types allowed by ALL selected widgets
        const sharedTypes = firstClass.allowedTypes.filter(type =>
            widgetClasses.every(wClass => wClass.allowedTypes.includes(type))
        );

        // Only render the tag dropdown if there is a common baseline for compatibility
        if (sharedChannels.length > 0 && sharedTypes.length > 0) {
            const tagSection = this.addSection();

            // Filter global tags down to only those matching the shared criteria
            const compatibleTags = Object.values(serverCache.tags).filter(tag => {
                return sharedTypes.includes(tag.data_type) && sharedChannels.includes(tag.channel);
            });

            const tagOptions = compatibleTags.map(tag => ({
                value: tag.external_id,
                display_name: Inspector.getTagLabel(tag)
            }));

            // Determine if they currently share the same tag, or if it's mixed
            const firstTagID = widgets[0].tag?.external_id;
            const isTagMixed = !widgets.every(w => w.tag?.external_id === firstTagID);
            const currentTagValue = isTagMixed ? "" : firstTagID;
            
            const tagDef = { label: "Control Tag", type: "select", options: tagOptions };
            const onChange = (newID) => {
                const selectedTag = serverCache.tags[newID];
                widgets.forEach(w => {
                    w.tag = selectedTag;
                    w.applyConfig();
                });
            };

            this.addField(tagDef, currentTagValue, onChange, tagSection, isTagMixed);
        }

        // Compute intersecting fields across all selected widgets
        const getSharedFields = (fieldKey) => {
            return (firstClass[fieldKey] || []).filter(field =>
                widgetClasses.every(wc => (wc[fieldKey] || []).some(f => f.name === field.name))
            );
        };

        // Helper to check mixed values and render intersecting fields
        const renderFields = (fields, section) => {
            fields.forEach(field => {
                // Gather values for this field across all selected widgets
                const values = widgets.map(w => w.config[field.name]);
                const uniqueValues = new Set(values.map(v => typeof v === 'object' ? JSON.stringify(v) : v));
                const isMixed = uniqueValues.size > 1;
                const currentValue = isMixed ? "" : values[0];

                const onChange = (newVal) => {
                    widgets.forEach(w => {
                        w.config[field.name] = newVal;
                        w.applyConfig();
                    });
                };

                this.addField(field, currentValue, onChange, section, isMixed);
            });
        };

        // Render fields into their respective sections
        const customSection = this.addSection();
        const defaultSection = this.addSection();

        renderFields(getSharedFields('customFields'), customSection);
        renderFields(getSharedFields('defaultFields'), defaultSection);

        // Clean up empty section wrappers if no fields intersected
        if (customSection.children.length === 0) customSection.remove();
        if (defaultSection.children.length === 0) defaultSection.remove();
    }

    /**
     * Populate the form with properties of a given dashboard
     * @param {Dashboard} dashboard 
     */
    inspectDashboard(dashboard) { 
        this.clear();
        const title = this.addTitle("Dashboard");
        const dashboardSection = this.addSection();

        this.addField({ label: "Dashboard Name", type: "text" }, dashboard.config.title, (value) => { dashboard.config.title = value }, dashboardSection);
        this.addField({ label: "Description", type: "text" }, dashboard.config.description, (value) => { dashboard.config.description = value }, dashboardSection);

        const dashboardPropertiesSection = this.addSection();
        this.addField({ label: "Columns", type: "int" }, dashboard.config.column_count, (value) => dashboard.setColumnCount(value), dashboardPropertiesSection);

        const saveSection = this.addSection();
        this.addButton("Save Dashboard", () => dashboard.save(), saveSection);

        const ioSection = this.addSection();
        this.addButton("Import", () => dashboard.fileInput.click(), ioSection);
        this.addButton("Export", () => dashboard.exportFile(), ioSection);
    }

    /**
     * Populate the form with properties of a given tag
     * @param {TagObject} tag 
     */
    inspectTag(tag) {
        this.clear();
        const tagSelectSection = this.addSection();

        const tagOptions = Object.values(serverCache.tags).map(tag => ({ value: tag.external_id, display_name: Inspector.getTagLabel(tag) }));
        this.addField({ label: "Tag", type: "select", options: tagOptions }, tag?.external_id, (tagID) => {
            this.inspectTag(serverCache.tags[tagID])
        }, tagSelectSection);

        this.addTitle("Create or Edit Tag");

        const tagSection = this.addSection();
        const alias = this.addField({ label: "Tag Name", type: "text" }, tag?.alias, null, tagSection);
        const description = this.addField({ label: "Description (optional)", type: "text" }, tag?.description, null, tagSection)

        const locationSection = this.addSection();
        const deviceOptions = serverCache.devices.map(d => ({ value: d.alias, display_name: d.alias }));
        const device = this.addField({ label: "Device", type: "select", options: deviceOptions }, tag?.device, null, locationSection);
        const bitIndex = this.addField({ label: "Bit Index (0-15)", type: "int" }, tag?.bit_index, tag?.bit_index, locationSection);
        const restrictedWriteField = this.addField({ label: "Restricted Write", type: "bool", description: "If the tag value should be protected from non-staff users"}, tag?.restricted_write, null, locationSection);

        // Dynamic data type field - update according to channel type
        const dataTypeContainer = document.createElement('div');
        let getDataTypeValue = () => { return tag?.data_type };

        /**
         * Update the data types and bit index field if channel changes
         * @param {ChannelType} channelValue 
         */
        const onChannelChanged = (channelValue) => {
            dataTypeContainer.innerHTML = '';
            let dataTypeOptions = serverCache.tagOptions?.actions?.POST?.data_type?.choices;
            let dataTypeValue = getDataTypeValue();

            // Only show data types that are compatible with the selected channel
            if(!channelValue)
                dataTypeOptions = [];
            else if(["coil", "di"].includes(channelValue)) {
                dataTypeOptions = dataTypeOptions.filter(t => {return t.value === 'bool'});
                dataTypeValue = "bool";
            }

            // Only show read-only checkbox if it's a writable tag
            ["coil", "hr"].includes(channelValue) ? 
                restrictedWriteField.wrapper.classList.remove("hidden") :
                restrictedWriteField.wrapper.classList.add("hidden");

            /**
             * Include the bit index field if it's a boolean value on holding/input registers
             *  @param {DataType} dataTypeValue
             */ 
            const onDataTypeChanged = (dataTypeValue) => {
                dataTypeValue === "bool" && ["hr", "ir"].includes(channelValue) ?
                    bitIndex.wrapper.classList.remove("hidden") :
                    bitIndex.wrapper.classList.add("hidden");
            }
            onDataTypeChanged(dataTypeValue);

            const newField = this.addField({ label: "Data Type", type: "select", options: dataTypeOptions }, dataTypeValue, onDataTypeChanged, dataTypeContainer);
            getDataTypeValue = newField.getValue;
        }
        
        const channelOptions = serverCache.tagOptions?.actions?.POST?.channel?.choices;
        const channel = this.addField({ label: "Channel", type: "select", options: channelOptions }, tag?.channel, onChannelChanged, locationSection);
        onChannelChanged(tag?.channel) // Add data type field
        locationSection.appendChild(dataTypeContainer);
        const address = this.addField({ label: "Address", type: "int", 
                description: "The starting address of the value to read or write. 0-indexed." }, 
            tag?.address || 0, null, locationSection);

        locationSection.appendChild(bitIndex.wrapper); // Move bit index field
        locationSection.appendChild(restrictedWriteField.wrapper); // Move read-only field

        //const readAmount = this.addField({label: "Read Amount", type: "int"}, 1, null, tagSection)
        const historySection = this.addSection();
        const historyRetention = this.addField({ label: "History Retention (Seconds)", type: "int", 
                description: "The maximum age of this tag's history entries. Use 0 for no history, or -1 for infinite history" },
            tag?.history_retention || 0, null, historySection
        );
        const historyInterval = this.addField({ label: "History Write Interval (Seconds)", type: "int", 
                description: "How long the server should wait before creating a new history entry. Use 0 for highest detail"}, 
            tag?.history_interval || 0, null, historySection
        );
        
        /**
         * Post tag configuration to the server
         * @param {boolean} create Send post or put request
         */
        const tagSubmit = async (create) => {
            const payload = {
                alias: alias.getValue(),
                description: description.getValue(),
                device: device.getValue(),
                address: address.getValue(),
                channel: channel.getValue(),
                bit_index: bitIndex.wrapper.classList.contains("hidden") ? 0 : bitIndex.getValue(),
                data_type: getDataTypeValue(),
                unit_id: 1,
                //read_amount: readAmount.getValue(),
                read_amount: 1,
                history_retention: historyRetention.getValue(),
                history_interval: historyInterval.getValue(),
                is_active: true,
                restricted_write: restrictedWriteField.getValue(),
            };

            if(create) {
                requestServer('/api/tags/', 'POST', payload, (data) => {
                    alert("Tag created!");
                    serverCache.tags[data.external_id] = data;
                    this.inspectTag(data);
                });
            }
            else {
                requestServer(`/api/tags/${tag.external_id}/`, 'PUT', payload, (data) => {
                    alert("Tag changed!");
                    Object.assign(tag, data);
                    this.inspectTag(tag);
                });
            }
        };
        const createSection = this.addSection();
        this.addButton("Create New Tag", () => tagSubmit(true), createSection);

        if(tag) {
            this.addButton(`Update ${tag.alias}`, () => tagSubmit(false), createSection);

            const deleteSection = this.addSection();
            const delButton = this.addButton(`Delete ${tag.alias}`, () => {
                if(window.confirm(`Are you sure you want to delete tag ${tag.alias}?`)) {
                    requestServer(`/api/tags/${tag.external_id}/`, 'DELETE', null, async () => {
                        alert("Tag deleted.");
                        delete serverCache.tags[tag.external_id];
                        this.inspectTag(); 
                    });
                }
            }, deleteSection);
            delButton.style.color = "crimson";
        }
        //TODO we need to notify dashboard/widgets about changes
    }

    /**
     * Populate the form with properties of a given alarm
     * @param {AlarmConfigObject} alarm 
     */
    inspectAlarm(alarm) {
        this.clear();
        const alarmSelectSection = this.addSection();

        const alarmOptions = Object.values(serverCache.alarms).map(alarm => ({ value: alarm.external_id, display_name: Inspector.getAlarmLabel(alarm) }));
        this.addField({ label: "Alarm", type: "select", options: alarmOptions }, alarm?.external_id, (alarmID) => {
            this.inspectAlarm(serverCache.alarms[alarmID])
        }, alarmSelectSection);

        this.addTitle("Create or Edit Alarm");

        const alarmSection = this.addSection();
        const alias = this.addField({ label: "Alarm Name", type: "text" }, alarm?.alias, null, alarmSection);

        const triggerContainer = document.createElement('div'); 
        const operatorContainer = document.createElement('div');
        let getTriggerValue = () => null;
        let getOperatorValue = () => null;

        /**
         * Update trigger value and operator field according to selected tag datatype
         * @param {string} tagID 
         */
        const onTagChanged = (tagID) => {
            triggerContainer.innerHTML = ''; 
            operatorContainer.innerHTML = '';
            
            const tag = serverCache.tags[tagID];
            if(!tag) return;

            // Show choices for trigger operator
            let operatorChoices = serverCache.alarmOptions?.actions?.POST?.operator?.choices;
            if(tag.data_type === "bool") 
                operatorChoices = operatorChoices.filter(t => { return t.value === "equals" });

            // Create an input with the same value type as the selected tag
            const fieldType = Inspector.getFieldType(tag.data_type);

            const newOperatorField = this.addField({ label: "Operator", type: "select", options: operatorChoices}, alarm?.operator, null, operatorContainer);
            const newTriggerField = this.addField({ label: "Trigger Value", type: fieldType, 
                    description: "The value to compare with for triggering the alarm" }, 
                alarm?.trigger_value, null, triggerContainer
            );
            
            getOperatorValue = newOperatorField.getValue;
            getTriggerValue = newTriggerField.getValue;
        }
        onTagChanged(alarm?.tag);

        const tagOptions = Object.values(serverCache.tags).map(tag => ({ value: tag.external_id, display_name: Inspector.getTagLabel(tag)}));
        const tag = this.addField({ label: "Control Tag", type: "select", options: tagOptions }, alarm?.tag, onTagChanged, alarmSection);

        alarmSection.appendChild(operatorContainer);
        alarmSection.appendChild(triggerContainer);

        const threatLevelOptions = serverCache.alarmOptions?.actions?.POST?.threat_level?.choices;
        const threatLevel = this.addField({ label: "Threat Level", type: "select", options: threatLevelOptions }, alarm?.threat_level, null, alarmSection);

        const message = this.addField({ label: "Message", type: "text", 
                description: "The message to send to subscribers when the alarm activates" }, 
            alarm?.message, null, alarmSection
        );

        /**
         * Post alarm configuration to the server
         * @param {boolean} create If alarm should be created or updated
         */
        const alarmSubmit = async (create) => {
            const payload = {
                alias: alias.getValue(),
                tag: tag.getValue(),
                threat_level: threatLevel.getValue(),
                operator: getOperatorValue(), // Use latest getValue
                trigger_value: getTriggerValue(), // Use latest getValue
                message: message.getValue(),
            }
            
            if(create) {
                requestServer('/api/alarms/', 'POST', payload, (data) => {
                    alert("Alarm created!");
                    serverCache.alarms[data.external_id] = data;
                    this.inspectAlarm(data);
                });
            }
            else {
                requestServer(`/api/alarms/${alarm.external_id}/`, 'PUT', payload, (data) => {
                    alert("Alarm changed!");
                    Object.assign(alarm, data);
                    this.inspectAlarm(alarm);
                });
            }
        }

        const createSection = this.addSection();
        this.addButton("Create New Alarm", () => alarmSubmit(true), createSection);

        if(alarm) {
            this.addButton(`Update ${alarm.alias}`, () => alarmSubmit(false), createSection);

            const deleteSection = this.addSection();
            const delButton = this.addButton(`Delete ${alarm.alias}`, () => {
                if(window.confirm(`Are you sure you want to delete alarm ${alarm.alias}?`)) {
                    requestServer(`/api/alarms/${alarm.external_id}/`, 'DELETE', null, async () => {
                        alert("Alarm deleted.");
                        delete serverCache.alarms[alarm.external_id];
                        this.inspectAlarm(); 
                    });
                }
            }, deleteSection);
            delButton.style.color = "crimson";
        }
    }

    /**
     * Populate the form with properties of a given schedule
     * @param {ScheduleObject} schedule 
     */
    inspectSchedule(schedule) {
        this.clear();

        const scheduleSelectSection = this.addSection();

        const scheduleOptions = Object.values(serverCache.schedules).map(schedule => ({ value: schedule.external_id, display_name: schedule.alias }));
        this.addField({ label: "Schedule", type: "select", options: scheduleOptions }, schedule?.external_id, (schID) => {
            this.inspectSchedule(serverCache.schedules[schID])
        }, scheduleSelectSection);

        this.addTitle("Create or Edit Schedule");

        const alias = this.addField({ label: "Schedule Name", type: "text" }, schedule?.alias, null);

        const tagSection = this.addSection();
        const writeContainer = document.createElement('div'); 
        let getWriteValue = () => null;

        const onTagChanged = (tagID) => {
            writeContainer.innerHTML = ''; 
            
            const tag = serverCache.tags[tagID];
            if(!tag) return;

            // Create an input with the same value type as the selected tag //TODO make generalized? used twice...
            const fieldType = Inspector.getFieldType(tag.data_type);
            const newTriggerField = this.addField({ label: "Write Value", type: fieldType }, schedule?.write_value, null, writeContainer);
            getWriteValue = newTriggerField.getValue;
        }
        onTagChanged(schedule?.tag);
        
        const writeableTags = Object.values(serverCache.tags).filter(tag => ["coil", "hr"].includes(tag.channel));
        const tagOptions = writeableTags.map(tag => ({ value: tag.external_id, display_name: Inspector.getTagLabel(tag)}));
        const tag = this.addField({ label: "Control Tag", type: "select", options: tagOptions }, schedule?.tag, onTagChanged, tagSection);
        tagSection.appendChild(writeContainer);        

        const timeSection = this.addSection();
        const time = this.addField({ label: "Time", type: "time"}, schedule?.time, null, timeSection);

        const dayNames = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
        const dayChecks = dayNames.map((name, idx) => this.addField({ label: name, type: "bool" }, schedule?.days[idx], null, timeSection))
        
        const miscSection = this.addSection();
        const enabled = this.addField({ label: "Enabled", type: "bool" }, schedule?.enabled || true, null, miscSection); //TODO add "enabled" field to other things?

        /**
         * Post schedule configuration to the server
         * @param {boolean} create If schedule should be created or updated
         */
        const scheduleSubmit = async (create) => {
            const payload = {
                alias: alias.getValue(),
                tag: tag.getValue(),
                write_value: getWriteValue(), // Use latest getValue
                time: time.getValue(),
                days: dayChecks.map(check => check.getValue()),
                enabled: enabled.getValue(),
            }
            
            if(create) {
                requestServer('/api/schedules/', 'POST', payload, (data) => {
                    alert("Schedule created!");
                    serverCache.schedules[data.external_id] = data;
                    this.inspectSchedule(data);
                });
            }
            else {
                requestServer(`/api/schedules/${schedule.external_id}/`, 'PUT', payload, (data) => {
                    alert("Schedule changed!");
                    Object.assign(schedule, data);
                    this.inspectSchedule(schedule);
                });
            }
        }

        const createSection = this.addSection();
        this.addButton("Create New Schedule", () => scheduleSubmit(true), createSection);

        if(schedule) {
            this.addButton(`Update ${schedule.alias}`, () => scheduleSubmit(false), createSection);

            const deleteSection = this.addSection();
            const delButton = this.addButton(`Delete ${schedule.alias}`, () => {
                if(window.confirm(`Are you sure you want to delete schedule ${schedule.alias}?`)) {
                    requestServer(`/api/schedules/${schedule.external_id}/`, 'DELETE', null, async () => {
                        alert("Schedule deleted.");
                        delete serverCache.schedules[schedule.external_id];
                        this.inspectSchedule(); 
                    });
                }
            }, deleteSection);
            delButton.style.color = "crimson";
        }
    }
}