import { getCookie } from "./util.js";

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

    start() {
        this.connectionBanner.classList.add("hidden");

        const tagIds = Object.keys(this.tagMap).join(",");
        const evt = new EventSource(`/events/tag-updates/?tags=${tagIds}`);

        evt.onmessage = (event) => {
            const updated = JSON.parse(event.data);
            for (const [tagId, tagData] of Object.entries(updated)) {
                if (this.tagMap[tagId]) {
                    this.tagMap[tagId].forEach(widget => widget.onData(tagData));
                }
            }
        };

        evt.onerror = () => {
            console.warn("SSE connection lost");
            this.connectionBanner.classList.remove("hidden");
        };
    }
}