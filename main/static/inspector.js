import { serverCache, refreshData } from "./global.js";
import { postServer } from "./util.js";

export class Inspector {
    constructor(container) {
        this.container = container;
    }

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

    clear() {
        this.container.innerHTML = '';
    }

    addTitle(text) {
        const title = document.createElement('p');
        title.innerText = text;
        title.className = "form-title";
        this.container.appendChild(title);
        return title;
    }

    addSection(title) {
        const box = document.createElement('div');
        box.className = "form-box";
        box.innerText = title ? title : "";
        this.container.appendChild(box);
        return box;
    }

    addButton(title, callback, section) {
        const btn = document.createElement('button');
        btn.innerText = title ? title : "";
        btn.classList.add("form-button");
        btn.onclick = callback;
        if(!section)
            section = this.container;
        section.appendChild(btn);
    }

    createField(def, currentValue, onChange, section) { // TODO add uint, restrict float input for int fields?
        const wrapper = document.createElement('div');
        wrapper.className = "input-group";

        const label = document.createElement('label');
        label.innerText = def.label || def.name;
        label.className = "form-label";

        let input = null;

        if(def.type === "select")
            input = document.createElement("select");
        else {
            input = document.createElement("input");
            input.value = currentValue; //TODO check type compatibility?
        }
        input.classList.add("form-input");

        // Function used to get this field's current value
        let getValue = () => {return null};

        // Add input based on value type
        switch (def.type) {
            case "bool":
                input.type = 'checkbox';
                input.checked = currentValue;
                input.classList.add("bool");
                label.classList.add("bool");
                getValue = () => { return input.checked };
                break;
            
            case "select":
                const defaultOpt = document.createElement('option');
                defaultOpt.text = "Select";
                defaultOpt.value = "";
                input.appendChild(defaultOpt);

                if (def.options) {
                    def.options.forEach(opt => {
                        const el = document.createElement('option');
                        el.value = opt.value;
                        el.text = opt.label;
                        if(opt.value === currentValue)
                            el.selected = true;
                        input.appendChild(el);
                    });
                }
                getValue = () => { return input.value };
                break;

            case "enum":
                input = document.createElement('div');
                const rows = document.createElement('div');

                // Get choices from the form
                getValue = () => {
                    const real_kvs = [];
                    Array.from(rows.children).forEach(row => {
                        real_kvs.push({
                            label: row.key_input.value,
                            value: row.value_input.value
                        });
                    });
                    return real_kvs;
                }

                // Create row for label, value, minus button
                const createKv = (k, v) => { //TODO fix spacing/styles
                    const row = document.createElement('div');
                    row.style.display = "flex";
                    
                    // Label input
                    const key_input = document.createElement("input");
                    key_input.type = "text";
                    key_input.value = k;
                    key_input.placeholder = "Name";
                    key_input.classList.add("form-input");
                    key_input.addEventListener("change", () => { onChange(getValue()) })
                    row.appendChild(key_input);

                    // Value input
                    const value_input = document.createElement("input");
                    value_input.type = "number";
                    value_input.value = v;
                    value_input.placeholder = "Value";
                    value_input.classList.add("form-input");
                    value_input.addEventListener("change", () => { onChange(getValue()) })
                    row.appendChild(value_input);

                    // Save inputs with the row
                    row.value_input = value_input;
                    row.key_input = key_input;

                    const sub_button = document.createElement("button");
                    sub_button.innerText = "-";
                    sub_button.classList.add("form-input");
                    sub_button.addEventListener("click", () => {
                        row.remove();
                        onChange(getValue());
                    })
                    row.appendChild(sub_button);

                    rows.appendChild(row);
                }

                // Add saved choices
                currentValue.forEach(real_kv => {
                    createKv(real_kv.label, real_kv.value);
                });

                input.appendChild(rows);

                // Add plus button
                const add_button = document.createElement("button");
                add_button.innerText = "+";
                add_button.classList.add("form-input");
                add_button.addEventListener("click", () => {
                    createKv("", "");
                    onChange(getValue());
                });
                input.appendChild(add_button);

                break;

            case "color":
                getValue = () => {return input.value};
                input.type = "color";
                break;

            case "int":
                getValue = () => { return parseInt(input.value) };
                input.type = "number";
                break;
            
            case "float":
                getValue = () => { return parseFloat(input.value) };
                input.type = "number";
                break;

            case "number":
                getValue = () => { return input.value === "" ? 0 : Number(input.value) };
                input.type = "number";
                break;

            default:
                getValue = () => {return input.value};
                input.type = 'text';
                break;
        }
        
        // On value change callback
        if (onChange) {
            input.addEventListener('change', (e) => {
                onChange(getValue());
            });
        }

        // Add to document
        label.appendChild(input);
        wrapper.appendChild(label);

        if(!section)
            section = this.container;
        section.appendChild(wrapper);

        return { wrapper, getValue };
    }

    inspectWidget(widget) {
        const widgetClass = widget.constructor;

        this.clear();
        this.addTitle(widgetClass.displayName);

        // Helper to widget config related fields
        const createConfigField = (field, section) => {
            this.createField(field, widget.config[field.name], (newVal) => {
                widget.config[field.name] = newVal;
                widget.applyConfig(); // Visual update
            }, section);
        }

        const tagSection = this.addSection();
        const dynamicFieldContainer = document.createElement('div');

        const createDynamicFields = (tagID) => {
            dynamicFieldContainer.innerHTML = "";

            if(!tagID || widget.dynamicFields.length === 0)
                return;

            const tag = serverCache.tags.find(t => t.external_id === tagID); //TODO streamline this process?
            if(!tag) {
                console.error("Couldn't get tag for dynamic field")
                return;
            }
            
            // Add new inputs
            const newFieldType = Inspector.getFieldType(tag.data_type);
            
            widget.dynamicFields.forEach(field => {
                field["type"] = newFieldType;
                createConfigField(field, dynamicFieldContainer);
            });
        }

        // Create dropdown with tags that are compatible with this widget
        const compatibleTags = serverCache.tags.filter(tag => {
            return widgetClass.allowedTypes.includes(tag.data_type) 
                && widgetClass.allowedChannels.includes(tag.channel);
        });
        const tagOptions = compatibleTags.map(tag => ({ value: tag.external_id, label: `${tag.alias} (${tag.channel} ${tag.address})`}));

        this.createField({label: "Control Tag", type: "select", options: tagOptions }, widget.tag, (newVal) => {
            widget.tag = newVal;
            widget.applyConfig();
            createDynamicFields(newVal); // Update the dynamic fields
        }, tagSection);

        
        // Add dynamic fields (form input changes with tag type)
        createDynamicFields(widget.tag);
        tagSection.appendChild(dynamicFieldContainer);

        // Add rest of fields
        const customFieldsSection = this.addSection();
        widgetClass.customFields.forEach(field => { createConfigField(field, customFieldsSection) });

        const defaultFieldsSection = this.addSection();
        widgetClass.defaultFields.forEach(field => { createConfigField(field, defaultFieldsSection) });

        //TODO add placeholder values?
    }

    inspectDashboard(dashboard) { 
        this.clear();
        const title = this.addTitle(dashboard.alias);
        const dashboardSection = this.addSection();

        this.createField({ label: "Dashboard Name", type: "text" }, dashboard.newAlias, (value) => {dashboard.newAlias = value}, dashboardSection);
        this.createField({ label: "Description", type: "text" }, dashboard.description, (value) => {dashboard.description = value}, dashboardSection);

        // todo columns, background color

        const ioSection = this.addSection();
        this.addButton("Import", () => {
            
        }, ioSection);
        this.addButton("Export", () => {
            
        }, ioSection);
        
    }

    inspectGlobal() {
        this.clear();
        this._formCreateTag();
        this._formCreateAlarm();
    }

    _formCreateTag() { //TODO i wonder if the options map should be a function, standardized in the API
        this.addTitle("New Tag");
        const tagSection = this.addSection();
        const alias = this.createField({ label: "Tag Name", type: "text" }, "", null, tagSection);

        const deviceOptions = serverCache.devices.map(d => ({ value: d.alias, label: d.alias }));
        const device = this.createField({ label: "Device", type: "select", options: deviceOptions}, "", null, tagSection);

        const address = this.createField({ label: "Address", type: "int" }, 0, null, tagSection);

        // Dynamic data type field - update according to channel type
        const dataTypeContainer = document.createElement('div');
        let getDataTypeValue = () => null;

        const onChannelChanged = (value) => {
            dataTypeContainer.innerHTML = '';
            let dataTypeOptions = serverCache.tagOptions.data_types;
            let currentValue = "";

            // Only show data types that are compatible with the selected channel
            if(!value)
                dataTypeOptions = [];
            else if(["coil", "di"].includes(value)) {
                dataTypeOptions = dataTypeOptions.filter(t => {return t.value === 'bool'});
                currentValue = "bool";
            }
            else 
                dataTypeOptions = dataTypeOptions.filter(t => {return t.value !== 'bool'});

            const newField = this.createField({ label: "Data Type", type: "select", options: dataTypeOptions }, currentValue, null, dataTypeContainer);
            getDataTypeValue = newField.getValue;
        }

        const channelOptions = serverCache.tagOptions.channels.map(o => ({ value: o.value, label: o.label }));
        const channel = this.createField({ label: "Channel", type: "select", options: channelOptions }, "", onChannelChanged, tagSection);
        onChannelChanged()

        tagSection.appendChild(dataTypeContainer);
        //const dataTypeOptions = serverCache.tagOptions.data_types.map(o => ({ value: o.value, label: o.label }));

        //const readAmount = this.createField({label: "Read Amount", type: "int"}, 1, null, tagSection)
        const historyRetention = this.createField({ label: "History Retention (Seconds)", type: "int" }, 0, null, tagSection)
        const historyInterval = this.createField({ label: "History Write Interval (Seconds)", type: "int" }, 1, null, tagSection)
        const description = this.createField({ label: "Description (optional)", type: "text" }, "", null, tagSection)

        // Post values to server
        const tagSubmit = async () => {
            const payload = {
                alias: alias.getValue(),
                description: description.getValue(),
                device: device.getValue(),
                address: address.getValue(),
                channel: channel.getValue(),
                data_type: getDataTypeValue(), // Use latest getValue
                unit_id: 1,
                //read_amount: readAmount.getValue(),
                read_amount: 1,
                history_retention: historyRetention.getValue(),
                history_interval: historyInterval.getValue(),
                is_active: true
            };

            const ok = await postServer('/api/tags/', payload, (data) => {
                alert("Tag Created!");
                refreshData();
            });
        };
        this.addButton("Create Tag", tagSubmit, tagSection);
    }

    _formCreateAlarm() {
        this.addTitle("New Alarm");
        const alarmSection = this.addSection();
        const alias = this.createField({ label: "Alarm Name", type: "text" }, "", null, alarmSection);

        // Dynamic trigger value and operator field - update according to tag type
        const triggerContainer = document.createElement('div'); 
        const operatorContainer = document.createElement('div');
        let getTriggerValue = () => null;
        let getOperatorValue = () => null;

        const onTagChanged = (value) => {
            triggerContainer.innerHTML = ''; 
            operatorContainer.innerHTML = '';

            if(value === null)
                return;

            const tag = serverCache.tags.find(t => t.external_id === value);
            if(!tag) {
                console.error("Couldn't get tag info for alarm");
                return;
            }

            // Show choices for trigger operator
            let operatorChoices = serverCache.alarmOptions.operator_choices;
            if(tag.data_type === "bool") 
                operatorChoices = operatorChoices.filter(t => {return t.value === "equals"});

            // Create an input with the same value type as the selected tag
            fieldType = Inspector.getFieldType(tag.data_type);

            const newOperatorField = this.createField({ label: "Operator", type: "select", options: operatorChoices }, "equals", null, operatorContainer);
            const newTriggerField = this.createField({ label: "Trigger Value", type: fieldType }, "", null, triggerContainer);
            
            getOperatorValue = newOperatorField.getValue;
            getTriggerValue = newTriggerField.getValue;
        }

        const tagOptions = serverCache.tags.map(tag => ({ value: tag.external_id, label: `${tag.alias} (${tag.channel} ${tag.address})`})); //TODO function?
        const tag = this.createField({ label: "Control Tag", type: "select", options: tagOptions }, "", onTagChanged, alarmSection);
        //onTagChanged()

        alarmSection.appendChild(operatorContainer);
        alarmSection.appendChild(triggerContainer);

        const threatLevelOptions = serverCache.alarmOptions.threat_levels.map(a => ({ value: a.value, label: a.label }));
        const threatLevel = this.createField({ label: "Threat Level", type: "select", options: threatLevelOptions }, "", null, alarmSection);

        const message = this.createField({ label: "Message", type: "text" }, "", null, alarmSection);

        // Post values to server
        const alarmSubmit = async () => {
            const payload = {
                alias: alias.getValue(),
                tag: tag.getValue(),
                threat_level: threatLevel.getValue(),
                operator: getOperatorValue(), // Use latest getValue
                trigger_value: getTriggerValue(), // Use latest getValue
                message: message.getValue(),
            }
            
            console.log("Submitting:", payload);
            const ok = await postServer('/api/alarms/', payload, (data) => {
                alert("Alarm Created!");
            });
        }

        this.addButton("Create Alarm", alarmSubmit, alarmSection);
    }
}