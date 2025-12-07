import { postServer } from "./util.js";

function createDashboard() {
    const payload = {
        alias: "",
        description: "",
    };
    postServer("/api/dashboards/", payload, (data) => {
        window.location.href = "/dashboard/" + data.alias;
    });
}

document.getElementById("create-dashboard").onclick = createDashboard;