/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與基礎 UI 工具 (api_core.js)
 * ============================================================================
 */

// 🔴 系統 API 端點 (依據原始設定)
const API_URL = "https://script.google.com/macros/s/AKfycbxWzxfHYdw9qvcPtGpU2qjxk-10hToTb1Jx-LrMhBN1jkR3IXUnu8m6UgfKcGMsi0tl/exec";

// ============================================================================
// 全域變數與狀態管理
// ============================================================================
let myName = ""; 
let myUid = localStorage.getItem('invUid') || Math.random().toString(36).substring(2); 
localStorage.setItem('invUid', myUid);

let globalClients = []; 
let globalSuppliers = []; 
let globalCatalog = []; 
let globalHistory = []; 
let globalOrders = []; 
let globalInventory = []; 
let globalSalesDetails = []; 
let globalInvLogs = []; 
let globalQuotes = []; 
let globalDeliveries = []; // 【全新】送貨追蹤總表全域陣列
let emailSettingsData = { list: [], selected: [] };

let myLastSyncTime = 0;

let aiTempData = null; 
let currentOrderManualItems = []; 
let currentQuoItems = []; 
let selectedOrderCache = []; 
let currentInvoiceData = { clientName:'', taxId:'', items:[] }; 
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組
// ============================================================================
async function callApi(action, payload = {}) {
    if (API_URL.includes("請填入你的")) throw new Error("⚠️ 尚未設定 API_URL，請更新 api_core.js 中的網址！");
    try {
        const response = await fetch(API_URL, { 
            method: 'POST', 
            redirect: 'follow', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify({ action: action, payload: payload }) 
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);
        return result.data;
    } catch (err) { 
        console.error(`[API Error] ${action}:`, err); 
        throw err; 
    }
}

// ============================================================================
// 背景同步佇列系統
// ============================================================================
let bgSyncQueue = []; 
let isSyncing = false; 
let syncTimeoutTimer = null;

function pushToSyncQueue(action, payload, callback) { 
    if (payload && typeof payload === 'object') {
        payload.clientSyncTime = myLastSyncTime;
        if (!payload.taskId) {
            payload.taskId = 'T_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        }
    }
    bgSyncQueue.push({ action, payload, callback, retry: 0, time: Date.now() }); 
    updateSyncIndicator(); 
    triggerSync(); 
}

function triggerSync() {
    if (isSyncing || bgSyncQueue.length === 0) return; 
    isSyncing = true; 
    const task = bgSyncQueue[0];
    
    clearTimeout(syncTimeoutTimer);
    // 【優化】將 timeout 縮短到 28 秒，提早攔截 Google 30 秒的硬性超時限制
    syncTimeoutTimer = setTimeout(() => {
        console.warn("同步超時(已達28秒)，準備於背景重試", task.action);
        task.retry += 1;
        handleSyncRetry(task);
    }, 28000);

    callApi(task.action, task.payload).then(res => {
        clearTimeout(syncTimeoutTimer);
        bgSyncQueue.shift(); 
        if(task.callback) task.callback(res); 
        updateSyncIndicator(); 
        isSyncing = false; 
        
        if (bgSyncQueue.length === 0) silentRefreshData();
        else triggerSync();
    }).catch(e => {
        clearTimeout(syncTimeoutTimer);
        console.error("背景傳輸異常", e); 
        if (e.message && e.message.includes("DIRTY_READ")) {
            alert(e.message);
            bgSyncQueue.shift();
            isSyncing = false;
            updateSyncIndicator();
            return;
        }
        task.retry += 1;
        handleSyncRetry(task);
    });
}

function handleSyncRetry(task) {
    if (task.retry > 3) {
        console.warn("任務失敗超過3次，轉存至 LocalStorage");
        let failedTasks = [];
        try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
        failedTasks.push(task);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        bgSyncQueue.shift(); 
        checkFailedTasks(); 
        updateSyncIndicator();
    }
    isSyncing = false; 
    if (bgSyncQueue.length > 0) {
        setTimeout(triggerSync, 5000); 
    }
}

// ============================================================================
// 報錯與未同步處理中心介面
// ============================================================================
function checkFailedTasks() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    let btn = document.getElementById('btnRetrySync');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnRetrySync';
        btn.className = 'btn btn-danger fw-bold shadow position-fixed';
        btn.style.cssText = 'bottom: 20px; right: 20px; z-index: 10800; border-radius: 30px; padding: 10px 20px; font-size: 0.9rem;';
        btn.onclick = window.openSyncErrorModal;
        document.body.appendChild(btn);
    }
    if (failedTasks.length > 0) {
        btn.innerText = `🔴 有 ${failedTasks.length} 筆未同步資料 (點擊處理)`;
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }
}

window.openSyncErrorModal = function() {
    renderSyncErrorList();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('syncErrorModal')).show();
};

function renderSyncErrorList() {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    const c = document.getElementById('syncErrorList');
    
    if (failedTasks.length === 0) {
        c.innerHTML = '<div class="text-center text-success fw-bold py-4 fs-5">✅ 所有資料皆已同步完成！</div>';
        checkFailedTasks();
        setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('syncErrorModal')).hide(), 1500);
        return;
    }
    
    c.innerHTML = failedTasks.map((t, idx) => {
        const dateStr = t.time ? new Date(t.time).toLocaleString() : '未知時間';
        const desc = translateTaskDesc(t);
        return `<div class="bg-white border rounded p-3 mb-2 shadow-sm d-flex justify-content-between align-items-center">
            <div>
                <div class="fw-bold text-dark fs-6">${desc}</div>
                <div class="small text-muted mt-1">🕒 發生時間: ${dateStr}</div>
                <div class="small text-secondary" style="font-size: 0.75rem;">內部指令: ${t.action}</div>
            </div>
            <div class="d-flex flex-column gap-2" style="min-width: 100px;">
                <button class="btn btn-sm btn-primary fw-bold" onclick="retrySingleTask(${idx})">🔄 重新傳送</button>
                <button class="btn btn-sm btn-outline-danger fw-bold" onclick="discardSingleTask(${idx})">🗑️ 清除捨棄</button>
            </div>
        </div>`;
    }).join('');
}

function translateTaskDesc(t) {
    const p = t.payload || {};
    switch(t.action) {
        case 'saveOrderData': return `📦 建立/編輯訂單 | 醫院: ${p.clientName||'未知'} | 單號: ${p.orderNo||'無'}`;
        case 'submitInvoice': return `📝 開立發票 | 客戶: ${p.clientName||'未知'} | 總計: $${(p.totalWithTax||0).toLocaleString()}`;
        case 'updateShipment': return `🚚 出貨作業 | 扣庫存 (${p.updates?.[0]?.name||'多筆品項'})`;
        case 'adjustInventory': return `🏭 庫存異動 | 品項: ${p.name||'未知'} | 動作: ${p.type||''} (${(p.changeQty||0)>0?'+':''}${p.changeQty||0})`;
        case 'submitPurchaseOrder': return `🛒 向廠商訂貨 | 品項: ${p.name||'未知'}`;
        case 'supplementInvoiceNo': return `📝 補登發票 | 新號碼: ${p.newPaperNo||'未知'}`;
        case 'addClientData': return `🏢 新增客戶 | 名稱: ${p.clientName||'未知'}`;
        case 'updateClientData': return `🏢 修改客戶 | 名稱: ${p.newName||'未知'}`;
        case 'saveAdminItem': return `📦 編輯報價品項 | 品名: ${p.productName||'未知'}`;
        case 'editInvLogRecord': return `✏️ 編輯異動紀錄 | 單號: ${p.invoiceNo||p.orderNo||'未知'}`;
        case 'updateInvoiceRecord': return `🗑️ 發票狀態操作 | 動作: ${p.action==='void'?'作廢':'修改'}`;
        case 'updateOrderStatus': return `📝 訂單狀態更新 | 狀態變更`;
        case 'saveQuotation': return `📑 建立/編輯估價單 | 客戶: ${p.clientName} | 單號: ${p.quoteNo}`;
        case 'mergeQuotations': return `🔗 合併估價單 | 群組 ID: ${p.mergeId}`;
        case 'unmergeQuotations': return `✂️ 解除合併估價單`;
        case 'updateQuotationStatus': return `🔄 更改估價單狀態 | 新狀態: ${p.status}`;
        case 'splitAndVoidQuotationItems': return `🗑️ 拆分作廢估價單品項 | 單號: ${p.quoteNo}`;
        // 【全新】送貨與批號系統翻譯
        case 'updateDeliveryInfo': return `🚚 更新送貨資訊 | 狀態: ${p.status||''}`;
        case 'updateDeliveryStatus': return `📦 送貨狀態變更 | 動作: ${p.action === 'sign' ? '簽收結案' : '退回待送'}`;
        case 'editInvLogBatch': return `🔄 修改出貨批號 | 品名: ${p.name||'未知'} -> 新批號: ${p.newLot||'不分批'}`;
        default: return `⚙️ 系統操作 (${t.action})`;
    }
}

window.retrySingleTask = function(idx) {
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    if (failedTasks[idx]) {
        let t = failedTasks[idx];
        t.retry = 0; 
        bgSyncQueue.push(t);
        failedTasks.splice(idx, 1);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        renderSyncErrorList();
        checkFailedTasks();
        updateSyncIndicator();
        triggerSync();
        showToast("🔄 已加入同步佇列重試");
    }
};

window.discardSingleTask = function(idx) {
    if(!confirm("確定要捨棄這筆資料嗎？\n(捨棄後資料將不會寫入系統，請確認您已不需要此操作)")) return;
    let failedTasks = [];
    try { failedTasks = JSON.parse(localStorage.getItem('failedSyncTasks') || '[]'); } catch(e){}
    if (failedTasks[idx]) {
        failedTasks.splice(idx, 1);
        localStorage.setItem('failedSyncTasks', JSON.stringify(failedTasks));
        renderSyncErrorList();
        checkFailedTasks();
    }
};

function updateSyncIndicator() { 
    const ind = document.getElementById('bgSyncIndicator'); 
    if(bgSyncQueue.length > 0) { 
        ind.innerText = `☁️ ${bgSyncQueue.length} 筆同步中...`; 
        ind.style.display = 'block'; 
    } else { 
        ind.innerText = `✅ 同步完成`; 
        setTimeout(()=> ind.style.display = 'none', 2000); 
    } 
}

function silentRefreshData() {
    callApi('getInitData', {}).then(res => {
        globalClients = res.clients||[]; globalSuppliers = res.suppliers||[]; globalCatalog = res.catalog||[]; globalHistory = res.history||[]; globalOrders = res.orders||[]; globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; globalInvLogs = res.invLogs||[];
        globalQuotes = res.quotes || []; 
        globalDeliveries = res.deliveries || []; // 【同步更新】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
        if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
        if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
        if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
        if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
        
        if(document.getElementById('sys-history') && document.getElementById('sys-history').style.display === 'block') { 
            if (typeof window.renderHistory === "function") window.renderHistory(); 
            if (typeof window.generateReport === "function") window.generateReport(); 
        }
        if(document.getElementById('sys-admin') && document.getElementById('sys-admin').style.display === 'block') { 
            if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
            if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
        }
        if(document.getElementById('sys-order') && document.getElementById('sys-order').style.display === 'block') {
            if (typeof window.renderOrderList === "function") window.renderOrderList();
        }
        if(document.getElementById('sys-inventory') && document.getElementById('sys-inventory').style.display === 'block') { 
            if (typeof window.renderInventory === "function") window.renderInventory(); 
            if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
            if (typeof window.renderShipments === "function") window.renderShipments(); 
        }
        if(document.getElementById('sys-quotation') && document.getElementById('sys-quotation').style.display === 'block') {
            if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
        }
        // 【新增連動】
        if(document.getElementById('sys-delivery') && document.getElementById('sys-delivery').style.display === 'block') {
            if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
        }
    }).catch(err => console.log('背景默默同步失敗:', err));
}

// ============================================================================
// 基礎工具與 UI 函式
// ============================================================================
function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function setSafeText(elementId, textValue) { const el = document.getElementById(elementId); if (el) el.innerText = textValue; }
function escapeQuotes(str) { return !str ? '' : String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }
function lockScreen() { document.body.classList.add('no-scroll'); } 
function unlockScreen() { document.body.classList.remove('no-scroll'); }
function setProgress(pct, text) { document.getElementById('splashProgress').style.width = pct + '%'; if(text) document.getElementById('splashText').innerText = text; }
function showLoading(msg="處理中...") { document.getElementById('miniLoadingText').innerText = msg; document.getElementById('miniLoading').style.display = 'flex'; }
function hideLoading() { document.getElementById('miniLoading').style.display = 'none'; }
function showToast(msg) { const tb = document.getElementById('toastBox'); tb.innerText = msg; tb.style.display = 'block'; setTimeout(()=> tb.style.opacity = '1', 10); setTimeout(() => { tb.style.opacity = '0'; setTimeout(()=> tb.style.display = 'none', 300); }, 2500); }

function debounce(func, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

// ============================================================================
// 【強制隱藏浮水印】動態切換紙張版型與防擠壓預覽系統
// ============================================================================
window.applyPrintStyle = function(size, layout) {
    let styleNode = document.getElementById('dynamicPrintStyle');
    if (!styleNode) {
        styleNode = document.createElement('style');
        styleNode.id = 'dynamicPrintStyle';
        document.head.appendChild(styleNode);
    }
    
    styleNode.innerHTML = `
    /* 【關鍵修正】強制在最頂層宣告邊界為 0，徹底消滅頁首頁尾浮水印 */
    @page { size: ${size} ${layout}; margin: 0mm !important; }

    @media screen {
        .print-active > div {
            min-width: 800px !important;
            margin: 0 auto !important;
            background: #fff;
            box-shadow: 0 0 15px rgba(0,0,0,0.3);
        }
    }
    @media print { 
        body { background: #fff !important; padding-top: 0 !important; } 
        #printControlBar { display: none !important; }
        .print-active { padding: 0 !important; overflow: visible !important; }
        .print-active > div { min-width: 100% !important; margin: 0 !important; box-shadow: none !important; }
    }`;
};

window.showPrintPreview = function(areaId) {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('homeMenu').style.display = 'none';
    
    // 【擴充】包含 printDeliveryArea
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
        }
    });
    
    const targetArea = document.getElementById(areaId);
    targetArea.style.display = 'block';
    targetArea.classList.add('print-active');
    
    targetArea.style.width = '100%';
    targetArea.style.overflowX = 'auto';
    targetArea.style.padding = '20px 0';
    
    let controlBar = document.getElementById('printControlBar');
    if (!controlBar) {
        controlBar = document.createElement('div');
        controlBar.id = 'printControlBar';
        controlBar.className = 'd-flex justify-content-center p-3 position-fixed w-100 top-0 d-print-none';
        controlBar.style.cssText = 'z-index: 10500; left: 0; background-color: #343a40; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        controlBar.innerHTML = `
            <button onclick="window.print()" class="btn btn-primary fw-bold px-4 py-2 me-3 fs-5 shadow-sm">🖨️ 確認呼叫印表機</button>
            <button onclick="closePrintPreview()" class="btn btn-danger fw-bold px-4 py-2 fs-5 shadow-sm">❌ 關閉預覽並返回</button>
        `;
        document.body.appendChild(controlBar);
    }
    controlBar.style.display = 'flex';
    document.body.style.backgroundColor = '#2c3034';
    document.body.style.paddingTop = '80px'; 
    document.body.style.overflow = 'auto'; 
    window.scrollTo(0,0);
};

window.closePrintPreview = function() {
    let controlBar = document.getElementById('printControlBar');
    if(controlBar) controlBar.remove(); 
    
    document.body.style.paddingTop = '0px';
    document.body.style.backgroundColor = ''; 
    document.body.style.overflow = ''; 
    
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
            el.style.width = '';
            el.style.overflowX = '';
            el.style.padding = '';
            // 【優化】使用 replaceChildren() 徹底且安全地清空 DOM 節點，防止事件監聽器殘留
            el.replaceChildren(); 
        }
    });
    
    document.getElementById('mainApp').style.display = 'block';
};

// ============================================================================
// 拖曳排序 (Drag & Drop) 邏輯
// ============================================================================
let draggedRowId = null;
let draggedType = null;

window.handleDragStart = function(e, id, type) {
    draggedRowId = id; draggedType = type;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
    e.target.style.border = '2px dashed #adb5bd';
};
window.handleDragOver = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
window.handleDragEnter = function(e) { e.currentTarget.style.borderTop = '3px solid #0d6efd'; };
window.handleDragLeave = function(e) { e.currentTarget.style.borderTop = ''; };
window.handleDrop = function(e, targetId, type) {
    e.stopPropagation(); e.currentTarget.style.borderTop = '';
    if (draggedRowId !== targetId && draggedType === type) {
        let arr = type === 'order' ? currentOrderManualItems : (type === 'invoice' ? currentInvoiceData.items : currentQuoItems);
        let fromIndex = arr.findIndex(x => x.id === draggedRowId);
        let toIndex = arr.findIndex(x => x.id === targetId);
        if (fromIndex >= 0 && toIndex >= 0) {
            const [movedItem] = arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, movedItem);
            if (type === 'order' && typeof window.reRenderOrderManualItems === "function") window.reRenderOrderManualItems();
            if (type === 'invoice' && typeof window.reRenderInvoiceItems === "function") window.reRenderInvoiceItems();
            if (type === 'quotation' && typeof window.reRenderQuotationItems === "function") window.reRenderQuotationItems(); 
        }
    }
    return false;
};
document.addEventListener('dragend', function(e) {
    if (e.target.style) { e.target.style.opacity = '1'; e.target.style.border = ''; }
    document.querySelectorAll('.draggable-row').forEach(el => el.style.borderTop = '');
});

// ============================================================================
// 系統初始化與授權
// ============================================================================
window.onload = function() {
    lockScreen(); checkFailedTasks();
    const exp = localStorage.getItem('invTokenExp'); 
    if (document.getElementById('invDate')) document.getElementById('invDate').value = getTodayStr();
    if (exp && parseInt(exp) > Date.now()) { 
        myName = localStorage.getItem('invStaffName'); 
        document.getElementById('authScreen').style.display = 'none'; 
        initSystemData(); 
    } else { 
        document.getElementById('splashScreen').style.display = 'none'; 
        document.getElementById('authScreen').style.display = 'flex'; 
    }
    setInterval(() => { 
        if(document.getElementById('mainApp') && document.getElementById('mainApp').style.display === 'block') { 
            callApi('heartbeat', { uid: myUid }).then(count => { 
                if(document.getElementById('mqOnline')) document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
                if(document.getElementById('navOnlineCount')) document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
            }).catch(e => console.log('心跳同步失敗', e)); 
        } 
    }, 60000);
};

window.loginSystem = function() {
    const pwd = document.getElementById('frontDoorPwd').value; 
    if(!pwd) return alert("請輸入密碼");
    const btn = document.querySelector('#authScreen button'); 
    btn.innerText = "驗證中..."; btn.disabled = true;
    callApi('verifyManager', { pwd: pwd }).then(res => { 
        myName = res.managerName; 
        localStorage.setItem('invStaffName', myName); 
        localStorage.setItem('invTokenExp', Date.now() + 7 * 24 * 60 * 60 * 1000); 
        document.getElementById('authScreen').style.opacity = '0'; 
        setTimeout(() => { document.getElementById('authScreen').style.display = 'none'; initSystemData(); }, 500); 
    }).catch(err => { 
        btn.innerText = "進入系統"; btn.disabled = false; alert(err.message); 
    });
};

window.logout = function() { if(confirm("確定登出？")) { localStorage.removeItem('invStaffName'); localStorage.removeItem('invTokenExp'); location.reload(); } };

window.initSystemData = function() {
    document.getElementById('splashScreen').style.display = 'flex'; let fakeProgress = 10; setProgress(fakeProgress, '下載雲端資料庫...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.15; setProgress(fakeProgress); }, 500);
    callApi('getInitData', {}).then(res => {
        clearInterval(intv); setProgress(100, '✅ 準備完成！');
        globalClients = res.clients || []; globalSuppliers = res.suppliers || []; globalCatalog = res.catalog || []; globalHistory = res.history || []; globalOrders = res.orders || []; globalInventory = res.inventory || []; globalSalesDetails = res.salesDetails || []; globalInvLogs = res.invLogs || [];
        globalQuotes = res.quotes || []; 
        globalDeliveries = res.deliveries || []; // 【同步更新】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
        if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
        if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
        if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
        if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
        
        if(document.getElementById('mqMonthCount')) document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${res.monthCount} 張`; 
        let daysLeft = Math.ceil((parseInt(localStorage.getItem('invTokenExp')) - Date.now()) / 86400000); 
        if(document.getElementById('welcomeName')) document.getElementById('welcomeName').innerText = `👋 ${myName}`; 
        if(document.getElementById('tokenCountdown')) document.getElementById('tokenCountdown').innerText = `🔐 憑證效期：${daysLeft} 天`;
        
        setTimeout(() => { 
            document.getElementById('splashScreen').style.opacity = '0'; 
            setTimeout(() => { 
                document.getElementById('splashScreen').style.display = 'none'; 
                unlockScreen(); 
                document.getElementById('homeMenu').style.display = 'block'; 
                if(typeof window.renderOrderList === "function") window.renderOrderList(); 
            }, 500); 
        }, 500);
    }).catch(e => { clearInterval(intv); alert("初始化失敗：" + e.message); });
};

window.refreshData = function() {
    showLoading("同步最新資料...");
    callApi('getInitData', {}).then(res => {
        globalClients = res.clients||[]; globalSuppliers = res.suppliers||[]; globalCatalog = res.catalog||[]; globalHistory = res.history||[]; globalOrders = res.orders||[]; globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; globalInvLogs = res.invLogs||[];
        globalQuotes = res.quotes || []; 
        globalDeliveries = res.deliveries || []; // 【同步更新】
        if (res.emailSettings) emailSettingsData = res.emailSettings;
        myLastSyncTime = res.serverSyncTime || Date.now();
        
        if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
        if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
        if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
        if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
        if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
        
        hideLoading(); showToast('✅ 已同步');
        
        if(document.getElementById('sys-history') && document.getElementById('sys-history').style.display === 'block') { 
            if (typeof window.renderHistory === "function") window.renderHistory(); 
            if (typeof window.generateReport === "function") window.generateReport(); 
        }
        if(document.getElementById('sys-admin') && document.getElementById('sys-admin').style.display === 'block') { 
            if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
            if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
        }
        if(document.getElementById('sys-order') && document.getElementById('sys-order').style.display === 'block') {
            if (typeof window.renderOrderList === "function") window.renderOrderList();
        }
        if(document.getElementById('sys-inventory') && document.getElementById('sys-inventory').style.display === 'block') { 
            if (typeof window.renderInventory === "function") window.renderInventory(); 
            if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
            if (typeof window.renderShipments === "function") window.renderShipments(); 
        }
        if(document.getElementById('sys-quotation') && document.getElementById('sys-quotation').style.display === 'block') {
            if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
        }
        // 【新增連動】
        if(document.getElementById('sys-delivery') && document.getElementById('sys-delivery').style.display === 'block') {
            if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
        }
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
};

window.enterSystem = function(modId) {
    document.getElementById('homeMenu').style.display = 'none'; document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none'); document.getElementById(`sys-${modId}`).style.display = 'block';
    
    // 【擴充】新增 title
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台', 'quotation': '📑 開立估價單', 'delivery': '🚚 送貨與電子簽收'}; 
    
    if(document.getElementById('sysTitle')) document.getElementById('sysTitle').innerText = titles[modId]; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
    }
    if(modId === 'admin') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
    }
    if(modId === 'order') {
        if (typeof window.renderOrderList === "function") window.renderOrderList();
    }
    if(modId === 'inventory') { 
        if (typeof window.renderInventory === "function") window.renderInventory(); 
        if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
        if (typeof window.renderShipments === "function") window.renderShipments(); 
    }
    if(modId === 'quotation') {
        if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
    }
    // 【新增連動】
    if(modId === 'delivery') {
        if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
    }
};

window.backToHome = function() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; };
