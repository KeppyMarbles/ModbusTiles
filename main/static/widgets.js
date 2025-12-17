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

    constructor(gridElem, config, tag) { // unsure if the tagID should be part of config or not        
        // Apply defaults
        if(!config) config = {};
        const allFields = [...(new.target.defaultFields), ...(new.target.customFields), ...(this.dynamicFields)];
        allFields.forEach(field => {
            if(config[field.name] === undefined)
                config[field.name] = field.default;
        });
        this.config = config;

        this.tag = tag;
        this.elem = gridElem.querySelector('.dashboard-widget');
        this.valueTimeout = 5000;
        this.alarmIndicator = gridElem.querySelector(".alarm-indicator");
        this.label = this.elem.parentNode?.querySelector(".widget-label");
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
            return false;
        }

        if(this.config.confirmation && !window.confirm(this.getConfirmMessage(value))) {
            return false;
        }

        const response = await fetch(`/api/write-requests/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCookie("csrftoken")
            },
            body: JSON.stringify({ 
                tag: this.tag.external_id,
                value: value,
            })
        });

        const result = await response.json();

        if (result.error) {
            alert("Failed to write value: " + result.error);
            return false;
        }

        return true;
    }

    onData(data) {
        if(data.age > this.valueTimeout) 
            this.elem.classList.add("is-state", "no-connection");
        else
            this.elem.classList.remove("is-state", "no-connection"); //TODO disable interactions?

        this.onValue(data.value, data.time);

        this.setAlarm(data.alarm);
    }

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
        if(this.config.showTagName) {
            this.label.classList.remove("hidden");
            this.label.textContent = this.tag ? this.tag.alias : "No Tag";
            this.label.title = this.tag ? this.tag.description : "";
        }
        else {
            this.label.classList.add("hidden");
        }

        this.elem.title = this.tag ? this.tag.alias : "";
    }

    getConfirmMessage(val) {
        return `Change ${this.tag.alias} to ${val}?`
    }

    updateFontSize() { // TODO method or function? (eg updateFontSize(this.text_elem))
        if (this.text_elem) {
            const amt = Math.round(this.text_elem.textContent.length / 3) * 3;
            const k = 100;

            // measure container
            const rect = this.text_elem.parentElement.getBoundingClientRect();
            const aspect = rect.width / rect.height;

            // width assist factor (>= 1)
            const widthBoost = Math.min(1.75, Math.sqrt(aspect));
            const textScale = (k / Math.sqrt(amt));
            
            // store CSS variables
            this.text_elem.style.setProperty('--text-scale', textScale);
            this.text_elem.style.setProperty('--width-boost', widthBoost);
        }
    }

    onValue(val) {
        throw new Error("onValue not implemented for this widget");
    }

    clear() {
        return;
    }
}

// -------- Static Widgets --------

class LabelWidget extends Widget { //TODO font size, formatting?
    static displayName = "Label";
    static customFields = [
        { name: "text", type: "text", default: "Label Text", label: "Text" },
    ]

    constructor(widget_elem, config) {
        super(widget_elem, config);
        this.text_elem = this.elem.querySelector(".label_text");
        
        this.config.showTagName = false; //TODO don't show control tag label
    }

    applyConfig() {
        super.applyConfig();
        this.text_elem.textContent = this.config.text;
        this.updateFontSize();
    }
}

// -------- Boolean Widgets --------

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
        this.onValue(false);
        this.updateFontSize();
    }

    onValue(val) {
        this.text_elem.textContent = val ? this.config.text_on : this.config.text_off;
        this.updateFontSize();
    }

    clear() {
        this.onValue(false); //TODO?
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
            const submitted = await this.submit(this.input.checked);
            if(!submitted)
                this.input.checked = !this.input.checked;
        });
    }

    getConfirmMessage(val) {
        return `Switch ${this.tag.alias} to ${val ? "ON" : "OFF"} position?`;
    }

    onValue(val) {
        this.input.checked = val ? true : false;
    }

    clear() {
        this.input.checked = false;
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

// -------- Number Widgets --------

class ButtonWidget extends Widget {
    static displayName = "Slider";
    static allowedChannels = ["coil", "hr"];
    static allowedTypes = ["bool", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "string"];
    static customFields = [
        { name: "button_text", type: "text", default: "Button Text", label: "Button Text" },
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
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
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.select = this.elem.querySelector(".form-input"); //TODO?

        this.select.addEventListener("change", async () => {
            this.submit(this.select.value);
        });
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
        this.select.value = val;
    }

    clear() {
        this.select.value = "";
    }
}

class SliderWidget extends Widget {
    static displayName = "Slider";
    static allowedChannels = ["hr"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "min_value", type: "number", default: 0, label: "Minimum Value" },
        { name: "max_value", type: "number", default: 10, label: "Maximum Value" },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
        { name: "display_range", type: "bool", default: true, label: "Show Range" },
        { name: "display_value", type: "bool", default: false, label: "Show Value" },
        { name: "confirmation", type: "bool", default: false, label: "Prompt Confirmation" },

    ]
    dynamicFields = [
        { name: "step", default: 1, label: "Step"}, //TODO default not working?
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.input = this.elem.querySelector(".slider-input");
        this.min_label = this.elem.querySelector(".min-label");
        this.max_label =  this.elem.querySelector(".max-label");
        this.value_label = this.elem.querySelector(".value-label");
        this.shouldUpdate = true;
        
        this.input.addEventListener("change", async () => {
            const submitted = await this.submit(this.input.value);
            if(!submitted)
                this.input.value = this.lastValue;
            this.shouldUpdate = true;
        });
        this.input.addEventListener("input", (e) => {
            clearTimeout(this.timeoutID);
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
        if(this.shouldUpdate) {
            this.input.value = val;
            this._updateDisplayValue();
        }
        this.lastValue = val;
    }

    clear() {
        this.onValue(0);
    }

    _updateDisplayValue() {
        if(this.config.display_value)
            this.value_label.textContent = this.config.prefix + "Value: " + this.input.value + this.config.suffix; //TODO decimals
        else
            this.value_label.textContent = "";
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
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
        { name: "display_range", type: "bool", default: true, label: "Show Range"},
        { name: "display_value", type: "bool", default: false, label: "Show Value"},
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
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
        this._updateDisplayValue();
    }

    clear() {
        this.onValue(0);
    }

    _updateDisplayValue() {
        if(this.config.display_value)
            this.value_label.textContent = this.config.prefix + "Value: " + this.bar.value + this.config.suffix; //TODO decimals
        else
            this.value_label.textContent = "";
    }
}

class MultiLabelWidget extends Widget {
    static displayName = "Multi-Value Label";
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "label_values", type: "enum", default: [], label: "Label Values" },
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.updateFontSize();
    }

    onValue(val) {
        const kv = this.config.label_values.find(kv => kv.value == val);
        this.text_elem.textContent = kv ? kv.label : `Unknown Value: ${val}`;
        this.updateFontSize();
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

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.text_elem = this.elem.querySelector(".label_text");
    }

    applyConfig() {
        super.applyConfig();
        this.onValue(0);
        this.updateFontSize();
    }

    onValue(val) {
        this.text_elem.textContent = this.config.prefix + val.toFixed(this.config.precision) + this.config.suffix;
        this.updateFontSize();
    }

    clear() {
        this.onValue(0);
    }
}

class ChartWidget extends Widget { 
    static displayName = "History Chart";
    static allowedChannels = ["hr", "ir"]; 
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
    static customFields = [
        { name: "title", type: "text", default: "Tag History", label: "Title" },
        { name: "history_seconds", type: "number", default: 60, label: "History Length (s)" },
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
    ]

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.pauseButton = this.elem.querySelector(".form-button");
        this.textColor = getComputedStyle(document.body).getPropertyValue('--text-main');
        this.realData = false;
        this.initPreview();

        // Size chart to gridstack elem
        this.resizeObserver = new ResizeObserver(() => {
            Plotly.Plots.resize(this.chartDiv);
        });
        this.resizeObserver.observe(this.elem);

        this.pauseButton.addEventListener("click", () => {
            this.togglePaused();
        })
        this.chartDiv.innerText = "";
    }

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

    async initHistory() {
        if(this.initializing)
            return;

        this.initializing = true;

        try {
            // Fetch real history data
            const response = await fetch(`/api/history/?tags=${this.tag.external_id}&seconds=${this.config.history_seconds}`);
            if (!response.ok) throw new Error("History fetch failed");

            const data = await response.json();
            const timestamps = data.map(e => e.timestamp);
            const values = data.map(e => e.value);

            const config = { responsive: true, displayModeBar: false };

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
            yaxis: {
                autorange: true,
                gridcolor: gridColor,
                linecolor: this.textColor,
                tickfont: { color: this.textColor }
            },
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
    static displayName = "Radial Gauge";
    static allowedChannels = ["hr", "ir"];
    static allowedTypes = ["int16", "uint16", "int32", "uint32", "float32", "float64"];
    
    static customFields = [
        { name: "title", type: "text", default: "", label: "Title" },
        { name: "min_value", type: "number", default: 0, label: "Min Value" },
        { name: "max_value", type: "number", default: 100, label: "Max Value" },
        { name: "warning_threshold", type: "number", default: 75, label: "Warning Start" },
        { name: "critical_threshold", type: "number", default: 90, label: "Critical Start" },
        { name: "prefix", type: "text", default: "", label: "Value Prefix" },
        { name: "suffix", type: "text", default: "", label: "Value Suffix" },
    ];

    constructor(widget_elem, config, tagID) {
        super(widget_elem, config, tagID);
        this.chartDiv = this.elem.querySelector(".chart-container");
        this.textColor = getComputedStyle(document.body).getPropertyValue('--text-main');

        this.currentValue = this.config.min_value;

        this.resizeObserver = new ResizeObserver(() => {
            Plotly.Plots.resize(this.chartDiv);
        });
        this.resizeObserver.observe(this.elem);

        this.chartDiv.innerText = "";
    }

    applyConfig() {
        super.applyConfig();
        // Redraw with new ranges/colors
        this.draw(this.currentValue);
    }

    onValue(val) {
        this.currentValue = val;
        this.draw(val);
    }

    draw(val) {
        const config = { responsive: true, displayModeBar: false };
        Plotly.react(this.chartDiv, [this._getTrace(val)], this._getLayout(), config);
    }

    clear() {
        this.onValue(0);
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

export const WidgetRegistry = {
    "switch": SwitchWidget,
    "slider": SliderWidget,
    "meter": MeterWidget,
    "led": LEDWidget,
    "label" : LabelWidget,
    "bool_label" : BoolLabelWidget,
    "multi_label" : MultiLabelWidget,
    "number_label" : NumberLabelWidget,
    "chart": ChartWidget,
    "button" : ButtonWidget,
    "dropdown" : DropdownWidget,
    "gauge" : GaugeWidget,
};