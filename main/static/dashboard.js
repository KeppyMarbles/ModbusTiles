import { WidgetRegistry } from "./widgets.js";
import { TagListener } from "./tag_listener.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'
import { refreshData, requestServer, serverCache } from "./global.js";
import { Inspector } from "./inspector.js";
/** @import { DashboardWidgetInfoObject, DashboardConfigObject } from "./types.js" */
/** @import { Widget } from "./widgets.js" */

/**
 * The main class for a dashboard page which handles Widget, TagListener, and Inspector classes 
 */
export class Dashboard {
    constructor() {
        /** @type {boolean} */
        this.editMode = false;

        /** @type {boolean} */
        this.isDirty = false;

        /** @type {Widget | null} */
        this.selectedWidget = null;

        /** @type {TagListener} The WebSocket listener to register Widgets to */
        this.listener = new TagListener();

        /** @type {Inspector} */
        this.inspector = new Inspector(document.getElementById('inspector-form'));

        /** @type {Inspector} */
        this.tagForm = new Inspector(document.getElementById('tag-form'));
        this.tagForm.inspectTag();

        /** @type {Inspector} */
        this.alarmForm = new Inspector(document.getElementById('alarm-form'));
        this.alarmForm.inspectAlarm();

        //TODO maybe have a metadata dict which contains all the stuff? 
        const dashboardMeta = document.getElementById('dashboard-container').dataset // Set by Django

        /** @type {string} */
        this.alias = dashboardMeta.alias;

        this.newAlias = this.alias; //TODO? used for keeping the desired new name before saving

        /** @type {string} */
        this.description = dashboardMeta.description;

        // Elements
        this.widgetGrid = document.getElementById('dashboard-grid');
        this.editButton = document.getElementById('edit-button');

        // Init
        this._setupEvents();
        this._setupGridStack(parseInt(dashboardMeta.columns));
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
                }
            }
        });

        // Buttons
        this.editButton.addEventListener('click', () => {
            this.toggleEdit(!this.editMode);
        });

        // Import file
        const fileInput = document.getElementById('importFile');
        fileInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if(file)
                await this.importFile(file);
            fileInput.value = "";
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

    /**
     * @param {number} columnCount 
     */
    _setupGridStack(columnCount) {
        /** 
         * The dashboard's GridStack instance
         * @type {GridStack} 
         */
        this.canvasGridStack = GridStack.init({
            staticGrid: true, 
            column: columnCount,
            minRow: 10,
            cellHeight: '100',
            margin: 5,
            float: true,
            acceptWidgets: true,
            dragIn: '.palette-item',
            //removable: "#editor-sidebar",
        });
        GridStack.setupDragIn('#palette .palette-item', { appendTo: 'body', helper: 'clone' });

        // Handle drag and drop
        this.canvasGridStack.on('added change', (event, items) => {
            items.forEach(item => {
                /** @type {Widget} */
                let widget = item.el.widgetInstance;
                if (!widget) {
                    const type = item.el.dataset.type; // Set by Django
                    widget = new WidgetRegistry[type](item.el);
                }
                widget.config.position_x = item.x;
                widget.config.position_y = item.y;
                widget.config.scale_x = item.w;
                widget.config.scale_y = item.h;
            });
            if(this.editMode) {
                this.isDirty = true;
            }
        });

        // Handle shift-dragging
        /** @type {Widget | null} */
        let newWidget = null;

        this.canvasGridStack.on('dragstart', (event, el) => {
            if (event.shiftKey && el && el.widgetInstance) {
                const config = JSON.parse(JSON.stringify(el.widgetInstance.config));
                config.locked = true; 

                this.canvasGridStack.batchUpdate();
                newWidget = this.createWidget(el.dataset.type, el.widgetInstance.tag, config);
                this.canvasGridStack.update(newWidget.gridElem, { locked: true }); //TODO this is kinda irritating... cuz widget doesn't set config immediately
                this.canvasGridStack.commit();
            }
        });

        this.canvasGridStack.on('dragstop', (event, el) => {
            if(newWidget) {
                newWidget.config.locked = false; //dumb
                newWidget.applyConfig();
            }
        });

        // Handle delete
        this.canvasGridStack.on('removed', (event, items) => {
            items.forEach(item => {
                if(item.el.widgetInstance == this.selectedWidget) {
                    console.log("unselecting")
                    this.selectWidget(null);
                }
            });
        });

        // Set grid 1:1 aspect ratio
        this.updateSquareCells();
    }

    /**
     * Populate the dashboard with new widgets from the given data
     * @param {DashboardWidgetInfoObject[]} widgetData 
     */
    async setupWidgets(widgetData) {
        if(!this.canvasGridStack) {
            console.error("Gridstack not initialized");
            return;
        }

        this.canvasGridStack.removeAll();
        this.listener.clear();

        console.log("Widgets:", widgetData);

        // Add widgets to the gridstack grid
        widgetData.forEach(wData => this.createWidget(wData.widget_type, serverCache.tags[wData.tag], wData.config));
    }

    /**
     * Creates a Widget instance of the provided type with a new GridStack element and adds it to the dashboard
     * @param {string} typeName 
     * @param {TagObject} tag 
     * @param {Object} config 
     */
    createWidget(typeName, tag, config) {
        // Copy widget contents from the palette populated by Django
        const palette = document.getElementById('palette');
        const gridPaletteElem = palette.querySelector(`[data-type="${typeName}"]`);
        const gridElem = gridPaletteElem.cloneNode(true);
        //gridStackNewItem.title = wData.tag_description; //TODO get description of tag

        /** @type {typeof Widget} */
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

    /**
     * Enable or disable edit mode
     * @param {boolean} flag
     */
    toggleEdit(flag) {
        //TODO supress warnings? (no connection, stale value indicators)
        if(flag === this.editMode)
            return;

        this.editMode = flag;
        this.listener.clear();
        this.selectWidget(null);

        if(this.editMode) {
            document.body.classList.add('edit-mode');
            this.editButton.innerText = "View Dashboard";
            
            this.canvasGridStack.setStatic(false); // Enable Drag/Drop

            this._getWidgets().forEach(widget => {
                widget.clear();
                widget.setAlarm(null); //TODO add to clear()?
            });
        }
        else {
            document.body.classList.remove('edit-mode');
            this.editButton.innerText = "Edit Dashboard";

            this.canvasGridStack.setStatic(true);

            this._getWidgets().forEach(widget => {
                this.listener.registerWidget(widget);
            });
            this.listener.connect();
        }

        const animInterval = setInterval(() => {
            this.updateSquareCells();
        }, 13);
        setTimeout(() => {
            clearInterval(animInterval);
        }, 500);
    }

    /**
     * Highlight and inspect the widget, or deselect and inspect the dashboard if already selected
     * @param {Widget} widget 
     * @returns 
     */
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
            activateTab(document.getElementById('inspect-button'));
        }
        else {
            this.inspector.inspectDashboard(this);
        }
    }

    /**
     * Resize the GridStack cell width to maintain 1:1 aspect ratio
     */
    updateSquareCells() {
        const gridEl = this.canvasGridStack.el;
        const width = gridEl.clientWidth;
        const columns = this.canvasGridStack.opts.column; 
        const cellWidth = width / columns;

        this.canvasGridStack.cellHeight(cellWidth);
        gridEl.style.setProperty('--cell-size', `${cellWidth}px`);
        this.canvasGridStack.onResize();
    }

    /**
     * @param {number} val 
     */
    setColumnCount(val) {
        this.canvasGridStack.column(val);
        this.updateSquareCells();
    }

    /**
     * Fetch and apply widget data from the server based on this dashboard's name
     */
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
                this.toggleEdit(true);
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

    /** 
     * Update the server with new widget config and screenshot
     */
    async save() {
        
        const formData = new FormData();

        // Add meta
        const config = this._getConfig();

        formData.append('alias', this.newAlias);
        formData.append('description', config.description);
        formData.append('column_count', config.column_count);
        formData.append('widgets', JSON.stringify(config.widgets));

        // Get image data
        const imageBlob = await this._getPreview();
        if (imageBlob) {
            formData.append('preview_image', imageBlob, 'preview.jpg');
        }

        requestServer(`/api/dashboards/${this.alias}/save-data/`, 'POST', formData, (data) => {
            this.isDirty = false;
            this.alias = this.newAlias;
            const aliasElem = document.getElementById('dashboard-alias');
            aliasElem.innerText = this.newAlias;
            aliasElem.title = this.description;
            history.pushState({}, "", `/dashboard/${this.newAlias}/`); // Change URL
            alert("Dashboard Saved!");
        });
    }

    /** 
     * Download dashboard configuration as .json
     */
    exportFile() {
        try {
            const json = JSON.stringify(this._getConfig(), null, 2);
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

    /**
     * Set up the dashboard with .json
     * @param {File} file 
     */
    async importFile(file) {
        try {
            const text = await file.text();
            const config = JSON.parse(text);
            const confirm = window.confirm(`Replace all widgets with ${config.widgets.length} new widgets?`)
            if(confirm) {
                this.setColumnCount(config.column_count);
                this.setupWidgets(config.widgets);
            }
        } 
        catch (err) {
            alert("Error importing configuration: " + err.message);
        }
    }

    /**
     * @returns {DashboardConfigObject} All data needed to recreate this dashboard
     */
    _getConfig() {
        return {
            alias: this.alias,
            description: this.description,
            column_count: this.canvasGridStack.getColumn(),
            widgets: this._getWidgets().map(widget => ({ //TODO widget method or nah?
                tag: widget.tag?.external_id || null,
                widget_type: widget.gridElem.dataset.type,
                config: widget.config
            }))
        };
    }

    /**
     * @returns {Widget[]}
     */
    _getWidgets() {
        return Array.from(this.widgetGrid.querySelectorAll('.grid-stack-item'))
            .map(item => item.widgetInstance)
            .filter(Boolean);
    }

    /**
     * Returns an image of the current dashboard. Enters screenshot mode for the capture then restores when done
     * @returns {Promise<Blob>}
     */
    async _getPreview() {
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
}

/** 
 * @param {HTMLButtonElement} btn 
 */
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