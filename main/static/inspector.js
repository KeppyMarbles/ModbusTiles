import { serverCache, requestServer } from "./global.js";
/** @import { InspectorFieldDefinition, ChoiceObject, DataType, TagObject, ChannelType, InspectorDataType, AlarmConfigObject } from "./types.js" */
/** @import { Widget } from "./widgets.js" */
/** @import { Dashboard } from "./dashboard.js" */

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
        return `${alarm.alias}`; //TODO
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
     * @param {(val: *)} onChange The callback that recieves the new data when input changes
     * @param {HTMLElement} section The element to append the field to, typically from `addSection`
     */
    addField(def, currentValue, onChange, section) {
        const wrapper = document.createElement('div');
        wrapper.className = "input-group";

        const label = document.createElement('label');
        label.innerText = def.label || def.name || "";
        label.className = "form-label";
        if(def.description) label.title = def.description;

        let inputObj;

        // Delegate rendering strategy
        if (def.type === "select")
            inputObj = this._createSelect(def.options, currentValue);
        else if (def.type === "enum")
            inputObj = this._createEnum(currentValue, onChange);
        else
            inputObj = this._createSimpleInput(def.type, currentValue);

        if (def.type === "bool")
            label.classList.add("bool");

        // Hook up change listeners
        if (onChange)
            inputObj.element.addEventListener('change', () => onChange(inputObj.getValue()));

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
     */
    _createSelect(options, currentValue) {
        const select = document.createElement("select");
        select.classList.add("form-input");
        
        // Default "Select" option
        const defaultOpt = document.createElement('option');
        defaultOpt.text = "Select";
        defaultOpt.value = "";
        select.appendChild(defaultOpt);

        if (options) {
            options.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.value;
                el.text = opt.label;
                if(opt.value === currentValue) el.selected = true;
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
     */
    _createSimpleInput(type, currentValue) {
        const input = document.createElement("input");
        input.classList.add("form-input");
        input.value = currentValue ?? "";

        let getValue;

        switch (type) {
            case "bool":
                input.classList.add("bool");
                input.type = 'checkbox';
                input.checked = currentValue;
                getValue = () => input.checked;
                break;

            case "color":
                input.type = "color";
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
     * @returns 
     */
    _createEnum(currentValue, onChange) {
        const container = document.createElement('div');
        const rowsContainer = document.createElement('div');

        const getValue = () => {
            /** @type {ChoiceObject[]} */
            const real_kvs = [];
            Array.from(rowsContainer.children).forEach(row => {
                real_kvs.push({
                    label: row.key_input.value,
                    value: row.value_input.value
                });
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

        // Init existing rows
        (currentValue || []).forEach(kv => createRow(kv.label, kv.value));

        // Add Button
        const addBtn = document.createElement("button");
        addBtn.className = "form-input";
        addBtn.innerText = "+";
        addBtn.onclick = () => { createRow("", ""); onChange(getValue()); };

        container.appendChild(rowsContainer);
        container.appendChild(addBtn);

        return { element: container, getValue };
    }

    /**
     * Populate the form with properties of a given widget
     * @param {Widget} widget 
     */
    inspectWidget(widget) {
        /** @type {typeof Widget} */
        const widgetClass = widget.constructor;

        this.clear();
        this.addTitle(widget.gridElem.title);

        /**
         * Helper to add widget config related fields
         * @param {InspectorFieldDefinition} field 
         * @param {HTMLElement} section 
         */
        const createConfigField = (field, section) => {
            this.addField(field, widget.config[field.name], (newVal) => {
                widget.config[field.name] = newVal;
                widget.applyConfig(); // Visual update
            }, section);
        }

        // Add tag section
        if(widgetClass.allowedChannels.length > 0) {
            const tagSection = this.addSection();
            const tagTypedFieldsContainer = document.createElement('div');

            /**
             * Helper to create tag-dependent fields
             * @param {TagObject} tag 
             */
            const createTagTypedFields = (tag) => {
                tagTypedFieldsContainer.innerHTML = "";

                if(!tag || widgetClass.tagTypedFields.length === 0)
                    return;
                
                // Add new inputs
                const newFieldType = Inspector.getFieldType(tag.data_type);
                
                widgetClass.tagTypedFields.forEach(field => {
                    createConfigField({ ...field, "type": newFieldType }, tagTypedFieldsContainer);
                });
            }

            // Create dropdown with tags that are compatible with this widget
            const compatibleTags = Object.values(serverCache.tags).filter(tag => {
                return widgetClass.allowedTypes.includes(tag.data_type) 
                    && widgetClass.allowedChannels.includes(tag.channel);
            });
            const tagOptions = compatibleTags.map(tag => ({ value: tag.external_id, label: Inspector.getTagLabel(tag) }));

            this.addField({ label: "Control Tag", type: "select", options: tagOptions }, widget.tag?.external_id, (newID) => {
                widget.tag = serverCache.tags[newID];
                widget.applyConfig();
                createTagTypedFields(newID); // Update the tag based fields
            }, tagSection);
            
            // Add tag-dependent fields
            createTagTypedFields(widget.tag);
            tagSection.appendChild(tagTypedFieldsContainer);
        }

        // Add rest of fields
        const customFieldsSection = this.addSection();
        widgetClass.customFields.forEach(field => { createConfigField(field, customFieldsSection) });

        const defaultFieldsSection = this.addSection();
        widgetClass.defaultFields.forEach(field => { createConfigField(field, defaultFieldsSection) });
    }

    /**
     * Populate the form with properties of a given dashboard
     * @param {Dashboard} dashboard 
     */
    inspectDashboard(dashboard) { 
        this.clear();
        const title = this.addTitle(dashboard.alias);
        const dashboardSection = this.addSection();

        this.addField({ label: "Dashboard Name", type: "text" }, dashboard.newAlias, (value) => {dashboard.newAlias = value}, dashboardSection);
        this.addField({ label: "Description", type: "text" }, dashboard.description, (value) => {dashboard.description = value}, dashboardSection);

        const dashboardPropertiesSection = this.addSection();
        this.addField({ label: "Columns", type: "int" }, dashboard.canvasGridStack.getColumn(), (value) => dashboard.setColumnCount(value), dashboardPropertiesSection);

        const saveSection = this.addSection();
        this.addButton("Save Dashboard", () => dashboard.save(), saveSection);

        const ioSection = this.addSection();
        this.addButton("Import", () => dashboard.fileInput.click(), ioSection);
        this.addButton("Export", () => dashboard.exportFile(), ioSection);
    }

    /**
     * 
     * @param {TagObject} tag 
     */
    inspectTag(tag) {
        this.clear();
        const tagSelectSection = this.addSection();

        const tagOptions = Object.values(serverCache.tags).map(tag => ({ value: tag.external_id, label: Inspector.getTagLabel(tag) }));
        this.addField({ label: "Tag", type: "select", options: tagOptions }, tag?.external_id, (tagID) => {
            this.inspectTag(serverCache.tags[tagID])
        }, tagSelectSection);

        this.addTitle("Create or Edit Tag");

        const tagSection = this.addSection();
        const alias = this.addField({ label: "Tag Name", type: "text" }, tag?.alias || "", null, tagSection);
        const description = this.addField({ label: "Description (optional)", type: "text" }, tag?.description, null, tagSection)

        const locationSection = this.addSection();
        const deviceOptions = serverCache.devices.map(d => ({ value: d.alias, label: d.alias }));
        const device = this.addField({ label: "Device", type: "select", options: deviceOptions }, tag?.device, null, locationSection);
        const bitIndex = this.addField({ label: "Bit Index (0-15)", type: "int" }, tag?.bit_index, tag?.bit_index, locationSection);
        const restrictedWriteField = this.addField({ label: "Read-Only", type: "bool", description: "If the tag value should be protected from non-staff users"}, tag?.read_only, null, locationSection);

        // Dynamic data type field - update according to channel type
        const dataTypeContainer = document.createElement('div');
        let getDataTypeValue = () => { return tag?.data_type };

        /**
         * Update the data types and bit index field if channel changes
         * @param {ChannelType} channelValue 
         */
        const onChannelChanged = (channelValue) => {
            dataTypeContainer.innerHTML = '';
            let dataTypeOptions = serverCache.tagOptions.data_types;
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
        
        const channelOptions = serverCache.tagOptions.channels.map(o => ({ value: o.value, label: o.label }));
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
                description: "The maximum age of this tag's history entries. Use 0 for no history" },
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
                        serverCache.tags.delete(tag.external_id);
                        this.inspectTag(); 
                    });
                }
            }, deleteSection);
            delButton.style.color = "crimson";
        }
        //TODO we need to notify dashboard/widgets about changes
    }

    /**
     * 
     * @param {AlarmConfigObject} alarm 
     */
    inspectAlarm(alarm) {
        this.clear();
        const alarmSelectSection = this.addSection();

        const alarmOptions = Object.values(serverCache.alarms).map(alarm => ({ value: alarm.external_id, label: Inspector.getAlarmLabel(alarm) }));
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

            if(!tag)
                return;

            // Show choices for trigger operator
            let operatorChoices = serverCache.alarmOptions.operator_choices;
            if(tag.data_type === "bool") 
                operatorChoices = operatorChoices.filter(t => { return t.value === "equals" });

            // Create an input with the same value type as the selected tag
            const fieldType = Inspector.getFieldType(tag.data_type);

            const newOperatorField = this.addField({ label: "Operator", type: "select", options: operatorChoices}, alarm?.operator || "", null, operatorContainer);
            const newTriggerField = this.addField({ label: "Trigger Value", type: fieldType, 
                    description: "The value to compare with for triggering the alarm" }, 
                alarm?.trigger_value, null, triggerContainer
            );
            
            getOperatorValue = newOperatorField.getValue;
            getTriggerValue = newTriggerField.getValue;
        }
        onTagChanged(alarm?.tag);

        const tagOptions = Object.values(serverCache.tags).map(tag => ({ value: tag.external_id, label: Inspector.getTagLabel(tag)}));
        const tag = this.addField({ label: "Control Tag", type: "select", options: tagOptions }, alarm?.tag, onTagChanged, alarmSection);

        alarmSection.appendChild(operatorContainer);
        alarmSection.appendChild(triggerContainer);

        const threatLevelOptions = serverCache.alarmOptions.threat_levels.map(a => ({ value: a.value, label: a.label }));
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
                        serverCache.alarms.delete(alarm.external_id);
                        this.inspectAlarm(); 
                    });
                }
            }, deleteSection);
            delButton.style.color = "crimson";
        }
    }
}