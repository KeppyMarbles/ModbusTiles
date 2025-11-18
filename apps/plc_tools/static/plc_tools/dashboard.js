import { updateWidget } from './widgets.js'

document.querySelectorAll(".widget").forEach(widget => {
    const tagId = widget.dataset.tag;
    const widgetType = widget.dataset.type;

    console.log(document.getElementById("config-" + widget.dataset.widget_id).textContent)
    const config = JSON.parse(document.getElementById("config-" + widget.dataset.widget_id).textContent);
    widget.config = config;
    //widget.baseTitle = widget.title;

    widget.style.left = config.position_x + "px";
    widget.style.top = config.position_y + "px";

    widget.style.transform = `scale(${config.scale_x}, ${config.scale_y})`;

    console.log("Found widget with id ", tagId, " type ", widgetType);

    if(tagId) {
        setInterval(() => { //TODO handle failed to fetch error?
            fetch(`/api/tag/${tagId}/value/`)
                .then(response => response.json())
                .then(data => {
                    updateWidget(widget, widgetType, data.value);
                });
        }, 500);
    }
    else {
        updateWidget(widget, widgetType);
    }
});