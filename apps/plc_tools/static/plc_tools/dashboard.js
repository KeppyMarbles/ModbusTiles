import { WidgetRegistry } from "./widgets.js";
import { TagPoller } from "./tag_poller.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'


const poller = new TagPoller();

const grid = GridStack.init({
    //staticGrid: true, 
    cellHeight: 100,
    margin: 5,
});


document.querySelectorAll(".widget-wrapper").forEach(wrapper => {
    const widgetType = wrapper.dataset.class;
    const widgetClass = WidgetRegistry[widgetType];
    
    const contentElem = wrapper.querySelector('.widget');

    const config = JSON.parse(document.getElementById("config-" + wrapper.dataset.widgetid).textContent);

    const widget = new widgetClass(contentElem, config);
    poller.registerWidget(widget);
});

poller.start();