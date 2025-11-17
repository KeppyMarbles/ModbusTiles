export function updateWidget(widget, type, value) {
    console.log("Updating widget");
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
        case "label":
            break;
    }
}