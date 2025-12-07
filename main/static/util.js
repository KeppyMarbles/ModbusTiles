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

export async function postServer(input, payload, successCallback) {
    const isFormData = payload instanceof FormData;

    // Headers
    const headers = {
        'X-CSRFToken': getCookie('csrftoken')
    };

    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }

    // Body
    const body = isFormData ? payload : JSON.stringify(payload);

    try {
        const response = await fetch(input, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (response.ok) {
            const data = await response.json();
            if (successCallback) successCallback(data);
        } 
        else {
            // Try to parse error message, fallback to status text
            let errMsg = response.statusText;
            try {
                const err = await response.json();
                errMsg = JSON.stringify(err);
            } catch (e) { /* ignore JSON parse error on 500s */ }
            
            alert("Error: " + errMsg);
        }
    } 
    catch (e) {
        console.error("Network or Logic Error:", e);
        //alert("A network error occurred.");
    }
}