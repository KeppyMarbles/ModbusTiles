/** @import { ServerCacheObject, TagObject, AlarmConfigObject, ScheduleObject } from "./types.js" */

/** 
 * Collection of object metadata from the server
 * @type {ServerCacheObject} 
 */
export const serverCache = {
    tags: {},
    alarms: {},
    schedules: {},
    devices: [],
    tagOptions: {},
    alarmOptions: {},
    deviceOptions: {},
}

/**
 * Requests an update for {@link serverCache}
 * 
 * Called on page load (for dashboard and alarm list)
 */
export async function refreshData() { //TODO options?
    try {
        // Fetch Tags and Devices in parallel
        const [tagsResp, alarmsResp, schedulesResp, devicesResp, tagOptionsResp, alarmOptionsResp, deviceOptionsResp] = await Promise.all([
            fetch('/api/tags/'),
            fetch('/api/alarms/'),
            fetch('/api/schedules/'),
            fetch('/api/devices/'),
            fetch('/api/tags/', { method: "OPTIONS" }),
            fetch('/api/alarms/', { method: "OPTIONS" }),
            fetch('/api/devices/', { method: "OPTIONS" }),
        ]);

        /** @type {[TagObject[], AlarmConfigObject[], ScheduleObject[], DeviceObject[], Object, Object, Object]} */
        const [tagList , alarmList, scheduleList, deviceList, tagOptions, alarmOptions, deviceOptions] = await Promise.all([
            tagsResp.json(),
            alarmsResp.json(),
            schedulesResp.json(),
            devicesResp.json(),
            tagOptionsResp.json(),
            alarmOptionsResp.json(),
            deviceOptionsResp.json(),
        ])

        const tagMap = Object.fromEntries(tagList.map(tag => [tag.external_id, tag]));
        const alarmMap = Object.fromEntries(alarmList.map(alarm => [alarm.external_id, alarm]));
        const scheduleMap = Object.fromEntries(scheduleList.map(schedule => [schedule.external_id, schedule]));

        serverCache.tags = tagMap;
        serverCache.alarms = alarmMap;
        serverCache.schedules = scheduleMap;
        serverCache.devices = deviceList;
        serverCache.tagOptions = tagOptions;
        serverCache.alarmOptions = alarmOptions;
        serverCache.deviceOptions = deviceOptions;
        
        console.log("Data loaded:", serverCache);
        return true;
    } 
    catch (err) {
        console.error("Failed to load editor data", err);
        alert("Could not load Tags/Devices"); //TODO show no connection banner, keep trying?
        return false;
        // would need to refactor logic for banner a bit
    }
}

/**
 * Get the value of a cookie by name
 * @param {string} name 
 * @returns {string}
 */
export function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            // Does this cookie string begin with the name we want?
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

/**
 * Send request with CSRFToken and payload at the given endpoint
 * @param {string} input 
 * @param {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} method
 * @param {Object} payload 
 * @param {(data: Object) => any} successCallback Performed if a success response is recieved
 * @returns 
 */
export async function requestServer(input, method, payload, successCallback) {
    const isFormData = payload instanceof FormData;
    method = method.toUpperCase();

    const headers = {
        'X-CSRFToken': getCookie('csrftoken')
    };

    // Configuration object for fetch
    const options = {
        method: method,
        headers: headers,
    };

    // Handle Body vs Query Params
    if (method === 'GET' || method === 'HEAD') {
        // If payload exists for GET, append it as query parameters
        if (payload) {
            const params = new URLSearchParams(payload).toString();
            input += (input.includes('?') ? '&' : '?') + params;
        }
    } 
    else {
        // For POST, PUT, PATCH, etc., add the body
        if (!isFormData) {
            headers['Content-Type'] = 'application/json';
        }
        options.body = isFormData ? payload : JSON.stringify(payload);
    }

    try {
        const response = await fetch(input, options);

        if (response.ok) {
            // Check if response has content before parsing JSON (important for DELETE usually)
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const data = await response.json();
                if (successCallback) successCallback(data);
            } else if (successCallback) {
                successCallback(null);
            }
            return true;
        } 
        else {
            // Error handling
            let errMsg = response.statusText;
            try {
                const err = await response.json();
                errMsg = JSON.stringify(err);
            } catch (e) { }
            alert("Error: " + errMsg);
        }
    } 
    catch (e) {
        console.error("Network or Logic Error:", e);
    }
    return false;
}