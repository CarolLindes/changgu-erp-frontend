/**
 * ============================================================================
 * 模組 2：訂單辨識建檔 (module_order.js)
 * 【強健比對、匯入日期顯示、同單號多單位核銷 ＆ AI 失敗信件自動重試升級版】
 * ============================================================================
 */

// ============================================================================
// 【核心工具】強健產品比對引擎 (Robust Product Matching)
// 解決醫院品名差異、隱藏空白、大小寫，並優先信任「資材碼」與「內部代號」
// ============================================================================
window.findProductRobust = function(clientName, itemCode, itemName) {
    if (!clientName) return null;
    return globalCatalog.find(x => {
        if (x.clientName !== clientName) return false;
        
        // 1. 絕對優先：資材碼或長固內部代號比對 (只要代碼對，無視品名差異)
        if (itemCode && (itemCode === x.assetCode || itemCode === x.internalCode)) return true;
        
        // 2. 降級容錯：消除所有空白、換行，並轉為小寫後進行品名強健比對
        let nameA = String(x.productName || '').replace(/\s+/g, '').toLowerCase();
        let nameB = String(itemName || '').replace(/\s+/g, '').toLowerCase();
        
        return nameA === nameB;
    });
};

// 強健品項名稱核對工具（解決訂單原始品名與轉發票後建檔品名的空白或字元微差）
window.isSameOrderItem = function(clientName, orderItem, targetName) {
    if (!orderItem || !targetName) return false;
    const normTarget = String(targetName || '').replace(/\s+/g, '').toLowerCase();
    const normItem = String(orderItem.name || '').replace(/\s+/g, '').toLowerCase();
    if (normItem === normTarget) return true;

    if (clientName && typeof window.findProductRobust === 'function') {
        const p = window.findProductRobust(clientName, orderItem.code || orderItem.internalCode, orderItem.name);
        if (p && p.productName) {
            const normCatalog = String(p.productName).replace(/\s+/g, '').toLowerCase();
            if (normCatalog === normTarget) return true;
        }
    }
    return false;
};

// 智慧計算單筆訂單品項的「已開立數量」（支援同單號、不同申請單位精準拆分核銷）
window.getOrderInvoicedQty = function(order, item) {
    if (!order || !order.orderNo || !item) return 0;
    const targetOrderNo = String(order.orderNo).trim();
    const targetDept = String(order.dept || '').trim();
    const expectedTag = targetDept ? `${targetOrderNo} ${targetDept}` : targetOrderNo;

    const matchingSales = (globalSalesDetails || []).filter(d => {
        if (d.shipStatus === '作廢' || d.shipStatus === '歷史已結案') return false;
        const dOrderNos = String(d.orderNo || '').split(',').map(s => s.trim());
        return dOrderNos.includes(targetOrderNo) && window.isSameOrderItem(order.client, item, d.name);
    });

    if (matchingSales.length === 0) return 0;

    const paperNos = [...new Set(matchingSales.map(d => d.paperNo).filter(Boolean))];
    let totalInvoiced = 0;
    let hasUntaggedQty = 0;

    paperNos.forEach(pNo => {
        const inv = (globalHistory || []).find(h => h.paperNo === pNo && h.status !== '作廢');
        let matchedByTagInThisInvoice = false;

        if (inv && inv.details && inv.details.includes('[')) {
            const lines = String(inv.details).split('\n');
            const hasOrderTag = lines.some(line => {
                const m = line.match(/\[([^\]]+)\]\s*$/);
                if (!m) return false;
                const tag = m[1].trim();
                return tag === targetOrderNo || tag.startsWith(targetOrderNo + ' ');
            });

            if (hasOrderTag) {
                matchedByTagInThisInvoice = true;
                lines.forEach(line => {
                    const m = line.match(/^(.*)\s+x([0-9.]+)\s*(?:\(單價:[^)]*\))?\s*\[([^\]]+)\]\s*$/);
                    if (m) {
                        const lineName = m[1].trim();
                        const lineQty = parseFloat(m[2]) || 0;
                        const lineTag = m[3].trim();

                        if (window.isSameOrderItem(order.client, item, lineName)) {
                            if (targetDept) {
                                if (lineTag === expectedTag || lineTag === targetOrderNo) {
                                    totalInvoiced += lineQty;
                                }
                            } else {
                                if (lineTag === targetOrderNo) {
                                    totalInvoiced += lineQty;
                                }
                            }
                        }
                    }
                });
            }
        }

        if (!matchedByTagInThisInvoice) {
            const salesInPaper = matchingSales.filter(d => d.paperNo === pNo);
            hasUntaggedQty += salesInPaper.reduce((sum, d) => sum + (Number(d.qty) || 0), 0);
        }
    });

    if (hasUntaggedQty > 0) {
        const sameGroupOrders = (globalOrders || []).filter(o =>
            o.status !== '已作廢' && o.status !== '作廢' &&
            String(o.orderNo || '').trim() === targetOrderNo &&
            String(o.dept || '').trim() === targetDept
        ).sort((a, b) => (a.rowIdx || 0) - (b.rowIdx || 0));

        if (sameGroupOrders.length > 1) {
            let pool = hasUntaggedQty;
            for (const o of sameGroupOrders) {
                let oItems = [];
                try { oItems = JSON.parse(o.jsonStr || '[]'); } catch (e) { oItems = []; }
                const matchItem = oItems.find(oi => window.isSameOrderItem(o.client, oi, item.name));
                if (matchItem) {
                    const need = Math.max(0, (Number(matchItem.qty) || 0) - totalInvoiced);
                    const allocated = Math.min(pool, need);
                    if (o.rowIdx === order.rowIdx) {
                        totalInvoiced += allocated;
                        break;
                    }
                    pool = Math.max(0, pool - allocated);
                }
            }
        } else {
            totalInvoiced += hasUntaggedQty;
        }
    }

    return totalInvoiced;
};

// ============================================================================
// AI 與信箱自動辨識系統 (整合失敗信件自動拔標籤重試機制)
// ============================================================================

window.triggerEmailScan = function(retryFailed = false) {
    const loadingMsg = retryFailed
        ? "🔄 正在自動拔除「ERP處理失敗」標籤、設回未讀並重新喚醒 AI..."
        : "⚡ 正在喚醒 AI 機器人並檢查待重試信件...";
    showLoading(loadingMsg);

    callApi('scanEmailOrders', { retryFailed: !!retryFailed }).then(res => {
        hideLoading();
        if (res && res.msg) {
            showToast(res.msg);
        } else {
            showToast("✅ 已成功喚醒 AI 機器人！系統將於背景獨立執行解析，請留意 Telegram 進度通知。");
        }
    }).catch(err => {
        hideLoading();
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
    reader.onload = async function(e) {
        const base64Data = e.target.result;
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                showLoading(attempt === 1
                    ? "✨ Gemini AI 智慧辨識中..."
                    : `🔄 AI 忙碌中，正在自動進行第 ${attempt} 次重試辨識...`
                );
                const res = await callApi('processOrderImage', { base64Str: base64Data, mimeType: mimeType });
                hideLoading();
                let previewData = Array.isArray(res) ? res[0] : res;
                if(!previewData) throw new Error('未辨識到訂單資訊');

                aiTempData = previewData; 
                document.getElementById('aiClient').value = previewData.clientName || ''; 
                document.getElementById('aiOrderNo').value = previewData.orderNo || ''; 
                document.getElementById('aiDept').value = previewData.department || ''; 
                document.getElementById('aiDeadline').value = ''; 
                window.recheckAiItems(); 
                document.getElementById('ordStep1').style.display = 'none'; 
                document.getElementById('ordStep2').style.display = 'block'; 
                return;
            } catch (err) {
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, attempt * 2000));
                } else {
                    hideLoading();
                    alert("AI 辨識失敗（已自動重試 3 次）：" + err.message);
                }
            }
        }
    };
    reader.readAsDataURL(file);
    input.value = '';
};

window.recheckAiItems = function() {
    if(!aiTempData || !aiTempData.items) return; 
    const clientName = document.getElementById('aiClient').value;
    const html = aiTempData.items.map((i, index) => {
        let internalCode = ""; 
        let assetCode = "";
        if (clientName) { 
            const p = window.findProductRobust(clientName, i.code || i.internalCode, i.name);
            if(p) {
                internalCode = p.internalCode || "";
                assetCode = p.assetCode || "";
            } 
        }
        let codeDisplay = `<span class="badge bg-secondary">醫院資材碼: ${i.code || assetCode || '無'}</span>`; 
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
    const btn = event ? event.currentTarget : null;

    aiTempData.clientName = document.getElementById('aiClient').value.trim(); 
    aiTempData.orderNo = document.getElementById('aiOrderNo').value.trim(); 
    aiTempData.department = document.getElementById('aiDept').value.trim(); 
    aiTempData.deadline = document.getElementById('aiDeadline').value;
    aiTempData.source = '📷 圖片辨識';
    aiTempData.mailUrl = '';
    
    if(!aiTempData.clientName) return alert("客戶名稱必填");

    if (aiTempData.orderNo) {
        const dupOrders = globalOrders.filter(x => 
            x.status !== '已作廢' && x.status !== '作廢' && 
            String(x.orderNo || '').trim() === aiTempData.orderNo
        );
        if (dupOrders.length > 0) {
            const dupInfo = dupOrders.map(d => `${d.client}${d.dept ? ' (' + d.dept + ')' : ''}`).join('、');
            if (!confirm(`⚠️ 重複單號警告：\n系統中已存在相同的訂單號碼【${aiTempData.orderNo}】\n既有紀錄：${dupInfo}\n\n確定仍要建立這筆訂單嗎？`)) {
                return;
            }
        }
    }

    if(window.lockButton(btn)) return; // 防連點保護

    aiTempData.items.forEach(i => { 
        const p = window.findProductRobust(aiTempData.clientName, i.code || i.internalCode, i.name);
        if(p) {
            i.internalCode = p.internalCode || "";
            if (!i.code && p.assetCode) i.code = p.assetCode;
        } 
    });
    
    const newRowIdx = Date.now() + Math.floor(Math.random() * 1000);
    aiTempData.rowIdx = newRowIdx;
    globalOrders.unshift({ rowIdx: newRowIdx, time: Date.now(), client: aiTempData.clientName, orderNo: aiTempData.orderNo, dept: aiTempData.department, status: "待出貨", jsonStr: JSON.stringify(aiTempData.items), deadline: aiTempData.deadline, source: aiTempData.source, mailUrl: aiTempData.mailUrl });
    pushToSyncQueue('saveOrderData', aiTempData, null); 
    cancelOrderAI(); 
    if(typeof window.updateOrderClientDropdown === 'function') window.updateOrderClientDropdown(); 
    window.renderOrderList(); 
    showToast("✅ 訂單建檔完成");
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
        (o.dept && o.dept.toLowerCase().includes(searchTerm)) ||
        (o.jsonStr && o.jsonStr.toLowerCase().includes(searchTerm))
    );
    
    if(pending.length === 0) return c.innerHTML = '<div class="text-center text-muted py-3">查無符合條件的訂單</div>';
    
    let html = '';
    pending.forEach(o => {
        let items = []; try { items = JSON.parse(o.jsonStr||'[]'); } catch(e) { items = []; }
        let orderFullyShipped = true; let hasPartial = false;
        
        let displayItems = items.map(i => {
            let invoicedQty = window.getOrderInvoicedQty(o, i);
            
            let remaining = i.qty - invoicedQty; 
            if (remaining > 0) orderFullyShipped = false; 
            if (invoicedQty > 0) hasPartial = true;
            
            const p = window.findProductRobust(o.client, i.code || i.internalCode, i.name);
            const intCodeBadge = (p && p.internalCode) ? `<span class="badge bg-info text-dark ms-1">長固: ${p.internalCode}</span>` : '';
            
            if (invoicedQty === 0) return `<div>${i.name} ${intCodeBadge} <span class="badge bg-secondary">x${i.qty}</span></div>`; 
            else return `<div>${i.name} ${intCodeBadge} <br><small class="text-primary fw-bold">需求: ${i.qty} | 已開: ${invoicedQty} | 剩餘: <span class="text-danger">${Math.max(0, remaining)}</span></small></div>`;
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
            else if (diffDays <= 3) deadlineHtml = `<span class="badge bg-warning text-dark ms-2">🟡 即將到期 (${o.deadline})</span>`; 
            else deadlineHtml = `<span class="badge bg-success ms-2">🟢 期限: ${o.deadline}</span>`;
        }

        let importDateHtml = '';
        if (o.time) {
            const dObj = new Date(Number(o.time));
            if (!isNaN(dObj.getTime())) {
                const y = dObj.getFullYear();
                const m = String(dObj.getMonth() + 1).padStart(2, '0');
                const d = String(dObj.getDate()).padStart(2, '0');
                importDateHtml = `<span class="badge bg-light text-secondary border ms-2">📅 匯入日期: ${y}/${m}/${d}</span>`;
            }
        }
        let deptHtml = o.dept ? `<span class="badge bg-light text-dark border ms-2">🏥 ${escapeQuotes(o.dept)}</span>` : '';

        const sourceStr = o.source || '⌨️ 手動建檔';
        let sourceBadge = '';
        if (sourceStr.includes('信件') || sourceStr.includes('信箱') || sourceStr.includes('自動')) sourceBadge = `<span class="badge bg-primary ms-2">${sourceStr}</span>`;
        else if (sourceStr.includes('圖片')) sourceBadge = `<span class="badge bg-info text-dark ms-2">${sourceStr}</span>`;
        else sourceBadge = `<span class="badge bg-secondary ms-2">${sourceStr}</span>`;

        let mailBtn = o.mailUrl ? `<a href="${escapeQuotes(o.mailUrl)}" target="_blank" class="btn btn-sm btn-outline-primary fw-bold me-2">📧 查閱原信</a>` : '';

        html += `<div class="item-row shadow-sm mb-2 p-3 ${hasPartial ? 'status-partial' : ''}" style="${cardStyle}">
            <div class="d-flex align-items-center justify-content-between mb-2 border-bottom pb-2">
                <div class="d-flex align-items-center" style="max-width: 70%;">
                    <input class="form-check-input me-3 cb-order" type="checkbox" value="${o.rowIdx}" data-orderno="${escapeQuotes(o.orderNo)}" data-client="${escapeQuotes(o.client)}" style="transform: scale(1.3); flex-shrink: 0;">
                    <div>
                        <div class="fw-bold text-dark fs-6">${o.client} ${warningLabel} ${sourceBadge}</div>
                        <div class="small text-muted mt-1">單號: ${o.orderNo||'無'} ${deptHtml} ${importDateHtml} ${deadlineHtml}</div>
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
    const clientName = document.getElementById('e_ordClient').value;
    const p = window.findProductRobust(clientName, null, prodName); 
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
    const btn = document.getElementById('btnSaveOrd');

    const idx = parseInt(document.getElementById('e_ordRow').value); 
    const c = document.getElementById('e_ordClient').value.trim(); 
    const o = document.getElementById('e_ordNo').value.trim(); 
    const d = document.getElementById('e_ordDept').value.trim(); 
    const deadline = document.getElementById('e_ordDeadline').value; 
    
    if(!c) return alert('客戶名稱必填！'); 
    
    let items = [];
    for (let item of currentOrderManualItems) { 
        if (!item.name || item.qty <= 0) return alert('品項明細填寫不完整或數量無效！'); 
        items.push({ code: item.code, internalCode: item.internalCode, name: item.name, qty: item.qty }); 
    }
    if (items.length === 0) return alert('請至少新增一項品項！');

    if (o) {
        const dupOrders = globalOrders.filter(x => 
            x.rowIdx !== idx && 
            x.status !== '已作廢' && x.status !== '作廢' && 
            String(x.orderNo || '').trim() === o
        );
        if (dupOrders.length > 0) {
            const dupInfo = dupOrders.map(dup => `${dup.client}${dup.dept ? ' (' + dup.dept + ')' : ''}`).join('、');
            if (!confirm(`⚠️ 重複單號警告：\n系統中已存在相同的訂單號碼【${o}】\n既有紀錄：${dupInfo}\n\n確定仍要儲存這筆訂單嗎？`)) {
                return;
            }
        }
    }

    if(window.lockButton(btn)) return; // 防連點保護
    
    let src = '⌨️ 手動建檔'; let mUrl = ''; let currStatus = '待出貨';
    if(idx) { 
        const od = globalOrders.find(x => x.rowIdx === idx); 
        if(od) { src = od.source || '⌨️ 手動建檔'; mUrl = od.mailUrl || ''; currStatus = od.status; } 
    }
    
    const j = JSON.stringify(items); 
    if (currStatus.includes('待排查')) currStatus = '待出貨';
    
    const targetRowIdx = idx || (Date.now() + Math.floor(Math.random() * 1000));
    const payload = { rowIdx: targetRowIdx, clientName: c, orderNo: o, department: d, status: currStatus, items: items, deadline: deadline, source: src, mailUrl: mUrl, staff: myName }; 
    
    if(idx) { 
        const od = globalOrders.find(x => x.rowIdx === idx); 
        if(od){ od.client = c; od.orderNo = o; od.dept = d; od.jsonStr = j; od.deadline = deadline; od.source = src; od.mailUrl = mUrl; od.status = currStatus; } 
    } 
    else { 
        globalOrders.unshift({ rowIdx: targetRowIdx, time: Date.now(), client: c, orderNo: o, dept: d, status: "待出貨", jsonStr: j, deadline: deadline, source: src, mailUrl: mUrl }); 
    }
    
    pushToSyncQueue('saveOrderData', payload, null); 
    if(typeof window.updateOrderClientDropdown === 'function') window.updateOrderClientDropdown(); 
    window.renderOrderList(); 
    bootstrap.Modal.getInstance(document.getElementById('editOrdModal')).hide(); 
    showToast("✅ 訂單儲存完成");
};

window.deleteOrder = function() { 
    const btn = document.getElementById('btnDeleteOrd');
    const idx = parseInt(document.getElementById('e_ordRow').value); 
    if(!idx) return; 
    if(confirm('確定要作廢這筆訂單嗎？')) { 
        if(window.lockButton(btn)) return; // 防連點保護
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
            let invoicedQty = window.getOrderInvoicedQty(order, i);
            
            let remaining = i.qty - invoicedQty;
            if (remaining > 0) {
                const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`; 
                const p = window.findProductRobust(client, i.code || i.internalCode, i.name);
                
                let price = p ? p.price : 0; 
                let unit = p ? p.unit : '式'; 
                let internalCode = p ? (p.internalCode || p.assetCode) : '';
                let finalName = p ? p.productName : i.name;
                
                currentInvoiceData.items.push({ id: rowId, product: p ? {productName: finalName, unit: unit, price: price, internalCode: internalCode} : null, qty: remaining, orderRef: order.orderNo, deptRef: order.dept });
            }
        });
    });
    
    if (typeof window.reRenderInvoiceItems === 'function') window.reRenderInvoiceItems(); 
    if (typeof window.goStep === 'function') window.goStep(2); 
    showToast("✅ 已載入剩餘待出貨品項，並自動執行資材碼/品名強健對應");
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
    const btn = event ? event.currentTarget : null;
    if(window.lockButton(btn)) return; // 防連點保護

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
    const btn = event ? event.currentTarget : null;

    if (emailSettingsData.selected.length === 0) return alert("請先勾選至少一個收件信箱並儲存設定！"); 
    if (!confirm("確定要現在立即產生並發送「未結案訂單報表」嗎？\n(將發送至勾選的信箱)")) return;
    if(window.lockButton(btn)) return; // 防連點保護
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
