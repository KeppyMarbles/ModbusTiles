import { getCookie } from "./util.js";
import { serverCache } from "./global.js";

class Widget {
    static displayName = "Default Widget";
    static allowedChannels = [];
    static allowedTypes = [];
    static defaultFields = [
        { name: "locked", type: "bool", default: false, label: "Position Locked" },
        { name: "showTagName", type: "bool", default: true, label: "Show Tag Name" },
    ];
    static customFields = [];
    dynamicFields = [];
    dataType = null;

    constructor(gridElem, config, tagID) { // unsure if the tagID should be part of config or not        
        // Apply defaults
        if(!config) config = {};
        const allFields = [...(new.target.defaultFields), ...(new.target.customFields), ...(this.dynamicFields)];
        allFields.forEach(field => {
            if(config[field.name] === undefined)
                config[field.name] = field.default;
        });
        this.config = config;

        this.tag = tagID;
        this.elem = gridElem.querySelector('.dashboard-widget');
        this.shouldUpdate = true;
        this.updateTimeout = 500; //TODO where should these values live?
        this.valueTimeout = 5000;
        this.alarmIndicator = this.elem.parentNode?.querySelector(".alarm-indicator");
        this.label = this.elem.parentNode?.querySelector(".widget-label");
        this.showAlarm = true;
        this.gridElem = gridElem;
        gridElem.widgetInstance = this;

        // Apply visual updates after construction
        setTimeout(() => {
            this.applyConfig();
        }, 0);
    }

    async submit(value) {
        if(!this.tag) {
            console.error("No tag value to submit");
            return;
        }

        this.shouldUpdate = false;
        clearTimeout(this.timeoutID);

        const response = await fetch(`/api/write-requests/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCookie("csrftoken")
            },
            body: JSON.stringify({ 
                tag: this.tag,
                value: value,
            })
        });

        const result = await response.json();

        if (result.error) {
            alert("Failed to write value: " + result.error);
        }

        this.timeoutID = setTimeout(() => {
            this.shouldUpdate = true;
        }, this.updateTimeout);
    }

    onData(data) {
        if(data.age > this.valueTimeout) 
            this.elem.classList.add("is-state", "no-connection");
        else
            this.elem.classList.remove("is-state", "no-connection"); //TODO disable interactions?

        this.onValue(data.value, data.time);
        
        if(this.showAlarm)
            this.setAlarm(data.alarm);
    }

    setAlarm(alarm) {
        this.elem.classList.remove("threat-high");
        
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
                    this.elem.classList.add("threat-high");
                    break;
            }
        }
        else {
            this.alarmIndicator.classList.add("hidden");
            this.alarmIndicator.title = "";
        }
    }

    applyConfig() {
        // Handle "locked" state
        const widgetNode = this.gridElem?.gridstackNode;
        if(widgetNode && widgetNode.locked != this.config["locked"]) {
            widgetNode.grid.update(widgetNode.el, { //TODO breaks if we add widgets that are locked size by default
                locked: this.config["locked"],
                noResize: this.config["locked"],
                noMove: this.config["locked"],
            })
        }
        if(this.config["locked"])
            this.gridElem.classList.add("is-state", "locked");
        else
            this.gridElem.classList.remove("is-state", "locked");

        // Show tag alias
        if(this.config["showTagName"]) {
            this.label.classList.remove("hidden");
            const tag = serverCache.tags.find(t => t.external_id === this.tag);
            if(tag) {
                this.label.textContent = tag.alias;
                this.label.title = tag.description;
            }
        }
        else {
            this.label.classList.add("hidden");
        }

        //TODO add tag name
    }

    onValue(val) {
        throw new Error("onValue not implemented for this widget");
    }

    clear() {
        return;
    }
}

class SwitchWidget extends Widget {
    static displayName = "Switch";
    static allowedChannels = ["coil"];
    static allowedTypes = ["bool"];
    static customFields = [
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.input = this.elem.querySelector(".switch-input");
        this.input.addEventListener("change", async () => {
            if(this.config.confirmation && !window.confirm(`Switch to ${this.input.checked ? "ON" : "OFF"} position?`))
                this.input.checked = !this.input.checked;
            else
                this.submit(this.input.checked);
        });
        this.showAlarm = false;
    }

    onValue(val) {
        if(this.shouldUpdate)
            this.input.checked = val ? true : false;
    }

    clear() {
        this.input.checked = false;
    }
}

class SliderWidget extends Widget {
    static displayName = "Slider";
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "step", type: "number", default: 1, label: "Step"},
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.input = this.elem.querySelector(".slider-input")
        this.min_label = this.elem.querySelector(".min-label")
        this.max_label =  this.elem.querySelector(".max-label")
        
        this.input.addEventListener("change", async () => {
            this.submit(this.input.value);
        });
        this.input.addEventListener("input", (e) => {
            clearTimeout(this.timeoutID); //TODO make sure this happens before the "change" event
            this.shouldUpdate = false;
        })
        this.showAlarm = false;
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
    }

    onValue(val) {
        if(this.shouldUpdate)
            this.input.value = val;
    }

    clear() {
        this.input.value = 0;
    }
}

class ButtonWidget extends Widget {
    static displayName = "Slider";
    static allowedChannels = ["coil", "hr"];
    static allowedTypes = ["bool", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "string"];
    static customFields = [
        { name: "button_text", type: "text", default: "Button Text", label: "Button Text" },
    ]
    dynamicFields = [
        { name: "submit_value", default: "", label: "Submit Value" }
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.button = this.elem.querySelector(".form-button");

        this.button.addEventListener("click", async () => {
            this.submit(this.config.submit_value);
        });
        this.showAlarm = false;
    }

    applyConfig() {
        super.applyConfig();
        this.button.innerText = this.config.button_text;
    }

    onValue(val) {
        return;
    }
}

class DropdownWidget extends Widget {
    static displayName = "Dropdown";
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "dropdown_choices", type: "enum", default: [], label: "Dropdown Choices" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.select = this.elem.querySelector(".form-input"); //TODO?

        this.select.addEventListener("change", async () => {
            this.submit(this.select.value);
        });
        this.showAlarm = false;
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

    onValue(val) {
        this.select.value = val;
    }

    clear() {
        this.select.value = "";
    }
}

class MeterWidget extends Widget {
    static displayName = "Meter";
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "low_value", type: "number", default: 0, label: "Low Value" },
        { name: "high_value", type: "number", default: 0, label: "High Value" },
        { name: "optimum_value", type: "number", default: 0, label: "Optimum Value" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.bar = this.elem.querySelector(".meter-bar");
        this.min_label = this.elem.querySelector(".min-label")
        this.max_label =  this.elem.querySelector(".max-label")
    }

    applyConfig() {
        super.applyConfig();
        this.bar.min = this.config.min_value;
        this.bar.max = this.config.max_value;
        this.bar.low = this.config.low_value;
        this.bar.high = this.config.high_value;
        this.bar.optimum = this.config.optimum_value;

        if(this.config.display_range) {
            this.min_label.textContent = this.bar.min;
            this.max_label.textContent = this.bar.max;
        }
        else {
            this.min_label.textContent = "";
            this.max_label.textContent = "";
        }
    }

    onValue(val) {
        this.bar.value = val;
    }

    clear() {
        this.bar.value = 0;
    }
}

class LEDWidget extends Widget {
    static displayName = "Light";
    static allowedChannels = ["coil", "di"];
    static allowedTypes = ["bool"];
    static customFields = [
        { name: "color_on", type: "color", default: "#00FF00", label: "On Color" },
        { name: "color_off", type: "color", default: "#FF0000", label: "Off Color" },
    ]
    
    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
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

class LabelWidget extends Widget { //TODO font size, formatting?
    static displayName = "Label";
    static customFields = [
        { name: "text", type: "text", default: "Label Text", label: "Text" },
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
        
        this.showAlarm = false;
    }

    applyConfig() {
        super.applyConfig();
        this.text_elem.textContent = this.config.text;
    }
}

class BoolLabelWidget extends Widget {
    static displayName = "Boolean Label";
    static allowedChannels = ["coil", "di"];
    static allowedTypes = ["bool"];
    static customFields = [
        { name: "text_on", type: "text", default: "On", label: "On Text" },
        { name: "text_off", type: "text", default: "Off", label: "Off Text" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.text_elem.textContent = this.config.text_off; //TODO?
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
    }

    clear() {
        this.text_elem.textContent = this.config.text_off;
    }
}

class ValueLabelWidget extends Widget {
    
}

class ChartWidget extends Widget {
    static displayName = "History Chart";
    static allowedChannels = ["hr", "ir"]; //TODO support boolean values
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "title", type: "text", default: "Title", label: "Title" },
        { name: "history_seconds", type: "number", default: 60, label: "History Length (seconds)" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.showAlarm = false;

        this.historyDurationSeconds = this.config.history_seconds;
        //this.maxPoints = this.config.max_points || 1000;
    }

    async initChart() {
        try {
            const response = await fetch(`/api/history/?tags=${this.tag}&seconds=${this.historyDurationSeconds}`);
            if (!response.ok) throw new Error("History fetch failed");

            const data = await response.json();
            
            const timestamps = data.map(e => e.timestamp);
            const values = data.map(e => e.value);

            console.log("Got", values.length, "values from history");

            // Data trace
            const trace = {
                x: timestamps,
                y: values,
                mode: 'lines',
                type: 'scatter',
                line: { color: this.config.line_color || '#17BECF' }
            };

            // Layout
            const layout = {
                title: this.config.title || 'Tag History',
                autosize: true,
                margin: { l: 30, r: 10, b: 30, t: 30, pad: 4 },
                xaxis: {
                    type: 'date',
                },
                yaxis: {
                    autorange: true
                },
                //paper_bgcolor: 'rgba(0,0,0,0)',
                //plot_bgcolor: 'rgba(0,0,0,0)',
                //font: {
                //    color: '#ccc'
                //}
            };

            const config = { responsive: true, displayModeBar: false };

            await Plotly.newPlot(this.chartDiv, [trace], layout, config);

            this.initialized = true;
        } 
        catch (err) {
            console.error("Error initializing chart:", err);
            this.chartDiv.innerHTML = "Error loading chart data";
        }
    }

    applyConfig() {
        super.applyConfig();
        //TODO
    }

    onValue(val, time) {
        if(this.initialized) {
            const updateTime = new Date(time);
            const timeStr = updateTime.toISOString();

            const startTime = new Date(updateTime.getTime() - (this.historyDurationSeconds * 1000));
            const startTimeStr = startTime.toISOString();

            Plotly.extendTraces(this.chartDiv, {
                x: [[timeStr]],
                y: [[val]]
            }, [0], this.maxPoints);
            Plotly.relayout(this.chartDiv, {
                'xaxis.range': [startTimeStr, timeStr]
            });
        }
        else {
            this.initChart();
        }
    }
}

export const WidgetRegistry = {
    "switch": SwitchWidget,
    "slider": SliderWidget,
    "meter": MeterWidget,
    "led": LEDWidget,
    "label" : LabelWidget,
    "bool_label" : BoolLabelWidget,
    "chart": ChartWidget,
    "button" : ButtonWidget,
    "dropdown" : DropdownWidget,
};