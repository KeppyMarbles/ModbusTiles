import { WidgetRegistry } from "./widgets.js";
import { TagPoller } from "./tag_poller.js";

const poller = new TagPoller();

document.querySelectorAll(".widget").forEach(elem => {
    const widgetClass = WidgetRegistry[elem.dataset.class];
    const config = JSON.parse(document.getElementById("config-" + elem.dataset.widgetid).textContent);

    const widget = new widgetClass(elem, config);
    poller.registerWidget(widget);
});

poller.start();