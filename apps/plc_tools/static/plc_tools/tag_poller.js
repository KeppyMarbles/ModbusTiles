import { getCookie } from "./util.js";

export class TagPoller {
    constructor() {
        this.tagMap = {}; // tag → [widgets]
    }

    registerWidget(widget) {
        if (!widget.tag) return;

        if (!this.tagMap[widget.tag])
            this.tagMap[widget.tag] = [];

        this.tagMap[widget.tag].push(widget);
    }

    start(interval = 500) {
        setInterval(() => this.pollAll(), interval);
    }

    async pollAll() {
        const tagIds = Object.keys(this.tagMap);
        if (tagIds.length === 0) return;

        try {
            const response = await fetch(`/api/tag/values/`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCookie("csrftoken")
                },
                body: JSON.stringify({ tag_ids: tagIds })
            });

            if (!response.ok) throw new Error("Batch fetch failed");

            const data = await response.json();

            // Distribute data to widgets
            for (const [tagId, tagData] of Object.entries(data)) {
                if (this.tagMap[tagId]) {
                    this.tagMap[tagId].forEach(widget => {
                        widget.onData(tagData); 
                    });
                }
            }

        } 
        catch (err) {
            console.error("Polling error:", err);
        }
    }
}