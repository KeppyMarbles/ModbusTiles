import { requestServer } from "./global.js";
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
            const tr = document.createElement('tr');
            tr.className = `row-${alarm.threat_level}`;
            
            const time = new Date(alarm.timestamp).toLocaleString();
            const status = alarm.is_active ? "ACTIVE" : "Resolved";

            const actionHtml = alarm.acknowledged ? 
                `<span class="user">Heard by ${alarm.acknowledged_by_username || 'Unknown'}</span>` :
                `<button class="form-button ack-btn" data-id="${alarm.id}">Acknowledge</button>`;

            tr.innerHTML = `
                <td>${time}</td>
                <td>${alarm.alias}</td> <td>${alarm.message} <span class="message">[${status}]</span></td>
                <td class="threat-level">${alarm.threat_level}</td>
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

loadAlarms();
//setInterval(loadAlarms, 5000);