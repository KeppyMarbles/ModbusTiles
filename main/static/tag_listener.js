import { requestServer } from "./global.js";
/** @import { TagValueObject } from "./types.js" */
/** @import { Widget } from "./widgets.js" */

/**
 * Dispatches incoming tag updates to registered widgets via WebSocket
 */
export class TagListener {
    constructor() {
        /** @type {{ [tag_id: string]: Widget[] }} */
        this.tagMap = {};

        /** @type {WebSocket | null} */
        this.socket = null;

        /** @type {number} */
        this.retryInterval = 2000;
    }

    /**
     * Registers a widget to receive updates for its associated tag
     * @param {Widget} widget 
     */
    registerWidget(widget) {
        if (!widget.tag) return;
        this.tagMap[widget.tag.external_id] ??= [];
        this.tagMap[widget.tag.external_id].push(widget);
    }

    /**
     * Establishes a WebSocket connection to the dashboard tag stream, retrying if failed.
     * Fetches current values before subscribing to live updates
     */
    async connect() {
        const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
        const path = `${protocol}${window.location.host}/ws/dashboard/`;

        await this.fetchAll();

        this.socket = new WebSocket(path);

        this.socket.onopen = () => {
            console.log("Connected to PLC Stream");
            document.getElementById("connection-banner")?.classList.add("hidden");
            this.sendSubscription();
        };

        this.socket.onmessage = (e) => {
            const payload = JSON.parse(e.data);

            // main.consumers.tag_update
            if (payload.type === "tag_update") {
                payload.data.forEach(update => {
                    this.onUpdate(update);
                });
            }
        };

        this.socket.onclose = () => {
            console.log("Stream disconnected. Retrying...");
            document.getElementById("connection-banner")?.classList.remove("hidden");
            setTimeout(() => this.connect(), this.retryInterval);
        };
    }

    /**
     * Fetches the current values for all registered tags and sends them to widgets
     */
    async fetchAll() {
        const tagIds = Object.keys(this.tagMap).join(",");
        if (tagIds.length === 0) return;

        await requestServer('/api/values/', 'GET', { tags: tagIds }, /** @param {TagValueObject[]} response **/ (response) => {
            response.forEach(update => this.onUpdate(update));
        });
    }

    /**
     * Sends a list of tags to the server to recieve updates for
     */
    sendSubscription() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return;

        // Get all unique keys from the tagMap
        const tagIds = Object.keys(this.tagMap);

        this.socket.send(JSON.stringify({
            type: "subscribe",
            tags: tagIds
        }));
    }

    /**
     * Dispatches a tag update to the relevant widgets
     * @param {TagValueObject} update 
     */
    onUpdate(update) {
        const tagWidgets = this.tagMap[update.id];
        if(!tagWidgets)
            return;

        tagWidgets.forEach(widget => {
            widget.onData(update);
        });
    }

    /**
     * Clears widget registry and stops the WebSocket connection
     */
    clear() {
        console.log("WebSocket stopped");
        this.tagMap = {};
        if(this.socket) {
            this.socket.onclose = null;
            this.socket.close();
            this.socket = null;
        }
    }
}