import { WidgetRegistry } from "./widgets.js";
import { TagListener } from "./tag_listener.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'
import { postServer } from "./util.js";
import { refreshData } from "./global.js";
import { Inspector } from "./inspector.js";
import { serverCache } from "./global.js";

class Dashboard {
    constructor() {
        this.editMode = false;
        this.isDirty = false;
        this.selectedWidget = null;

        this.sidebar = document.getElementById('editor-sidebar');
        this.widgetGrid = document.getElementById('dashboard-grid');
        this.editButton = document.getElementById('edit-button');
        this.viewButton = document.getElementById('view-button');
        this.creatorItems = document.getElementById('palette');
        this.inspectButton = document.getElementById('inspect-button');
        this.tagButton = document.getElementById('tag-button');
        this.aliasElem = document.getElementById('dashboard-alias');
        this.fileInput = document.getElementById('importFile');
        //TODO maybe have a metadata dict which contains all the stuff?
        this.alias = document.getElementById('dashboard-container').dataset.alias; // Set by Django
        this.newAlias = this.alias; //TODO? used for keeping the desired new name before saving
        this.description = document.getElementById('dashboard-container').dataset.description;
        const columnCount = parseInt(document.getElementById('dashboard-container').dataset.columns);

        this.listener = new TagListener();
        this.inspector = new Inspector(document.getElementById('inspector-form'));
        this.tagForm = new Inspector(document.getElementById('tag-form'));
        this.tagForm.inspectGlobal();
                
        // Init
        this._setupEvents();
        this._setupGridStack(columnCount);
        this.load();
    }

    _setupEvents() {
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
            this.toggleEdit(true);
        });
        this.viewButton.addEventListener('click', () => {
            this.toggleEdit(false);
        });

        // Import file
        this.fileInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if(file)
                await this.importFile(file);
            this.fileInput.value = "";
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
    }

    _setupGridStack(columnCount) {
        // Initial settings
        this.canvasGridStack = GridStack.init({
            staticGrid: true, 
            column: columnCount,
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

    async setupWidgets(widgetData) {
        if(!this.canvasGridStack) {
            console.error("Gridstack not initialized");
            return;
        }

        this.canvasGridStack.removeAll();
        this.listener.clear();

        console.log("Widgets:", widgetData);

        // Add widgets to the gridstack grid
        widgetData.forEach(wData => {
            const tag = serverCache.tags.find(t => t.external_id === wData.tag); //TODO O(1)?
            this.createWidget(wData.widget_type, tag, wData.config);
        });
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

    toggleEdit(flag) {
        //TODO supress warnings? (no connection, stale value indicators)
        if(flag === this.editMode)
            return;

        this.editMode = flag;
        this.listener.clear();
        this.selectWidget(null);

        if(this.editMode) {
            document.body.classList.add('edit-mode');
            this.viewButton.classList.remove('hidden');
            this.editButton.classList.add('hidden');
            
            this.canvasGridStack.setStatic(false); // Enable Drag/Drop

            this._getWidgets().forEach(widget => {
                widget.clear();
                widget.setAlarm(null); //TODO add to clear()?
            });
        }
        else {
            document.body.classList.remove('edit-mode');
            this.viewButton.classList.add('hidden');
            this.editButton.classList.remove('hidden');

            this.canvasGridStack.setStatic(true);

            this._getWidgets().forEach(widget => {
                this.listener.registerWidget(widget);
            });
            this.listener.connect();
        }

        const interval = setInterval(() => {
            this.updateSquareCells();
        }, 13);
        setTimeout(() => {
            clearInterval(interval);
        }, 500);
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

    setColumnCount(val) {
        this.canvasGridStack.column(val);
        this.updateSquareCells();
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

            if(widgets.length === 0) {
                this.toggleEdit();
            }
            else {
                this._getWidgets().forEach(widget => {
                    this.listener.registerWidget(widget);
                });
                await this.listener.connect();
            }
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
        
        const formData = new FormData();

        // Add meta
        const meta = this._getMeta();

        formData.append('alias', this.newAlias);
        formData.append('description', meta.description);
        formData.append('column_count', meta.columns);
        formData.append('widgets', JSON.stringify(meta.widgets));

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

    exportFile() {
        try {
            const json = JSON.stringify(this._getMeta(), null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `${this.alias}-config.json`;
            a.click();
            URL.revokeObjectURL(url);
        } 
        catch (err) {
            alert("Error exporting configuration: " + err.message);
        }
    }

    async importFile(file) {
        try {
            const text = await file.text();
            const config = JSON.parse(text);
            const confirm = window.confirm(`Replace all widgets with ${config.widgets.length} new widgets?`)
            if(confirm) {
                this.setColumnCount(config.columns);
                this.setupWidgets(config.widgets);
            }
        } 
        catch (err) {
            alert("Error importing configuration: " + err.message);
        }
    }

    _getMeta() {
        return {
            alias: this.alias,
            description: this.description,
            columns: this.canvasGridStack.getColumn(),
            widgets: this._getWidgets().map(widget => ({
                tag: widget.tag?.external_id || null,
                widget_type: widget.gridElem.dataset.type,
                config: widget.config
            }))
        };
    }

    _getWidgets() {
        return Array.from(this.widgetGrid.querySelectorAll('.grid-stack-item'))
            .map(item => item.widgetInstance)
            .filter(Boolean);
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