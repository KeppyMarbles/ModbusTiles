import { requestServer } from "./global.js";

/**
 * Register a new dashboard on the server, then redirect to it
 */
function createDashboard() {
    requestServer("/api/dashboards/", 'POST', { alias: "" }, (data) => {
        window.location.href = "/dashboard/" + data.alias;
    });
}

function checkAlarms() {
    requestServer('/api/activated-alarms/active_count/', 'GET', null, (data) => {
        const badge = document.getElementById('alarm-badge');
        if (data.count > 0) {
            badge.textContent = data.count;
            badge.style.display = 'inline-block';
        } 
        else {
            badge.style.display = 'none';
        }
    });
}
checkAlarms();
//setInterval(checkAlarms, 10000);

document.getElementById("create-dashboard").onclick = createDashboard;