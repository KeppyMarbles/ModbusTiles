import { getCookie } from "./util.js";

class Widget {
    static displayName = "Default Widget";
    static defaultFields = [
        //{ name: "position_x", type: "number", default: 0, label: "Position X" },
        //{ name: "position_x", type: "number", default: 0, label: "Position Y" },
        //{ name: "scale_x", type: "number", default: 1, label: "Size X" },
        //{ name: "scale_y", type: "number", default: 1, label: "Size Y" },
        { name: "tag", type: "tag_picker", default: null, label: "Control Tag"},
    ]
    static customFields = [];

    constructor(widgetElem, config, tagID) { // unsure if the tagID should be part of config or not
        if(config) {
            this.config = config;
        }
        else {
            this.config = {};
            const allFields = [...(new.target.defaultFields), ...(new.target.customFields)];
            allFields.forEach(field => {
                this.config[field.name] = field.default;
            });
        }

        this.elem = widgetElem;
        this.tag = tagID;
        this.shouldUpdate = true;
        this.updateTimeout = 500; //TODO where should these values live?
        this.valueTimeout = 5000;
        this.alarmIndicator = widgetElem.parentNode?.querySelector(".alarm-indicator");
        this.showAlarm = true;
        widgetElem.widgetInstance = this;
    }

    async submit(value) {
        //TODO yes/no confirmation if configured?
        if(!this.tag) {
            console.error("No tag value to submit");
            return;
        }

        console.log("Submitting", value)
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
        console.log(result)
        if (result.error) {
            alert("Failed to write value: " + result.error);
        }

        this.timeoutID = setTimeout(() => {
            this.shouldUpdate = true;
        }, this.updateTimeout);
    }

    onData(data) {
        if(data.age > this.valueTimeout) 
            this.elem.classList.add("no-connection");
        else
            this.elem.classList.remove("no-connection"); //TODO disable interactions?

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
        return;
    }

    onValue(val) {
        throw new Error("onValue not implemented for this widget");
    }
}

class SwitchWidget extends Widget {
    static displayName = "Switch";
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
}

class SliderWidget extends Widget {
    static displayName = "Slider";
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "width", type: "number", default: 300, label: "Width"},
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        console.log(widget_elem);
        this.input = this.elem.querySelector(".slider-input")
        console.log(this.input);
        this.min_label = this.elem.querySelector(".min-label")
        this.max_label =  this.elem.querySelector(".max-label")

        this.applyConfig();
        
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
        this.input.min = this.config.min_value;
        this.input.max = this.config.max_value;

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
}

class MeterWidget extends Widget {
    static displayName = "Meter";
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "low_value", type: "number", default: 0, label: "Low Value" },
        { name: "high_value", type: "number", default: 0, label: "High Value" },
        { name: "optimum_value", type: "number", default: 0, label: "Optimum Value" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
        { name: "width", type: "number", default: 300, label: "Width"},
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.bar = this.elem.querySelector(".meter-bar");
        this.min_label = this.elem.querySelector(".min-label")
        this.max_label =  this.elem.querySelector(".max-label")
        
        this.applyConfig();
    }

    applyConfig() {
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
}

class LEDWidget extends Widget {
    static displayName = "Light";
    static customFields = [
        { name: "color_on", type: "color", default: "green", label: "On Color" },
        { name: "color_off", type: "color", default: "red", label: "Off Color" },
    ]
    
    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.indicator = this.elem.querySelector(".indicator");
        this.applyConfig();
    }

    applyConfig() {
        this.indicator.style.backgroundColor = this.config.color_off; //TODO?
    }

    onValue(val) {
        this.indicator.style.backgroundColor = val ? this.config.color_on : this.config.color_off;
        //this.indicator.style.boxShadow = val ? `0 0 15px ${this.config.color_on}` : "none";
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
        
        this.applyConfig();
        
        this.showAlarm = false;
    }

    applyConfig() {
        this.text_elem.textContent = this.config.text;
    }
}

class BoolLabelWidget extends Widget {
    static displayName = "Boolean Label";
    static customFields = [
        { name: "text_on", type: "text", default: "On", label: "On Text" },
        { name: "text_off", type: "text", default: "Off", label: "Off Text" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.text_elem = this.elem.querySelector(".label_text");
        this.applyConfig();
    }

    applyConfig() {
        this.text_elem.textContent = this.config.text_off; //TODO?
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
    }
}

class ValueLabelWidget extends Widget {
    
}

class ChartWidget extends Widget {
    static displayName = "History Chart";
    static customFields = [
        { name: "title", type: "text", default: "Title", label: "Title" },
        { name: "history_seconds", type: "number", default: 60, label: "History Length (seconds)" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.showAlarm = false;

        this.historyDurationSeconds = this.config.history_seconds || 60;
        this.maxPoints = this.config.max_points || 1000;
    }

    async initChart() {
        try {
            const response = await fetch(`/api/history/?tags=${this.tag}&seconds=${this.historyDurationSeconds}`);
            if (!response.ok) throw new Error("History fetch failed");

            const data = await response.json();
            
            const timestamps = data.map(e => e.timestamp);
            const values = data.map(e => e.value);

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
};