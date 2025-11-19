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
        for (const tag in this.tagMap) {
            const req = await fetch(`/api/tag/${tag}/value/`);
            const data = await req.json();

            console.log(data.time);

            this.tagMap[tag].forEach(widget =>
                widget.onValue(data.value, data.time)
            );
        }
    }
}