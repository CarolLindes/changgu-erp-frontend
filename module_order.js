/**
 * ============================================================================
 * 模組 2：訂單辨識建檔 (module_order.js)
 * ============================================================================
 */

// ============================================================================
// AI 與信箱自動辨識系統
// ============================================================================

window.triggerEmailScan = function() {
    showLoading("⚡ 正在喚醒 AI 機器人...");
    callApi('scanEmailOrders', {}).then(res => {
        hideLoading();
        
        // 【升級版非同步處理】
        // 由於後端已經改為背景獨立執行，前端不再需要等待訂單資料回傳，
        // 只要瞬間彈出安撫提示，讓畫面立刻恢復順暢操作即可！
        if (res && res.msg) {
            showToast(res.msg);
        } else {
            showToast("✅ 已成功喚醒 AI 機器人！系統將於背景獨立執行解析，請留意 Telegram 進度通知。");
        }
        
    }).catch(err => {
        hideLoading();
        // 攔截並優化超時或連線錯誤的安撫提示
        if (err.message && err.message.toLowerCase().includes('timeout')) {
            showToast("⏳ 系統已轉由背景繼續解析，請稍後（約1~3分鐘）點擊上方刷新按鈕查看最新訂單！");
        } else {
            alert("喚醒失敗：" + err.message);
        }
    });
};

window.processOrderUpload = function(input) {
    if(!input.files || !input.files[0]) return; 
    const file = input.files[0]; 
    const mimeType = file.type || 'application/pdf'; 
    const reader = new FileReader();
    reader.onload = function(e) {
        showLoading("✨ Gemini AI 智慧辨識中...");
        callApi('processOrderImage', { base64Str: e.target.result, mimeType: mimeType }).then(res => { 
            hideLoading(); 
            let previewData = Array.isArray(res) ? res[0] : res;
            if(!previewData) return alert('未辨識到訂單資訊');
            aiTempData = previewData; 
            document.getElementById('aiClient').value = previewData.clientName || ''; 
            document.getElementById('aiOrderNo').value = previewData.orderNo || ''; 
            document.getElementById('aiDept').value = previewData.department || ''; 
            document.getElementById('aiDeadline').value = ''; 
            window.recheckAiItems(); 
            document.getElementById('ordStep1').style.display = 'none'; 
            document.getElementById('ordStep2').style.display = 'block'; 
        }).catch(err => { hideLoading(); alert(err.message); });
    };
    reader.readAsDataURL(file); input.value = '';
};

window.recheckAiItems = function() {
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
        return `<div class="p-3 border rounded mb-2 bg-white shadow-sm"><label class="form-label small fw-bold text-muted mb-1">確認/修改品名</label><input type="text" class="form-control form-control-sm fw-bold text-dark mb-2" value="${escapeQuotes(i.name)}" oninput="updateAiItemName(${index}, this.value)"><div class="d-flex justify-content-between align-items-center mt-2"><div>${codeDisplay}</div><div class="d-flex align-items-center"><label class="form-label small fw-bold text-danger mb-0 me-2">數量:</label><input type="number" class="form-control form-control-sm text-danger fw-bold text-center" style="width: 70px;" value="${i.qty}" min="0" step="any" oninput="updateAiItemQty(${index}, this.value)"></div></div></div>`;
    }).join('');
    document.getElementById('aiItemsContainer').innerHTML = html || '<div class="text-muted">未擷取到品項</div>';
};

window.updateAiItemName = function(idx, val) { if(aiTempData && aiTempData.items[idx]) { aiTempData.items[idx].name = val; } };
window.updateAiItemQty = function(idx, val) { if(aiTempData && aiTempData.items[idx]) { aiTempData.items[idx].qty = Math.max(0, parseFloat(val) || 0); } };

window.cancelOrderAI = function() { 
    document.getElementById('ordStep2').style.display = 'none'; 
    document.getElementById('ordStep1').style.display = 'block'; 
    aiTempData = null; 
};

window.saveOrderAI = function() {
    if(!aiTempData) return;
    aiTempData.clientName = document.getElementById('aiClient').value; 
    aiTempData.orderNo = document.getElementById('aiOrderNo').value; 
    aiTempData.department = document.getElementById('aiDept').value; 
    aiTempData.deadline = document.getElementById('aiDeadline').value;
    aiTempData.source = '📷 圖片辨識';
    aiTempData.mailUrl = '';
    
    if(!aiTempData.clientName) return alert("客戶名稱必填");
    aiTempData.items.forEach(i => { 
        const p = globalCatalog.find(x => x.clientName === aiTempData.clientName && x.productName === i.name); 
        if(p) i.internalCode = p.internalCode || p.assetCode || ""; 
    });
    
    globalOrders.unshift({ rowIdx: 9999, time: Date.now(), client: aiTempData.clientName, orderNo: aiTempData.orderNo, dept: aiTempData.department, status: "待出貨", jsonStr: JSON.stringify(aiTempData.items), deadline: aiTempData.deadline, source: aiTempData.source, mailUrl: aiTempData.mailUrl });
    pushToSyncQueue('saveOrderData', aiTempData, null); 
    cancelOrderAI(); 
    if(typeof window.updateOrderClientDropdown === 'function') window.updateOrderClientDropdown(); 
    window.renderOrderList(); 
    showToast("✅ 訂單建檔完成 (若有重複將自動排查)");
};

// ============================================================================
// 訂單管理與渲染模組
// ============================================================================

window.renderOrderList = debounce(function() {
    const c = document.getElementById('ordListContainer'); 
    const searchTerm = (document.getElementById('ordSearchInput').value || '').toLowerCase(); 
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
    
    if (searchTerm) pending = pending.filter(o => 
        (o.client && o.client.toLowerCase().includes(searchTerm)) || 
        (o.orderNo && o.orderNo.toLowerCase().includes(searchTerm)) || 
        (o.jsonStr && o.jsonStr.toLowerCase().includes(searchTerm))
    );
    
    if(pending.length === 0) return c.innerHTML = '<div class="text-center text-muted py-3">查無符合條件的訂單</div>';
    
    let html = '';
    pending.forEach(o => {
        let items = []; try { items = JSON.parse(o.jsonStr||'[]'); } catch(e) { items = []; }
        let orderFullyShipped = true; let hasPartial = false;
        
        let displayItems = items.map(i => {
            let invoicedQty = globalSalesDetails.filter(d => { 
                let dOrderNos = String(d.orderNo).split(',').map(s=>s.trim()); 
                return dOrderNos.includes(o.orderNo) && d.name === i.name && d.shipStatus !== '作廢'; 
            }).reduce((sum, d) => sum + d.qty, 0);
            
            let remaining = i.qty - invoicedQty; 
            if (remaining > 0) orderFullyShipped = false; 
            if (invoicedQty > 0) hasPartial = true;
            
            const p = globalCatalog.find(x => x.clientName === o.client && x.productName === i.name); 
            const intCodeBadge = (p && p.internalCode) ? `<span class="badge bg-info text-dark ms-1">長固: ${p.internalCode}</span>` : '';
            
            if (invoicedQty === 0) return `<div>${i.name} ${intCodeBadge} <span class="badge bg-secondary">x${i.qty}</span></div>`; 
            else return `<div>${i.name} ${intCodeBadge} <br><small class="text-primary fw-bold">需求: ${i.qty} | 已開: ${invoicedQty} | 剩餘: <span class="text-danger">${remaining}</span></small></div>`;
        }).join('<hr class="my-2" style="opacity: 0.1;">');
        
        if (orderFullyShipped && items.length > 0) return;
        
        let isDuplicate = String(o.status).includes('待排查');
        let cardStyle = isDuplicate ? 'border: 2px solid #dc3545; background-color: #fff5f5;' : '';
        let warningLabel = o.jsonError ? `<span class="badge bg-danger ms-2">資料異常</span>` : 
                           (isDuplicate ? `<span class="badge bg-danger ms-2">⚠️ 單號重複待排查</span>` : 
                           (hasPartial ? `<span class="badge bg-info text-white ms-2">部分開立</span>` : ''));
        
        const desc = items.length > 0 ? displayItems : (o.jsonError ? '⚠️ 資料格式損毀' : '無明細'); 
        
        let deadlineHtml = '';
        if (o.deadline) {
            const deadlineDate = new Date(o.deadline); deadlineDate.setHours(0,0,0,0); 
            const diffDays = Math.ceil((deadlineDate - today) / 86400000);
            if (diffDays < 0) deadlineHtml = `<span class="badge bg-danger ms-2">🔴 已逾期 (${o.deadline})</span>`; 
            else if (diffDays === 0) deadlineHtml = `<span class="badge bg-danger ms-2">🔴 今日出貨 (${o.deadline})</span>`; 
            else if (diffDays <= 3) deadlineHtml = `<span class="badge bg-warning text-dark ms-2">🟡 即觸到期 (${o.deadline})</span>`; 
            else deadlineHtml = `<span class="badge bg-success ms-2">🟢 期限: ${o.deadline}</span>`;
        }

        const sourceStr = o.source || '⌨️ 手動建檔';
        let sourceBadge = '';
        if (sourceStr.includes('信件') || sourceStr.includes('信箱') || sourceStr.includes('自動')) sourceBadge = `<span class="badge bg-primary ms-2">${sourceStr}</span>`;
        else if (sourceStr.includes('圖片')) sourceBadge = `<span class="badge bg-info text-dark ms-2">${sourceStr}</span>`;
        else sourceBadge = `<span class="badge bg-secondary ms-2">${sourceStr}</span>`;

        let mailBtn = o.mailUrl ? `<a href="${escapeQuotes(o.mailUrl)}" target="_blank" class="btn btn-sm btn-outline-primary fw-bold me-2">📧 查閱原信</a>` : '';

        html += `<div class="item-row shadow-sm mb-2 p-3 ${hasPartial ? 'status-partial' : ''}" style="${cardStyle}">
            <div class="d-flex align-items-center justify-content-between mb-2 border-bottom pb-2">
                <div class="d-flex align-items-center" style="max-width: 65%;">
                    <input class="form-check-input me-3 cb-order" type="checkbox" value="${o.rowIdx}" data-orderno="${escapeQuotes(o.orderNo)}" data-client="${escapeQuotes(o.client)}" style="transform: scale(1.3); flex-shrink: 0;">
                    <div>
                        <div class="fw-bold text-dark fs-6">${o.client} ${warningLabel} ${sourceBadge}</div>
                        <div class="small text-muted mt-1">單號: ${o.orderNo||'無'} ${deadlineHtml}</div>
                    </div>
                </div>
                <div>
                    ${mailBtn}
                    <button class="btn btn-sm btn-outline-secondary fw-bold" onclick="openOrderModal(${o.rowIdx})">📝 編輯</button>
                </div>
            </div>
            <div class="small text-muted">${desc}</div>
        </div>`;
    });
    c.innerHTML = html || '<div class="text-center text-muted py-3">目前訂單皆已出清結案</div>';
}, 300);

// ============================================================================
// 手動建檔與訂單編輯
// ============================================================================

window.renderSingleOrderManualItem = function(item) {
    return `<div class="item-row p-3 mb-2 bg-light border shadow-sm draggable-row" id="${item.id}" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'order')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${item.id}', 'order')" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">
        <div class="drag-handle position-absolute" style="top:10px; left:10px; cursor:grab; font-size: 1.2rem; color: #adb5bd;" title="按住拖曳排序">☰</div>
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:8px; right:8px;" onclick="removeOrderManualItem('${item.id}')">✕</button>
        <div class="mb-2 pe-4 ps-4">
            <label class="form-label small fw-bold text-muted mb-1">品名</label>
            <input type="text" class="form-control fake-input-btn form-control-sm fw-bold fs-6" id="ordM_name_${item.id}" value="${escapeQuotes(item.name)}" readonly placeholder="點此選擇品名..." onclick="openSearchModal('item_ord_${item.id}', (val)=>selectProductForOrderManual('${item.id}', val))">
        </div>
        <div class="row g-2 ps-4">
            <div class="col-4"><label class="form-label small fw-bold text-muted mb-1">醫院資材碼</label><input type="text" class="form-control form-control-sm bg-white text-secondary" id="ordM_code_${item.id}" value="${escapeQuotes(item.code)}" readonly placeholder="自動匹配"></div>
            <div class="col-4"><label class="form-label small fw-bold text-muted mb-1 text-info">長固代號</label><input type="text" class="form-control form-control-sm bg-white text-info fw-bold" id="ordM_intcode_${item.id}" value="${escapeQuotes(item.internalCode)}" readonly placeholder="內部代號"></div>
            <div class="col-4"><label class="form-label small fw-bold text-muted mb-1">數量</label><input type="number" class="form-control form-control-sm fw-bold text-primary fs-6" id="ordM_qty_${item.id}" value="${item.qty}" min="0" step="any" inputmode="numeric" oninput="updateOrderManualQty('${item.id}', this.value)" placeholder="輸入數量"></div>
        </div>
    </div>`;
};

window.reRenderOrderManualItems = function() { 
    document.getElementById('e_ordItemsContainer').innerHTML = currentOrderManualItems.map(window.renderSingleOrderManualItem).join(''); 
};

window.selectClientForOrder = function(val) { 
    const oldClient = document.getElementById('e_ordClient').value; 
    document.getElementById('e_ordClient').value = val; 
    if (oldClient !== val) { 
        currentOrderManualItems = []; 
        window.addOrderManualItemRow(); 
    } 
};

window.openOrderModal = function(idx) {
    currentOrderManualItems = [];
    if(idx) {
        const o = globalOrders.find(x => x.rowIdx === idx); 
        document.getElementById('e_ordRow').value = idx; 
        document.getElementById('e_ordClient').value = o.client; 
        document.getElementById('e_ordNo').value = o.orderNo; 
        document.getElementById('e_ordDept').value = o.dept; 
        document.getElementById('e_ordDeadline').value = o.deadline || ''; 
        document.getElementById('btnDeleteOrd').style.display = 'block'; 
        document.getElementById('btnSaveOrd').classList.replace('w-100', 'w-50');
        
        let items = []; try { items = JSON.parse(o.jsonStr); } catch(e){} 
        items.forEach(i => { 
            const rowId = `ordM_${Date.now()}_${Math.random().toString(36).substr(2,5)}`; 
            currentOrderManualItems.push({ id: rowId, code: i.code||'', internalCode: i.internalCode||'', name: i.name||'', qty: i.qty||'' }); 
        });
    } else {
        document.getElementById('e_ordRow').value = ''; 
        document.getElementById('e_ordClient').value = ''; 
        document.getElementById('e_ordNo').value = ''; 
        document.getElementById('e_ordDept').value = ''; 
        document.getElementById('e_ordDeadline').value = ''; 
        document.getElementById('btnDeleteOrd').style.display = 'none'; 
        document.getElementById('btnSaveOrd').classList.replace('w-50', 'w-100'); 
        
        const rowId = `ordM_${Date.now()}_${Math.random().toString(36).substr(2,5)}`; 
        currentOrderManualItems.push({ id: rowId, code: '', internalCode: '', name: '', qty: '' });
    }
    window.reRenderOrderManualItems();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editOrdModal')).show();
};

window.addOrderManualItemRow = function() { 
    const rowId = `ordM_${Date.now()}_${Math.random().toString(36).substr(2,5)}`; 
    currentOrderManualItems.push({ id: rowId, code: '', internalCode: '', name: '', qty: '' }); 
    window.reRenderOrderManualItems(); 
};

window.selectProductForOrderManual = function(rowId, prodName) { 
    const p = globalCatalog.find(x => x.clientName === document.getElementById('e_ordClient').value && x.productName === prodName); 
    if(!p) return; 
    const item = currentOrderManualItems.find(x => x.id === rowId); 
    if(item) { item.name = p.productName; item.code = p.assetCode || ''; item.internalCode = p.internalCode || ''; } 
    window.reRenderOrderManualItems(); 
};

window.updateOrderManualQty = function(rowId, qty) { 
    const item = currentOrderManualItems.find(x => x.id === rowId); 
    if(item) item.qty = Math.max(0, parseFloat(qty) || 0); 
};

window.removeOrderManualItem = function(rowId) { 
    currentOrderManualItems = currentOrderManualItems.filter(x => x.id !== rowId); 
    window.reRenderOrderManualItems(); 
};

window.saveEditOrder = function() {
    const idx = parseInt(document.getElementById('e_ordRow').value); 
    const c = document.getElementById('e_ordClient').value; 
    const o = document.getElementById('e_ordNo').value; 
    const d = document.getElementById('e_ordDept').value; 
    const deadline = document.getElementById('e_ordDeadline').value; 
    
    if(!c) return alert('客戶名稱必填！'); 
    
    let items = [];
    for (let item of currentOrderManualItems) { 
        if (!item.name || item.qty <= 0) return alert('品項明細填寫不完整或數量無效！'); 
        items.push({ code: item.code, internalCode: item.internalCode, name: item.name, qty: item.qty }); 
    }
    if (items.length === 0) return alert('請至少新增一項品項！');
    
    let src = '⌨️ 手動建檔'; let mUrl = ''; let currStatus = '待出貨';
    if(idx) { 
        const od = globalOrders.find(x => x.rowIdx === idx); 
        if(od) { src = od.source || '⌨️ 手動建檔'; mUrl = od.mailUrl || ''; currStatus = od.status; } 
    }
    
    const j = JSON.stringify(items); 
    if (currStatus.includes('待排查')) currStatus = '待出貨';
    
    const payload = { rowIdx: idx||null, clientName: c, orderNo: o, department: d, status: currStatus, items: items, deadline: deadline, source: src, mailUrl: mUrl, staff: myName }; 
    
    if(idx) { 
        const od = globalOrders.find(x => x.rowIdx === idx); 
        if(od){ od.client = c; od.orderNo = o; od.dept = d; od.jsonStr = j; od.deadline = deadline; od.source = src; od.mailUrl = mUrl; od.status = currStatus; } 
    } 
    else { 
        globalOrders.unshift({ rowIdx: Date.now(), time: Date.now(), client: c, orderNo: o, dept: d, status: "待出貨", jsonStr: j, deadline: deadline, source: src, mailUrl: mUrl }); 
    }
    
    pushToSyncQueue('saveOrderData', payload, null); 
    if(typeof window.updateOrderClientDropdown === 'function') window.updateOrderClientDropdown(); 
    window.renderOrderList(); 
    bootstrap.Modal.getInstance(document.getElementById('editOrdModal')).hide(); 
    showToast("✅ 訂單儲存完成");
};

window.deleteOrder = function() { 
    const idx = parseInt(document.getElementById('e_ordRow').value); 
    if(!idx) return; 
    if(confirm('確定要作廢這筆訂單嗎？')) { 
        const o = globalOrders.find(x=>x.rowIdx===idx); 
        if(o) o.status = '已作廢'; 
        pushToSyncQueue('updateOrderStatus', {rowIndices: [idx], status: '已作廢'}, null); 
        if(typeof window.updateOrderClientDropdown === 'function') window.updateOrderClientDropdown(); 
        window.renderOrderList(); 
        bootstrap.Modal.getInstance(document.getElementById('editOrdModal')).hide(); 
    } 
};

// ============================================================================
// 合併出貨與報表發送
// ============================================================================
window.groupFulfillOrders = function() {
    const cbs = document.querySelectorAll('.cb-order:checked'); 
    if(cbs.length === 0) return showToast('請先勾選訂單');
    
    let client = ''; let valid = true; let ids = []; 
    cbs.forEach(cb => { 
        ids.push(parseInt(cb.value)); 
        if(!client) client = cb.dataset.client; 
        else if(client !== cb.dataset.client) valid = false; 
    });
    
    if(!valid) return alert('群組合併開票必須為【同一間客戶】，請重新勾選。');
    
    selectedOrderCache = globalOrders.filter(o => ids.includes(o.rowIdx)); 
    window.enterSystem('invoice');
    
    document.getElementById('invClientInput').value = client; 
    currentInvoiceData.clientName = client; 
    const cObj = globalClients.find(x => x.name === client); 
    currentInvoiceData.taxId = cObj ? cObj.taxId : ''; 
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${currentInvoiceData.taxId||'無'})`; 
    document.getElementById('invClientInfo').style.display = 'block'; 
    document.getElementById('btnNext1').style.display = 'block'; 
    
    document.getElementById('invOrderNo').value = [...new Set(selectedOrderCache.map(o => o.orderNo).filter(x=>x))].join(', ');
    
    currentInvoiceData.items = []; 
    document.getElementById('invAiNotice').style.display = 'block';
    
    selectedOrderCache.forEach(order => {
        let items = []; try { items = JSON.parse(order.jsonStr || '[]'); } catch(e){}
        items.forEach(i => {
            let invoicedQty = globalSalesDetails.filter(d => { 
                let dOrderNos = String(d.orderNo).split(',').map(s=>s.trim()); 
                return dOrderNos.includes(order.orderNo) && d.name === i.name && d.shipStatus !== '作廢'; 
            }).reduce((sum, d) => sum + d.qty, 0); 
            
            let remaining = i.qty - invoicedQty;
            if (remaining > 0) {
                const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`; 
                const p = globalCatalog.find(x => x.clientName === client && x.productName === i.name);
                let price = p ? p.price : 0; 
                let unit = p ? p.unit : '式'; 
                let internalCode = p ? (p.internalCode || p.assetCode) : '';
                currentInvoiceData.items.push({ id: rowId, product: p ? {productName: i.name, unit: unit, price: price, internalCode: internalCode} : null, qty: remaining, orderRef: order.orderNo, deptRef: order.dept });
            }
        });
    });
    
    if (typeof window.reRenderInvoiceItems === 'function') window.reRenderInvoiceItems(); 
    if (typeof window.goStep === 'function') window.goStep(2); 
    showToast("✅ 已載入剩餘待出貨品項");
};

window.renderEmailSettings = function() {
    const container = document.getElementById('emailCheckboxes');
    if (!emailSettingsData || emailSettingsData.list.length === 0) { container.innerHTML = '<div class="text-muted small">尚未在「收件信箱管理」工作表設定任何信箱。</div>'; return; }
    let html = '';
    emailSettingsData.list.forEach((item, idx) => {
        const isChecked = emailSettingsData.selected.includes(item.email) ? 'checked' : '';
        html += `<div class="form-check"><input class="form-check-input email-cb" type="checkbox" value="${item.email}" id="cb_email_${idx}" ${isChecked}><label class="form-check-label fw-bold text-dark" for="cb_email_${idx}">${item.email} <span class="badge bg-secondary ms-1">${item.memo || ''}</span></label></div>`;
    });
    container.innerHTML = html;
};

window.saveEmailSettings = function() {
    const cbs = document.querySelectorAll('.email-cb:checked'); 
    emailSettingsData.selected = Array.from(cbs).map(cb => cb.value);
    showLoading("儲存設定中..."); 
    callApi('saveReportEmails', { selectedEmails: emailSettingsData.selected }).then(res => { 
        hideLoading(); showToast("💾 收件信箱設定已儲存"); 
    }).catch(err => { 
        hideLoading(); alert("儲存失敗：" + err.message); 
    });
};

window.triggerManualReport = function() {
    if (emailSettingsData.selected.length === 0) return alert("請先勾選至少一個收件信箱並儲存設定！"); 
    if (!confirm("確定要現在立即產生並發送「未結案訂單報表」嗎？\n(將發送至勾選的信箱)")) return;
    showLoading("報表產生並發送中..."); 
    callApi('sendPendingOrdersReport', {}).then(res => { 
        hideLoading(); alert(res.msg); 
    }).catch(err => { 
        hideLoading(); alert("發送失敗：" + err.message); 
    });
};

window.updateOrderClientDropdown = function() { 
    const pending = globalOrders.filter(o => o.status !== '已結案' && o.status !== '作廢' && o.status !== '已作廢'); 
    const clients = [...new Set(pending.map(o => o.client).filter(x => x))].sort(); 
    if (document.getElementById('ordFilterClient')) {
        document.getElementById('ordFilterClient').innerHTML = '<option value="">🏢 所有醫院</option>' + clients.map(c => `<option value="${escapeQuotes(c)}">${c}</option>`).join(''); 
    }
};
