// 后台脚本，用于绕过页面内CORS限制，代为请求资源并转为Base64
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetch_base64") {
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ base64: reader.result });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                console.warn("Fetch base64 failed for url:", request.url, err);
                sendResponse({ base64: null });
            });
        
        // 返回 true 告诉 Chrome 我们会异步调用 sendResponse
        return true; 
    }
});