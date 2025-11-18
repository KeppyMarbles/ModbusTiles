import { updateWidget, setupWidget } from './widgets.js'

document.querySelectorAll(".widget").forEach(widget => {
    const config = JSON.parse(document.getElementById("config-" + widget.dataset.widget_id).textContent);
    widget.config = config;
    //widget.baseTitle = widget.title;

    widget.style.left = config.position_x + "px";
    widget.style.top = config.position_y + "px";

    widget.style.transform = `scale(${config.scale_x}, ${config.scale_y})`;

    //console.log("Found widget with id ", widget.dataset.tag, " type ", widget.dataset.type);

    setupWidget(widget);

    if(widget.dataset.tag) { //TODO we only need to know the values for each tag, not each widget
        setInterval(() => { //TODO handle failed to fetch error?
            fetch(`/api/tag/${widget.dataset.tag}/value/`)
                .then(response => response.json())
                .then(data => {
                    updateWidget(widget, data.value);
                });
        }, 500);
    }
});