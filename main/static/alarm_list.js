import { requestServer, refreshData, serverCache } from "./global.js";
/** @import { ActivatedAlarmObject } from "./types.js" */

// Pagination and Filtering State
let limit = 20;
let offset = 0;
let searchQuery = "";
let threatFilter = "";
let ackFilter = "";

let totalResolvedCount = 0;
let loadedResolvedCount = 0;

// DOM Element references
const activeTbody = document.querySelector('#active-alarms-table tbody');
const resolvedTbody = document.querySelector('#resolved-alarms-table tbody');
const loadMoreBtn = document.querySelector('#load-more-btn');
const paginationStatus = document.querySelector('#pagination-status');

const searchInput = document.querySelector('#alarm-search');
const threatSelect = document.querySelector('#threat-filter');
const ackSelect = document.querySelector('#ack-filter');

/** 
 * Populate Active Incidents table with matching Active ActivatedAlarm objects
 */
async function loadActiveAlarms() {
    requestServer(`/api/activated-alarms/`, 'GET', getPayload(true, false), /** @param {ActivatedAlarmObject[]} data */ (data) => {
        activeTbody.innerHTML = '';
        data.forEach(alarm => {
            activeTbody.appendChild(createAlarmRow(alarm));
        });
    });
}

/** 
 * Populate Resolved Incidents table with matching Resolved ActivatedAlarm objects
 * @param {boolean} append - If true, appends elements to the existing list instead of resetting
 */
async function loadResolvedAlarms(append = false) {
    if (!append) {
        offset = 0;
        loadedResolvedCount = 0;
    }

    requestServer(`/api/activated-alarms/`, 'GET', getPayload(false, true), (data) => {
        if (!append) {
            resolvedTbody.innerHTML = '';
        }
        totalResolvedCount = data.count || 0;
        const results = data.results || [];
        
        results.forEach(alarm => {
            resolvedTbody.appendChild(createAlarmRow(alarm));
        });

        loadedResolvedCount += results.length;
        
        // Update pagination UI status text
        paginationStatus.textContent = `Showing ${loadedResolvedCount} of ${totalResolvedCount} resolved incidents`;
        
        // Disable and update the load more button if there are no more pages
        if (loadedResolvedCount >= totalResolvedCount || !data.next) {
            loadMoreBtn.disabled = true;
            loadMoreBtn.textContent = "No More Alarms";
        } else {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = "Load More";
        }
    });
}

/**
 * Get the query params for activated alarms
 * @param {boolean} active
 * @param {boolean} paginate
 */
function getPayload(active, paginate) {
    const payload = { is_active: active };
    if (paginate) payload.limit = limit;
    if (paginate) payload.offset = offset;
    if (searchQuery) payload.search = searchQuery;
    if (threatFilter) payload.threat_level = threatFilter;
    if (ackFilter)  payload.acknowledged = ackFilter;
    return payload;
}

/** 
 * Triggers loading/refreshing of both Active and Resolved lists
 */
async function loadAlarms() {
    loadActiveAlarms();
    loadResolvedAlarms(false);
}

/**
 * Loads the next page of resolved alarms and appends to the table
 */
function loadMoreResolved() {
    offset += limit;
    loadResolvedAlarms(true);
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

    tr.appendChild(td({"low": "🔔 Low", "high": "⚠️ High", "crit": "‼️ Critical"}[alarmConfig.threat_level], "threat-level"));
    tr.appendChild(td(time));
    tr.appendChild(td(tag.alias, null, tag.description));

    const messageTd = document.createElement('td');
    messageTd.textContent = alarmConfig.message + " ";
    tr.appendChild(messageTd);

    const actionTd = document.createElement('td');
    if (alarm.acknowledged) {
        actionTd.className = "user";
        actionTd.title = `Heard at ${timeHeard}`;
        actionTd.textContent = `Heard by ${alarm.acknowledged_by_username || 'Unknown'}`;
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

// Event Listeners for Filters
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        searchQuery = e.target.value;
        loadAlarms();
    }, 300);
});

threatSelect.addEventListener('change', (e) => {
    threatFilter = e.target.value;
    loadAlarms();
});

ackSelect.addEventListener('change', (e) => {
    ackFilter = e.target.value;
    loadAlarms();
});

loadMoreBtn.addEventListener('click', () => {
    loadMoreResolved();
});

// Initial Data Load
await refreshData();
loadAlarms();
//setInterval(loadAlarms, 5000);