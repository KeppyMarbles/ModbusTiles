import { WidgetRegistry } from "./widgets.js";
import { TagPoller } from "./tag_poller.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'
import { postServer } from "./util.js";
import { refreshData } from "./global.js";
import { Inspector } from "./inspector.js";

class Dashboard {
    constructor() {
        this.editMode = false;
        this.isDirty = false;

        this.sidebar = document.getElementById('editor-sidebar');
        this.widgetGrid = document.getElementById('dashboard-grid');
        this.editButton = document.getElementById('edit-button');
        this.editButton.addEventListener('click', () => {
            this.toggleEdit();
        });
        this.creatorItems = document.getElementById('palette');
        this.inspectButton = document.getElementById('inspect-button');
        this.alias = document.getElementById('dashboard-container').dataset.alias;
        this.poller = new TagPoller();
        this.inspector = new Inspector();

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
            else if(this.selectedWidget) {
                this.selectWidget(null);
            }
        });
        
        this.setupGridStack();
        this.load();
    }

    setupGridStack() {
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

        // Handle drag and drop
        this.canvasGridStack.on('added change', (event, items) => {
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
            if(this.editMode) {
                this.isDirty = true;
            }
        });
    }

    setupWidgets(widgetData) {
        if(!this.canvasGridStack) {
            console.error("Gridstack not initialized");
            return;
        }

        this.canvasGridStack.removeAll();
        this.poller.clear();

        console.log("Widgets:", widgetData);

        // Add widgets to the gridstack grid and poller
        widgetData.forEach(wData => {
            const palette = document.getElementById('palette');
            const gridStackPaletteItem = palette.querySelector(`[data-type="${wData.widget_type}"]`);
            const gridStackNewItem = gridStackPaletteItem.cloneNode(true);
            //gridStackNewItem.title = wData.tag_description; //TODO get description of tag

            this.canvasGridStack.makeWidget(gridStackNewItem, {
                x: wData.config.position_x,
                y: wData.config.position_y,
                w: wData.config.scale_x,
                h: wData.config.scale_y,
            });

            const widgetElem = gridStackNewItem.querySelector('.dashboard-widget');
            const widgetClass = WidgetRegistry[wData.widget_type];
            if(widgetClass) {
                const widget = new widgetClass(widgetElem, wData.config, wData.tag);
                this.poller.registerWidget(widget);
            }
            else {
                console.error("Unknown widget type", wData.widget_type);
            }
        });
        
        this.poller.start();
        this.updateSquareCells();
    }

    async toggleEdit() { //TODO toggle/on off, update poller accordingly?
        //TODO supress warnings? (no connection, stale value indicators)
        //TODO set existing widget values to default?
        this.editMode = true;
        document.body.classList.add('edit-mode');
        this.sidebar.classList.remove('hidden');
        this.canvasGridStack.setStatic(false); // Enable Drag/Drop

        document.querySelectorAll('.dashboard-widget').forEach(el => {
            el.style.pointerEvents = 'none'; 
        });

        this.poller.clear();

        this.editButton.classList.add('hidden');
        
        await refreshData();
        this.selectWidget(null);
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

        if(widgetElem) {
            widgetElem.classList.add("selected")
            this.inspector.inspectWidget(widgetElem.widgetInstance);
            activateTab(this.inspectButton);
        }
        else {
            this.inspector.inspectGlobal();
            this.inspector.addButton("Save Dashboard", async () => {
                this.save();
            })
        }
    }

    updateSquareCells() {
        const width = this.canvasGridStack.el.clientWidth;
        const cellWidth = width / this.canvasGridStack.opts.column;
        this.canvasGridStack.cellHeight(cellWidth);   // make rows match columns
    }

    async load() {
        try {
            document.getElementById('loading-spinner').classList.remove('hidden');

            // Get widget info from server
            const response = await fetch(`/api/dashboard-widgets/?dashboard=${this.alias}`);
            if(!response.ok) throw new Error("Failed to load widgets");
            
            const widgets = await response.json();

            this.setupWidgets(widgets);
        } 
        catch (err) {
            console.error(err);
            this.widgetGrid.innerHTML = `<div class="error">Error loading dashboard: ${err.message}</div>`;
        } 
        finally {
            document.getElementById('loading-spinner').classList.add('hidden');
        }
    }

    async save() {
        const widgetsPayload = [];

        // Add widget info to payload
        this.widgetGrid.querySelectorAll('.grid-stack-item').forEach(item => {
            const widgetEl = item.querySelector('.dashboard-widget');

            if (widgetEl && widgetEl.widgetInstance) {
                widgetsPayload.push({
                    tag: widgetEl.widgetInstance.tag || null, 
                    widget_type: item.dataset.type,
                    config: widgetEl.widgetInstance.config
                });
            }
        });

        console.log("Saving...", widgetsPayload);

        
        if(postServer( 
            `/api/dashboards/${this.alias}/save-widgets/`, 
            widgetsPayload, 
            `Dashboard Saved!`
        ))
            this.isDirty = false;
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

window.addEventListener("beforeunload", (event) => {
    if (dashboard.isDirty) {
        event.preventDefault();
        event.returnValue = "";
    }
});