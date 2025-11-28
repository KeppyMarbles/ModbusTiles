export class TagPoller {
    constructor() {
        this.tagMap = {}; // tag → [widgets]
        this.connectionBanner = document.querySelector(".connection-banner")
    }

    registerWidget(widget) {
        if (!widget.tag) return;

        if (!this.tagMap[widget.tag])
            this.tagMap[widget.tag] = [];

        this.tagMap[widget.tag].push(widget);
    }

    start(interval = 500) {
        this.pollInterval = setInterval(() => this.pollAll(), interval);
    }

    async pollAll() {
        this.connectionBanner.classList.add("hidden");
        const tagIds = Object.keys(this.tagMap).join(",");
        if (tagIds.length === 0) return;

        try {
            const req = await fetch(`/api/values/?tags=${tagIds}`);

            if (!req.ok) throw new Error("Batch fetch failed");

            const response = await req.json();

            // Distribute data to widgets
            response.forEach(tagData => {
                if (this.tagMap[tagData.id]) {
                    this.tagMap[tagData.id].forEach(widget => {
                        widget.onData(tagData); 
                    });
                }
            });

        } 
        catch (err) {
            console.error("Polling error:", err);
            this.connectionBanner.classList.remove("hidden");
            clearTimeout(this.pollInterval);
        }
    }
}