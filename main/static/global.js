export const serverCache = {
    tags: [],
    devices: [],
    tagOptions: [],
    alarmOptions: [],
}

export async function refreshData() { //TODO options?
    try {
        // Fetch Tags and Devices in parallel
        const [tagsResp, devicesResp, tagOptions, alarmOptions] = await Promise.all([
            fetch('/api/tags/'),
            fetch('/api/devices/'),
            fetch('/api/tag-options/'),
            fetch('/api/alarm-options/')
        ]);

        serverCache.tags = await tagsResp.json();
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

// export function getDropdown(type) { 
//     return serverCache[type]?.map(a => ({ value: a.value, label: a.label}));
// }