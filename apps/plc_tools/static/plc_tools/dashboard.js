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
        this.selectedWidget = null;

        this.sidebar = document.getElementById('editor-sidebar');
        this.widgetGrid = document.getElementById('dashboard-grid');
        this.editButton = document.getElementById('edit-button');
        this.editButton.addEventListener('click', () => {
            this.toggleEdit();
        });
        this.creatorItems = document.getElementById('palette');
        this.inspectButton = document.getElementById('inspect-button');
        this.alias = document.getElementById('dashboard-container').dataset.alias; // Set by Django
        this.poller = new TagPoller();
        this.inspector = new Inspector();

        // Widget selection
        this.widgetGrid.addEventListener('click', (e) => {
            if(!this.editMode) return;

            const gridEl = e.target.closest('.palette-item');

            if(gridEl && gridEl.widgetInstance)
                this.selectWidget(gridEl.widgetInstance);

            else if(this.selectedWidget)
                this.selectWidget(null);
        });

        // Widget deletion
        document.addEventListener('keydown', (e) => {
            if (this.editMode && this.selectedWidget) {
                if (e.key === 'Delete') {
                    e.preventDefault(); 
                    this.canvasGridStack.removeWidget(this.selectedWidget.gridElem); //TODO how to guarantee widget class instance is deleted?
                    this.selectWidget(null);
                }
            }
        });
        
        this.setupGridStack();
        this.load();
    }

    setupGridStack() {
        // Initial settings
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
                let widget = item.el.widgetInstance;
                if (!widget) {
                    const type = item.el.dataset.type; // Set by Django
                    widget = new WidgetRegistry[type](item.el);
                }
                widget.config["position_x"] = item.x;
                widget.config["position_y"] = item.y;
                widget.config["scale_x"] = item.w;
                widget.config["scale_y"] = item.h;
            });
            if(this.editMode) {
                this.isDirty = true;
            }
        });

        // Handle shift-dragging
        let newWidget = null;

        this.canvasGridStack.on('dragstart', (event, el) => {
            if (event.shiftKey && el && el.widgetInstance) {
                const config = JSON.parse(JSON.stringify(el.widgetInstance.config));
                config["locked"] = true; 

                this.canvasGridStack.batchUpdate();
                newWidget = this.createWidget(el.dataset.type, el.widgetInstance.tag, config);
                this.canvasGridStack.update(newWidget.gridElem, { locked: true }); //TODO this is kinda irritating... cuz widget doesn't set config immediately
                this.canvasGridStack.commit();
            }
        });

        this.canvasGridStack.on('dragstop', (event, el) => {
            if(newWidget) {
                newWidget.config["locked"] = false; //dumb
                newWidget.applyConfig();
            }
        });

        // Set grid 1:1 aspect ratio
        this.updateSquareCells();
    }

    createWidget(typeName, tag, config) {
        // Copy widget contents from the palette populated by Django
        const palette = document.getElementById('palette');
        const gridPaletteElem = palette.querySelector(`[data-type="${typeName}"]`);
        const gridElem = gridPaletteElem.cloneNode(true);
        //gridStackNewItem.title = wData.tag_description; //TODO get description of tag

        // Create gridstack item
        this.canvasGridStack.makeWidget(gridElem, {
            x: config.position_x,
            y: config.position_y,
            w: config.scale_x,
            h: config.scale_y,
        });

        // Create widget class instance
        const widgetClass = WidgetRegistry[typeName];
        if(widgetClass)
            return new widgetClass(gridElem, config, tag);
        else
            console.error("Unknown widget type", typeName);
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
            const widget = this.createWidget(wData.widget_type, wData.tag, wData.config);
            this.poller.registerWidget(widget);
        });
        
        this.poller.start();
        
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

    selectWidget(widget) { //TODO add "locked" bool on all widgets? to prevent dragging/sizing
        if(this.selectedWidget) {
            this.selectedWidget.elem.classList.remove("selected");
            if(this.selectedWidget === widget) {
                this.selectWidget(null);
                return;
            }
        }
        this.selectedWidget = widget;

        if(widget) {
            widget.elem.classList.add("selected")
            this.inspector.inspectWidget(widget);
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
        this.canvasGridStack.cellHeight(cellWidth); // make rows match columns
    }

    async load() {
        try {
            document.getElementById('loading-spinner').classList.remove('hidden');

            // Get widget info from server
            const response = await fetch(`/api/dashboard-widgets/?dashboard=${this.alias}`);
            if(!response.ok) throw new Error("Failed to load widgets");
            
            const widgets = await response.json();

            // Set up recieved info
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
            if (item.widgetInstance) {
                widgetsPayload.push({
                    tag: item.widgetInstance.tag || null, 
                    widget_type: item.dataset.type,
                    config: item.widgetInstance.config
                });
            }
        });

        console.log("Saving...", widgetsPayload);
        
        // Send data to server
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