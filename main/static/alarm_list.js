import { requestServer, refreshData, serverCache } from "./global.js";
/** @import { ActivatedAlarmObject } from "./types.js" */

/** 
 * Populate table with ActivatedAlarm objects from the server 
 */
async function loadAlarms() {
    const activeTbody = document.querySelector('#active-alarms-table tbody');
    const resolvedTbody = document.querySelector('#resolved-alarms-table tbody');

    requestServer('/api/activated-alarms/', 'GET', null, /** @param {ActivatedAlarmObject[]} data */ (data) => {
        activeTbody.innerHTML = '';
        resolvedTbody.innerHTML = '';
        data.forEach(alarm => {
            const row = createAlarmRow(alarm);
            const body = alarm.is_active ? activeTbody : resolvedTbody;
            body.appendChild(row);
        });
    });
}

/**
 * Create a table row from the given alarm
 * @param {ActivatedAlarmObject} alarm 
 */
function createAlarmRow(alarm) {
    const alarmConfig = serverCache.alarms[alarm.config];
    const tag = serverCache.tags[alarmConfig.tag];

    const tr = document.createElement('tr');
    tr.className = `row-${alarmConfig.threat_level}`;

    const time = new Date(alarm.timestamp).toLocaleString();
    const timeHeard = alarm.acknowledged ? new Date(alarm.acknowledged_at).toLocaleString() : "";
    //const timeResolved = alarm.is_active ? "" : new Date(alarm.resolved_at).toLocaleString();
    //const status = alarm.is_active ? "ACTIVE" : "Resolved";

    tr.appendChild(td({"low": "🔔 Low", "high": "⚠️ High", "crit": "‼️ Critical"}[alarmConfig.threat_level], "threat-level"));
    tr.appendChild(td(time));
    tr.appendChild(td(tag.alias, null, tag.description));

    const messageTd = document.createElement('td');
    messageTd.textContent = alarmConfig.message + " ";
    tr.appendChild(messageTd);

    const actionTd = document.createElement('td');
    if (alarm.acknowledged) {
        tr.appendChild(td(`Heard by ${alarm.acknowledged_by_username || 'Unknown'}`, "user", `Heard at ${timeHeard}`))
    } 
    else {
        const btn = document.createElement('button');
        btn.className = "form-button ack-btn";
        btn.textContent = "Acknowledge";
        btn.addEventListener('click', () => acknowledge(alarm.id));
        actionTd.appendChild(btn);
    }

    tr.appendChild(actionTd);
    return tr;
}

/**
 * Get a data cell with attributes
 * @param {string} text 
 * @param {string} className 
 * @param {string} title
 */
function td(text, className, title) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (title) cell.title = title;
    cell.textContent = text;
    return cell;
}

function acknowledge(id) {
    requestServer(`/api/activated-alarms/${id}/acknowledge/`, 'POST', null, () => loadAlarms());
}

await refreshData();
loadAlarms();
//setInterval(loadAlarms, 5000);