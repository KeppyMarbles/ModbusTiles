import { getCookie } from "./util.js";

export function updateWidget(widget, value) { //TODO null values
    //console.log("Updating widget");
    //if(value !== undefined)
    //    widget.title = `${widget.baseTitle} (Value: ${value})`
    switch (widget.dataset.type) {
        case "led":
            const indicator = widget.querySelector(".indicator");
            indicator.style.backgroundColor = value ? widget.config.color_on : widget.config.color_off;
            break;

        case "val":
            break;

        case "chart":
            break;

        case "button":
            break;

        case "bool_label":
            widget.querySelector(".label_text").textContent = value ? widget.config.text_on : widget.config.text_off;
            break;

        case "switch":
            if(widget.shouldUpdate)
                widget.querySelector(".switch-input").checked = value ? true : false;
            break;

        case "meter":
            widget.querySelector(".meter-bar").value = value;
            break;
    }
}

export function setupWidget(widget) {
    switch (widget.dataset.type) {
        case "switch":
            widget.shouldUpdate = true;
            const input = widget.querySelector(".switch-input")
            input.addEventListener("change", async () => {
                //TODO yes/no confirmation if configured?
                widget.shouldUpdate = false;
                clearTimeout(widget.timeoutID);

                const response = await fetch(`/api/tag/${widget.dataset.tag}/write/`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": getCookie("csrftoken")
                    },
                    body: JSON.stringify({ value: input.checked })
                });
            
                const result = await response.json();
                console.log(result)
                if (result.error) {
                    alert("Failed to write value: " + result.error);
                }
                
                widget.timeoutID = setTimeout(() => {
                    widget.shouldUpdate = true;
                }, 500); //TODO figure out a good duration
            });
            break;

        case "label":
            widget.querySelector(".label_text").textContent = widget.config.text;
            break;

        case "meter":
            const bar = widget.querySelector(".meter-bar");
            bar.min = widget.config.min_value;
            bar.max = widget.config.max_value;
            widget.querySelector(".min-label").textContent = bar.min;
            widget.querySelector(".max-label").textContent = bar.max;
    }
}