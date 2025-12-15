export class TagListener {
    constructor() {
        this.tagMap = {}; // tag_id -> [widgets]
        this.socket = null;
        this.retryInterval = 2000;
    }

    registerWidget(widget) {
        if (!widget.tag) return;
        if (!this.tagMap[widget.tag]) this.tagMap[widget.tag] = [];
        this.tagMap[widget.tag].push(widget);
    }

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
                const updates = payload.data;
                updates.forEach(update => {
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

    async fetchAll() {
        const tagIds = Object.keys(this.tagMap).join(",");
        if (tagIds.length === 0) return;

        try {
            const req = await fetch(`/api/values/?tags=${tagIds}`);

            if (!req.ok) throw new Error("Batch fetch failed");

            const response = await req.json();
            response.forEach(update => {
                this.onUpdate(update);
            })

        } 
        catch (err) {
            console.error("Fetching error:", err);
        }
    }

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

    onUpdate(update) {
        const tagWidgets = this.tagMap[update.id];
        if(!tagWidgets)
            return;

        tagWidgets.forEach(widget => {
            widget.onData(update);
        });
    }

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