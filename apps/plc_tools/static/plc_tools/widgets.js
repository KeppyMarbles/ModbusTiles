import { getCookie } from "./util.js";

class Widget {
    constructor(widget_elem, config) {
        this.elem = widget_elem;
        this.config = config;
        this.tag = this.elem.dataset.tag; //TODO?
        this.shouldUpdate = true;
        this.updateTimeout = 500; // TODO should be at least the server polling rate
        this.elem.style.left = config.position_x + "px";
        this.elem.style.top = config.position_y + "px";
        this.elem.style.transform = `scale(${config.scale_x}, ${config.scale_y})`;
    }

    async submit(value) {
        //TODO yes/no confirmation if configured?
        console.log("Submitting", value)
        this.shouldUpdate = false;
        clearTimeout(this.timeoutID);

        const response = await fetch(`/api/tag/${this.tag}/write/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCookie("csrftoken")
            },
            body: JSON.stringify({ value: value })
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

    onValue(val) {
        throw new Error("onValue not implemented for this widget");
    }
}
//
class SwitchWidget extends Widget {
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.input = this.elem.querySelector(".switch-input");
        this.input.addEventListener("change", async () => {
            this.submit(this.input.checked);
        });
    }

    onValue(val) {
        if(this.shouldUpdate)
            this.input.checked = val ? true : false;
    }
}

class SliderWidget extends Widget {
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
    }

    onValue(val) {
        if(this.shouldUpdate)
            this.input.value = val;
    }
}

class MeterWidget extends Widget {
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
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.indicator = this.elem.querySelector(".indicator");
    }

    onValue(val) {
        this.indicator.style.backgroundColor = val ? this.config.color_on : this.config.color_off;
    }
}

class LabelWidget extends Widget {
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
        this.text_elem.textContent = this.config.text;
    }
}

class BoolLabelWidget extends Widget {
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
    }
}

class ChartWidget extends Widget {
    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.chartDiv = this.elem.querySelector(".chart-container");

        this.historyDurationSeconds = config.history_seconds || 60;
        this.maxPoints = config.max_points || 1000;

        this.initChart();
    }

    async initChart() {
        try {
            const response = await fetch(`/api/tag/${this.tag}/history/?minutes=${this.historyDurationMinutes}`);
            const data = await response.json();
            
            // Data arrays
            const timestamps = data.history.map(e => e.timestamp);
            const values = data.history.map(e => e.value);

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
        const updateTime = new Date(time);
        const timeStr = updateTime.toISOString();

        const startTime = new Date(updateTime.getTime() - (this.historyDurationSeconds * 1000));
        const startTimeStr = startTime.toISOString();
        
        if(this.initialized) {
            Plotly.extendTraces(this.chartDiv, {
                x: [[timeStr]],
                y: [[val]]
            }, [0], this.maxPoints);
            Plotly.relayout(this.chartDiv, {
                'xaxis.range': [startTimeStr, timeStr]
            });
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