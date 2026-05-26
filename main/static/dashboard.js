import { WidgetRegistry } from "./widgets.js";
import { TagListener } from "./tag_listener.js";
import { GridStack } from "./lib/gridstack.js";
import html2canvas from "./lib/html2canvas.esm.js";
import { refreshData, requestServer, serverCache } from "./global.js";
import { Inspector } from "./inspector.js";
/** @import { DashboardWidgetInfoObject, DashboardConfigObject, DashboardObject, DashboardStateObject } from "./types.js" */
/** @import { Widget } from "./widgets.js" */

/**
 * The main class for a dashboard page which handles Widget, TagListener, and Inspector classes 
 */
export class Dashboard {
    /**
     * @type {InspectorFieldDefinition[]}
     */
    static defaultFields = [
        { name: "title", type: "string", default: "", label: "Dashboard Name" },
        { name: "description", type: "string", default: "", label: "Description" },
        { name: "column_count", type: "number", default: "", label: "Column Count" },
        { name: "background_color", type: "color", default: "", label: "Background Color" },
    ];

    /**
     * @param {string} alias 
     */
    constructor(alias) {
        /** @type {boolean} */
        this.editMode = false;

        /** @type {boolean} */
        this.isDirty = false;

        /** @type {Set<Widget>} */
        this.widgets = new Set();

        /** @type {Set<Widget>} */
        this.selectedWidgets = new Set();

        /** @type {TagListener} The WebSocket listener to register Widgets to */
        this.listener = new TagListener();

        /** @type {Inspector} */
        this.inspector = new Inspector(document.getElementById('inspector-form'));

        /** @type {Object} */
        this.config = null;

        /** @type {HTMLDivElement} */
        this.widgetGrid = document.getElementById('dashboard-grid');

        /** @type {HTMLButtonElement} */
        this.editButton = document.getElementById('edit-button');

        /** @type {HTMLButtonElement} */
        this.fileInput = null;

        /** @type {ResizeObserver} */
        this.resizeObserver = new ResizeObserver(() => this.updateSquareCells());
        this.resizeObserver.observe(this.widgetGrid);

        /** @type {DashboardStateObject[]} */
        this.undoStack = [];

        /** @type {DashboardStateObject[]} */
        this.redoStack = [];

        // Init
        this._setupEvents();
        this.load(alias);
    }

    _setupEvents() {
        // Widget selection
        this.widgetGrid.addEventListener('click', (e) => {
            if(!this.editMode) return;
            if(e.target.classList.contains("ui-resizable-handle")) return;

            /** @type {Widget?} */
            const widget = e.target.closest('.palette-item')?.widgetInstance;

            if(widget) {
                if(e.shiftKey) {
                    if(this.selectedWidgets.has(widget))
                        this.selectedWidgets.delete(widget);
                    else
                        this.selectedWidgets.add(widget);
                }
                else {
                    this.selectedWidgets.clear();
                    this.selectedWidgets.add(widget);
                }
                if(dashboardEdit) // TODO this is weird
                    activateTab(document.getElementById('inspect-button'));
            }
            else {
                this.selectedWidgets.clear();
            }

            this.updateSelection();
        });

        // Hotkeys
        document.addEventListener('keydown', (e) => {
            if (this.editMode) {
                if (e.ctrlKey) {
                    if(e.key === 'z') {
                        e.preventDefault();
                        this.undo();
                    }
                    if(e.key === 'y') {
                        e.preventDefault();
                        this.redo();
                    }
                    else if(e.key === 's') {
                        e.preventDefault();
                        this.save();
                    }
                }
                if (e.key === 'Delete') {
                    e.preventDefault();
                    this.deleteSelection();
                }
            }
        });

        // Buttons
        this.editButton.addEventListener('click', () => this.toggleEdit(!this.editMode));

        // Import file
        this.fileInput = document.getElementById('importFile');
        this.fileInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if(file)
                await this.importFile(file);
            this.fileInput.value = "";
        });

        // Window events
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
            animate: false,
            //removable: "#editor-sidebar",
        });
        GridStack.setupDragIn('#palette .palette-item', { appendTo: 'body', helper: 'clone' });

        // Handle drag and drop, deletion
        this.canvasGridStack.on('added change removed', (event, items) => {
            if(!this._settingUp) {
                this.pushState();
            }
            items.forEach(item => {
                /** @type {Widget} */
                let widget = item.el.widgetInstance;
                switch(event.type) {
                    case 'added':
                        if(!widget) { // If the widget was added using the palette (TODO? this is a bit weird)
                            const type = item.el.dataset.type; // Set by Django
                            widget = new WidgetRegistry[type](item.el);
                        }
                        this.widgets.add(widget);
                        // Fall-through

                    case 'change': 
                        widget.config.position_x = item.x;
                        widget.config.position_y = item.y;
                        widget.config.scale_x = item.w;
                        widget.config.scale_y = item.h;
                        break;

                    case 'removed':
                        this.widgets.delete(widget);
                        break;
                }
            });

            if(this.editMode)
                this.isDirty = true; // Prompt page exit

        });

        // Set grid 1:1 aspect ratio
        this.updateSquareCells();
    }

    /**
     * Fetch and apply widget data from the server based on the given name
     * @param {string} alias
     */
    async load(alias) {
        try {
            const [metaResp, widgetResp] = await Promise.all([
                fetch(`/api/dashboards/${alias}`),
                fetch(`/api/dashboard-widgets/?dashboard=${alias}`)
            ]);

            /** @type {DashboardWidgetInfoObject[]} */
            const widgets = await widgetResp.json();

            /** @type {DashboardObject} */
            const meta = await metaResp.json();
            this.alias = alias;
            this.config = meta.config || { column_count: 20, description: "", title: "" };

            // Set up recieved info
            this.setupWidgets(widgets, this.config.column_count);
            this.applyConfig();

            if(widgets.length === 0) {
                this.toggleEdit(true);
            }
            else {
                this.widgets.forEach(widget => this.listener.registerWidget(widget));
                await this.listener.connect();
            }

            document.getElementById('loading-spinner').classList.remove('hidden');
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
     * Populate the dashboard with new widgets from the given data
     * @param {DashboardWidgetInfoObject[]} widgetData 
     * @param {number} columnCount
     */
    setupWidgets(widgetData, columnCount) {
        this._settingUp = true;
        
        if(!this.canvasGridStack) this._setupGridStack(columnCount);
        this.canvasGridStack.removeAll();
        this.listener.clear();

        // Add widgets to the gridstack grid
        this.canvasGridStack.batchUpdate();
        widgetData.forEach(wData => this.createWidget(wData.config?.widget_type, serverCache.tags[wData.tag], wData.config));
        this.canvasGridStack.batchUpdate(false);

        this._settingUp = false;
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
        if(flag === this.editMode)
            return;

        this.editMode = flag;
        this.listener.clear();

        if(this.editMode) {
            document.body.classList.add('edit-mode');
            this.editButton.innerText = "View Dashboard";
            
            this.canvasGridStack.setStatic(false); // Enable Drag/Drop

            this.widgets.forEach(widget => {
                widget.clear();
                widget.setAlarm(null); //TODO add to clear()?
            });
            this.updateSelection();
        }
        else {
            document.body.classList.remove('edit-mode');
            this.editButton.innerText = "Edit Dashboard";

            this.canvasGridStack.setStatic(true);

            this.widgets.forEach(widget => this.listener.registerWidget(widget));
            this.listener.connect();
        }
    }

    applyConfig() {
        if(this.canvasGridStack.getColumn() !== this.config.column_count) {
            this.canvasGridStack.column(this.config.column_count);
            this.updateSquareCells();
        }
        document.body.style.backgroundColor = this.config.background_color;
        const title = document.getElementById("dashboard-title");
        if(title) {
            title.textContent = this.config.title;
            title.title = this.config.description;
        }
    }

    /**
     * Resize the GridStack cell width to maintain 1:1 aspect ratio
     */
    updateSquareCells() {
        if(!this.canvasGridStack)
            return;

        const gridEl = this.canvasGridStack.el;
        const width = gridEl.clientWidth;
        const columns = this.canvasGridStack.opts.column; 
        const cellWidth = width / columns;

        this.canvasGridStack.setAnimation(false);
        this.canvasGridStack.cellHeight(cellWidth);
        gridEl.style.setProperty('--cell-size', `${cellWidth}px`);
        this.canvasGridStack.onResize();
        this.canvasGridStack.setAnimation(this.editMode); // TODO? kinda hacky. Might not be performant
    }

    updateSelection() {
        this.widgets.forEach(w => w.gridElem.classList.toggle("selected", this.selectedWidgets.has(w)));

        if(this.selectedWidgets.size > 0)
            this.inspector.inspectWidgets([...this.selectedWidgets], () => this.pushState());
        else
            this.inspector.inspectDashboard(this);
    }

    deleteSelection() {
        this.canvasGridStack.batchUpdate();
        this.selectedWidgets.forEach(w => this.canvasGridStack.removeWidget(w.gridElem));
        this.canvasGridStack.batchUpdate(false);
        this.inspector.inspectDashboard(this);
    }

    /** 
     * Update the server with new widget config and screenshot
     */
    async save() {
        const fullConfig = this.getFullConfig();

        // Save config and widgets using JSON
        requestServer(`/api/dashboards/${this.alias}/save-data/`, 'POST', fullConfig, async (data) => {
            this.isDirty = false;
            this.alias = data.new_alias;

            const titleElem = document.getElementById('dashboard-title');
            titleElem.innerText = this.config.title;
            titleElem.title = this.config.description || "";
            history.pushState({}, "", `/dashboard/${this.alias}/`); // Change URL

            // Capture and upload the preview image in the background
            const imageBlob = await this.getPreview();
            if (imageBlob) {
                const imgFormData = new FormData();
                imgFormData.append('preview_image', imageBlob, 'preview.jpg');
                await requestServer(`/api/dashboards/${this.alias}/upload-preview/`, 'POST', imgFormData);
            }

            alert("Dashboard Saved!");
        });
    }

    /**
     * @returns {DashboardConfigObject} All data needed to recreate this dashboard
     */
    getFullConfig() {
        return {
            config: structuredClone(this.config),
            widgets: [...this.widgets].map(widget => {
                const widgetConfig = structuredClone(widget.config);
                widgetConfig.widget_type = widget.gridElem.dataset.type;
                return {
                    tag: widget.tag?.external_id || null,
                    config: widgetConfig
                };
            })
        };
    }

    /**
     * Download dashboard configuration as .json
     */
    exportFile() {
        try {
            const json = JSON.stringify(this.getFullConfig(), null, 2);
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
            /** @type {DashboardConfigObject} */
            const config = JSON.parse(text);
            const confirm = window.confirm(`Replace all widgets with ${config.widgets.length} new widgets?`)
            if(confirm) this.setupWidgets(config.widgets, config.config?.column_count || 20);
        } 
        catch (err) {
            alert("Error importing configuration: " + err.message);
        }
    }

    /**
     * Returns an image of the current dashboard. Enters screenshot mode for the capture then restores when done
     * @returns {Promise<Blob>}
     */
    async getPreview() {
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
            document.body.classList.remove("screenshot-mode");
        }
    }

    pushState() {
        this.undoStack.push(this.getState());
        this.redoStack = [];
        this.isDirty = true;
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this.getState());
        const previousState = this.undoStack.pop();
        this.restoreState(previousState);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this.getState());
        const nextState = this.redoStack.pop();
        this.restoreState(nextState);
    }

    /**
     * @returns {DashboardStateObject}
     */
    getState() {
        return {
            config: this.getFullConfig(),
            selection: [...this.selectedWidgets].map(w => `${w.config.position_x}x${w.config.position_y}y`),
        };
    }

    /** 
     * @param {DashboardStateObject} state 
     */
    restoreState(state) {
        this.setupWidgets(state.config.widgets, state.config.config?.column_count);

        this.selectedWidgets.clear();

        const widgets = Object.fromEntries(
            [...this.widgets].map(w => [`${w.config.position_x}x${w.config.position_y}y`, w])
        );

        state.selection.forEach(key => {
            if (widgets[key])
                this.selectedWidgets.add(widgets[key]);
        });

        this.updateSelection();
        this.applyConfig();
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
    btn.addEventListener('click', () => activateTab(btn));
});

await refreshData();

const tagForm = new Inspector(document.getElementById('tag-form'));
tagForm.inspectTag();

const alarmForm = new Inspector(document.getElementById('alarm-form'));
alarmForm.inspectAlarm();

const scheduleForm = new Inspector(document.getElementById('schedule-form'));
scheduleForm.inspectSchedule();

const alias = document.getElementById('dashboard-container').dataset.alias; // Set by Django
const dashboard = new Dashboard(alias);

let dashboardEdit = true;

document.getElementById("context-button").addEventListener('click', () => {
    dashboardEdit = !dashboardEdit;
    document.getElementById("dashboard-tabs").classList.toggle("hidden", !dashboardEdit);
    document.getElementById("system-tabs").classList.toggle("hidden", dashboardEdit);
    document.getElementById("editor-name").innerText = dashboardEdit ? "Dashboard Editor" : "System Editor";
    document.getElementById("context-button").innerText = dashboardEdit ? ">" : "<";
    activateTab(dashboardEdit ? 
        dashboard.selectedWidgets.size === 0 ? document.getElementById("add-button") : document.getElementById("inspect-button") :
        document.getElementById("tag-button")
    )
})