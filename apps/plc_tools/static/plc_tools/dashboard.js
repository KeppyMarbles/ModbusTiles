import { WidgetRegistry } from "./widgets.js";
import { TagPoller } from "./tag_poller.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'

class Dashboard {
    constructor() {
        this.editMode = false;

        this.sidebar = document.getElementById('editor-sidebar');
        this.widgetGrid = document.getElementById('dashboard-grid');
        this.editButton = document.getElementById('edit-button');
        this.editButton.addEventListener('click', () => {
            this.toggleEdit();
        });
        this.creatorItems = document.getElementById('palette');
        this.inspectorForm = document.getElementById('inspector-form');
        this.inspectButton = document.getElementById('inspect-button');
        this.poller = new TagPoller();

        // Widget selection
        this.widgetGrid.addEventListener('click', (e) => {
            if(!this.editMode) return;

            const gridEl = e.target.closest('.palette-item');

            if(gridEl) {
                const widgetEl = gridEl.querySelector('.dashboard-widget');
                if(widgetEl && widgetEl.widgetInstance) {
                    this.selectWidget(widgetEl);
                }
            }
            else {
                this.selectWidget(null);
            }
        });
        
        // Create the grid
        this.canvasGridStack = GridStack.init({
            staticGrid: true, 
            column: 20,
            cellHeight: '100',
            margin: 5,
            float: true,
            acceptWidgets: true,
            dragIn: '.palette-item',
        });
        GridStack.setupDragIn('#palette .palette-item', { appendTo: 'body', helper: 'clone' });
        // TODO need a "trash" area for delete

        // Create saved widgets
        document.querySelectorAll('widget-config').forEach(configElem => { //TODO widget size/position
            const widgetType = configElem.dataset.type;
            const tagID = configElem.dataset.tagid;
            const title = configElem.dataset.title;
            console.log(tagID);
            const config = JSON.parse(configElem.querySelector('script[type="application/json"]').textContent);
            const palette = document.getElementById('palette');
            const gridStackPaletteItem = palette.querySelector(`[data-type="${widgetType}"]`);
            const gridStackNewItem = gridStackPaletteItem.cloneNode(true);
            gridStackNewItem.title = title;
            const widgetElem = gridStackNewItem.querySelector('.dashboard-widget');
            this.canvasGridStack.makeWidget(gridStackNewItem, {
                x: config.position_x,
                y: config.position_y,
                w: config.scale_x,
                h: config.scale_y,
            });
            const widget = new WidgetRegistry[widgetType](widgetElem, config, tagID);
            this.poller.registerWidget(widget);
        })

        // Handle drag and drop
        this.canvasGridStack.on('added change', function(event, items) {
            items.forEach(item => {
                const widgetElem = item.el.querySelector('.dashboard-widget');
                if (!widgetElem.widgetInstance) {
                    const type = item.el.dataset.type;
                    const newWidget = new WidgetRegistry[type](widgetElem);
                }
                widgetElem.widgetInstance.config["position_x"] = item.x;
                widgetElem.widgetInstance.config["position_y"] = item.y;
                widgetElem.widgetInstance.config["scale_x"] = item.w;
                widgetElem.widgetInstance.config["scale_y"] = item.h;
            });
        });

        this.poller.start();
        this.updateSquareCells();
    }

    toggleEdit() { //TODO toggle/on off, update poller accordingly?
        //TODO supress warnings? (no connection, stale value indicators)
        //TODO set existing widget values to default?
        this.editMode = true;
        document.body.classList.add('edit-mode');
        this.sidebar.classList.remove('hidden');
        this.canvasGridStack.setStatic(false); // Enable Drag/Drop

        document.querySelectorAll('.dashboard-widget').forEach(el => {
            el.style.pointerEvents = 'none'; 
        });

        this.poller.stop();

        this.editButton.classList.add('hidden');
    }

    selectWidget(widgetElem) { //TODO add "locked" bool on all widgets? to prevent dragging/sizing
        if(this.selectedWidget) {
            this.selectedWidget.classList.remove("selected");
            if(this.selectedWidget === widgetElem) {
                this.selectWidget(null);
                return;
            }
        }
            
        this.selectedWidget = widgetElem;
        this.inspectorForm.innerHTML = ''; // Clear previous

        if (!widgetElem) return;

        activateTab(this.inspectButton);
        widgetElem.classList.add("selected");

        const title = document.createElement('p');
        title.innerText = widgetElem.widgetInstance.constructor.displayName;
        title.className = "inspector-title";
        this.inspectorForm.appendChild(title);
        // Merge default and custom fields
        const allFields = [...widgetElem.widgetInstance.constructor.defaultFields, ...widgetElem.widgetInstance.constructor.customFields];

        allFields.forEach(field => {
            const wrapper = document.createElement('div');
            wrapper.className = "input-group";

            const label = document.createElement('label');
            label.innerText = field.label;
            label.className = "inspector-label";

            let input;

            // Factory for input types
            switch(field.type) {
                case "tag_picker":
                    //input = this.createTagPicker(field, widgetInstance.config[field.name]);
                    break;

                case "bool":
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = widgetElem.widgetInstance.config[field.name];
                    input.className = "inspector-input";
                    break;

                case "number":
                    input = document.createElement('input');
                    input.type = field.type === 'number' ? 'number' : 'text';
                    input.value = widgetElem.widgetInstance.config[field.name];
                    input.className = "inspector-input";
                    break;

                case "text":
                    input = document.createElement('input');
                    input.type = field.type === 'text';
                    input.value = widgetElem.widgetInstance.config[field.name];
                    input.className = "inspector-input";
                    break;
            }

            if(!input) {
                console.warn("Unknown input for ", field.type);
                return;
            }
                
            // Live Update Logic
            input.addEventListener('change', (e) => {
                const val = field.type === 'bool' ? e.target.checked : e.target.value;
                widgetElem.widgetInstance.config[field.name] = val;
                widgetElem.widgetInstance.applyConfig();
            });
            
            label.appendChild(input);
            wrapper.appendChild(label);
            this.inspectorForm.appendChild(wrapper);
        });
    }

    updateSquareCells() {
        const width = this.canvasGridStack.el.clientWidth;
        const cellWidth = width / this.canvasGridStack.opts.column;
        this.canvasGridStack.cellHeight(cellWidth);   // make rows match columns
    }
}

function activateTab(btn) {
    document.querySelectorAll('.tab-buttons button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
}

document.querySelectorAll('.tab-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
        activateTab(btn);
    });
});

var dashboard = new Dashboard();
window.addEventListener('resize', () => {
    dashboard.updateSquareCells();
});