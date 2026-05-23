/**
 * ============================================================================
 * 長固 ERP 系統 - 前端核心運算邏輯
 * ============================================================================
 */

// 🔴 系統 API 端點 (請替換為你的 GAS 網址)
const API_URL = "請填入你的_GAS_網頁應用程式_URL";

// ============================================================================
// 全域變數與狀態管理
// ============================================================================
let myName = ""; 
let myUid = localStorage.getItem('invUid') || Math.random().toString(36).substring(2); 
localStorage.setItem('invUid', myUid);

let globalClients = []; 
let globalCatalog = []; 
let globalHistory = []; 
let globalOrders = []; 
let globalInventory = []; 
let globalSalesDetails = []; 
let globalInvLogs = [];
let emailSettingsData = { list: [], selected: [] };

// AI 暫存與目前狀態
let aiTempData = null;
let currentOrderManualItems = [];
let selectedOrderCache = [];
let currentInvoiceData = { clientName:'', taxId:'', items:[] };
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組
// ============================================================================
async function callApi(action, payload = {}) {
    if (API_URL.includes("請填入你的")) {
        throw new Error("⚠️ 尚未設定 API_URL，請更新 main.js 中的網址！");
    }

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
    bgSyncQueue.push({ action, payload, callback }); 
    updateSyncIndicator(); 
    triggerSync(); 
}

function triggerSync() {
    if (isSyncing || bgSyncQueue.length === 0) return; 
    isSyncing = true; 
    const task = bgSyncQueue[0];
    
    clearTimeout(syncTimeoutTimer);
    syncTimeoutTimer = setTimeout(() => {
        console.warn("同步超時，強制重置狀態");
        isSyncing = false;
        triggerSync();
    }, 15000);

    callApi(task.action, task.payload)
        .then(res => {
            clearTimeout(syncTimeoutTimer);
            bgSyncQueue.shift(); 
            if(task.callback) task.callback(res); 
            updateSyncIndicator(); 
            isSyncing = false; 
            triggerSync();
        })
        .catch(e => {
            clearTimeout(syncTimeoutTimer);
            console.error("背景傳輸重試", e); 
            isSyncing = false; 
            setTimeout(triggerSync, 5000); 
        });
}

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

// ============================================================================
// 基礎工具與 UI 函式
// ============================================================================
function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function setSafeText(elementId, textValue) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = textValue;
}
function escapeQuotes(str) { 
    return !str ? '' : String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;"); 
}
function lockScreen() { document.body.classList.add('no-scroll'); } 
function unlockScreen() { document.body.classList.remove('no-scroll'); }
function setProgress(pct, text) { 
    document.getElementById('splashProgress').style.width = pct + '%'; 
    if(text) document.getElementById('splashText').innerText = text; 
}
function showLoading(msg="處理中...") { 
    document.getElementById('miniLoadingText').innerText = msg; 
    document.getElementById('miniLoading').style.display = 'flex'; 
}
function hideLoading() { 
    document.getElementById('miniLoading').style.display = 'none'; 
}
function showToast(msg) { 
    const tb = document.getElementById('toastBox'); 
    tb.innerText = msg; 
    tb.style.display = 'block'; 
    setTimeout(()=> tb.style.opacity = '1', 10); 
    setTimeout(() => { 
        tb.style.opacity = '0'; 
        setTimeout(()=> tb.style.display = 'none', 300); 
    }, 2500); 
}

// ============================================================================
// 系統初始化與授權
// ============================================================================
window.onload = function() {
    lockScreen(); 
    const exp = localStorage.getItem('invTokenExp');
    document.getElementById('invDate').value = getTodayStr();
    
    if (exp && parseInt(exp) > Date.now()) { 
        myName = localStorage.getItem('invStaffName'); 
        document.getElementById('authScreen').style.display = 'none'; 
        initSystemData(); 
    } else { 
        document.getElementById('splashScreen').style.display = 'none'; 
        document.getElementById('authScreen').style.display = 'flex'; 
    }
    
    setInterval(() => { 
        if(document.getElementById('mainApp').style.display === 'block') { 
            callApi('heartbeat', { uid: myUid }).then(count => {
                document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
                document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
            }).catch(e => console.log('心跳同步失敗', e));
        } 
    }, 60000);
};

function loginSystem() {
    const pwd = document.getElementById('frontDoorPwd').value; 
    if(!pwd) return alert("請輸入密碼");
    
    const btn = document.querySelector('#authScreen button'); 
    btn.innerText = "驗證中..."; btn.disabled = true;
    
    callApi('verifyManager', { pwd: pwd })
        .then(res => {
            myName = res.managerName; 
            localStorage.setItem('invStaffName', myName); 
            localStorage.setItem('invTokenExp', Date.now() + 7 * 24 * 60 * 60 * 1000); 
            document.getElementById('authScreen').style.opacity = '0'; 
            setTimeout(() => { 
                document.getElementById('authScreen').style.display = 'none'; 
                initSystemData(); 
            }, 500);
        })
        .catch(err => {
            btn.innerText = "進入系統"; btn.disabled = false; alert(err.message);
        });
}

function logout() { 
    if(confirm("確定登出？")) { 
        localStorage.removeItem('invStaffName'); 
        localStorage.removeItem('invTokenExp'); 
        location.reload(); 
    } 
}

function initSystemData() {
    document.getElementById('splashScreen').style.display = 'flex'; 
    let fakeProgress = 10; setProgress(fakeProgress, '下載雲端資料庫...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.15; setProgress(fakeProgress); }, 500);
    
    callApi('getInitData', {})
        .then(res => {
            clearInterval(intv); setProgress(100, '✅ 準備完成！');
            globalClients = res.clients || []; globalCatalog = res.catalog || []; 
            globalHistory = res.history || []; globalOrders = res.orders || [];
            globalInventory = res.inventory || []; globalSalesDetails = res.salesDetails || []; 
            globalInvLogs = res.invLogs || [];
            if (res.emailSettings) emailSettingsData = res.emailSettings;

            populateAdminClientFilter(); updateHistoryDropdowns(); populateLogDropdowns(); 
            updateOrderClientDropdown(); renderEmailSettings();
            
            document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${res.monthCount} 張`;
            let daysLeft = Math.ceil((parseInt(localStorage.getItem('invTokenExp')) - Date.now()) / 86400000);
            document.getElementById('welcomeName').innerText = `👋 ${myName}`; 
            document.getElementById('tokenCountdown').innerText = `🔐 憑證效期：${daysLeft} 天`;
            
            setTimeout(() => { 
                document.getElementById('splashScreen').style.opacity = '0'; 
                setTimeout(() => { 
                    document.getElementById('splashScreen').style.display = 'none'; 
                    unlockScreen(); 
                    document.getElementById('homeMenu').style.display = 'block'; 
                    renderOrderList(); 
                }, 500); 
            }, 500);
        })
        .catch(e => { clearInterval(intv); alert("初始化失敗：" + e.message); });
}

function refreshData() {
    showLoading("同步最新資料...");
    callApi('getInitData', {})
        .then(res => {
            globalClients = res.clients||[]; globalCatalog = res.catalog||[]; 
            globalHistory = res.history||[]; globalOrders = res.orders||[];
            globalInventory = res.inventory||[]; globalSalesDetails = res.salesDetails||[]; 
            globalInvLogs = res.invLogs||[];
            if (res.emailSettings) emailSettingsData = res.emailSettings;

            populateAdminClientFilter(); updateHistoryDropdowns(); populateLogDropdowns(); 
            updateOrderClientDropdown(); renderEmailSettings();
            hideLoading(); showToast('✅ 已同步');
            
            if(document.getElementById('sys-history').style.display === 'block') { renderHistory(); generateReport(); }
            if(document.getElementById('sys-admin').style.display === 'block') { renderAdminItems(); renderAdminClients(); }
            if(document.getElementById('sys-order').style.display === 'block') renderOrderList();
            if(document.getElementById('sys-inventory').style.display === 'block') { renderInventory(); renderInvLogs(); renderShipments(); }
        })
        .catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
}

function enterSystem(modId) {
    document.getElementById('homeMenu').style.display = 'none'; 
    document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none');
    document.getElementById(`sys-${modId}`).style.display = 'block';
    
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台'};
    document.getElementById('sysTitle').innerText = titles[modId]; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history') { renderHistory(); generateReport(); }
    if(modId === 'admin') { renderAdminItems(); renderAdminClients(); }
    if(modId === 'order') renderOrderList();
    if(modId === 'inventory') { renderInventory(); renderInvLogs(); renderShipments(); }
}

function backToHome() { 
    document.getElementById('mainApp').style.display = 'none'; 
    document.getElementById('homeMenu').style.display = 'block'; 
}

// ============================================================================
// 通用 Dropdowns & 信箱管理
// ============================================================================
function populateLogDropdowns() {
    const names = [...new Set(globalInvLogs.map(l=>l.name).filter(x=>x))].sort();
    document.getElementById('logFilterName').innerHTML = '<option value="">📦 所有品名 (不限)</option>' + names.map(n => `<option value="${escapeQuotes(n)}">${n}</option>`).join('');
}
function updateOrderClientDropdown() {
    const pending = globalOrders.filter(o => o.status !== '已結案' && o.status !== '作廢' && o.status !== '已作廢');
    const clients = [...new Set(pending.map(o => o.client).filter(x => x))].sort();
    document.getElementById('ordFilterClient').innerHTML = '<option value="">🏢 所有醫院</option>' + clients.map(c => `<option value="${escapeQuotes(c)}">${c}</option>`).join('');
}
function updateHistoryDropdowns() {
    const staffs = [...new Set(globalHistory.map(h=>h.staff).filter(x=>x))].sort(); 
    const clients = [...new Set(globalHistory.map(h=>h.client).filter(x=>x))].sort();
    document.getElementById('histFilterStaff').innerHTML = '<option value="">👤 員工</option>' + staffs.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('histFilterClient').innerHTML = '<option value="">🏢 客戶</option>' + clients.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderEmailSettings() {
    const container = document.getElementById('emailCheckboxes');
    if (emailSettingsData.list.length === 0) {
        container.innerHTML = '<div class="text-muted small">尚未在「收件信箱管理」工作表設定任何信箱。</div>';
        return;
    }
    let html = '';
    emailSettingsData.list.forEach((item, idx) => {
        const isChecked = emailSettingsData.selected.includes(item.email) ? 'checked' : '';
        html += `<div class="form-check">
            <input class="form-check-input email-cb" type="checkbox" value="${item.email}" id="cb_email_${idx}" ${isChecked}>
            <label class="form-check-label fw-bold text-dark" for="cb_email_${idx}">${item.email} <span class="badge bg-secondary ms-1">${item.memo || ''}</span></label>
        </div>`;
    });
    container.innerHTML = html;
}

function saveEmailSettings() {
    const cbs = document.querySelectorAll('.email-cb:checked');
    const selected = Array.from(cbs).map(cb => cb.value);
    emailSettingsData.selected = selected;
    showLoading("儲存設定中...");
    callApi('saveReportEmails', { selectedEmails: selected }).then(res => {
        hideLoading(); showToast("💾 收件信箱設定已儲存");
    }).catch(err => { hideLoading(); alert("儲存失敗：" + err.message); });
}

function triggerManualReport() {
    if (emailSettingsData.selected.length === 0) return alert("請先勾選至少一個收件信箱並儲存設定！");
    if (!confirm("確定要現在立即產生並發送「未結案訂單報表」嗎？\n(將發送至勾選的信箱)")) return;
    showLoading("報表產生並發送中...");
    callApi('sendPendingOrdersReport', {}).then(res => { hideLoading(); alert(res.msg); }).catch(err => { hideLoading(); alert("發送失敗：" + err.message); });
}

// ============================================================================
// 訂單模組 (Order) - AI 開放編輯與長固代號顯示
// ============================================================================
function processOrderUpload(input) {
    if(!input.files || !input.files[0]) return;
    const file = input.files[0]; 
    const mimeType = file.type || 'application/pdf'; 
    const reader = new FileReader();
    
    reader.onload = function(e) {
        showLoading("✨ Gemini AI 智慧辨識中...");
        callApi('processOrderImage', { base64Str: e.target.result, mimeType: mimeType })
            .then(res => {
                hideLoading(); aiTempData = res;
                document.getElementById('aiClient').value = res.clientName || ''; 
                document.getElementById('aiOrderNo').value = res.orderNo || ''; 
                document.getElementById('aiDept').value = res.department || '';
                document.getElementById('aiDeadline').value = ''; 
                recheckAiItems(); 
                document.getElementById('ordStep1').style.display = 'none'; 
                document.getElementById('ordStep2').style.display = 'block';
            }).catch(err => { hideLoading(); alert(err.message); });
    };
    reader.readAsDataURL(file); input.value = '';
}

// ✨ 開放 AI 預覽畫面進行文字編輯
function recheckAiItems() {
    if(!aiTempData || !aiTempData.items) return;
    const clientName = document.getElementById('aiClient').value;
    
    const html = aiTempData.items.map((i, index) => {
        let internalCode = "";
        if (clientName) {
            const p = globalCatalog.find(x => x.clientName === clientName && x.productName === i.name);
            if(p) internalCode = p.internalCode || p.assetCode || "";
        }
        let codeDisplay = `<span class="badge bg-secondary">醫院資材碼: ${i.code || '無'}</span>`;
        if (internalCode) codeDisplay += `<span class="badge bg-info text-dark ms-1">長固代號: ${internalCode}</span>`;
        
        return `<div class="p-3 border rounded mb-2 bg-white shadow-sm">
            <label class="form-label small fw-bold text-muted mb-1">確認/修改品名</label>
            <input type="text" class="form-control form-control-sm fw-bold text-dark mb-2" value="${escapeQuotes(i.name)}" onchange="updateAiItemName(${index}, this.value)">
            <div class="d-flex justify-content-between align-items-center mt-2">
                <div>${codeDisplay}</div>
                <div class="d-flex align-items-center">
                    <label class="form-label small fw-bold text-danger mb-0 me-2">數量:</label>
                    <input type="number" class="form-control form-control-sm text-danger fw-bold text-center" style="width: 70px;" value="${i.qty}" min="0" step="any" onchange="updateAiItemQty(${index}, this.value)">
                </div>
            </div>
        </div>`;
    }).join('');
    document.getElementById('aiItemsContainer').innerHTML = html || '<div class="text-muted">未擷取到品項</div>';
}

window.updateAiItemName = function(idx, val) {
    if(aiTempData && aiTempData.items[idx]) {
        aiTempData.items[idx].name = val;
        recheckAiItems(); // 重新比對對應的長固代號
    }
};

window.updateAiItemQty = function(idx, val) {
    if(aiTempData && aiTempData.items[idx]) {
        aiTempData.items[idx].qty = Math.max(0, parseFloat(val) || 0);
    }
};

function cancelOrderAI() { 
    document.getElementById('ordStep2').style.display = 'none'; 
    document.getElementById('ordStep1').style.display = 'block'; 
    aiTempData = null; 
}

function saveOrderAI() {
    if(!aiTempData) return;
    aiTempData.clientName = document.getElementById('aiClient').value; 
    aiTempData.orderNo = document.getElementById('aiOrderNo').value; 
    aiTempData.department = document.getElementById('aiDept').value;
    aiTempData.deadline = document.getElementById('aiDeadline').value;

    if(!aiTempData.clientName) return alert("客戶名稱必填");
    
    aiTempData.items.forEach(i => {
        const p = globalCatalog.find(x => x.clientName === aiTempData.clientName && x.productName === i.name);
        if(p) i.internalCode = p.internalCode || p.assetCode || "";
    });
    
    globalOrders.unshift({ 
        rowIdx: 9999, time: Date.now(), client: aiTempData.clientName, 
        orderNo: aiTempData.orderNo, dept: aiTempData.department, status: "待出貨", 
        jsonStr: JSON.stringify(aiTempData.items), deadline: aiTempData.deadline 
    });
    
    pushToSyncQueue('saveOrderData', aiTempData, null);
    cancelOrderAI(); updateOrderClientDropdown(); renderOrderList(); showToast("✅ 訂單建檔完成");
}

function renderOrderList() {
    const c = document.getElementById('ordListContainer');
    const searchTerm = document.getElementById('ordSearchInput').value.toLowerCase();
    const filterClient = document.getElementById('ordFilterClient').value;
    const filterDeadline = document.getElementById('ordFilterDeadline').value;

    let pending = globalOrders.filter(o => o.status !== '已結案' && o.status !== '作廢' && o.status !== '已作廢');
    const today = new Date(); today.setHours(0,0,0,0);

    if (filterClient) pending = pending.filter(o => o.client === filterClient);

    if (filterDeadline) {
        pending = pending.filter(o => {
            if (!o.deadline) return filterDeadline === 'none';
            const deadlineDate = new Date(o.deadline); deadlineDate.setHours(0,0,0,0);
            const diffDays = Math.ceil((deadlineDate - today) / 86400000);
            if (filterDeadline === 'danger') return diffDays <= 0;
            if (filterDeadline === 'warning') return diffDays > 0 && diffDays <= 3;
            if (filterDeadline === 'success') return diffDays > 3;
            return true;
        });
    }

    if (searchTerm) {
        pending = pending.filter(o => 
            (o.client && o.client.toLowerCase().includes(searchTerm)) || 
            (o.orderNo && o.orderNo.toLowerCase().includes(searchTerm)) ||
            (o.jsonStr && o.jsonStr.toLowerCase().includes(searchTerm))
        );
    }
    
    if(pending.length === 0) return c.innerHTML = '<div class="text-center text-muted py-3">查無符合條件的訂單</div>';
    
    let html = '';
    pending.forEach(o => {
        let items = [];
        try { items = JSON.parse(o.jsonStr||'[]'); } catch(e) { items = []; }
        
        let orderFullyShipped = true;
        let hasPartial = false;
        
        let displayItems = items.map(i => {
            let invoicedQty = globalSalesDetails.filter(d => d.orderNo === o.orderNo && d.name === i.name && d.shipStatus !== '作廢').reduce((sum, d) => sum + d.qty, 0);
            let remaining = i.qty - invoicedQty;
            if (remaining > 0) orderFullyShipped = false;
            if (invoicedQty > 0) hasPartial = true;

            // ✨ 尋找專屬長固代號
            const p = globalCatalog.find(x => x.clientName === o.client && x.productName === i.name);
            const intCodeBadge = (p && p.internalCode) ? `<span class="badge bg-info text-dark ms-1">長固: ${p.internalCode}</span>` : '';

            if (invoicedQty === 0) return `<div>${i.name} ${intCodeBadge} <span class="badge bg-secondary">x${i.qty}</span></div>`;
            else return `<div>${i.name} ${intCodeBadge} <br><small class="text-primary fw-bold">需求: ${i.qty} | 已開: ${invoicedQty} | 剩餘: <span class="text-danger">${remaining}</span></small></div>`;
        }).join('<hr class="my-2" style="opacity: 0.1;">');

        if (orderFullyShipped && items.length > 0) return;

        const desc = items.length > 0 ? displayItems : (o.jsonError ? '⚠️ 資料格式損毀' : '無明細');
        const warningLabel = o.jsonError ? `<span class="badge bg-danger ms-2">資料異常</span>` : (hasPartial ? `<span class="badge bg-info text-white ms-2">部分開立</span>` : '');
        const partialClass = hasPartial ? 'status-partial' : '';

        let deadlineHtml = '';
        if (o.deadline) {
            const deadlineDate = new Date(o.deadline); deadlineDate.setHours(0,0,0,0);
            const diffDays = Math.ceil((deadlineDate - today) / 86400000);
            if (diffDays < 0) deadlineHtml = `<span class="badge bg-danger ms-2">🔴 已逾期 (${o.deadline})</span>`;
            else if (diffDays === 0) deadlineHtml = `<span class="badge bg-danger ms-2">🔴 今日出貨 (${o.deadline})</span>`;
            else if (diffDays <= 3) deadlineHtml = `<span class="badge bg-warning text-dark ms-2">🟡 即將到期 (${o.deadline})</span>`;
            else deadlineHtml = `<span class="badge bg-success ms-2">🟢 期限: ${o.deadline}</span>`;
        }

        html += `<div class="item-row bg-white shadow-sm mb-2 p-3 ${partialClass}">
            <div class="d-flex align-items-center justify-content-between mb-2 border-bottom pb-2">
            <div class="d-flex align-items-center" style="max-width: 75%;">
                <input class="form-check-input me-3 cb-order" type="checkbox" value="${o.rowIdx}" data-orderno="${escapeQuotes(o.orderNo)}" data-client="${escapeQuotes(o.client)}" style="transform: scale(1.3); flex-shrink: 0;">
                <div><div class="fw-bold text-dark fs-6">${o.client} ${warningLabel}</div><div class="small text-muted mt-1">單號: ${o.orderNo||'無'} ${deadlineHtml}</div></div>
            </div>
            <button class="btn btn-sm btn-outline-secondary" onclick="openOrderModal(${o.rowIdx})">📝 編輯</button>
            </div>
            <div class="small text-muted">${desc}</div>
        </div>`;
    });
    
    c.innerHTML = html || '<div class="text-center text-muted py-3">目前訂單皆已出清結案</div>';
}

function selectClientForOrder(val) {
    const oldClient = document.getElementById('e_ordClient').value;
    document.getElementById('e_ordClient').value = val;
    if (oldClient !== val) {
        currentOrderManualItems = [];
        document.getElementById('e_ordItemsContainer').innerHTML = '';
        addOrderManualItemRow();
    }
}

function openOrderModal(idx) {
    currentOrderManualItems = [];
    document.getElementById('e_ordItemsContainer').innerHTML = '';
    if(idx) {
        const o = globalOrders.find(x => x.rowIdx === idx);
        document.getElementById('e_ordRow').value = idx;
        document.getElementById('e_ordClient').value = o.client;
        document.getElementById('e_ordNo').value = o.orderNo;
        document.getElementById('e_ordDept').value = o.dept;
        document.getElementById('e_ordDeadline').value = o.deadline || '';
        document.getElementById('btnDeleteOrd').style.display = 'block';
        document.getElementById('btnSaveOrd').classList.replace('w-100', 'w-50');
        let items = [];
        try { items = JSON.parse(o.jsonStr); } catch(e){}
        items.forEach(i => addOrderManualItemRow(i));
    } else {
        document.getElementById('e_ordRow').value = ''; document.getElementById('e_ordClient').value = '';
        document.getElementById('e_ordNo').value = ''; document.getElementById('e_ordDept').value = '';
        document.getElementById('e_ordDeadline').value = ''; document.getElementById('btnDeleteOrd').style.display = 'none';
        document.getElementById('btnSaveOrd').classList.replace('w-50', 'w-100');
        addOrderManualItemRow();
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editOrdModal')).show();
}

function addOrderManualItemRow(itemData = null) {
    const rowId = `ordM_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    currentOrderManualItems.push({ id: rowId, code: itemData?itemData.code:'', internalCode: itemData?itemData.internalCode:'', name: itemData?itemData.name:'', qty: itemData?itemData.qty:'' });
    
    const html = `
    <div class="item-row p-3 mb-2 bg-light border shadow-sm" id="${rowId}">
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:8px; right:8px;" onclick="removeOrderManualItem('${rowId}')">✕</button>
        <div class="mb-2 pe-4">
        <label class="form-label small fw-bold text-muted mb-1">品名</label>
        <input type="text" class="form-control fake-input-btn form-control-sm fw-bold fs-6" id="ordM_name_${rowId}" value="${escapeQuotes(itemData?itemData.name:'')}" readonly placeholder="點此選擇品名..." onclick="openSearchModal('item_ord_${rowId}', (val)=>selectProductForOrderManual('${rowId}', val))">
        </div>
        <div class="row g-2">
        <div class="col-4"><label class="form-label small fw-bold text-muted mb-1">醫院資材碼</label><input type="text" class="form-control form-control-sm bg-white text-secondary" id="ordM_code_${rowId}" value="${escapeQuotes(itemData?itemData.code:'')}" readonly placeholder="自動匹配"></div>
        <div class="col-4"><label class="form-label small fw-bold text-muted mb-1 text-info">長固代號</label><input type="text" class="form-control form-control-sm bg-white text-info fw-bold" id="ordM_intcode_${rowId}" value="${escapeQuotes(itemData?itemData.internalCode:'')}" readonly placeholder="內部代號"></div>
        <div class="col-4"><label class="form-label small fw-bold text-muted mb-1">數量</label><input type="number" class="form-control form-control-sm fw-bold text-primary fs-6" id="ordM_qty_${rowId}" value="${itemData?itemData.qty:''}" min="0" step="any" inputmode="numeric" onchange="updateOrderManualQty('${rowId}', this.value)" placeholder="輸入數量"></div>
        </div>
    </div>`;
    document.getElementById('e_ordItemsContainer').insertAdjacentHTML('beforeend', html);
}

function selectProductForOrderManual(rowId, prodName) {
    const clientName = document.getElementById('e_ordClient').value;
    const p = globalCatalog.find(x => x.clientName === clientName && x.productName === prodName); if(!p) return;
    document.getElementById(`ordM_name_${rowId}`).value = p.productName; document.getElementById(`ordM_code_${rowId}`).value = p.assetCode || ''; document.getElementById(`ordM_intcode_${rowId}`).value = p.internalCode || '';
    const item = currentOrderManualItems.find(x => x.id === rowId);
    if(item) { item.name = p.productName; item.code = p.assetCode || ''; item.internalCode = p.internalCode || ''; }
}

function updateOrderManualQty(rowId, qty) { const item = currentOrderManualItems.find(x => x.id === rowId); if(item) item.qty = Math.max(0, parseFloat(qty) || 0); }
function removeOrderManualItem(rowId) { document.getElementById(rowId).remove(); currentOrderManualItems = currentOrderManualItems.filter(x => x.id !== rowId); }

function saveEditOrder() {
    const idx = parseInt(document.getElementById('e_ordRow').value); 
    const c = document.getElementById('e_ordClient').value; const o = document.getElementById('e_ordNo').value; 
    const d = document.getElementById('e_ordDept').value; const deadline = document.getElementById('e_ordDeadline').value; 
    if(!c) return alert('客戶名稱必填！');
    
    let items = [];
    for (let item of currentOrderManualItems) {
        if (!item.name || item.qty <= 0) return alert('品項明細填寫不完整或數量無效！');
        items.push({ code: item.code, internalCode: item.internalCode, name: item.name, qty: item.qty });
    }
    if (items.length === 0) return alert('請至少新增一項品項！');
    
    const j = JSON.stringify(items);
    const payload = { rowIdx: idx||null, clientName: c, orderNo: o, department: d, status: '待出貨', items: items, deadline: deadline }; 
    if(idx) { 
        const od = globalOrders.find(x=>x.rowIdx===idx); 
        if(od){ od.client = c; od.orderNo = o; od.dept = d; od.jsonStr = j; od.deadline = deadline; } 
    } else { globalOrders.unshift({ rowIdx: Date.now(), time: Date.now(), client: c, orderNo: o, dept: d, status: "待出貨", jsonStr: j, deadline: deadline }); }
    
    pushToSyncQueue('saveOrderData', payload, null); 
    updateOrderClientDropdown(); renderOrderList(); 
    bootstrap.Modal.getInstance(document.getElementById('editOrdModal')).hide();
}

function deleteOrder() {
    const idx = parseInt(document.getElementById('e_ordRow').value); if(!idx) return;
    if(confirm('確定要作廢這筆訂單嗎？')) { 
        const o = globalOrders.find(x=>x.rowIdx===idx); if(o) o.status = '已作廢'; 
        pushToSyncQueue('updateOrderStatus', {rowIndices: [idx], status: '已作廢'}, null); 
        updateOrderClientDropdown(); renderOrderList(); 
        bootstrap.Modal.getInstance(document.getElementById('editOrdModal')).hide(); 
    }
}

function groupFulfillOrders() {
    const cbs = document.querySelectorAll('.cb-order:checked');
    if(cbs.length === 0) return showToast('請先勾選訂單');
    let client = ''; let valid = true; let ids = [];
    
    cbs.forEach(cb => { ids.push(parseInt(cb.value)); if(!client) client = cb.dataset.client; else if(client !== cb.dataset.client) valid = false; });
    if(!valid) return alert('群組合併開票必須為【同一間客戶】，請重新勾選。');
    
    selectedOrderCache = globalOrders.filter(o => ids.includes(o.rowIdx));
    enterSystem('invoice');
    
    document.getElementById('invClientInput').value = client;
    currentInvoiceData.clientName = client;
    const cObj = globalClients.find(x => x.name === client);
    currentInvoiceData.taxId = cObj ? cObj.taxId : '';
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${currentInvoiceData.taxId||'無'})`;
    document.getElementById('invClientInfo').style.display = 'block';
    document.getElementById('btnNext1').style.display = 'block';
    
    let orderNos = [...new Set(selectedOrderCache.map(o => o.orderNo).filter(x=>x))].join(', ');
    document.getElementById('invOrderNo').value = orderNos;
    currentInvoiceData.items = []; document.getElementById('invItemsContainer').innerHTML = '';
    document.getElementById('invAiNotice').style.display = 'block';
    
    selectedOrderCache.forEach(order => {
        let items = []; try { items = JSON.parse(order.jsonStr || '[]'); } catch(e){}
        items.forEach(i => {
            let invoicedQty = globalSalesDetails.filter(d => d.orderNo === order.orderNo && d.name === i.name && d.shipStatus !== '作廢').reduce((sum, d) => sum + d.qty, 0);
            let remaining = i.qty - invoicedQty;
            if (remaining > 0) {
                const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`;
                const p = globalCatalog.find(x => x.clientName === client && x.productName === i.name);
                let price = p ? p.price : 0; let unit = p ? p.unit : '式'; let isMatch = p ? true : false;
                let internalCode = p ? (p.internalCode || p.assetCode) : '';
                
                currentInvoiceData.items.push({ id: rowId, product: {productName: i.name, unit: unit, price: price, internalCode: internalCode}, qty: remaining, orderRef: order.orderNo, deptRef: order.dept });
                let remarkHint = `${order.orderNo || ''} ${order.dept || ''}`.trim();
                
                const html = `<div class="item-row border-primary" id="${rowId}">
                    <button class="btn btn-sm btn-outline-danger position-absolute" style="top:10px; right:10px;" onclick="removeInvItem('${rowId}')">✕</button>
                    <label class="form-label text-primary fw-bold small">${isMatch?'✅ 已對應價表':'⚠️ 價格待確'}</label>
                    <input type="text" class="form-control fake-input-btn mb-2" id="prodInput_${rowId}" value="${escapeQuotes(i.name)}" readonly placeholder="點此選擇品項..." onclick="openSearchModal('item_${rowId}', (val)=>selectProductForInv('${rowId}', val))">
                    <div id="prodInfo_${rowId}" class="small text-muted mb-2 px-1">單價: $${price} | 單位: ${unit}</div>
                    <div class="row g-2">
                        <div class="col-6"><label class="form-label fw-bold small">本次開立數量 (可修改)</label><input type="number" class="form-control" id="qty_${rowId}" value="${remaining}" min="0" step="any" onchange="updateInvQty('${rowId}', this.value)"></div>
                        <div class="col-6"><label class="form-label fw-bold small">歸屬訂單 / 單位</label><input type="text" class="form-control bg-light text-secondary" value="${escapeQuotes(remarkHint)}" readonly></div>
                    </div>
                </div>`;
                document.getElementById('invItemsContainer').insertAdjacentHTML('beforeend', html);
            }
        });
    });
    updateInvAddBtn(); goStep(2); showToast("✅ 已載入剩餘待出貨品項");
}

// ============================================================================
// 發票模組 (Invoice)
// ============================================================================
function goStep(s) { document.querySelectorAll('#sys-invoice .step-card').forEach(c=>c.style.display='none'); document.getElementById('invStep'+s).style.display='block'; document.getElementById('mainApp').scrollTo(0,0); }

function selectClientForInvoice(name) {
    const c = globalClients.find(x => x.name === name); if(!c) return;
    document.getElementById('invClientInput').value = name; currentInvoiceData.clientName = name; currentInvoiceData.taxId = c.taxId; 
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${c.taxId||'無'})`; document.getElementById('invClientInfo').style.display = 'block'; document.getElementById('btnNext1').style.display = 'block';
    document.getElementById('invOrderNo').value = ''; selectedOrderCache = []; document.getElementById('invAiNotice').style.display = 'none';
}

function addInvoiceItemRow() {
    const rowId = `invR_${Date.now()}`; currentInvoiceData.items.push({ id: rowId, product: null, qty: 1, orderRef: '', deptRef: '' });
    const html = `<div class="item-row" id="${rowId}">
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:10px; right:10px;" onclick="removeInvItem('${rowId}')">✕</button>
        <label class="form-label text-primary fw-bold small">手動新增品項</label>
        <input type="text" class="form-control fake-input-btn mb-2" id="prodInput_${rowId}" readonly placeholder="點此選擇品項..." onclick="openSearchModal('item_${rowId}', (val)=>selectProductForInv('${rowId}', val))">
        <div id="prodInfo_${rowId}" class="small text-muted mb-2 px-1"></div>
        <label class="form-label fw-bold small">數量</label>
        <input type="number" class="form-control" id="qty_${rowId}" value="1" min="0" step="any" onchange="updateInvQty('${rowId}', this.value)">
    </div>`;
    document.getElementById('invItemsContainer').insertAdjacentHTML('beforeend', html); updateInvAddBtn(); setTimeout(() => document.getElementById('mainApp').scrollTo({top: document.getElementById('mainApp').scrollHeight, behavior: 'smooth'}), 100);
}

function selectProductForInv(rowId, prodName) {
    const p = globalCatalog.find(x => x.clientName === currentInvoiceData.clientName && x.productName === prodName); if(!p) return;
    document.getElementById(`prodInput_${rowId}`).value = prodName; document.getElementById(`prodInfo_${rowId}`).innerHTML = `單價: $${p.price.toFixed(3)} | 單位: ${p.unit}`; 
    const item = currentInvoiceData.items.find(x => x.id === rowId); if(item) item.product = p;
}

function updateInvQty(rowId, qty) { const item = currentInvoiceData.items.find(x => x.id === rowId); if(item) item.qty = Math.max(0, parseFloat(qty) || 0); }
function removeInvItem(rowId) { document.getElementById(rowId).remove(); currentInvoiceData.items = currentInvoiceData.items.filter(x => x.id !== rowId); updateInvAddBtn(); }
function updateInvAddBtn() { document.getElementById('btnAddInvItem').style.display = currentInvoiceData.items.length >= 10 ? 'none' : 'block'; }

function generatePreview() {
    try {
        const validItems = currentInvoiceData.items.filter(x => x && x.product && parseFloat(x.qty) > 0);
        if(validItems.length === 0) return alert('請完整選擇品項並輸入大於零的數量！');
        
        let totalWithTax = 0; const prevBody = document.getElementById('prevTableBody'); if(!prevBody) throw new Error("無法找到表格主體");
        prevBody.innerHTML = '';
        
        const invOrderNoEl = document.getElementById('invOrderNo'); const orderNoStr = invOrderNoEl ? invOrderNoEl.value : '';
        const invDateEl = document.getElementById('invDate'); const invDateStr = invDateEl && invDateEl.value ? invDateEl.value : getTodayStr();
        
        validItems.forEach((item, idx) => { 
            let price = Math.max(0, parseFloat(item.product.price) || 0); let qty = Math.max(0, parseFloat(item.qty) || 0); let unit = item.product.unit || '式'; let name = item.product.productName || '未知品項';
            const sub = price * qty; totalWithTax += sub; 
            let defaultOrderStr = orderNoStr ? orderNoStr : ''; let oRef = item.orderRef ? item.orderRef : (idx === 0 && defaultOrderStr ? defaultOrderStr : ''); let dRef = item.deptRef ? item.deptRef : '';
            let remark = `${oRef} ${dRef}`.trim(); item.formattedRemark = remark; 
            prevBody.innerHTML += `<tr><td class="text-start">${name}</td><td>${qty} ${unit}</td><td class="text-end">$${price.toFixed(3)}</td><td class="text-end">$${sub.toLocaleString()}</td><td class="text-center small text-secondary">${remark}</td></tr>`; 
        });
        
        totalWithTax = Math.round(totalWithTax); const net = Math.round(totalWithTax / 1.05); const tax = totalWithTax - net;
        currentInvoiceData.finalNet = net; currentInvoiceData.finalTax = tax; currentInvoiceData.finalTotal = totalWithTax; currentInvoiceData.validItems = validItems;
        currentInvoiceData.detailsStr = validItems.map(x => `${x.product.productName || ''} x${x.qty} (單價: $${(parseFloat(x.product.price)||0).toFixed(3)}) ${x.formattedRemark ? '[' + x.formattedRemark + ']' : ''}`).join('\n');
        
        setSafeText('prevClientName', currentInvoiceData.clientName || '無'); setSafeText('prevTaxId', currentInvoiceData.taxId || '無'); setSafeText('prevOrderNo', orderNoStr || '無');
        const paperNoEl = document.getElementById('invPaperNo'); setSafeText('prevPaperNo', (paperNoEl ? paperNoEl.value.toUpperCase() : '無') || '無');
        setSafeText('prevInvDate', invDateStr); setSafeText('prevNet', net.toLocaleString()); setSafeText('prevTax', tax.toLocaleString()); setSafeText('prevTotal', totalWithTax.toLocaleString());
        goStep(4);
    } catch(err) { alert("預覽結算時發生錯誤: " + err.message); }
}

function submitInvoiceOptimistic() {
    const orderNo = document.getElementById('invOrderNo').value; const paperNo = document.getElementById('invPaperNo').value.toUpperCase();
    const invDateVal = document.getElementById('invDate').value; const invDateTimestamp = invDateVal ? new Date(invDateVal).getTime() : Date.now();

    const payloadItems = currentInvoiceData.validItems.map(i => ({ name: i.product.productName, internalCode: i.product.internalCode || i.product.assetCode || "", qty: i.qty, unit: i.product.unit, price: i.product.price, subtotal: i.qty * i.product.price }));
    const payload = { invDate: invDateTimestamp, staff: myName, clientName: currentInvoiceData.clientName, taxId: currentInvoiceData.taxId, netTotal: currentInvoiceData.finalNet, tax: currentInvoiceData.finalTax, totalWithTax: currentInvoiceData.finalTotal, detailsStr: currentInvoiceData.detailsStr, paperNo: paperNo, orderNo: orderNo, items: payloadItems };
    
    globalHistory.unshift({ rowIdx: 9999, time: invDateTimestamp, staff: myName, client: payload.clientName, taxId: payload.taxId, net: payload.netTotal, tax: payload.tax, total: payload.totalWithTax, details: payload.detailsStr, paperNo: payload.paperNo, orderNo: payload.orderNo, status: "正常", historyLog: "[]" });
    payloadItems.forEach(pi => { let tempIdx = -Math.floor(Math.random() * 1000000); globalSalesDetails.unshift({ rowIdx: tempIdx, time: invDateTimestamp, paperNo: paperNo, client: payload.clientName, orderNo: orderNo, name: pi.name, qty: pi.qty, shippedQty: 0, shipStatus: '待出貨' }); });
    
    pushToSyncQueue('submitInvoice', payload, null);
    
    setSafeText('visBuyer', payload.clientName); setSafeText('visTaxId', payload.taxId); setSafeText('visPaperNo', paperNo); setSafeText('visInvDate', invDateVal.replace(/-/g, '/')); 
    setSafeText('visNet', payload.netTotal.toLocaleString()); setSafeText('visTax', payload.tax.toLocaleString()); setSafeText('visTotal', payload.totalWithTax.toLocaleString());
    
    const tbody = document.getElementById('visTbody'); tbody.innerHTML = '';
    for(let i=0; i < Math.max(currentInvoiceData.validItems.length, 5); i++) {
        if(i < currentInvoiceData.validItems.length) {
            const item = currentInvoiceData.validItems[i]; const unTaxedP = (item.product.price / 1.05).toFixed(3); const unTaxedS = Math.round(item.qty * (item.product.price / 1.05));
            tbody.innerHTML += `<tr><td class="text-start highlight-data">${item.product.productName}</td><td class="highlight-data">${item.qty} ${item.product.unit}</td><td class="text-end highlight-data">${unTaxedP}</td><td class="text-end highlight-data">${unTaxedS.toLocaleString()}</td><td class="highlight-data" style="font-size:0.8rem;">${item.formattedRemark}</td></tr>`;
        } else { tbody.innerHTML += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`; }
    }
    goStep(5);
}

function resetInvoiceSystem() { 
    document.getElementById('invDate').value = getTodayStr(); document.getElementById('invClientInput').value=''; document.getElementById('invOrderNo').value=''; document.getElementById('invPaperNo').value=''; document.getElementById('invItemsContainer').innerHTML=''; currentInvoiceData={clientName:'', taxId:'', items:[]}; selectedOrderCache=[]; goStep(1); 
}

// ============================================================================
// 庫存模組 (Inventory)
// ============================================================================
function triggerSyncAssetCodes() {
    showLoading("同步長固代號 / 資材碼中...");
    callApi('syncAssetCodesToInventory', {}).then(res => {
        hideLoading();
        if(res.success) { showToast(`✅ 同步完成！共更新了 ${res.count} 筆資材碼資料。`); refreshData(); } else { alert(res.msg); }
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
}

function renderInventory() {
    const term = document.getElementById('stkSearch').value.toLowerCase(); let arr = globalInventory;
    if(term) arr = arr.filter(v => v.name.toLowerCase().includes(term) || v.supplier.toLowerCase().includes(term) || String(v.internalCode).toLowerCase().includes(term));
    
    let totalVal = 0; let alertCount = 0;
    globalInventory.forEach(v => { totalVal += (v.qty * v.cost); if(v.qty <= v.alertQty) alertCount++; });
    
    document.getElementById('stkTotalValue').innerText = `$${totalVal.toLocaleString()}`; document.getElementById('stkAlertCount').innerText = `${alertCount} 項`;
    const c = document.getElementById('stkListContainer');
    if(arr.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無庫存資料</div>';
    
    c.innerHTML = arr.map(v => {
        let dot = 'stock-g'; let alertHTML = ''; 
        if (v.qty <= 0) dot = 'stock-r'; else if (v.qty <= v.alertQty) dot = 'stock-y';
        if (v.qty <= v.alertQty) alertHTML = `<div class="small text-danger fw-bold mt-1">⚠️ 低於安全庫存 (${v.alertQty})</div>`;
        return `<div class="item-row bg-white shadow-sm">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <div class="fw-bold fs-6 text-dark"><span class="stock-dot ${dot}"></span>${v.name} <span class="badge bg-secondary ms-1">${v.internalCode||''}</span></div>
                    <div class="small text-primary mt-1 fw-bold">對應資材碼: ${v.assetCodeCombined||'無'}</div>
                    <div class="small text-muted mt-1">效期: ${v.expiry||'--'} | 批號: ${v.lot||'--'}</div>
                    ${alertHTML}
                </div>
                <div class="text-end">
                    <div class="fs-4 fw-bold ${dot==='stock-r'?'text-danger':(dot==='stock-y'?'text-warning':'text-success')}">${v.qty}</div>
                    <div class="small text-muted">庫存數量</div>
                </div>
            </div>
            <button class="btn btn-sm btn-outline-info w-100 fw-bold" onclick="openAdjustModal('${escapeQuotes(v.name)}')">進貨 / 盤點</button>
        </div>`;
    }).join('');
}

function renderInvLogs() {
    const fIn = document.getElementById('logFilterIn').value; const fOut = document.getElementById('logFilterOut').value; const fStart = document.getElementById('logFilterStart').value; const fEnd = document.getElementById('logFilterEnd').value; const fName = document.getElementById('logFilterName').value; const term = document.getElementById('stkLogSearch').value.toLowerCase();
    let arr = globalInvLogs;
    if(fIn || fOut) arr = arr.filter(l => (fIn && l.type.includes(fIn)) || (fOut && l.type.includes(fOut)));
    if(fStart) { const startT = new Date(fStart).setHours(0,0,0,0); arr = arr.filter(l => new Date(l.time).setHours(0,0,0,0) >= startT); }
    if(fEnd) { const endT = new Date(fEnd).setHours(23,59,59,999); arr = arr.filter(l => new Date(l.time).getTime() <= endT); }
    if(fName) arr = arr.filter(l => l.name === fName);
    if(term) arr = arr.filter(l => l.name.toLowerCase().includes(term) || l.staff.toLowerCase().includes(term) || l.memo.toLowerCase().includes(term));
    
    const c = document.getElementById('stkLogContainer');
    if(arr.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無符合條件的異動紀錄</div>';
    
    c.innerHTML = arr.map(l => {
        const d = new Date(l.time); const dateStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const isAdd = l.qtyChange > 0;
        return `<div class="p-3 bg-white border rounded mb-2 shadow-sm d-flex justify-content-between align-items-center">
            <div><div class="fw-bold text-dark">${l.name} <span class="badge ${isAdd?'bg-success':'bg-danger'}">${l.type}</span></div><div class="small text-muted mt-1">${dateStr} | ${l.staff}</div><div class="small text-secondary mt-1">${l.memo}</div></div>
            <div class="text-end"><div class="fs-5 fw-bold ${isAdd?'text-success':'text-danger'}">${isAdd?'+':''}${l.qtyChange}</div><div class="small text-muted">結存: ${l.newQty}</div></div>
        </div>`;
    }).join('');
}

function openAdjustModal(nameStr) {
    if(nameStr) {
        const v = globalInventory.find(x => x.name === nameStr);
        document.getElementById('adjRowIdx').value = v.rowIdx; document.getElementById('adjName').value = v.name; document.getElementById('adjName').onclick = null; document.getElementById('adjName').classList.remove('fake-input-btn');
        document.getElementById('adjInternalCode').value = v.internalCode || ''; document.getElementById('adjAlert').value = v.alertQty; document.getElementById('adjCost').value = v.cost; document.getElementById('adjSup').value = v.supplier;
    } else {
        document.getElementById('adjRowIdx').value = ''; document.getElementById('adjName').value = ''; document.getElementById('adjName').onclick = () => openSearchModal('item_adj', selectProductForAdj); document.getElementById('adjName').classList.add('fake-input-btn');
        document.getElementById('adjInternalCode').value = ''; document.getElementById('adjAlert').value = '10'; document.getElementById('adjCost').value = '0'; document.getElementById('adjSup').value = '';
    }
    document.getElementById('adjQty').value = ''; document.getElementById('adjLot').value = ''; document.getElementById('adjExp').value = ''; document.getElementById('adjMemo').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adjInvModal')).show();
}

function selectProductForAdj(val) {
    document.getElementById('adjName').value = val;
    const p = globalCatalog.find(x => x.productName === val);
    if(p) document.getElementById('adjInternalCode').value = p.internalCode || p.assetCode || '';
}

function saveInventoryAdjust() {
    const idx = document.getElementById('adjRowIdx').value; const name = document.getElementById('adjName').value.trim(); const internalCode = document.getElementById('adjInternalCode').value.trim();
    const changeQty = parseFloat(document.getElementById('adjQty').value); const alertQty = parseFloat(document.getElementById('adjAlert').value) || 0; const cost = parseFloat(document.getElementById('adjCost').value) || 0; const sup = document.getElementById('adjSup').value.trim();
    const lot = document.getElementById('adjLot').value.trim(); const exp = document.getElementById('adjExp').value; const type = document.getElementById('adjType').value; const memo = document.getElementById('adjMemo').value.trim();
    
    if(!name || isNaN(changeQty) || changeQty === 0) return alert("請選定品名並輸入非零異動數量");
    
    const payload = { name: name, internalCode: internalCode, changeQty: changeQty, alertQty: alertQty, cost: cost, supplier: sup, lot: lot, expiry: exp, type: type, memo: memo, staff: myName };
    if(idx) { const v = globalInventory.find(x => x.rowIdx === parseInt(idx)); if(v) { v.qty += changeQty; v.alertQty = alertQty; v.cost = cost; v.supplier = sup; if(lot) v.lot=lot; if(exp) v.expiry=exp; if(internalCode) v.internalCode=internalCode; } } 
    else { globalInventory.push({rowIdx: Date.now(), name: name, internalCode: internalCode, qty: changeQty, alertQty: alertQty, cost: cost, supplier: sup, lot: lot, expiry: exp}); }
    
    globalInvLogs.unshift({time: Date.now(), staff: myName, name: name, type: type, qtyChange: changeQty, newQty: idx ? globalInventory.find(x => x.rowIdx === parseInt(idx)).qty : changeQty, memo: memo});
    populateLogDropdowns(); renderInventory(); renderInvLogs(); bootstrap.Modal.getInstance(document.getElementById('adjInvModal')).hide(); pushToSyncQueue('adjustInventory', payload, null);
}

function renderShipments() {
    const c = document.getElementById('stkShipContainer');
    const pending = globalSalesDetails.filter(s => s.shipStatus !== '已結案' && s.shipStatus !== '作廢');
    if(pending.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">✅ 所有已開立發票之品項皆已全數出貨完畢</div>';
    
    c.innerHTML = pending.map(s => {
        let remain = s.qty - s.shippedQty;
        return `<div class="item-row bg-white shadow-sm mb-2"><div class="d-flex justify-content-between mb-2"><div><div class="fw-bold text-dark fs-6">${s.name}</div><div class="small text-muted mt-1">${s.client} | 發票: ${s.paperNo}</div></div><button class="btn btn-sm btn-primary fw-bold" onclick="openShipModal(${s.rowIdx})">出貨</button></div><div class="d-flex gap-3 small"><span class="text-secondary">總訂購: ${s.qty}</span><span class="text-success">已出: ${s.shippedQty}</span><span class="text-danger fw-bold">欠貨: ${remain}</span></div></div>`;
    }).join('');
}

function openShipModal(rowIdx) {
    const s = globalSalesDetails.find(x => x.rowIdx === rowIdx); if(!s) return;
    document.getElementById('shipRowIdx').value = rowIdx; document.getElementById('shipItemName').innerText = s.name;
    document.getElementById('shipTotalQty').innerText = s.qty; document.getElementById('shipDoneQty').innerText = s.shippedQty;
    const remain = s.qty - s.shippedQty; document.getElementById('shipRemainQty').innerText = remain;
    document.getElementById('shipNowQty').value = remain; document.getElementById('shipNowQty').max = remain;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipModal')).show();
}

function confirmShipment() {
    const rowIdx = parseInt(document.getElementById('shipRowIdx').value); const qty = parseFloat(document.getElementById('shipNowQty').value);
    if(isNaN(qty) || qty <= 0) return alert("數量錯誤");
    const s = globalSalesDetails.find(x => x.rowIdx === rowIdx); if(!s) return;
    if(qty > (s.qty - s.shippedQty)) return alert("出貨量不可大於欠貨量");
    
    s.shippedQty += qty; if(s.shippedQty >= s.qty) s.shipStatus = '已結案'; else s.shipStatus = '部分出貨';
    let inv = globalInventory.find(x => x.name === s.name);
    if (inv) inv.qty -= qty; else globalInventory.push({rowIdx:0, name: s.name, qty: -qty, alertQty: 0, cost: 0, supplier: '', internalCode: '', lot: '', expiry: ''});
    
    let currentInvQty = inv ? inv.qty : -qty;
    globalInvLogs.unshift({ time: Date.now(), staff: myName, name: s.name, type: '分批出貨', qtyChange: -qty, newQty: currentInvQty, memo: `單號: ${s.paperNo}` });
    
    populateLogDropdowns(); renderInvLogs(); renderInventory(); renderShipments();
    bootstrap.Modal.getInstance(document.getElementById('shipModal')).hide();
    pushToSyncQueue('updateShipment', {updates: [{rowIdx: rowIdx, paperNo: s.paperNo, name: s.name, shipQty: qty, totalQty: s.qty}], staff: myName}, null); showToast("🚚 出貨與庫存扣抵完成");
}

// ============================================================================
// 發票紀錄與報表 (History / Report)
// ============================================================================
function renderHistory() {
    const fStaff = document.getElementById('histFilterStaff').value; const fClient = document.getElementById('histFilterClient').value; const fDate = document.getElementById('histFilterDate').value; const fStatus = document.getElementById('histFilterStatus').value; const term = document.getElementById('histSearch').value.toLowerCase();
    let filtered = globalHistory;
    if(fStaff) filtered = filtered.filter(h => h.staff === fStaff); if(fClient) filtered = filtered.filter(h => h.client === fClient); if(fStatus) filtered = filtered.filter(h => h.status === fStatus);
    if(fDate) { const target = new Date(fDate).setHours(0,0,0,0); filtered = filtered.filter(h => { const d = new Date(h.time).setHours(0,0,0,0); return d === target; }); }
    if(term) filtered = filtered.filter(h => h.client.toLowerCase().includes(term) || String(h.paperNo).toLowerCase().includes(term) || h.details.toLowerCase().includes(term));
    
    const c = document.getElementById('histListContainer');
    if(filtered.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無紀錄</div>';
    
    c.innerHTML = filtered.map(h => {
        const d = new Date(h.time); const dateStr = isNaN(d.getTime()) ? '未知' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const isVoid = h.status === '作廢'; const isEdited = h.historyLog && h.historyLog.length > 2;
        let badgeHTML = isVoid ? '<span class="badge bg-danger ms-1">已作廢</span>' : '';
        if(isEdited && !isVoid) { const safeLog = escapeQuotes(JSON.parse(h.historyLog).join('\\n')); badgeHTML += `<span class="badge bg-warning text-dark ms-1" onclick="alert('修改紀錄：\\n${safeLog}')" style="cursor:pointer;">⚠️ 已修改</span>`; }
        
        return `<div class="item-row bg-white shadow-sm p-3 ${isVoid?'status-void':''}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2"><div><div class="fw-bold fs-6 text-dark">${h.client} ${badgeHTML}</div><div class="small text-muted">單號: ${h.orderNo||'--'} | 開立: ${h.staff}</div></div><div class="text-end"><div class="badge bg-light text-dark border">${dateStr}</div><div class="small text-muted mt-1 fw-bold text-danger">${h.paperNo?'發票: '+h.paperNo:''}</div></div></div>
            <div class="history-details text-muted mb-3">${h.details}</div>
            <div class="d-flex justify-content-between align-items-center"><div>${!isVoid ? `<button class="btn btn-sm btn-outline-danger me-1" onclick="voidInv(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">作廢</button><button class="btn btn-sm btn-outline-secondary" onclick="openEditInv(${h.rowIdx})">編輯</button>` : ''}</div><span class="fw-bold text-danger fs-5">$${Number(h.total).toLocaleString()}</span></div>
        </div>`;
    }).join('');
}

function voidInv(idx, pNo) { 
    if(confirm("確定作廢？系統將自動：\n1. 註銷此發票帳款\n2. 註銷銷售明細\n3. 【自動返還已出貨之庫存數量】")) { 
        const h = globalHistory.find(x=>x.rowIdx === idx); if(h) h.status = '作廢'; 
        globalSalesDetails.forEach(sd => { 
            if(sd.paperNo === pNo && sd.shipStatus !== '作廢') { 
                sd.shipStatus = '作廢'; 
                if (sd.shippedQty > 0) {
                    let inv = globalInventory.find(x=>x.name === sd.name); if(inv) inv.qty += sd.shippedQty; 
                    globalInvLogs.unshift({ time: Date.now(), staff: myName, name: sd.name, type: '作廢返還', qtyChange: sd.shippedQty, newQty: inv ? inv.qty : sd.shippedQty, memo: `作廢單號: ${pNo}` });
                }
            } 
        });
        populateLogDropdowns(); renderHistory(); renderInventory(); renderInvLogs(); renderShipments(); generateReport(); 
        pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: idx, staff: myName, paperNo: pNo}, null); showToast("🗑️ 已作廢並返還庫存");
    } 
}

function openEditInv(idx) {
    const h = globalHistory.find(x=>x.rowIdx === idx); if(!h) return;
    document.getElementById('e_invRow').value = idx; document.getElementById('e_invPaper').value = h.paperNo; document.getElementById('e_invOrder').value = h.orderNo; document.getElementById('e_invNet').value = h.net; document.getElementById('e_invTotal').value = h.total; document.getElementById('e_invDetails').value = h.details; bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvModal')).show();
}

function saveEditInvoice() {
    const idx = parseInt(document.getElementById('e_invRow').value); const h = globalHistory.find(x=>x.rowIdx === idx);
    const data = { client: h.client, taxId: h.taxId, paperNo: document.getElementById('e_invPaper').value.toUpperCase(), orderNo: document.getElementById('e_invOrder').value, net: document.getElementById('e_invNet').value, tax: Math.round(document.getElementById('e_invTotal').value - document.getElementById('e_invNet').value), total: document.getElementById('e_invTotal').value, details: document.getElementById('e_invDetails').value };
    if(h) { Object.assign(h, data); h.historyLog = "[\"修改紀錄存在\"]"; } 
    renderHistory(); bootstrap.Modal.getInstance(document.getElementById('editInvModal')).hide(); pushToSyncQueue('updateInvoiceRecord', {action:'edit', rowIdx: idx, staff: myName, data: data}, null);
}

function setReportDate(days) { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - (days - 1)); document.getElementById('repEnd').valueAsDate = e; document.getElementById('repStart').valueAsDate = s; generateReport(); }
function setReportMonth() { const val = document.getElementById('repMonthPicker').value; if(!val) return; const [year, month] = val.split('-'); document.getElementById('repStart').valueAsDate = new Date(year, month - 1, 1); document.getElementById('repEnd').valueAsDate = new Date(year, month, 0); generateReport(); }

function generateReport() {
    const sVal = document.getElementById('repStart').value; const eVal = document.getElementById('repEnd').value; if(!sVal || !eVal) return;
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    let rCount=0, rNet=0, rTotal=0; const clientStats = {};
    
    globalHistory.forEach(h => {
        const d = new Date(h.time);
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { rCount++; rNet += Number(h.net); rTotal += Number(h.total); if(!clientStats[h.client]) clientStats[h.client] = 0; clientStats[h.client] += Number(h.total); }
    });
    document.getElementById('repCount').innerText = `${rCount} 張`; document.getElementById('repNet').innerText = `$${rNet.toLocaleString()}`; document.getElementById('repTotal').innerText = `$${rTotal.toLocaleString()}`;
}

function exportReportToEmail() {
    const sVal = document.getElementById('repStart').value; const eVal = document.getElementById('repEnd').value; if(!sVal || !eVal) return alert("請先設定日期");
    const email = prompt("接收報表的 Email："); if(!email) return;
    showLoading("產生 Excel 中...");
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    
    let rCount=0, rNet=0, rTax=0, rTotal=0; const clientStats = {}; const details = []; const lines = [];
    globalHistory.forEach(h => {
        const d = new Date(h.time);
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') {
            rCount++; rNet += Number(h.net); rTax += Number(h.tax); rTotal += Number(h.total);
            if(!clientStats[h.client]) clientStats[h.client] = 0; clientStats[h.client] += Number(h.total);
            details.push({ date: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: h.paperNo, orderNo: h.orderNo, status: h.status, staff: h.staff, client: h.client, taxId: h.taxId, net: h.net, tax: h.tax, total: h.total, desc: h.details });
        }
    });
    globalSalesDetails.forEach(s => {
        const d = new Date(s.time);
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && s.shipStatus !== '作廢') {
            lines.push({ time: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: s.paperNo, client: s.client, orderNo: s.orderNo, name: s.name, qty: s.qty, price: 0, shipStatus: s.shipStatus, shippedQty: s.shippedQty });
        }
    });
    
    const payload = { email: email, dateRange: `${sVal} ~ ${eVal}`, summary: { count: rCount, net: rNet, tax: rTax, total: rTotal }, clientStats: Object.keys(clientStats).map(k=>({name:k, total:clientStats[k]})).sort((a,b)=>b.total-a.total), details: details.reverse(), lineItems: lines.reverse() };
    callApi('exportExcelReport', payload).then(res => { hideLoading(); alert(`✅ 報表已寄送至 ${email}`); }).catch(err => { hideLoading(); alert("匯出失敗：" + err.message); });
}

// ============================================================================
// 通用搜尋 Modal
// ============================================================================
function openSearchModal(type, callback) {
    currentSearchCallback = callback; document.getElementById('searchModalList').innerHTML = ''; document.getElementById('searchModalInput').value = '';
    
    if(type === 'client' || type === 'admin_client' || type === 'client_ord') { 
        document.getElementById('searchModalTitle').innerText = '選擇客戶'; 
        currentSearchSource = globalClients.map(c => ({ text: c.name, sub: `統編: ${c.taxId||'無'}`, val: c.name })); 
    }
    else if(type === 'item_adj') {
        document.getElementById('searchModalTitle').innerText = '選擇盤點品項'; 
        const uniqueProds = [...new Map(globalCatalog.map(item => [item.productName, item])).values()];
        currentSearchSource = uniqueProds.map((p, idx) => ({ text: p.productName, sub: `長固代號: ${p.internalCode||p.assetCode||'無'}`, val: p.productName, idx: idx, ref: p }));
    }
    else if(type.startsWith('item_')) {
        document.getElementById('searchModalTitle').innerText = '選擇品項'; 
        let clientName = '';
        if(type.startsWith('item_ord_')) clientName = document.getElementById('e_ordClient').value;
        else clientName = document.getElementById('invClientInput').value;
        if(!clientName) { alert('請先選擇客戶！'); return; }
        currentSearchSource = globalCatalog.filter(p => p.clientName === clientName).map((p, idx) => ({ text: p.productName, sub: `單價: $${p.price} / ${p.unit}`, val: p.productName, idx: idx, ref: p }));
    }
    
    renderSearchList(currentSearchSource); bootstrap.Modal.getOrCreateInstance(document.getElementById('searchModal')).show(); setTimeout(()=> document.getElementById('searchModalInput').focus(), 500);
}

function filterSearchModal() { const term = document.getElementById('searchModalInput').value.toLowerCase(); renderSearchList(currentSearchSource.filter(s => s.text.toLowerCase().includes(term) || (s.sub && s.sub.toLowerCase().includes(term)))); }
function renderSearchList(arr) { document.getElementById('searchModalList').innerHTML = arr.map(item => `<button class="search-btn-item" onclick="onSearchSelect('${escapeQuotes(item.val)}')"><div class="d-flex justify-content-between align-items-center"><span>${item.text}</span><span class="badge bg-secondary">${item.sub}</span></div></button>`).join(''); }
function onSearchSelect(val) { bootstrap.Modal.getInstance(document.getElementById('searchModal')).hide(); if(currentSearchCallback) currentSearchCallback(val); }

// ============================================================================
// 管理員模組 (Admin)
// ============================================================================
function populateAdminClientFilter() { document.getElementById('admItemFilterSelect').innerHTML = '<option value="">📂 所有客戶 (顯示全部)</option>' + globalClients.map(c => `<option value="${c.name}">${c.name}</option>`).join(''); }
function renderAdminClients() { 
    const term = document.getElementById('admClientSearch').value.toLowerCase(); 
    document.getElementById('admClientList').innerHTML = globalClients
        .filter(c => c.name.toLowerCase().includes(term) || String(c.taxId).includes(term))
        .map(c => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6">${c.name}</div><div class="small text-muted mt-1">統編: ${c.taxId||'無'}</div></div><button class="btn btn-outline-danger btn-sm fw-bold px-3" onclick="openEditClientModal('${escapeQuotes(c.name)}', '${escapeQuotes(c.taxId)}')">📝 編輯</button></div>`)
        .join(''); 
}

function openNewClientModal() { document.getElementById('addClientName').value = ''; document.getElementById('addClientTaxId').value = ''; bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).show(); }

function submitNewClientOptimistic() { 
    const name = document.getElementById('addClientName').value.trim(); const taxId = document.getElementById('addClientTaxId').value.trim(); 
    if(!name) return alert('名稱必填'); 
    
    globalClients.push({ name, taxId }); populateAdminClientFilter(); renderAdminClients(); 
    bootstrap.Modal.getInstance(document.getElementById('addClientModal')).hide(); 
    pushToSyncQueue('addClientData', {clientName: name, taxId}, null); 
}

function openEditClientModal(name, taxId) { document.getElementById('editClientOldName').value = name; document.getElementById('editClientName').value = name; document.getElementById('editClientTaxId').value = taxId; bootstrap.Modal.getOrCreateInstance(document.getElementById('editClientModal')).show(); }

function submitEditClientOptimistic() { 
    const old = document.getElementById('editClientOldName').value; const name = document.getElementById('editClientName').value.trim(); const tax = document.getElementById('editClientTaxId').value.trim(); 
    if(!name) return; 
    
    const c = globalClients.find(x => x.name === old); if(c) { c.name = name; c.taxId = tax; } 
    globalCatalog.forEach(p => { if(p.clientName === old) p.clientName = name; }); 
    populateAdminClientFilter(); renderAdminClients(); renderAdminItems(); 
    bootstrap.Modal.getInstance(document.getElementById('editClientModal')).hide(); 
    pushToSyncQueue('updateClientData', {oldName: old, newName: name, newTaxId: tax}, null); 
}

function renderAdminItems() { 
    const f = document.getElementById('admItemFilterSelect').value; const t = document.getElementById('admItemSearch').value.toLowerCase(); 
    let arr = globalCatalog; 
    if(f) arr = arr.filter(p => p.clientName === f); if(t) arr = arr.filter(p => p.productName.toLowerCase().includes(t) || p.clientName.toLowerCase().includes(t)); 
    
    document.getElementById('admItemList').innerHTML = arr.length 
        ? arr.map(p => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6 mb-2">${p.productName} <span class="badge bg-secondary ms-1">${p.internalCode||''}</span></div><div class="d-flex align-items-center"><span class="badge bg-light text-dark border me-2 align-self-center">${p.clientName}</span><div class="bg-success text-white px-2 py-1 rounded shadow-sm d-inline-block"><span class="fw-bold">NT$ ${p.price}</span></div><span class="text-muted small fw-bold ms-1">/ ${p.unit}</span></div></div><button class="btn btn-outline-primary btn-sm fw-bold px-3 ms-2" onclick="openAdminItemModal(${p.rowIndex})">📝</button></div>`).join('') 
        : '<div class="text-center text-muted py-4">查無對應品項</div>'; 
}

function openAdminItemModal(idx) { 
    const m = document.getElementById('editItemModal'); const ipt = document.getElementById('editItemClientDisplay'); 
    if(idx) { 
        const p = globalCatalog.find(x => x.rowIndex === idx); document.getElementById('editItemRowIndex').value = idx; 
        ipt.value = p.clientName; document.getElementById('editItemClientVal').value = p.clientName; ipt.onclick = null; ipt.classList.remove('fake-input-btn'); 
        document.getElementById('editItemName').value = p.productName; document.getElementById('editItemInternalCode').value = p.internalCode || ''; 
        document.getElementById('editItemUnit').value = p.unit; document.getElementById('editItemPrice').value = p.price; 
    } else { 
        document.getElementById('editItemRowIndex').value = ''; ipt.value = ''; ipt.onclick = triggerItemClientSelect; ipt.classList.add('fake-input-btn'); 
        document.getElementById('editItemName').value = ''; document.getElementById('editItemInternalCode').value = ''; document.getElementById('editItemUnit').value = '式'; document.getElementById('editItemPrice').value = ''; 
    } 
    bootstrap.Modal.getOrCreateInstance(m).show(); 
}

function triggerItemClientSelect() { 
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
    openSearchModal('admin_client', (val) => { document.getElementById('editItemClientDisplay').value = val; document.getElementById('editItemClientVal').value = val; setTimeout(()=> bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).show(), 400); }); 
}

function submitEditItemOptimistic() { 
    const idx = document.getElementById('editItemRowIndex').value; const client = document.getElementById('editItemClientVal').value; 
    const name = document.getElementById('editItemName').value.trim(); const internalCode = document.getElementById('editItemInternalCode').value.trim(); 
    const unit = document.getElementById('editItemUnit').value.trim(); const price = document.getElementById('editItemPrice').value; 
    
    if(!client || !name || !price) return alert('必填未填'); 
    
    const payload = { rowIndex: idx ? parseInt(idx) : null, clientName: client, productName: name, internalCode: internalCode, unit, price: Number(price) }; 
    if(idx) { const p = globalCatalog.find(x => x.rowIndex === payload.rowIndex); if(p) Object.assign(p, payload); } 
    else { payload.rowIndex = Date.now(); globalCatalog.push(payload); } 
    
    renderAdminItems(); 
    // 👉 這裡修正了彈窗重複調用導致卡死的問題
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide(); 
    pushToSyncQueue('saveAdminItem', payload, null); 
}
