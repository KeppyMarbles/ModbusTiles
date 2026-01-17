import { requestServer, serverCache } from "./global.js";
/** @import { TagObject, TagValueObject, AlarmConfigObject, InspectorFieldDefinition, ChannelType, DataType } from "./types.js" */

/**
 * Abstract class for dashboard widgets.
 * 
 * Can be registered with TagListener to recieve updates from the server.
 * `onValue` determines how those updates are handled
 * @abstract
 */
export class Widget {
    /** 
     * Channel filter for tag selection
     * @type {ChannelType[]}
     */
    static allowedChannels = [];

    /** 
     * Type filter for tag selection
     * @type {DataType[]}
     */
    static allowedTypes = [];

    /**
     * Inspector fields that apply to all widgets
     * @type {InspectorFieldDefinition[]}
     */
    static defaultFields = [
        { name: "locked", type: "bool", default: false, label: "Position Locked" },
        { name: "showTagName", type: "bool", default: true, label: "Show Tag Name" },
    ];

    /**
     * Subclass-specific inspector fields 
     * @type {InspectorFieldDefinition[]}
     */
    static customFields = [];

    /**
     * Subclass-specific fields which change form input based on tag datatype
     * @type {InspectorFieldDefinition[]}
     */
    static tagTypedFields = [];

    /**
     * @param {HTMLElement} gridElem 
     * @param {Object} config 
     * @param {TagObject} tag 
     */
    constructor(gridElem, config, tag) {      
        // Apply defaults
        if(!config) config = {};
        const allFields = [...(new.target.defaultFields), ...(new.target.customFields), ...(new.target.tagTypedFields)];
        allFields.forEach(field => {
            if(config[field.name] === undefined)
                config[field.name] = field.default;
        });

        /**@type {TagObject} meta describing the tag this widget should use */
        this.tag = tag;

        /** The entries for defaultFields, customFields, etc. Fields not provided are set to default */
        /** @type {Object} */
        this.config = config;

        /** @type {HTMLElement} The GridStack element */
        this.gridElem = gridElem;
        gridElem.widgetInstance = this;
        
        /** @type {HTMLElement} The contents of the GridStack widget */
        this.elem = gridElem.querySelector('.dashboard-widget');

        /** @type {number} Age in ms the widget's value can be before displaying as stale  */
        this.valueTimeout = 5000;

        this.alarmIndicator = gridElem.querySelector(".alarm-indicator");
        this.tagLabel = this.elem.parentNode?.querySelector(".widget-label");

        // Apply visual updates after construction
        setTimeout(() => {
            this.applyConfig();
        }, 0);
    }

    /**
     * Handles new data from the server. Called from TagListener
     * @param {TagValueObject} data The update recieved
     */
    onData(data) {
        if(data.age > this.valueTimeout) 
            this.elem.classList.add("is-state", "no-connection");
        else
            this.elem.classList.remove("is-state", "no-connection");

        this.onValue(data.value, data.time);
        this.setAlarm(serverCache.alarms[data.alarm]);
    }

    /**
     * Visually updates the widget with the alarm from onData
     * @param {AlarmConfigObject} alarm The alarm config info
     */
    setAlarm(alarm) {
        if(!this.alarmIndicator)
            return;

        this.gridElem.classList.remove("threat-high");
        
        if(alarm) {
            this.alarmIndicator.classList.remove("hidden");
            this.alarmIndicator.title = alarm.message;
            switch(alarm.threat_level) {
                case "low":
                    this.alarmIndicator.innerHTML = "🔔";
                    break;
                case "high":
                    this.alarmIndicator.innerHTML = "⚠️";
                    break;
                case "crit":
                    this.alarmIndicator.innerHTML = "‼️";
                    this.gridElem.classList.add("threat-high");
                    break;
            }
        }
        else {
            this.alarmIndicator.classList.add("hidden");
            this.alarmIndicator.title = "";
        }
    }

    /**
     * 
     * Updates the widget's visual contents based on the current state of the config.
     * Called immediately after the widget is finished constructing, and when data changes in the Inspector
     */
    applyConfig() {
        // Handle "locked" state
        const widgetNode = this.gridElem?.gridstackNode;
        if(widgetNode && widgetNode.locked != this.config.locked) {
            widgetNode.grid.update(widgetNode.el, { //TODO breaks if we add widgets that are locked size by default
                locked: this.config.locked,
                noResize: this.config.locked,
                noMove: this.config.locked,
            })
        }
        if(this.config.locked)
            this.gridElem.classList.add("is-state", "locked");
        else
            this.gridElem.classList.remove("is-state", "locked");

        // Show tag alias
        if(this.tagLabel) {
            if(this.config.showTagName) {
                this.tagLabel.classList.remove("hidden");
                this.tagLabel.textContent = this.tag ? this.tag.alias : "No Tag";
                this.tagLabel.title = this.tag ? this.tag.description : "";
            }
            else {
                this.tagLabel.classList.add("hidden");
            }
        }
        this.elem.title = this.tag ? this.tag.alias : "";
    }

    /**
     * Called when a new value for the tag is recieved from the server
     * @param {string | number | boolean} val
     * @param {string} time
     */
    onValue(val, time) {
        return;
    }

    /**
     * Handles new value from `onData`
     */
    clear() {
        return;
    }
}

/**
 * Abstract class for widgets than can write data.
 * 
 * Upon submitting a value, the widget will be locked until fail or a new value is read.
 * A fail effect will be created if the submit request fails, or a success effect if the next value read is the submitted value
 * @abstract
 */
class InputWidget extends Widget {
    static defaultFields = [ ...Widget.defaultFields,
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);

        /** Last value submitted successfully */
        this.lastSubmitted = null;

        /** Last value recieved from onValue */
        this.lastValue = null;
    }

    /**
     * Message the server to update this widget's tag with a new value, if it needs updating.
     * Prompts the user before submitting, if configured
     * @param {any} value The desired new value
     */
    async trySubmit(value) {
        this.lastSubmitted = null;

        if(value === this.lastValue || !this.tag) {
            return;
        }

        if(this.config.confirmation && !window.confirm(this.getConfirmMessage(value))) {
            return;
        }

        const submitted = await requestServer(`/api/write-requests/`, 'POST', { tag: this.tag.external_id, value: value });
        this.elem.classList.add('pending'); //TODO schedule remove?

        if(submitted)
            this.lastSubmitted = value;
        else {
            // Write request submission failed
            this.onValue(this.lastValue);
            flashBool(this.elem, false);
        }
    }

    /**
     * @returns the string to prompt the user with before submitting, if `this.config.confirmation`
     */
    getConfirmMessage(val) {
        return `Change ${this.tag.alias} to ${val}?`
    }

    /**
     * 
     * Checks if the new value is what was just submitted
     * @inheritdoc
     */
    onValue(val) {
        this.lastValue = val;
        if(this.lastSubmitted !== null && val == this.lastSubmitted) {
            // Value changed successfully!
            flashBool(this.elem, true);
            this.lastSubmitted = null;
        } //TODO flash bool if not the correct value? would need to make it so the server sends the tag update if failed
        this.elem.classList.remove('pending');
    }
}

// -------- Static Widgets --------

class LabelWidget extends Widget { //TODO font size, formatting?
    static customFields = [
        { name: "text", type: "text", default: "Label Text", label: "Text" },
    ]

    constructor(gridElem, config) {
        super(gridElem, config);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.text_elem.textContent = this.config.text;
        fitText(this.text_elem);
    }
}

// -------- Boolean Widgets --------

class BoolLabelWidget extends Widget {
    static allowedChannels = ["coil", "di", "hr", "ir"];
    static allowedTypes = ["bool"];
    static customFields = [
        { name: "text_on", type: "text", default: "On", label: "On Text", 
            description: "Text to display when the value is true." 
        },
        { name: "text_off", type: "text", default: "Off", label: "Off Text",
            description: "Text to display when the value is false." 
        },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.onValue(false);
        fitText(this.text_elem);
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
        fitText(this.text_elem);
    }

    clear() {
        this.onValue(false); //TODO?
    }
}

class SwitchWidget extends InputWidget {
    static allowedChannels = ["coil", "hr"];
    static allowedTypes = ["bool"];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.input = this.elem.querySelector(".switch-input");
        this.input.addEventListener("change", async () => this.trySubmit(this.input.checked));
    }

    getConfirmMessage(val) {
        return `Switch ${this.tag.alias} to ${val ? "ON" : "OFF"} position?`;
    }

    onValue(val) {
        super.onValue(val);
        this.input.checked = val ? true : false;
    }

    clear() {
        this.onValue(false);
    }
}

class LEDWidget extends Widget {
    static allowedChannels = ["coil", "di", "hr", "ir"];
    static allowedTypes = ["bool"];
    static customFields = [
        { name: "color_on", type: "color", default: "#00FF00", label: "On Color",
            description: "Color to display when the value is true." 
        },
        { name: "color_off", type: "color", default: "#FF0000", label: "Off Color",
            description: "Color to display when the value is false." 
        },
    ]
    
    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.indicator = this.elem.querySelector(".indicator");
    }

    onValue(val) {
        this.indicator.style.backgroundColor = val ? this.config.color_on : this.config.color_off;
        //this.indicator.style.boxShadow = val ? `0 0 15px ${this.config.color_on}` : "none";
    }

    clear() {
        this.indicator.style.backgroundColor = "";
    }
}

// -------- Number Widgets --------

class ButtonWidget extends InputWidget {
    static allowedChannels = ["coil", "hr"];
    static allowedTypes = ["bool", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "string"];
    static customFields = [
        { name: "button_text", type: "text", default: "Button Text", label: "Button Text" },
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
    ]
    static tagTypedFields = [
        { name: "submit_value", default: "", label: "Submit Value",
            description: "The value to write to the tag when clicked."
        }
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.button = this.elem.querySelector(".form-button");
        this.button.addEventListener("click", async () => this.trySubmit(this.config.submit_value));
    }

    applyConfig() {
        super.applyConfig();
        this.button.innerText = this.config.button_text;
    }
}

class DropdownWidget extends InputWidget {
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "dropdown_choices", type: "enum", default: [], label: "Dropdown Choices" },
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.select = this.elem.querySelector(".form-input"); //TODO?
        this.select.addEventListener("change", async () => this.trySubmit(Number(this.select.value)));
    }

    applyConfig() {
        this.select.options.length = 0;
        this.config.dropdown_choices.forEach(choice => {
            const opt = document.createElement('option');
            opt.value = choice.value;
            opt.label = choice.label;
            this.select.appendChild(opt);
        });
    }

    getConfirmMessage(val) {
        return `Change ${this.tag.alias} to ${this.select.label}?`;
    }

    onValue(val) {
        super.onValue(val);
        this.select.value = val;
    }

    clear() {
        this.select.value = "";
    }
}

class SliderWidget extends InputWidget {
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "step", type: "number", default: 1, label: "Step" },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
        { name: "display_range", type: "bool", default: true, label: "Show Range" },
        { name: "display_value", type: "bool", default: false, label: "Show Value" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.input = this.elem.querySelector(".slider-input");
        this.min_label = this.elem.querySelector(".min-label");
        this.max_label =  this.elem.querySelector(".max-label");
        this.value_label = this.elem.querySelector(".value-label");
        this.shouldUpdate = true;
        
        this.input.addEventListener("change", async () => {
            await this.trySubmit(this.input.value);
            this.shouldUpdate = true;
        });

        this.input.addEventListener("input", (e) => {
            // Prevent value updates when using the slider
            this.shouldUpdate = false;
            this._updateDisplayValue();
        })
    }

    applyConfig() {
        super.applyConfig();
        this.input.min = this.config.min_value;
        this.input.max = this.config.max_value;
        this.input.step = this.config.step;

        if(this.config.display_range) {
            this.min_label.textContent = this.input.min;
            this.max_label.textContent = this.input.max;
        }
        else {
            this.min_label.textContent = "";
            this.max_label.textContent = "";
        }
        this.clear();
    }

    onValue(val) {
        super.onValue(val);
        if(this.shouldUpdate) {
            this.input.value = val;
            this._updateDisplayValue(val);
        }
    }

    clear() {
        this.onValue(0);
    }

    _updateDisplayValue(val) {
        if(this.config.display_value)
            this.value_label.textContent = this.config.prefix + "Value: " + val + this.config.suffix; //TODO decimals
        else
            this.value_label.textContent = "";
    }
}

class MeterWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "low_value", type: "number", default: 0, label: "Low Value",
            description: "Minimum value considered low."
        },
        { name: "high_value", type: "number", default: 0, label: "High Value",
            description: "Minimum value considered high."
        },
        { name: "optimum_value", type: "number", default: 0, label: "Optimum Value",
            description: "The best value."
        },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
        { name: "display_value", type: "bool", default: false, label: "Show Value"},
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.bar = this.elem.querySelector(".meter-bar");
        this.min_label = this.elem.querySelector(".min-label");
        this.max_label =  this.elem.querySelector(".max-label");
        this.value_label = this.elem.querySelector(".value-label");
    }

    applyConfig() {
        super.applyConfig();
        this.bar.min = this.config.min_value;
        this.bar.max = this.config.max_value;
        this.bar.low = this.config.low_value;
        this.bar.high = this.config.high_value;
        this.bar.optimum = this.config.optimum_value;

        if(this.config.display_range) {
            this.min_label.textContent = this.config.prefix + this.bar.min + this.config.suffix;
            this.max_label.textContent = this.config.prefix + this.bar.max + this.config.suffix;
        }
        else {
            this.min_label.textContent = "";
            this.max_label.textContent = "";
        }
        this._updateDisplayValue();
        this.clear();
    }

    onValue(val) {
        this.bar.value = val;
        this._updateDisplayValue(val);
    }

    clear() {
        this.onValue(0);
    }

    _updateDisplayValue(val) {
        if(this.config.display_value)
            this.value_label.textContent = this.config.prefix + "Value: " + val + this.config.suffix; //TODO decimals
        else
            this.value_label.textContent = "";
    }
}

class MultiLabelWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "label_values", type: "enum", default: [], label: "Label Values" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        fitText(this.text_elem);
    }

    onValue(val) {
        const kv = this.config.label_values.find(kv => kv.value == val);
        this.text_elem.textContent = kv ? kv.label : `Unknown Value: ${val}`;
        fitText(this.text_elem);
    }

    clear() {
        this.text_elem.textContent = "Multi-Value Label";
    }
}

class NumberLabelWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "precision", type: "int", default: 0, label: "Decimal Places" },
        { name: "prefix", type: "text", default: "", label: "Prefix" },
        { name: "suffix", type: "text", default: "", label: "Suffix" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
        fitText(this.text_elem);
    }

    onValue(val) {
        this.text_elem.textContent = this.config.prefix + val.toFixed(this.config.precision) + this.config.suffix;
        fitText(this.text_elem);
    }

    clear() {
        this.onValue(0);
    }
}

class NumberInputWidget extends InputWidget {
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "float32", "float64"];
    static customFields = [
        { name: "precision", type: "int", default: 2, label: "Decimal Places" },
        { name: "step", type: "number", default: 1, label: "Step" },
        { name: "min", type: "number", default: 0, label: "Minimum Value" },
        { name: "max", type: "number", default: 100, label: "Maximum Value" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.input = this.elem.querySelector('input');
        this.button = this.elem.querySelector('.form-button');

        this.button.addEventListener('click', async () => {
            this.trySubmit(Number(this.input.value));
            this.input.blur(); 
        })
        this.input.onkeydown = (e) => {
            if (e.key === 'Enter') this.write();
        };

        // Prevent value updates while using the input
        this.isFocused = false;
        this.input.onfocus = () => { this.isFocused = true; };
        this.input.onblur = () => { this.isFocused = false; };
    }

    applyConfig() {
        super.applyConfig();
        this.input.step = this.config.step;
        this.input.min = this.config.min;
        this.input.max = this.config.max;
    }

    getConfirmMessage(val) {
        return `Set ${this.tag.alias} to ${this.input.value}?`;
    }

    onValue(val) {
        super.onValue(val);
        if (!this.isFocused) {
            if (typeof val === 'number' && val % 1 !== 0)
                val = parseFloat(val).toFixed(this.config.precision);
            this.input.value = val;
        }
    }

    clear() {
        this.input.value = "";
    }
}

class ChartWidget extends Widget { 
    static allowedChannels = ["hr", "ir"]; 
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "title", type: "text", default: "Tag History", label: "Title" },
        { name: "history_seconds", type: "number", default: 60, label: "History Length (s)",
            description: "The amount of time that the chart should display.",
        }, 
        { name: "chart_type", type: "select", default: "line", label: "Chart Type",
            options: [
                { value: "line", label: "Line Chart" },
                { value: "area", label: "Area Chart" },
                { value: "bar", label: "Bar Chart" },
            ]
        },
        { name: "plot_mode", type: "select", default: "lines", label: "Line Mode",
            options: [
                { value: "lines", label: "Lines Only" },
                { value: "markers", label: "Points Only" },
                { value: "lines+markers", label: "Lines & Points" }
            ]
        },
        { name: "line_color", type: "color", default: "#17BECF", label: "Line Color" },
        { name: "line_width", type: "number", default: 2, label: "Line Width" },
        { name: "show_grid", type: "bool", default: true, label: "Show Grid" },
        { name: "y_min", type: "number", default: null, label: "Y Min" },
        { name: "y_max", type: "number", default: null, label: "Y Max" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.pauseButton = this.elem.querySelector(".form-button");
        this.textColor = getComputedStyle(document.body).getPropertyValue('--text-main');
        this.realData = false;
        this.initPreview();

        this.resizeObserver = throttledResizeObserver(this.elem, () => {
            Plotly.Plots.resize(this.chartDiv);
        }, 100);

        this.pauseButton.addEventListener("click", () => {
            this.togglePaused();
        })
        this.chartDiv.innerText = "";
    }

    /**
     * Populate the chart with generated data
     */
    initPreview() {
        const now = new Date();
        const x = [], y = [];
        for(let i=0; i<20; i++) {
            x.push(new Date(now.getTime() - (20-i)*1000).toISOString());
            y.push(Math.sin(i/3) * 10);
        }

        // Store as "last" data so applyConfig has something to work with
        this.lastX = x;
        this.lastY = y;

        const config = { responsive: true, displayModeBar: false, staticPlot: true }; // Static plot for editor
        
        Plotly.newPlot(this.chartDiv, [this._getTrace(x, y)], this._getLayout(), config);

        this.realData = false;
    }

    /**
     * Populate the chart with actual data from the server
     */
    async initHistory() {
        if(this.initializing)
            return;

        this.initializing = true;

        try {
            // Fetch real history data
            const response = await fetch(`/api/history/?tags=${this.tag.external_id}&seconds=${this.config.history_seconds}`);
            if (!response.ok) 
                throw new Error("History fetch failed");

            const data = await response.json();
            const timestamps = data.map(e => e.timestamp);
            const values = data.map(e => e.value);

            const config = { responsive: true, displayModeBar: false, staticPlot: false };

            await Plotly.newPlot(this.chartDiv, [this._getTrace(timestamps, values)], this._getLayout(), config);
            this.realData = true;
        } 
        catch (err) {
            console.error("Error initializing chart:", err);
            this.chartDiv.innerHTML = `<div class="error-msg">Error loading chart</div>`;
        }
        finally {
            this.initializing = false;
        }        
    }

    /**
     * Stop or start the live value feed
     */
    togglePaused() {
        this.paused = !this.paused;
        this.pauseButton.innerText = this.paused ? "⏵︎" : "⏸︎";
        this.pauseButton.title = this.paused ? "Play" : "Pause";
        if(!this.paused && this.realData)
            this.initHistory();
    }

    applyConfig() {
        super.applyConfig();
        
        // If the chart exists, update layout/style without full re-fetch
        Plotly.react(this.chartDiv, [this._getTrace(this.lastX || [], this.lastY || [])], this._getLayout(), { 
            responsive: true, displayModeBar: false 
        });
    }

    onValue(val, time) { 
        if(!this.realData) {
            this.initHistory();
            return;
        }
        if(this.paused) {
            return;
        }

        const updateTime = new Date(time);
        const timeStr = updateTime.toISOString();
        const startTime = new Date(updateTime.getTime() - (this.config.history_seconds * 1000));

        const traces = { 
            x: [[timeStr]], 
            y: [[val]] 
        };

        Plotly.extendTraces(this.chartDiv, traces, [0]);

        Plotly.relayout(this.chartDiv, {
            'xaxis.range': [startTime.toISOString(), timeStr]
        });
    }

    clear() {
        if(!this.realData)
            return;
        
        this.initPreview();
    }

    _getLayout() {
        const gridColor = this.config.show_grid ? 'rgba(128, 128, 128, 0.2)' : 'rgba(0,0,0,0)';

        const yAxis = {
            gridcolor: gridColor,
            linecolor: this.textColor,
            tickfont: { color: this.textColor },
            autorange: (this.config.y_min == null || this.config.y_max == null),
        };

        if(!yAxis.autorange)
            yAxis.range = [this.config.y_min, this.config.y_max];

        return {
            title: {
                text: this.config.title,
                font: { color: this.textColor }
            },
            autosize: true,
            margin: { l: 40, r: 10, b: 30, t: 40, pad: 4 },
            xaxis: {
                type: 'date',
                gridcolor: gridColor,
                linecolor: this.textColor,
                tickfont: { color: this.textColor }
            },
            yaxis: yAxis,
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
        };
    }

    _getTrace(xData, yData) {
        // Default to scatter
        let traceType = 'scatter';
        let fillMode = 'none';

        // Handle specific Chart Types
        if (this.config.chart_type === 'bar') {
            traceType = 'bar';
        } 
        else if (this.config.chart_type === 'area') {
            fillMode = 'tozeroy'; // Fills space under the line
        }

        return {
            x: xData,
            y: yData,
            type: traceType,
            mode: this.config.plot_mode, // Only affects 'scatter' type
            fill: fillMode,              // Only affects 'scatter' type
            marker: {                    // Used for 'bar' and 'scatter' points
                color: this.config.line_color
            },
            line: { 
                color: this.config.line_color,
                width: this.config.line_width 
            }
        };
    }
}

class GaugeWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "float32", "float64"];
    
    static customFields = [
        { name: "title", type: "text", default: "", label: "Title" },
        { name: "min_value", type: "number", default: 0, label: "Min Value" },
        { name: "max_value", type: "number", default: 100, label: "Max Value" },
        { name: "warning_threshold", type: "number", default: 75, label: "Warning Start",
            description: "Minimum value of warning color. Purely visual."
        },
        { name: "critical_threshold", type: "number", default: 90, label: "Critical Start",
            description: "Minimum value of critical color. Purely visual."
        },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.textColor = getComputedStyle(document.body).getPropertyValue('--text-main');

        this.resizeObserver = throttledResizeObserver(this.elem, () => {
            Plotly.Plots.resize(this.chartDiv);
        }, 100);

        this.chartDiv.innerText = "";
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
    }

    onValue(val) {
        this.draw(val);
    }

    draw(val) {
        const config = { responsive: true, displayModeBar: false };
        Plotly.react(this.chartDiv, [this._getTrace(val)], this._getLayout(), config);
    }

    clear() {
        this.onValue(this.config.min_value);
    }

    _getTrace(val) {
        return {
            type: "indicator",
            mode: "gauge+number",
            value: val,
            number: { 
                prefix: this.config.prefix,
                suffix: this.config.suffix,
                font: { color: this.textColor, size: 20 }
            },
            gauge: {
                axis: { 
                    range: [this.config.min_value, this.config.max_value],
                    tickwidth: 1, 
                    tickcolor: this.textColor 
                },
                bar: { color: "darkblue" }, // TODO more customizations here?
                bgcolor: "rgba(0,0,0,0)",
                borderwidth: 2,
                bordercolor: "gray",
                steps: [
                    { range: [this.config.min_value, this.config.warning_threshold], color: "#2ecc71" },
                    { range: [this.config.warning_threshold, this.config.critical_threshold], color: "#f1c40f" },
                    { range: [this.config.critical_threshold, this.config.max_value], color: "#e74c3c" }
                ],
                threshold: {
                    line: { color: "red", width: 4 },
                    thickness: 0.75,
                    value: this.config.critical_threshold
                }
            }
        };
    }

    _getLayout() {
        return {
            title: { text: this.config.title, font: { size: 16, color: this.textColor } },
            margin: { t: 40, b: 0, l: 30, r: 30 },
            paper_bgcolor: "rgba(0,0,0,0)",
            font: { color: this.textColor }
        };
    }
}

/**
 * Call a function a given time after an element has stopped resizing
 * @param {HTMLElement} elem 
 * @param {()} cb 
 * @param {number} time 
 */
function throttledResizeObserver(elem, cb, time) {
    let resizeTimeout;
    const resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(cb, time);
    });
    resizeObserver.observe(elem);
    return resizeObserver;
}

/**
 * Attempt to update an element font size to fit its parent rect
 * @param {HTMLElement} elem 
 */
function fitText(elem) {
    const amt = Math.round(elem.textContent.length / 3) * 3;
    const k = 100;

    // measure container
    const rect = elem.parentElement.getBoundingClientRect();
    const aspect = rect.width / rect.height;

    // width assist factor (>= 1)
    const widthBoost = Math.min(1.75, Math.sqrt(aspect));
    const textScale = (k / Math.sqrt(amt));
    
    // Set font size
    elem.style.fontSize = `clamp(0.75rem, calc(${textScale} * ${widthBoost} * 1cqh), 5rem)`;
}

/**
 * Create a red or green pulse on an element
 * @param {HTMLElement} elem 
 * @param {boolean} flag 
 */
function flashBool(elem, flag) {
    const cls = flag ? 'flash-success' : 'flash-error';
    elem.classList.remove('flash-success', 'flash-error');
    void elem.offsetWidth;
    elem.classList.add(cls);
}

/** String -> Widget class map */
export const WidgetRegistry = {
    "switch": SwitchWidget,
    "slider": SliderWidget,
    "meter": MeterWidget,
    "led": LEDWidget,
    "label" : LabelWidget,
    "bool_label" : BoolLabelWidget,
    "multi_label" : MultiLabelWidget,
    "number_label" : NumberLabelWidget,
    "number_input" : NumberInputWidget,
    "chart": ChartWidget,
    "button" : ButtonWidget,
    "dropdown" : DropdownWidget,
    "gauge" : GaugeWidget,
};