import { WidgetRegistry } from "./widgets.js";
import { TagListener } from "./tag_listener.js";
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
        this.saveButton = document.getElementById('save-button');
        this.creatorItems = document.getElementById('palette');
        this.inspectButton = document.getElementById('inspect-button');
        this.tagButton = document.getElementById('tag-button');
        this.aliasElem = document.getElementById('dashboard-alias');
        //TODO maybe have a metadata dict which contains all the stuff?
        this.alias = document.getElementById('dashboard-container').dataset.alias; // Set by Django
        this.description = document.getElementById('dashboard-container').dataset.description;

        this.listener = new TagListener();
        this.inspector = new Inspector(document.getElementById('inspector-form'));
        this.newAlias = this.alias;
        this.tagForm = new Inspector(document.getElementById('tag-form'));
        this.tagForm.inspectGlobal();

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

        // Buttons
        this.editButton.addEventListener('click', () => {
            this.toggleEdit();
        });
        this.saveButton.addEventListener('click', () => {
            this.save();
        });

        // Window events
        window.addEventListener('resize', () => {
            this.updateSquareCells();
        });

        window.addEventListener("beforeunload", (event) => {
            if (this.isDirty) {
                event.preventDefault();
                event.returnValue = "";
            }
        });
                
        // Init
        this.setupGridStack();
        this.load();
    }

    setupGridStack() {
        // Initial settings
        this.canvasGridStack = GridStack.init({
            staticGrid: true, 
            column: 20,
            minRow: 10,
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

        const widgetClass = WidgetRegistry[typeName];

        if(widgetClass) {
            // Create widget class instance
            const newWidget = new widgetClass(gridElem, config, tag);

            // Create gridstack item
            this.canvasGridStack.makeWidget(gridElem, {
                x: config.position_x,
                y: config.position_y,
                w: config.scale_x,
                h: config.scale_y,
            });
            
            return newWidget;
        } 
        else {
            console.error("Unknown widget type", typeName);
            return null;
        }
    }

    async setupWidgets(widgetData) {
        if(!this.canvasGridStack) {
            console.error("Gridstack not initialized");
            return;
        }

        this.canvasGridStack.removeAll();
        this.listener.clear();

        console.log("Widgets:", widgetData);

        // Add widgets to the gridstack grid and listener
        if(widgetData.length === 0) {
            this.toggleEdit();
        }
        else {
            widgetData.forEach(wData => {
                const widget = this.createWidget(wData.widget_type, wData.tag, wData.config);
                this.listener.registerWidget(widget);
            });
            await this.listener.connect();
        }
    }

    toggleEdit() { //TODO toggle/on off, update poller accordingly?
        //TODO supress warnings? (no connection, stale value indicators)
        this.editMode = true;

        document.body.classList.add('edit-mode');
        this.saveButton.classList.remove('hidden');
        this.editButton.classList.add('hidden');
        
        this.canvasGridStack.setStatic(false); // Enable Drag/Drop

        this.widgetGrid.querySelectorAll('.grid-stack-item').forEach(item => {
            if (item.widgetInstance) {
                item.widgetInstance.clear();
                item.widgetInstance.setAlarm(null); //TODO add to clear()?
            }
        });


        const interval = setInterval(() => {
            this.updateSquareCells();
        }, 20);
        setTimeout(() => {
            clearInterval(interval);
        }, 500);

        this.listener.clear();
        
        this.selectWidget(null);
    }

    selectWidget(widget) {
        if(this.selectedWidget) {
            this.selectedWidget.gridElem.classList.remove("selected");
            if(this.selectedWidget === widget) {
                this.selectWidget(null);
                return;
            }
        }
        this.selectedWidget = widget;

        if(widget) {
            widget.gridElem.classList.add("selected")
            this.inspector.inspectWidget(widget);
            activateTab(this.inspectButton);
        }
        else {
            this.inspector.inspectDashboard(this);
        }
    }

    updateSquareCells() {
        const gridEl = this.canvasGridStack.el;
        const width = gridEl.clientWidth;
        const columns = this.canvasGridStack.opts.column; 
        const cellWidth = width / columns;

        this.canvasGridStack.cellHeight(cellWidth);
        gridEl.style.setProperty('--cell-size', `${cellWidth}px`);
        this.canvasGridStack.onResize();
    }

    async capturePreview() {
        const CAPTURE_WIDTH = 1300; 
        const ASPECT_RATIO = 260 / 160; 
        const CAPTURE_HEIGHT = CAPTURE_WIDTH / ASPECT_RATIO; // Result: 800px

        // Save state
        const originalStyle = {
            width: this.widgetGrid.style.width,
            height: this.widgetGrid.style.height,
            overflow: this.widgetGrid.style.overflow,
        };

        // Screenshot mode
        document.body.classList.add("screenshot-mode");
        document.body.classList.remove('edit-mode');
        this.canvasGridStack.setStatic(true); 
        this.widgetGrid.style.width = `${CAPTURE_WIDTH}px`;
        this.widgetGrid.style.height = `${CAPTURE_HEIGHT}px`;
        this.widgetGrid.style.overflow = 'hidden';
        this.updateSquareCells(); 
        //this.canvasGridStack.onResize();

        try {
            // Capture
            const canvas = await html2canvas(this.widgetGrid, {
                scale: 0.4, 
                useCORS: true,
                //backgroundColor: getComputedStyle(document.body).backgroundColor,
                width: CAPTURE_WIDTH,
                height: CAPTURE_HEIGHT,
                windowWidth: CAPTURE_WIDTH,
            });

            return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        } 
        finally {
            // Restore state
            this.widgetGrid.style.width = originalStyle.width;
            this.widgetGrid.style.height = originalStyle.height;
            this.widgetGrid.style.overflow = originalStyle.overflow;
            if (this.editMode) {
                document.body.classList.add('edit-mode');
                this.canvasGridStack.setStatic(false);
            }
            this.updateSquareCells();
            //this.canvasGridStack.onResize();
            document.body.classList.remove("screenshot-mode");
        }
    }

    async load() {
        try {
            document.getElementById('loading-spinner').classList.remove('hidden');

            // Get widget info from server
            const response = await fetch(`/api/dashboard-widgets/?dashboard=${this.alias}`);
            if(!response.ok) throw new Error("Failed to load widgets");
            
            const widgets = await response.json();

            // Set up recieved info
            await this.setupWidgets(widgets);
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
        // Send meta

        const formData = new FormData();

        formData.append('alias', this.newAlias);
        formData.append('description', this.description);

        // Add widget data
        const widgetsPayload = [];
        this.widgetGrid.querySelectorAll('.grid-stack-item').forEach(item => {
            if (item.widgetInstance) {
                widgetsPayload.push({
                    tag: item.widgetInstance.tag || null, 
                    widget_type: item.dataset.type,
                    config: item.widgetInstance.config
                });
            }
        });
        
        formData.append('widgets', JSON.stringify(widgetsPayload));

        // Get image data
        const imageBlob = await this.capturePreview();
        if (imageBlob) {
            formData.append('preview_image', imageBlob, 'preview.jpg');
        }

        postServer(`/api/dashboards/${this.alias}/save-data/`, formData, (data) => {
            this.isDirty = false;
            this.alias = this.newAlias;
            this.aliasElem.innerText = this.newAlias;
            this.aliasElem.title = this.description;
            history.pushState({}, "", `/dashboard/${this.newAlias}/`);
            alert("Dashboard Saved!");
        });
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

await refreshData();

var dashboard = new Dashboard();