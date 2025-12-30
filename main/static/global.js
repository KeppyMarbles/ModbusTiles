/** @import { ServerCacheObject } from "./types.js" */

/** 
 * Collection of object metadata from the server
 * @type {ServerCacheObject} 
 */
export const serverCache = {
    tags: [], //TODO make this a map of external_id -> other info?
    alarms: [],
    devices: [],
    tagOptions: [],
    alarmOptions: [],
}

/**
 * Requests an update for {@link serverCache}
 * 
 * Called on page load or when an alarm or tag is created
 */
export async function refreshData() { //TODO options?
    try {
        // Fetch Tags and Devices in parallel
        const [tagsResp, alarmsResp, devicesResp, tagOptions, alarmOptions] = await Promise.all([
            fetch('/api/tags/'),
            fetch('/api/alarms/'),
            fetch('/api/devices/'),
            fetch('/api/tag-options/'),
            fetch('/api/alarm-options/')
        ]);

        const tagList = await tagsResp.json();
        const alarmList = await alarmsResp.json();

        const tagMap = new Map(tagList.map(tag => [tag.external_id, tag]));
        const alarmMap = new Map(alarmList.map(alarm => [alarm.external_id, alarm]));

        serverCache.tags = tagMap
        serverCache.alarms = alarmMap
        serverCache.devices = await devicesResp.json();
        serverCache.tagOptions = await tagOptions.json();
        serverCache.alarmOptions = await alarmOptions.json();
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