let isSelecting = false;
let hoveredElement = null;

// 阻止默认行为和冒泡
function stopEvent(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleMouseMove(e) {
    if (!isSelecting) return;
    
    // 确保目标是元素节点且有classList
    if (e.target && e.target.nodeType === 1) {
        if (hoveredElement && hoveredElement !== e.target && hoveredElement.classList) {
            hoveredElement.classList.remove('element-export-highlight');
        }
        hoveredElement = e.target;
        hoveredElement.classList.add('element-export-highlight');
    }
}

async function handleMouseClick(e) {
    if (!isSelecting) return;
    stopEvent(e);

    isSelecting = false;
    if (hoveredElement && hoveredElement.classList) {
        hoveredElement.classList.remove('element-export-highlight');
    }
    
    // 移除监听器
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleMouseClick, true);

    showLoading();

    try {
        const targetElement = e.target;
        const htmlContent = await extractElement(targetElement);
        downloadHtml(htmlContent);
    } catch (error) {
        console.error("导出失败:", error);
        alert("导出失败：" + error.message);
    } finally {
        hideLoading();
    }
}

function showLoading() {
    const div = document.createElement('div');
    div.id = 'element-export-loading';
    div.innerText = '正在提取元素和资源，请稍候（页面越复杂时间越长）...';
    document.body.appendChild(div);
}

function hideLoading() {
    const div = document.getElementById('element-export-loading');
    if (div) div.remove();
}

function downloadHtml(htmlContent) {
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exported_element_' + new Date().getTime() + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function urlToBase64(url) {
    return new Promise((resolve) => {
        try {
            // 如果已经是绝对路径或 base64，URL 构造可能会报错但无关紧要，为了保险重新构造绝对路径
            const absoluteUrl = new URL(url, window.location.href).href;
            
            // 尝试通过 Canvas 直接在前端转换（适用于无跨域限制或设置了 CORS 的图片）
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataURL = canvas.toDataURL('image/png');
                    resolve(dataURL);
                } catch (e) {
                    // Canvas 跨域污染失败，回退到 Background 请求
                    fallbackToBackgroundFetch(absoluteUrl, resolve);
                }
            };
            img.onerror = () => {
                // 前端加载失败，回退到 Background 请求
                fallbackToBackgroundFetch(absoluteUrl, resolve);
            };
            img.src = absoluteUrl;

        } catch (e) {
            resolve(url);
        }
    });
}

function fallbackToBackgroundFetch(absoluteUrl, resolve) {
    chrome.runtime.sendMessage({ action: "fetch_base64", url: absoluteUrl }, (response) => {
        if (chrome.runtime.lastError) {
            // Background 脚本没响应
            resolve(absoluteUrl);
        } else if (response && response.base64) {
            resolve(response.base64);
        } else {
            resolve(absoluteUrl); // 失败时回退到原始URL绝对路径
        }
    });
}

async function extractElement(element) {
    const clone = element.cloneNode(true);
    const originalNodes = [element, ...element.querySelectorAll('*')];
    const cloneNodes = [clone, ...clone.querySelectorAll('*')];

    const chunkSize = 50; // 分块处理，避免阻塞主线程过久导致页面卡死

    for (let i = 0; i < originalNodes.length; i++) {
        const orig = originalNodes[i];
        const cloned = cloneNodes[i];

        if (orig.nodeType !== Node.ELEMENT_NODE) continue;

        // 定期让出主线程
        if (i % chunkSize === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // 1. 处理样式：不再内联所有计算样式，因为那会破坏 :hover 和 @keyframes 动画。
        // 我们改为保留原有 class，只在极其必要时(如原本有style)保留 inline style。
        // 取而代之的是，我们将在下面提取所有的页面样式表。
        cloned.classList.remove('element-export-highlight');

        // 2. 处理图片，将其转为Base64
        if (orig.tagName === 'IMG') {
            // 获取最真实的图片地址 (处理懒加载属性如 data-src)
            let imgSrc = orig.src || orig.getAttribute('data-src') || orig.getAttribute('data-original') || '';
            
            if (imgSrc) {
                if (!imgSrc.startsWith('data:')) {
                    try {
                        const absoluteUrl = new URL(imgSrc, window.location.href).href;
                        cloned.src = await urlToBase64(absoluteUrl);
                    } catch (e) {
                        cloned.src = imgSrc;
                    }
                } else {
                    cloned.src = imgSrc;
                }
            }
            // 清除可能导致离线图片无法显示的懒加载属性
            cloned.removeAttribute('loading');
            cloned.removeAttribute('data-src');
            cloned.removeAttribute('srcset');
        }

        // 3. 处理 Canvas (转为图片，以防Canvas离线失效)
        if (orig.tagName === 'CANVAS') {
            try {
                const dataUrl = orig.toDataURL();
                const img = document.createElement('img');
                img.src = dataUrl;
                img.style.cssText = cloned.style.cssText;
                img.className = cloned.className;
                cloned.parentNode.replaceChild(img, cloned);
            } catch(e) {
                console.warn("Canvas导出失败（可能由于跨域污染）", e);
            }
        }

        // 4. 处理背景图片转Base64 (现在我们需要直接读元素的 inline style 或者计算样式中的背景)
        const computedStyle = window.getComputedStyle(orig);
        const bgImage = computedStyle.getPropertyValue('background-image');
        if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
            const urls = bgImage.match(/url\(['"]?(.*?)['"]?\)/g);
            if (urls) {
                let newBgImage = bgImage;
                for (const urlStr of urls) {
                    const match = urlStr.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1] && !match[1].startsWith('data:')) {
                        const base64 = await urlToBase64(match[1]);
                        newBgImage = newBgImage.replace(urlStr, 'url("' + base64 + '")');
                    }
                }
                cloned.style.backgroundImage = newBgImage;
            }
        }

        // 5. 将视频/音频资源的URL转换为绝对路径（不转Base64以防文件过大崩溃）
        if (['VIDEO', 'AUDIO', 'SOURCE'].includes(orig.tagName) && orig.src) {
            if (!orig.src.startsWith('data:')) {
                try {
                    cloned.src = new URL(orig.src, window.location.href).href;
                } catch(e){}
            }
        }
    }

    // 6. 提取整个页面的真实 CSS 规则，而不是简单复制 link（防止跨域 link 离线失效）
    let allCSS = '';
    for (let i = 0; i < document.styleSheets.length; i++) {
        try {
            const sheet = document.styleSheets[i];
            // 忽略我们自己的高亮样式表
            if (sheet.href && sheet.href.includes('content.css')) continue;
            
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
                for (let j = 0; j < rules.length; j++) {
                    allCSS += rules[j].cssText + '\n';
                }
            }
        } catch (e) {
            // 如果遇到跨域样式表(CORS)无法读取 cssRules，则退而求其次通过 link 引入
            const sheet = document.styleSheets[i];
            if (sheet.href) {
                allCSS += `@import url("${sheet.href}");\n`;
            }
        }
    }
    
    const globalStyles = `<style>\n${allCSS}\n</style>`;

    // 8. 获取所有的 JS 脚本 (保持原本依赖链，用于恢复JS动画和交互逻辑)
    let globalScripts = '';
    document.querySelectorAll('script').forEach(s => {
        // 忽略插件自己可能注入的或不相关的脚本，也可以全部克隆
        if (s.src) {
            try {
                // 如果是相对路径转绝对路径
                const absoluteSrc = new URL(s.src, window.location.href).href;
                globalScripts += `<script src="${absoluteSrc}"></script>\n`;
            } catch(e){}
        } else {
            // 内联脚本
            globalScripts += `<script>${s.innerHTML}</script>\n`;
        }
    });

    // 组装最终离线 HTML
    const html = '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n<head>\n' +
    '    <meta charset="UTF-8">\n' +
    '    <title>已导出元素 - ' + (document.title || '网页片段') + '</title>\n' +
    '    ' + globalStyles + '\n' +
    '    <style>\n' +
    '        /* 默认离线页面基础样式 */\n' +
    '        body { margin: 0; padding: 20px; background-color: #f0f2f5; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }\n' +
    '        .exported-container { background: transparent; max-width: 100%; overflow: visible; position: relative; }\n' +
    '    </style>\n' +
    '</head>\n<body>\n' +
    '    <div class="exported-container">\n' +
    '        ' + clone.outerHTML + '\n' +
    '    </div>\n' +
    '    ' + globalScripts + '\n' +
    '</body>\n</html>';

    return html;
}

// 监听 Popup 发来的开始选择指令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_selection") {
        isSelecting = true;
        // 使用捕获阶段确保优先处理，并覆盖原有页面逻辑
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('click', handleMouseClick, true);
    }
});