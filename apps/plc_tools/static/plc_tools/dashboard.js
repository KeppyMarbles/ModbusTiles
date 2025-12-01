import { WidgetRegistry } from "./widgets.js";
import { TagPoller } from "./tag_poller.js";
import { GridStack } from 'https://cdn.jsdelivr.net/npm/gridstack@12.3.3/+esm'
import { getCookie } from "./util.js";

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
        this.cache = {
            tags: [],
            devices: [],
            tagOptions: [],
        }

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
        document.querySelectorAll('widget-config').forEach(configElem => {
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

        this.poller.stop();

        this.editButton.classList.add('hidden');
        
        await this.refreshData();
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
        this.inspectorForm.innerHTML = ''; // Clear previous

        if (!widgetElem) {
            this.inspectGlobal();
            return;
        }

        activateTab(this.inspectButton);
        widgetElem.classList.add("selected");

        // Add title
        const title = document.createElement('p');
        title.innerText = widgetElem.widgetInstance.constructor.displayName;
        title.className = "inspector-title";
        this.inspectorForm.appendChild(title);

        // Add fields
        const widget = widgetElem.widgetInstance;
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
                    input = document.createElement('select');
                    
                    // Add null option
                    const defaultOpt = document.createElement('option');
                    defaultOpt.value = "";
                    defaultOpt.text = "-- Select Tag --";
                    input.appendChild(defaultOpt);

                    // Add compatible tags
                    
                    const allowedTypes = widget.constructor.allowedTypes;
                    const allowedChannels = widget.constructor.allowedChannels;

                    const compatibleTags = this.cache.tags.filter(tag => {
                        const typeOk = allowedTypes.includes(tag.data_type);
                        const channelOk = allowedChannels.includes(tag.channel);
                        return typeOk && channelOk;
                    });

                    compatibleTags.forEach(tag => {
                        const opt = document.createElement('option');
                        opt.value = tag.external_id; // Using UUID
                        // Show useful info in the dropdown
                        opt.text = `${tag.alias} [${tag.address}]`;
                        console.log(widget.tag, tag.external_id);
                        
                        if (widget.tag === tag.external_id) {
                            opt.selected = true;
                        }
                        input.appendChild(opt);
                    });
                    break;

                case "bool":
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = widget.config[field.name];
                    break;

                case "number":
                    input = document.createElement('input');
                    input.type = field.type === 'number' ? 'number' : 'text';
                    input.value = widget.config[field.name];
                    break;

                case "text":
                    input = document.createElement('input');
                    input.type = field.type === 'text';
                    input.value = widget.config[field.name];
                    break;
            }

            if(!input) {
                console.warn("Unknown input for ", field.type);
                return;
            }
            input.className = "inspector-input";
                
            // Live Update Logic
            input.addEventListener('change', (e) => { //TODO don't really like these condintionals
                // We could just send the update by removing tagid from the config and adding it to the request but that's icky
                const val = field.type === 'bool' ? e.target.checked : e.target.value;
                if(field.type === "tag_picker")
                    widgetElem.widgetInstance.config[field.name] = val;
                else
                    widgetElem.widgetInstance.tag = e.target.value;
                widgetElem.widgetInstance.applyConfig();
            });
            
            label.appendChild(input);
            wrapper.appendChild(label);
            this.inspectorForm.appendChild(wrapper);
        });
    }

    inspectGlobal() {
        activateTab(this.inspectButton);

        this.inspectorForm.innerHTML = '';
        
        const title = document.createElement('p');
        title.innerText = "Dashboard Settings";
        title.className = "inspector-title";
        this.inspectorForm.appendChild(title);

        // --- Create Tag Section ---
        const box = document.createElement('p');
        box.style.border = "1px solid #ccc";
        box.style.padding = "10px";
        box.innerText = 'Create New Tag';
        
        // Simple helper to create inputs
        const createInput = (name, label, type="text", value) => { //TODO default value
            const wrapper = document.createElement('div');
            wrapper.className = "input-group";

            const labelElem = document.createElement('label');
            labelElem.innerText = label;
            labelElem.className = "inspector-label";

            const input = document.createElement(type === 'select' ? 'select' : 'input');
            if(type !== 'select') input.type = type;
            input.name = name;
            input.className = "inspector-input";

            input.value = value !== undefined ? value : "";

            wrapper.appendChild(labelElem);
            labelElem.appendChild(input);
            return { wrapper, input };
        };

        // Alias
        const aliasUI = createInput("alias", "Tag Name");
        box.appendChild(aliasUI.wrapper);

        // Device Select
        const deviceUI = createInput("device", "Device", "select");
        this.cache.devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.alias;
            opt.innerText = d.alias;
            deviceUI.input.appendChild(opt);
        });
        box.appendChild(deviceUI.wrapper);

        // Address
        const addrUI = createInput("address", "Address (e.g. 40001)", "number", 0);
        box.appendChild(addrUI.wrapper);

        // Channel Select
        const channelUI = createInput("channel", "Channel", "select");
        this.cache.tagOptions.channels.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.value;
            opt.innerText = d.label;
            channelUI.input.appendChild(opt);
        });
        box.appendChild(channelUI.wrapper);

        // Data Type Select
        const dataTypeUI = createInput("datatype", "Data Type", "select");
        this.cache.tagOptions.data_types.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.value;
            opt.innerText = d.label;
            dataTypeUI.input.appendChild(opt);
        });
        box.appendChild(dataTypeUI.wrapper);

        // Read Amount
        const readAmountUI = createInput("read", "Read Amount", "number", 1);
        box.appendChild(readAmountUI.wrapper);

        // Max History Entries
        const maxHistoryUI = createInput("history", "Max History", "number", 0);
        box.appendChild(maxHistoryUI.wrapper);

        // Submit Button
        const btn = document.createElement('button');
        btn.innerText = "Save Tag";
        btn.className = "btn-primary";
        btn.style.marginTop = "10px";
        
        btn.onclick = async () => {
            const payload = {
                alias: aliasUI.input.value,
                device: deviceUI.input.value,
                address: parseInt(addrUI.input.value),
                channel: channelUI.input.value,
                data_type: dataTypeUI.input.value, 
                unit_id: 1,
                read_amount: parseInt(readAmountUI.input.value),
                max_history_entries: parseInt(maxHistoryUI.input.value),
                is_active: true
            };

            const result = await createTag(payload);
            if(result) {
                this.refreshData(); // Repopulate tag list
            }
        };
        
        box.appendChild(btn);
        this.inspectorForm.appendChild(box);
    }

    async refreshData() {
        try {
            // Fetch Tags and Devices in parallel
            const [tagsResp, devicesResp, tagOptions] = await Promise.all([
                fetch('/api/tags/'),
                fetch('/api/devices/'),
                fetch('/api/tag-options/')
            ]);

            this.cache.tags = await tagsResp.json();
            this.cache.devices = await devicesResp.json();
            this.cache.tagOptions = await tagOptions.json();
            console.log("Data loaded:", this.cache);
        } 
        catch (err) {
            console.error("Failed to load editor data", err);
            alert("Could not load Tags/Devices"); //TODO show no connection banner, keep trying?
            // would need to refactor logic for banner a bit
        }
    }

    updateSquareCells() {
        const width = this.canvasGridStack.el.clientWidth;
        const cellWidth = width / this.canvasGridStack.opts.column;
        this.canvasGridStack.cellHeight(cellWidth);   // make rows match columns
    }

    save() {
        // send all the widget info
        // backend should get all the widgets and update them accordingly

        const widgetUpdates = []

        document.querySelectorAll('.dashboard-widget').forEach(el => {
            const widget = el.widgetInstance;

            widgetUpdates.push({
                // Top level database fields
                tag: widget.tagId, // The UUID string
                widget_type: el.dataset.type,
                config: widget.config
            });
        });
        //TODO include dashboard alias
        //const payload = 
    }
}

async function createTag(payload) {
    try {
        const response = await fetch('/api/tags/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("Tag Created!");
            return true;
        } 
        else {
            const err = await response.json();
            alert("Error: " + JSON.stringify(err));
        }
    } catch (e) {
        console.error(e);
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