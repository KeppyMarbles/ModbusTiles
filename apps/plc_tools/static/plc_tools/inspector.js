import { serverCache, refreshData } from "./global.js";
import { postServer } from "./util.js";

export class Inspector {
    constructor() {
        this.container = document.getElementById('inspector-form');
    }

    clear() {
        this.container.innerHTML = '';
    }

    addTitle(text) {
        const title = document.createElement('p');
        title.innerText = text;
        title.className = "inspector-title";
        this.container.appendChild(title);
        return title;
    }

    addSection(title) {
        const box = document.createElement('div');
        box.className = "inspector-box";
        box.innerText = title;
        this.container.appendChild(box);
        return box;
    }

    addButton(title, callback, section) {
        const btn = document.createElement('button');
        btn.innerText = title;
        btn.style.marginTop = "10px";
        btn.onclick = callback;
        if(!section)
            section = this.container;
        section.appendChild(btn);
    }

    createField(def, currentValue, onChange, section) {
        const wrapper = document.createElement('div');
        wrapper.className = "input-group";

        const label = document.createElement('label');
        label.innerText = def.label || def.name;
        label.className = "inspector-label";

        let input = document.createElement('input');
        input.value = currentValue;
        input.type = 'text';

        // Function used to get this field's current value
        let getValue = () => {return input.value};

        // Add input based on value type
        switch (def.type) {
            case "bool":
                input.type = 'checkbox';
                input.checked = currentValue;
                getValue = () => {return input.checked};
                break;
            
            case "select":
                input = document.createElement('select');

                const defaultOpt = document.createElement('option');
                defaultOpt.text = "Select";
                input.appendChild(defaultOpt);

                if (def.options) {
                    def.options.forEach(opt => {
                        const el = document.createElement('option');
                        el.value = opt.value;
                        el.innerText = opt.label;
                        if(opt.value === currentValue)
                            el.selected = true;
                        input.appendChild(el);
                    });
                }
                getValue = () => {return input.value};
                break;

            case "color":
                input.type = "color";
                break;

            case "int":
                getValue = () => {return parseInt(input.value)};
                input.type = "number";
                break;
            
            case "float":
                getValue = () => {return parseFloat(input.value)};
                input.type = "number";
                break;

            case "number":
                getValue = () => {return input.value === "" ? 0 : Number(input.value)};
                input.type = "number";
                break;
        }
        input.className = "inspector-input";

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
        this.clear();
        this.addTitle(widget.constructor.displayName);

        {
            // Create dropdown with tags that are compatible with this widget
            const allowedTypes = widget.constructor.allowedTypes;
            const allowedChannels = widget.constructor.allowedChannels;

            const compatibleTags = serverCache.tags.filter(tag => {
                return allowedTypes.includes(tag.data_type) 
                    && allowedChannels.includes(tag.channel);
            });
            const tagOptions = compatibleTags.map(tag => ({ value: tag.external_id, label: `${tag.alias} (${tag.channel} ${tag.address})`}));

            this.createField({label: "Control Tag", type: "select", options: tagOptions }, widget.tag, (newVal) => {
                widget.tag = newVal;
            });
        }

        const allFields = [ //TODO should these actually be dictionaries where the key is the config name and the value is the field dict
            ...widget.constructor.customFields,
            ...widget.constructor.defaultFields,
        ];

        // Add rest of fields
        allFields.forEach(field => { 
            this.createField(field, widget.config[field.name], (newVal) => {
                widget.config[field.name] = newVal;
                widget.applyConfig(); // Visual update
            });
        });
    }

    inspectGlobal() {
        this.clear();
        this.addTitle("Creator");
        this._formCreateTag();
        this._formCreateAlarm();
    }

    _formCreateTag() { //TODO i wonder if the options map should be a function, standardized in the API
        const tagSection = this.addSection("Create New Tag");
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
        const maxHistory = this.createField({ label: "Max History", type: "int" }, 0, null, tagSection)

        // Post values to server
        const tagSubmit = async () => {
            const payload = {
                alias: alias.getValue(),
                device: device.getValue(),
                address: address.getValue(),
                channel: channel.getValue(),
                data_type: getDataTypeValue(), // Use latest getValue
                unit_id: 1,
                //read_amount: readAmount.getValue(),
                read_amount: 1,
                max_history_entries: maxHistory.getValue(),
                is_active: true
            };

            const result = await postServer('/api/tags/', payload, "Tag Created!");
            if(result)
                refreshData(); // Repopulate tag list
        };
        this.addButton("Create Tag", tagSubmit, tagSection);
    }

    _formCreateAlarm() {
        const alarmSection = this.addSection("Create New Alarm");
        const alias = this.createField({ label: "Alarm Name", type: "text" }, "", null, alarmSection);

        // Dynamic trigger value field - update according to tag type
        const triggerContainer = document.createElement('div'); 
        let getTriggerValue = () => null; 

        const onTagChanged = (value) => {
            triggerContainer.innerHTML = ''; 
            const tag = serverCache.tags.find(t => t.external_id === value);
            if(!tag) {
                console.error("Couldn't get tag info for alarm");
                return;
            }

            // Create an input with the same value type as the selected tag
            let fieldType = "text";
            if(tag.data_type === "bool") fieldType = "bool";
            else if(["int16", "uint16", "int32", "uint32", "int64"].includes(tag.data_type)) fieldType = "int";
            else if(["float32", "float64"].includes(tag.data_type)) fieldType = "number";

            const newField = this.createField({ label: "Trigger Value", type: fieldType }, "", null, triggerContainer);

            getTriggerValue = newField.getValue;
        }

        const tagOptions = serverCache.tags.map(tag => ({ value: tag.external_id, label: `${tag.alias} (${tag.channel} ${tag.address})`})); //TODO function?
        const tag = this.createField({ label: "Control Tag", type: "select", options: tagOptions }, "", onTagChanged, alarmSection);
        //onTagChanged()

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
                trigger_value: getTriggerValue(), // Use latest getValue
                message: message.getValue(),
            }
            
            console.log("Submitting:", payload);
            const result = await postServer('/api/alarms/', payload, "Alarm Created!");
        }

        this.addButton("Create Alarm", alarmSubmit, alarmSection);
    }
}