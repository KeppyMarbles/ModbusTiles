export function updateWidget(widget, type, value) { //TODO null values
    console.log("Updating widget");
    //if(value !== undefined)
    //    widget.title = `${widget.baseTitle} (Value: ${value})`
    switch (type) {
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
            widget.querySelector(".label_text").textContent = value ? widget.config.text_on : widget.config.text_off
            break;
        case "label":
            widget.querySelector(".label_text").textContent = widget.config.text;
            break;
    }
}