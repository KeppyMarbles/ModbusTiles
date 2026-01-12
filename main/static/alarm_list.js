import { requestServer, refreshData, serverCache } from "./global.js";
/** @import { ActivatedAlarmObject } from "./types.js" */

/** 
 * Populate table with ActivatedAlarm objects from the server 
 * */
async function loadAlarms() {
    requestServer('/api/activated-alarms/', 'GET', null, /** @param {ActivatedAlarmObject[]} data */ (data) => {
        const tbody = document.querySelector('#active-alarms-table tbody');
        tbody.innerHTML = '';
        
        // TODO make 2 tables?
        data.sort((a, b) => (a.is_active === b.is_active) ? 0 : a.is_active ? -1 : 1);

        data.forEach(alarm => {
            const alarmConfig = serverCache.alarms[alarm.config];
            const tag = serverCache.tags[alarmConfig.tag];
            const threat_level = serverCache.alarmOptions.threat_levels.find(choice => choice.value === alarmConfig.threat_level)?.label;

            console.log(alarm);

            const tr = document.createElement('tr');
            tr.className = `row-${alarmConfig.threat_level}`;
            
            const time = new Date(alarm.timestamp).toLocaleString();
            const timeHeard = alarm.acknowledged ? new Date(alarm.acknowledged_at).toLocaleString() : "";
            const timeResolved = alarm.is_active ? "" : new Date(alarm.resolved_at).toLocaleString();
            const status = alarm.is_active ? "ACTIVE" : "Resolved";

            const actionHtml = alarm.acknowledged ? 
                `<span class="user" title="Heard at ${timeHeard}">Heard by ${alarm.acknowledged_by_username || 'Unknown'}</span>` :
                `<button class="form-button ack-btn" data-id="${alarm.id}">Acknowledge</button>`;

            tr.innerHTML = `
                <td>${time}</td>
                <td>${tag.alias}</td> <td>${alarmConfig.message} <span class="message" title="Resolved at ${timeResolved}">[${status}]</span></td>
                <td class="threat-level">${threat_level}</td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.ack-btn').forEach(btn => {
            btn.addEventListener('click', (e) => acknowledge(e.target.dataset.id));
        });
    });
}

function acknowledge(id) {
    requestServer(`/api/activated-alarms/${id}/acknowledge/`, 'POST', null, () => loadAlarms());
}

await refreshData();
loadAlarms();
//setInterval(loadAlarms, 5000);