import { getCookie } from "./util.js";

class Widget {
    displayName = "Default Widget";
    defaultFields = [
        { name: "position_x", type: "number", default: 0, label: "Position X" },
        { name: "position_x", type: "number", default: 0, label: "Position Y" },
        { name: "scale_x", type: "number", default: 1, label: "Size X" },
        { name: "scale_y", type: "number", default: 1, label: "Size Y" },
        { name: "tag", type: "tag_picker", default: null, label: "Control Tag"},
    ]
    customFields = [];

    constructor(widget_elem, config) {
        this.elem = widget_elem;
        this.config = config;
        this.tag = this.elem.dataset.tag; //TODO?
        this.shouldUpdate = true;
        this.updateTimeout = 500; //TODO where should these values live?
        this.valueTimeout = 5000;
        this.elem.style.left = config.position_x + "px";
        this.elem.style.top = config.position_y + "px";
        this.elem.style.transform = `scale(${config.scale_x}, ${config.scale_y})`;
        this.alarmIndicator = widget_elem.querySelector(".alarm-indicator");
        this.showAlarm = true;
    }

    async submit(value) {
        //TODO yes/no confirmation if configured?
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

    onValue(val) {
        throw new Error("onValue not implemented for this widget");
    }
}

class SwitchWidget extends Widget {
    displayName = "Switch";

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.input = this.elem.querySelector(".switch-input");
        this.input.addEventListener("change", async () => {
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
    displayName = "Slider";
    customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
        { name: "width", type: "number", default: 300, label: "Width"},
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.input = this.elem.querySelector(".slider-input")
        this.min_label = this.elem.querySelector(".min-label")
        this.max_label =  this.elem.querySelector(".max-label")

        this.input.min = this.config.min_value;
        this.input.max = this.config.max_value;

        if(this.config.display_range) {
            this.min_label.textContent = this.input.min;
            this.max_label.textContent = this.input.max;
        }

        this.elem.style.width = this.config.width;
        
        this.input.addEventListener("change", async () => {
            this.submit(this.input.value);
        });
        this.input.addEventListener("input", (e) => {
            clearTimeout(this.timeoutID); //TODO make sure this happens before the "change" event
            this.shouldUpdate = false;
        })
        this.showAlarm = false;
    }

    onValue(val) {
        if(this.shouldUpdate)
            this.input.value = val;
    }
}

class MeterWidget extends Widget {
    displayName = "Meter";
    customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "low_value", type: "number", default: 0, label: "Low Value" },
        { name: "high_value", type: "number", default: 0, label: "High Value" },
        { name: "optimum_value", type: "number", default: 0, label: "Optimum Value" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
        { name: "width", type: "number", default: 300, label: "Width"},
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.bar = this.elem.querySelector(".meter-bar");

        this.bar.min = this.config.min_value;
        this.bar.max = this.config.max_value;
        this.bar.low = this.config.low_value;
        this.bar.high = this.config.high_value;
        this.bar.optimum = this.config.optimum_value;

        if(this.config.display_range) {
            this.querySelector(".min-label").textContent = this.bar.min;
            this.querySelector(".max-label").textContent = this.bar.max;
        }

        this.elem.style.width = this.config.width;
    }

    onValue(val) {
        this.bar.value = val;
    }
}

class LEDWidget extends Widget {
    displayName = "Light";
    customFields = [
        { name: "color_on", type: "color", default: "green", label: "On Color" },
        { name: "color_off", type: "number", default: 10, label: "Off Color" },
    ]
    
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.indicator = this.elem.querySelector(".indicator");
    }

    onValue(val) {
        this.indicator.style.backgroundColor = val ? this.config.color_on : this.config.color_off;
    }
}

class LabelWidget extends Widget {
    displayName = "Label";
    customFields = [
        { name: "text", type: "text", default: "Text Label", label: "Text" },
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
        this.text_elem.textContent = this.config.text;
        this.showAlarm = false;
    }
}

class BoolLabelWidget extends Widget {
    displayName = "Boolean Label";
    customFields = [
        { name: "text_on", type: "text", default: "On", label: "On Text" },
        { name: "text_off", type: "text", default: "Off", label: "Off Text" },
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
    }
}

class ValueLabelWidget extends Widget {
    
}

class ChartWidget extends Widget {
    displayName = "History Chart";
    customFields = [
        { name: "title", type: "text", default: "Title", label: "Title" },
        { name: "history_seconds", type: "number", default: 60, label: "History Length (seconds)" },
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.showAlarm = false;

        this.historyDurationSeconds = config.history_seconds || 60;
        this.maxPoints = config.max_points || 1000;
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