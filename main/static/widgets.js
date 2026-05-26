import { requestServer, serverCache } from "./global.js";
import uPlot from "./lib/uPlot.esm.js";
/** @import { TagObject, TagHistoryObject, TagValueObject, AlarmConfigObject, InspectorFieldDefinition, ChannelType, DataType } from "./types.js" */

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
        { name: "background_color", type: "color", default: "", label: "Background Color" },
        { name: "outline_color", type: "color", default: "", label: "Outline Color" },
        { name: "text_color", type: "color", default: "", label: "Text Color" },
    ];

    /**
     * Subclass-specific inspector fields 
     * @type {InspectorFieldDefinition[]}
     */
    static customFields = [];

    /**
     * @param {HTMLElement} gridElem 
     * @param {Object} config 
     * @param {TagObject} tag 
     */
    constructor(gridElem, config, tag) {      
        // Apply defaults
        if(!config) config = {};
        const allFields = [...(new.target.defaultFields), ...(new.target.customFields)];
        allFields.forEach(field => {
            if(config[field.name] === undefined)
                config[field.name] = field.default;
        });

        /** @type {TagObject} meta describing the tag this widget should use */
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

        /** @type {HTMLElement?} Displays a symbol for an alarm, if active for the widget's tag */
        this.alarmIndicator = gridElem.querySelector(".alarm-indicator");

        /** @type {HTMLElement?} Displays the widget's tag alias */
        this.tagLabel = this.elem.parentNode?.querySelector(".widget-label");

        /** @type {ResizeObserver} */
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.elem);

        // Apply visual updates after child class construction
        setTimeout(() => this.applyConfig(), 0);
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
        this.elem.parentElement.style.backgroundColor = this.config.background_color;
        this.gridElem.style.backgroundColor = this.config.outline_color;
        this.gridElem.style.color = this.config.text_color; //TODO !important?
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
     * Called when the size of the widget element changes
     */
    onResize() {
        return;
    }

    /**
     * Return the widget to default. Called when entering edit mode
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
            flashBool(this.elem.parentElement, false);
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
        if(this.lastSubmitted !== null) {
            flashBool(this.elem.parentElement, val == this.lastSubmitted);
            this.lastSubmitted = null;
        }
        this.elem.classList.remove('pending');
    }
}

/**
 * Abstract class for a widget that uses tag history values.
 * 
 * Populates `xData` and `yData` arrays as values arrive from the server.
 * Automatically shifts this data to the `history_seconds` window.
 * @abstract
 */
class HistoryWidget extends Widget {
    static defaultFields = [
        { name: "history_seconds", type: "number", default: 60, label: "History Length (s)",
            description: "The maximum age of values that this widget should use.",
        }, ...Widget.defaultFields
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);

        /** @type {number[]} Timestamps for yData (seconds since epoch) */
        this.xData = [];

        /** @type {*[]} Tag values over time */
        this.yData = [];

        //setTimeout(() => this.initPreview(), 0);
    }

    /**
     * Populate `xData` and `yData` with data from the server
     */
    async initHistory() {
        if(this._initializing) return;

        this._initializing = true;

        const payload = { tags: this.tag.external_id, seconds: this.config.history_seconds };
        const success = await requestServer('/api/history/', 'GET', payload, /** @param {TagHistoryObject[]} data */ async (data) => {
            // uPlot requires UNIX timestamps in seconds
            this.xData = data.map(e => new Date(e.timestamp).getTime() / 1000);
            this.yData = data.map(e => e.value);

            this.onHistoryRecieved();
            this._realData = true;
        });

        if (!success) {
            console.error("Error initializing chart data.");
            this.chartDiv.innerHTML = `<div class="error-msg">Error loading chart</div>`;
        }

        this._initializing = false;    
    }

    /**
     * Called when initHistory is successful
     */
    onHistoryRecieved() {
        return;
    }

    /**
     * 
     * Adds the value to `xData`/`yData`
     * @inheritdoc
     */
    onValue(val, time) {
        if (!this._realData) { // Add the previous values first, if we don't have them
            this.initHistory();
            return;
        }

        const timeSec = new Date(time).getTime() / 1000;

        this.xData.push(timeSec);
        this.yData.push(val);

        const cutoff = timeSec - this.config.history_seconds;

        while (this.xData.length > 0 && this.xData[0] < cutoff) {
            this.xData.shift();
            this.yData.shift();
        }
    }

    /**
     * 
     * Clears `xData` and `yData`. 
     * Fake data can be safely added here, as it will be discarded the next time values are recieved.
     * @inheritdoc
     */
    clear() {
        //if(!this.realData) return;
        this.xData = [];
        this.yData = [];
        this._realData = false;
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

    onResize() {
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
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
        fitText(this.text_elem);
    }

    onResize() {
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
        { name: "submit_value", type: "text", default: "", label: "Submit Value", 
            description: "The value to write to the tag when clicked. Use 'true' or 'false' for boolean values."
        },
        { name: "button_text", type: "text", default: "Button Text", label: "Button Text" },
        { name: "button_color", type: "color", default: "", label: "Button Color" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.button = this.elem.querySelector(".form-button");
        this.button.addEventListener("click", async () => {
            if(this.config.submit_value === "" || this.config.submit_value === undefined) return;
            this.trySubmit(this.tag.data_type === "bool" 
                ? ["true", "1"].includes(this.config.submit_value.toLowerCase())  
                : Number(this.config.submit_value)
            );
        });
    }

    applyConfig() {
        super.applyConfig();
        this.button.innerText = this.config.button_text;
        this.button.style.backgroundColor = this.config.button_color;
        fitText(this.button);
    }

    onResize() {
        fitText(this.button);
    }
}

class DropdownWidget extends InputWidget {
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "dropdown_choices", type: "enum", default: [], label: "Dropdown Choices" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.select = this.elem.querySelector(".form-input"); //TODO?
        this.select.addEventListener("change", async () => this.trySubmit(Number(this.select.value)));
    }

    applyConfig() {
        super.applyConfig();
        this.select.options.length = 0;
        this.config.dropdown_choices.forEach(choice => {
            const opt = document.createElement('option');
            opt.value = choice.value;
            opt.label = choice.display_name;
            this.select.appendChild(opt);
        });
    }

    getConfirmMessage(val) {
        const kv = this.config.dropdown_choices.find(kv => kv.value == val);
        return `Change ${this.tag.alias} to ${kv.display_name}?`;
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
            this._updateDisplayValue(this.input.value);
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
            this.value_label.textContent = this.config.prefix + val + this.config.suffix; //TODO decimals
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
        this._updateDisplayValue(this.bar.value);
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
            this.value_label.textContent = this.config.prefix + val + this.config.suffix; //TODO decimals
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
        this.text_elem.textContent = kv ? kv.display_name : `Unknown Value: ${val}`;
        fitText(this.text_elem);
    }

    onResize() {
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
    }

    onValue(val) {
        this.text_elem.textContent = this.config.prefix + val.toFixed(this.config.precision) + this.config.suffix;
        fitText(this.text_elem);
    }

    onResize() {
        fitText(this.text_elem);
    }

    clear() {
        this.onValue(0);
    }
}

class TimeLabelWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32"];
    static _unitDisplayOptions = [
        { display_name: "Always", value: "always" },
        { display_name: "Auto", value: "auto" },
        { display_name: "None", value: "" },
    ];
    static customFields = [
        { name: "factor", type: "select", default: "0.001", label: "Input Format", options: [
            { display_name: "Hours", value: "3600" },
            { display_name: "Minutes", value: "60" },
            { display_name: "Seconds", value: "1" },
            { display_name: "Deciseconds", value: "0.1" },
            { display_name: "Centiseconds", value: "0.01" },
            { display_name: "Milliseconds", value: "0.001" },
            { display_name: "Microseconds", value: "0.000001" },
        ], description: "The expected time unit of the tag value." },
        { name: "style", type: "select", default: "digital", label: "Output Format", options: [
            { display_name: "Long", value: "long" },
            { display_name: "Short", value: "short" },
            { display_name: "Narrow", value: "narrow" },
            { display_name: "Digital", value: "digital" },
        ], description: "The style of the displayed time." },
        { name: "hours", type: "select", default: "always", label: "Hours Display", options: TimeLabelWidget._unitDisplayOptions },
        { name: "minutes", type: "select", default: "always", label: "Minutes Display", options: TimeLabelWidget._unitDisplayOptions },
        { name: "seconds", type: "select", default: "always", label: "Seconds Display", options: TimeLabelWidget._unitDisplayOptions },
        { name: "milliseconds", type: "select", default: "auto", label: "Milliseconds Display", options: TimeLabelWidget._unitDisplayOptions },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
    }

    onValue(val) {
        const totalSeconds = val * Number(this.config.factor);

        const duration = { 
            hours: this.config.hours ? Math.floor(totalSeconds / 3600) : undefined,
            minutes: this.config.minutes ? Math.floor((totalSeconds % 3600) / 60) : undefined,
            seconds: this.config.seconds ? Math.floor(totalSeconds % 60) : undefined,
            milliseconds: this.config.milliseconds ? Math.floor(totalSeconds * 1000) % 1000 : undefined,
        };
        const style = {
            style: this.config.style,
            hoursDisplay: this.config.hours || undefined,
            minutesDisplay: this.config.minutes || undefined,
            secondsDisplay: this.config.seconds || undefined,
            // Digital format requires fractionalDigits to force milliseconds, while the rest can use millisecondsDisplay
            millisecondsDisplay: this.config.style !== "digital" ? this.config.milliseconds || undefined : undefined,
            fractionalDigits: this.config.style === "digital" && this.config.milliseconds === "always" ? 3 : undefined,
        }

        const format = new Intl.DurationFormat("en-US", style);
        this.text_elem.textContent = this.config.prefix + format.format(duration) + this.config.suffix;

        fitText(this.text_elem);
    }

    onResize() {
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
        { name: "button_color", type: "color", default: "", label: "Button Color" },
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
        this.button.style.backgroundColor = this.config.button_color;
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

class GaugeWidget extends Widget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "float32", "float64"];
    
    static customFields = [
        { name: "title", type: "text", default: "", label: "Title" },
        { name: "min_value", type: "number", default: 0, label: "Min Value" },
        { name: "max_value", type: "number", default: 100, label: "Max Value" },
        { name: "warning_threshold", type: "number", default: 75, label: "Warning Start",
            description: "Minimum value for the warning color."
        },
        { name: "critical_threshold", type: "number", default: 90, label: "Critical Start",
            description: "Minimum value for the critical color."
        },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        
        // Grab the elements directly from the existing HTML structure
        this.valuePath = this.elem.querySelector('.gauge-value-path');
        this.valueText = this.elem.querySelector('.gauge-value-text');
        this.titleDiv = this.elem.querySelector('.gauge-title');

        // Grab the new zone paths
        this.safeZone = this.elem.querySelector('.safe-zone');
        this.warnZone = this.elem.querySelector('.warning-zone');
        this.critZone = this.elem.querySelector('.critical-zone');
    }

    applyConfig() {
        super.applyConfig();
        if (this.titleDiv) {
            this.titleDiv.textContent = this.config.title;
        }

        const range = this.config.max_value - this.config.min_value;

        if (range > 0) {
            // Calculate percentages (clamped between 0 and 1)
            let warnP = Math.max(0, Math.min(1, (this.config.warning_threshold - this.config.min_value) / range));
            let critP = Math.max(0, Math.min(1, (this.config.critical_threshold - this.config.min_value) / range));
            
            // Ensure warning doesn't overlap critical if configured backwards
            if (warnP > critP) warnP = critP;

            const totalLength = this.safeZone.getTotalLength();

            const safeLen = warnP * totalLength;
            const warnLen = (critP - warnP) * totalLength;
            const critLen = (1 - critP) * totalLength;

            // helper to apply a segment
            const setSegment = (el, len, offset) => {
                el.style.strokeDasharray = `${len} ${totalLength}`;
                el.style.strokeDashoffset = `-${offset}`;
            };

            setSegment(this.safeZone, safeLen, 0);
            setSegment(this.warnZone, warnLen, safeLen);
            setSegment(this.critZone, critLen, safeLen + warnLen);
        }
    }

    onValue(val) {
        // Clamp the value so the arc doesn't break if it exceeds bounds
        const clampedVal = Math.max(this.config.min_value, Math.min(this.config.max_value, val));
        
        // Calculate the percentage of the range
        const range = this.config.max_value - this.config.min_value;
        const percent = range === 0 ? 0 : (clampedVal - this.config.min_value) / range;

        const pathLength = this.safeZone.getTotalLength();
        const offset = pathLength - (percent * pathLength);
        
        // Update SVG path offset and text
        this.valuePath.style.strokeDashoffset = offset;
        
        // Format decimal display if needed
        const displayVal = (typeof val === 'number' && val % 1 !== 0) ? parseFloat(val).toFixed(2) : val;
        this.valueText.textContent = `${this.config.prefix}${displayVal}${this.config.suffix}`;
        
        // Update colors based on config thresholds
        if (val >= this.config.critical_threshold) {
            this.valuePath.style.stroke = "#e74c3c"; // Red
        } else if (val >= this.config.warning_threshold) {
            this.valuePath.style.stroke = "#f1c40f"; // Yellow
        } else {
            this.valuePath.style.stroke = "#2ecc71"; // Green
        }
    }

    clear() {
        this.onValue(this.config.min_value);
    }
}

// -------- History Widgets --------

class ChartWidget extends HistoryWidget { 
    static allowedChannels = ["hr", "ir"]; 
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "title", type: "text", default: "Tag History", label: "Title" },
        { name: "line_color", type: "color", default: "#17BECF", label: "Line Color" },
        { name: "line_width", type: "number", default: 2, label: "Line Width" },
        { name: "y_min", type: "number", default: null, label: "Y Min" },
        { name: "y_max", type: "number", default: null, label: "Y Max" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.pauseButton = this.elem.querySelector(".form-button");
        this.textColor = getComputedStyle(document.body).getPropertyValue('--text-main');
        this.uplot = null;
        this.pauseButton.addEventListener("click", () => this.togglePaused());
    }

    onHistoryRecieved() {
        this._renderPlot();
    }

    /**
     * Stop or start the live value feed
     */
    togglePaused() {
        this.paused = !this.paused;
        this.pauseButton.innerText = this.paused ? "⏵︎" : "⏸︎";
        this.pauseButton.title = this.paused ? "Play" : "Pause";
        if(!this.paused && this._realData) {
            this.initHistory();
        }
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
    }

    onValue(val, time) {
        if (this.paused)
            return;

        super.onValue(val, time);

        if (this.uplot) {
            this.uplot.setData([this.xData, this.yData]);

            // snap window to whole seconds
            const max = Math.ceil(this.xData.at(-1));
            const min = max - this.config.history_seconds;

            this.uplot.setScale("x", { min, max });
        }
    }

    onResize() {
        this.uplot?.setSize({
            width: this.chartDiv.clientWidth,
            height: this.chartDiv.clientHeight
        });
    }

    clear() {
        super.clear();
        const nowSec = Math.floor(Date.now() / 1000);        
        for(let i=0; i<20; i++) {
            this.xData.push(nowSec - (20-i));
            this.yData.push(Math.sin(i/3) * 10); // TODO use config max/min? idk
        }
        this._renderPlot();
    }

    _renderPlot() {
        if (this.uplot)
            this.uplot.destroy();

        this.chartDiv.innerHTML = "";

        const yAxisAuto = (this.config.y_min == null || this.config.y_max == null);
        
        const opts = {
            title: this.config.title,
            width: this.chartDiv.clientWidth || 300,
            height: this.chartDiv.clientHeight || 200,
            cursor: {
                drag: { x: true, y: true },
            },
            legend: { show: false },
            axes: [
                {
                    stroke: this.textColor,
                    grid: { stroke: "rgba(128, 128, 128, 0.2)" }
                },
                {
                    stroke: this.textColor,
                    grid: { stroke: "rgba(128, 128, 128, 0.2)" }
                }
            ],
            scales: {
                x: { time: true },
                y: {
                    auto: yAxisAuto,
                    range: yAxisAuto ? undefined : [this.config.y_min, this.config.y_max]
                }
            },
            series: [
                {},
                {
                    stroke: this.config.line_color,
                    width: this.config.line_width
                }
            ]
        };

        this.uplot = new uPlot(opts, [this.xData, this.yData], this.chartDiv);
    }
}

class TrendWidget extends HistoryWidget { 
    static allowedChannels = ["hr", "ir"]; 
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "max_roc", type: "number", default: 10, label: "Max Rate (units per Rate Unit)",
            description: "The rate of change that represents 100% magnitude (full arrow tilt)."
        },
        { name: "color_up", type: "color", default: "#2ecc71", label: "Rise Color" },
        { name: "color_down", type: "color", default: "#e74c3c", label: "Fall Color" },
        { name: "precision", type: "int", default: 2, label: "Decimal Places" },
        { name: "rate_unit", type: "select", default: "min", label: "Rate Unit", options: [
            { display_name: "Hours", value: "hour" },
            { display_name: "Minutes", value: "min" },
            { display_name: "Seconds", value: "sec" },
        ], description: "The time unit used to display the rate of change." },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
    ]

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.arrow = this.elem.querySelector(".trend-arrow");
        this.rocLabel = this.elem.querySelector(".roc-label");
    }

    onHistoryRecieved() {
        this.updateTrend();
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
    }

    onValue(val, time) {
        super.onValue(val, time);
        this.updateTrend();
    }

    onResize() {
        fitText(this.rocLabel.parentElement);
        fitText(this.arrow.parentElement);
    }

    /**
     * Computes the slope over all active points using Ordinary Least Squares
     */
    updateTrend() {
        const n = this.xData.length;
        if (n < 2) return;

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        
        // Using a baseline (the oldest point) keeps numeric precision high for timestamps
        const x0 = this.xData[0]; 

        for (let i = 0; i < n; i++) {
            const x = this.xData[i] - x0;
            const y = this.yData[i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        const denominator = (n * sumXX - sumX * sumX);
        
        // If all points have the exact same timestamp, slope is vertical/undefined
        if (denominator === 0) return;

        // Slope per second (dx/dt)
        const slopePerSecond = (n * sumXY - sumX * sumY) / denominator;

        const roc = 
            this.config.rate_unit === "sec" ? slopePerSecond : 
            this.config.rate_unit === "min" ? slopePerSecond * 60 :
            this.config.rate_unit === "hour" ? slopePerSecond * 3600 : 0;

        this.setTrend(roc);
    }

    /**
     * Updates the text label, rotates the arrow tangent to the slope, and updates color
     */
    setTrend(roc) {
        // RoC label
        const pct = Math.max(-1, Math.min(1, roc / this.config.max_roc));
        const sign = roc > 0 ? "+" : "";
        const rocStr = `${this.config.prefix}${sign}${roc.toFixed(this.config.precision)}${this.config.suffix}`
        this.rocLabel.textContent = `${rocStr} / ${this.config.rate_unit}`;
        fitText(this.rocLabel.parentElement);

        // Arrow color & transform
        const angle = pct * -90 + 90;
        this.arrow.style.transform = `rotate(${angle}deg)`;
        this.arrow.style.color = 
            Math.abs(pct) < 0.05 ? "var(--text-main, #ffffff)" :
            pct > 0 ? this.config.color_up : this.config.color_down;
    }

    clear() {
        super.clear();
        this.setTrend(0);
    }
}

class HistogramWidget extends HistoryWidget {
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "title", type: "text", default: "Histogram", label: "Title" },
        { name: "bins", type: "int", default: 20, label: "Bin Count" },
        { name: "bar_color", type: "color", default: "#3498db", label: "Bar Color" },
    ];

    constructor(gridElem, config, tag) {
        super(gridElem, config, tag);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.uplot = null;
    }

    onHistoryRecieved() {
        this.renderHistogram();
    }

    onValue(val, time) {
        super.onValue(val, time);
        this.renderHistogram();
    }

    applyConfig() {
        super.applyConfig();
        this.clear();
    }

    clear() {
        super.clear();

        const now = Date.now() / 1000;
        const mean = 50, stddev = 10, totalSamples = 1000; 
        const binCount = Math.max(1, this.config.bins);

        // Gaussian curve
        for (let i = 0; i < binCount; i++) {
            const t = (i / (binCount - 1)) * 6 - 3; // Ranges from -3 to +3
            const value = mean + t * stddev;
            const exponent = -0.5 * Math.pow(t, 2);
            const density = Math.exp(exponent); // Relative height (0 to 1)
            const countForBin = Math.round(density * (totalSamples / binCount) * 2.5);

            for (let j = 0; j < countForBin; j++) {
                this.yData.push(value);
                this.xData.push(now + this.yData.length);
            }
        }

        this.renderHistogram();
    }

    onResize() {
        this.uplot?.setSize({
            width: this.chartDiv.clientWidth,
            height: this.chartDiv.clientHeight,
        });
    }

    computeHistogram() {
        if (this.yData.length === 0)
            return { bins: [], counts: [] };

        const values = this.yData;

        const min = Math.min(...values);
        const max = Math.max(...values);

        if (min === max) {
            return { bins: [min], counts: [values.length] };
        }

        const binCount = Math.max(1, this.config.bins);
        const binSize = (max - min) / binCount;
        const counts = new Array(binCount).fill(0);
        const bins = new Array(binCount);

        for (let i = 0; i < binCount; i++) {
            bins[i] = min + (i + 0.5) * binSize;
        }

        for (const value of values) {
            let idx = Math.floor((value - min) / binSize);

            // include max value in last bucket
            if (idx >= binCount)
                idx = binCount - 1;

            counts[idx]++;
        }

        return { bins, counts };
    }

    renderHistogram() {
        const { bins, counts } = this.computeHistogram();

        if (this.uplot)
            this.uplot.destroy();

        this.chartDiv.innerHTML = "";

        if (bins.length < 2)
            return;

        // Get half the width of a single bin to use as padding
        const binWidth = bins[1] - bins[0];
        const halfWidth = binWidth / 2;
        const minX = bins[0] - binWidth * 0.6;
        const maxX = bins[bins.length - 1] + binWidth * 0.6;

        const opts = {
            title: this.config.title,
            width: this.chartDiv.clientWidth || 300,
            height: this.chartDiv.clientHeight || 200,
            scales: {
                x: { time: false, min: minX, max: maxX },
                y: { auto: true }
            },
            axes: [
                { label: "Value" },
                { label: "Count" }
            ],
            series: [
                {},
                {
                    fill: this.config.bar_color,
                    stroke: this.config.bar_color,
                    paths: uPlot.paths.bars({
                        size: [0.9, 100],
                        align: 0, // Keep center alignment
                    }),
                }
            ]
        };

        this.uplot = new uPlot(opts, [bins, counts], this.chartDiv);
    }
}

/**
 * Attempt to update an element font size to fit its parent rect
 * @param {HTMLElement} elem 
 */

function fitText(elem) {
    const p = elem.parentElement;
    if (!p) return;

    const cs = getComputedStyle(p);
    const maxW = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const maxH = p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

    const MIN = 6, MAX = 196;

    const fits = s => {
        elem.style.fontSize = s + "px";
        return elem.scrollWidth <= maxW + 1 && elem.scrollHeight <= maxH + 1;
    };

    let cur = +elem.dataset.lastFit || parseFloat(getComputedStyle(elem).fontSize) || 16;
    let lo = cur, hi = cur, step = 1;

    if (fits(cur)) {
        while ((hi = cur + step) <= MAX && fits(hi)) {
            lo = hi;
            step *= 2;
        }
        hi = Math.min(hi, MAX);
    } 
    else {
        while ((lo = cur - step) >= MIN && !fits(lo)) {
            hi = lo;
            step *= 2;
        }
        lo = Math.max(lo, MIN);
    }

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        fits(mid) ? lo = mid + 1 : hi = mid - 1;
    }

    elem.dataset.lastFit = hi;
    elem.style.fontSize = hi * 0.8 + "px";
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
    "time_label" : TimeLabelWidget,
    "number_input" : NumberInputWidget,
    "chart": ChartWidget,
    "button" : ButtonWidget,
    "dropdown" : DropdownWidget,
    "gauge" : GaugeWidget,
    "trend" : TrendWidget,
    "histogram" : HistogramWidget,
};