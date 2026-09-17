/**
 * ============================================================================
 * 模組 4：庫存、訂貨與管理員後台 (module_inventory_admin.js)
 * ============================================================================
 */

// ============================================================================
// 【核心防護罩】批號與效期安全解析器
// ============================================================================
window.parseBatchesSafely = function(rawStr, defaultQty) {
    if (!rawStr || String(rawStr).trim() === '') return [];
    let parsed;
    try { 
        parsed = JSON.parse(rawStr); 
    } catch(e) { 
        parsed = rawStr; 
    }
    
    // 如果確實是標準陣列，直接回傳
    if (Array.isArray(parsed)) {
        return parsed;
    } else {
        // 如果是純數字 (如 12345) 或純文字，強制包裝成標準的單一物件陣列
        return [{ lot: String(parsed), exp: '', qty: defaultQty || 0 }];
    }
};

// ============================================================================
// 庫存管理與異動模組
// ============================================================================
window.populateLogDropdowns = function() { 
    const names = [...new Set(globalInvLogs.map(l => l.name || '').filter(x => x))].sort(); 
    const filterEl = document.getElementById('logFilterName');
    if (filterEl) {
        filterEl.innerHTML = '<option value="">📦 所有品名 (不限)</option>' + names.map(n => `<option value="${escapeQuotes(n)}">${n}</option>`).join(''); 
    }
};

window.triggerSyncAssetCodes = function() { 
    showLoading("同步長固代號 / 資材碼中..."); 
    callApi('syncAssetCodesToInventory', {}).then(res => { 
        hideLoading(); 
        if(res.success) { 
            showToast(`✅ 同步完成！共更新了 ${res.count} 筆資料。`); 
            refreshData(); 
        } else { 
            alert(res.msg); 
        } 
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); }); 
};

window.renderInventory = debounce(function() {
    const term = (document.getElementById('stkSearch').value || '').toLowerCase(); 
    let arr = globalInventory; 
    
    if(term) {
        arr = arr.filter(v => 
            (v.name || '').toLowerCase().includes(term) || 
            (v.supplier || '').toLowerCase().includes(term) || 
            String(v.internalCode || '').toLowerCase().includes(term)
        );
    }
    
    let totalVal = 0; let alertCount = 0; 
    globalInventory.forEach(v => { 
        totalVal += (v.qty * v.cost); 
        if(v.qty <= v.alertQty) alertCount++; 
    });
    
    document.getElementById('stkTotalValue').innerText = `$${totalVal.toLocaleString()}`; 
    document.getElementById('stkAlertCount').innerText = `${alertCount} 項`;
    
    const c = document.getElementById('stkListContainer'); 
    if(arr.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無庫存資料</div>';
    
    c.innerHTML = arr.map(v => {
        let dot = 'stock-g'; let alertHTML = ''; 
        if (v.qty <= 0) dot = 'stock-r'; 
        else if (v.qty <= v.alertQty) dot = 'stock-y';
        
        if (v.qty <= v.alertQty) alertHTML = `<div class="small text-danger fw-bold mt-1">⚠️ 低於安全庫存 (${v.alertQty})</div>`;
        
        let batches = window.parseBatchesSafely(v.batchesStr, v.qty);
        let batchDisplay = '';
        if (batches.length === 1) {
            batchDisplay = `效期: ${batches[0].exp||'--'} | 批號: ${batches[0].lot||'--'}`;
        } else if (batches.length > 1) {
            batchDisplay = `<span class="badge bg-primary">📦 包含 ${batches.length} 組不同批號庫存</span>`;
        } else {
            batchDisplay = `效期: -- | 批號: --`;
        }

        return `<div class="item-row bg-white shadow-sm">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <div class="fw-bold fs-6 text-dark"><span class="stock-dot ${dot}"></span>${v.name} <span class="badge bg-secondary ms-1">${v.internalCode||''}</span></div>
                    <div class="small text-primary mt-1 fw-bold">對應資材碼: ${v.assetCodeCombined||'無'}</div>
                    <div class="small text-muted mt-1">${batchDisplay}</div>
                    ${alertHTML}
                </div>
                <div class="text-end">
                    <div class="fs-4 fw-bold ${dot==='stock-r'?'text-danger':(dot==='stock-y'?'text-warning':'text-success')}">${v.qty}</div>
                    <div class="small text-muted">總庫存數量</div>
                </div>
            </div>
            <button class="btn btn-sm btn-outline-info w-100 fw-bold" onclick="openAdjustModal('${escapeQuotes(v.name)}')">進貨 / 盤點</button>
        </div>`;
    }).join('');
}, 300);

window.renderInvLogs = debounce(function() {
    const fIn = document.getElementById('logFilterIn').value; 
    const fOut = document.getElementById('logFilterOut').value; 
    const fStart = document.getElementById('logFilterStart').value; 
    const fEnd = document.getElementById('logFilterEnd').value; 
    const fName = document.getElementById('logFilterName').value; 
    const term = (document.getElementById('stkLogSearch').value || '').toLowerCase();
    
    let arr = globalInvLogs; 
    if(fIn || fOut) arr = arr.filter(l => (fIn && (l.type||'').includes(fIn)) || (fOut && (l.type||'').includes(fOut)));
    if(fStart) { const startT = new Date(fStart).setHours(0,0,0,0); arr = arr.filter(l => new Date(l.time).setHours(0,0,0,0) >= startT); }
    if(fEnd) { const endT = new Date(fEnd).setHours(23,59,59,999); arr = arr.filter(l => new Date(l.time).getTime() <= endT); }
    if(fName) arr = arr.filter(l => l.name === fName); 
    
    if(term) {
        arr = arr.filter(l => 
            (l.name || '').toLowerCase().includes(term) || 
            (l.staff || '').toLowerCase().includes(term) || 
            (l.memo || '').toLowerCase().includes(term) || 
            String(l.invoiceNo || '').toLowerCase().includes(term) || 
            String(l.orderNo || '').toLowerCase().includes(term) ||
            String(l.lot || '').toLowerCase().includes(term)
        );
    }
    
    const c = document.getElementById('stkLogContainer'); 
    if(arr.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無符合條件的異動紀錄</div>';
    
    c.innerHTML = arr.map(l => {
        const d = new Date(l.time); 
        const dateStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; 
        const isAdd = l.qtyChange > 0;
        let extInfo = [];
        if (l.invoiceNo) extInfo.push(`發票: ${l.invoiceNo}`);
        if (l.orderNo) extInfo.push(`單號: ${l.orderNo}`);
        if (l.arrivalDate) extInfo.push(`進貨日: ${l.arrivalDate}`);
        if (l.lot) extInfo.push(`批號: ${l.lot}`);
        let extHtml = extInfo.length > 0 ? `<div class="small text-primary fw-bold mt-1">${extInfo.join(' | ')}</div>` : '';
        
        let actionBtns = `<button class="btn btn-sm btn-outline-secondary fw-bold" onclick="openEditInvLogModal(${l.rowIdx})">✏️ 編輯備註</button>`;
        
        if (l.type === "向廠商訂貨" && l.snapshot) {
            actionBtns = `<button class="btn btn-sm btn-outline-info fw-bold me-1 text-dark" onclick="reprintPurchaseOrderFast(${l.rowIdx})">🖨️ 列印訂貨單</button>` + actionBtns;
        }

        if (l.type === "分批出貨") {
            actionBtns = `<button class="btn btn-sm btn-outline-warning fw-bold me-1 text-dark" onclick="openEditBatchModal(${l.rowIdx})">🔄 修改批號</button>` + actionBtns;
        }

        return `<div class="p-3 bg-white border rounded mb-2 shadow-sm d-flex justify-content-between align-items-center">
            <div>
                <div class="fw-bold text-dark">${l.name} <span class="badge ${isAdd?'bg-success':(l.qtyChange<0?'bg-danger':'bg-warning text-dark')}">${l.type}</span></div>
                <div class="small text-muted mt-1">${dateStr} | ${l.staff}</div>
                ${extHtml}
                <div class="small text-secondary mt-1" style="white-space: pre-wrap;">${l.memo || ''}</div>
            </div>
            <div class="text-end">
                <div class="fs-5 fw-bold ${isAdd?'text-success':(l.qtyChange<0?'text-danger':'text-warning')}">${isAdd?'+':''}${l.qtyChange}</div>
                <div class="small text-muted mb-2">結存: ${l.newQty}</div>
                <div class="d-flex justify-content-end gap-1 flex-wrap">${actionBtns}</div>
            </div>
        </div>`;
    }).join('');
}, 300);

// ============================================================================
// 異動紀錄編輯器 (一般備註與發票修改)
// ============================================================================
window.openEditInvLogModal = function(idx) {
    const l = globalInvLogs.find(x => x.rowIdx === idx); 
    if(!l) return;
    document.getElementById('e_logRowIdx').value = idx;
    document.getElementById('e_logInvoiceNo').value = l.invoiceNo || '';
    document.getElementById('e_logArrivalDate').value = l.arrivalDate || '';
    document.getElementById('e_logOrderNo').value = l.orderNo || '';
    document.getElementById('e_logMemo').value = l.memo || '';
    document.getElementById('e_logSnapshot').value = l.snapshot || '';
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvLogModal')).show();
};

window.saveEditInvLog = function() {
    const idx = parseInt(document.getElementById('e_logRowIdx').value);
    const invoiceNo = document.getElementById('e_logInvoiceNo').value.trim();
    const arrivalDate = document.getElementById('e_logArrivalDate').value;
    const orderNo = document.getElementById('e_logOrderNo').value.trim();
    const memo = document.getElementById('e_logMemo').value.trim();
    
    const l = globalInvLogs.find(x => x.rowIdx === idx);
    if(l) {
        l.invoiceNo = invoiceNo; l.arrivalDate = arrivalDate; l.orderNo = orderNo; l.memo = memo;
    }
    
    pushToSyncQueue('editInvLogRecord', { rowIdx: idx, invoiceNo, arrivalDate, orderNo, memo }, null);
    window.renderInvLogs();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvLogModal')).hide();
    showToast("💾 異動紀錄備註已更新");
};

// ============================================================================
// 修改出貨批號連動機制
// ============================================================================
window.openEditBatchModal = function(idx) {
    const l = globalInvLogs.find(x => x.rowIdx === idx);
    if (!l) return;
    
    document.getElementById('eb_logRowIdx').value = idx;
    document.getElementById('eb_itemName').value = l.name;
    document.getElementById('eb_changeQty').value = Math.abs(l.qtyChange);
    document.getElementById('eb_oldLot').value = l.lot || '';
    document.getElementById('eb_currentLotDisplay').value = l.lot || '不分批 / 無紀錄';

    const inv = globalInventory.find(x => x.name === l.name);
    const select = document.getElementById('eb_newBatchSelect');
    select.innerHTML = '<option value="">不分批 (退回總庫存)</option>';
    
    if (inv && inv.batchesStr) {
        let batches = window.parseBatchesSafely(inv.batchesStr, inv.qty);
        batches.forEach(b => {
            select.innerHTML += `<option value="${escapeQuotes(b.lot)}" data-exp="${escapeQuotes(b.exp)}">${b.lot} (目前庫存: ${b.qty}, 效期: ${b.exp})</option>`;
        });
    }
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editBatchModal')).show();
};

window.confirmEditBatch = function() {
    const idx = parseInt(document.getElementById('eb_logRowIdx').value);
    const itemName = document.getElementById('eb_itemName').value;
    const changeQty = parseFloat(document.getElementById('eb_changeQty').value);
    const oldLot = document.getElementById('eb_oldLot').value;

    const select = document.getElementById('eb_newBatchSelect');
    const newLot = select.value;
    const newExp = select.selectedIndex > 0 ? select.options[select.selectedIndex].getAttribute('data-exp') : '';

    if (oldLot === newLot) return alert("新舊批號相同，無需修改。");

    const payload = {
        logRowIdx: idx, name: itemName, changeQty: changeQty,
        oldLot: oldLot, newLot: newLot, newExp: newExp
    };
    pushToSyncQueue('editInvLogBatch', payload, null);

    const l = globalInvLogs.find(x => x.rowIdx === idx);
    if (l) {
        l.lot = newLot;
        l.memo += `\n[批號已由 ${oldLot||'不分批'} 改為 ${newLot||'不分批'}]`;
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('editBatchModal')).hide();
    showToast("🔄 批號修改完成，系統將自動返還並重新扣除指定庫存。");
    window.renderInvLogs();
};

// ============================================================================
// 庫存進貨/盤點 (Adjust)
// ============================================================================
window.openAdjustModal = function(nameStr) {
    document.getElementById('adjInvoiceNo').value = ''; 
    document.getElementById('adjArrivalDate').value = getTodayStr(); 
    
    if(nameStr) { 
        const v = globalInventory.find(x => x.name === nameStr); 
        document.getElementById('adjRowIdx').value = v.rowIdx; 
        document.getElementById('adjName').value = v.name; 
        document.getElementById('adjName').onclick = null; 
        document.getElementById('adjName').classList.remove('fake-input-btn'); 
        document.getElementById('adjInternalCode').value = v.internalCode || ''; 
        document.getElementById('adjAlert').value = v.alertQty; 
        document.getElementById('adjCost').value = v.cost; 
        document.getElementById('adjSup').value = v.supplier || ''; 
    } else { 
        document.getElementById('adjRowIdx').value = ''; 
        document.getElementById('adjName').value = ''; 
        document.getElementById('adjName').onclick = () => openSearchModal('item_adj', selectProductForAdj); 
        document.getElementById('adjName').classList.add('fake-input-btn'); 
        document.getElementById('adjInternalCode').value = ''; 
        document.getElementById('adjAlert').value = '10'; 
        document.getElementById('adjCost').value = '0'; 
        document.getElementById('adjSup').value = ''; 
    }
    document.getElementById('adjQty').value = ''; 
    document.getElementById('adjLot').value = ''; 
    document.getElementById('adjExp').value = ''; 
    document.getElementById('adjMemo').value = ''; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adjInvModal')).show();
};

window.selectProductForAdj = function(val) { 
    document.getElementById('adjName').value = val; 
    const p = globalCatalog.find(x => x.productName === val); 
    if(p) {
        let intCode = p.internalCode || p.assetCode || '';
        document.getElementById('adjInternalCode').value = intCode;
        if (intCode) {
            const parts = intCode.split('-');
            if (parts.length > 1) {
                const supCodeMatch = parts[1];
                const s = globalSuppliers.find(x => x.code === supCodeMatch);
                if (s) document.getElementById('adjSup').value = s.name || '';
            }
        }
    } 
    
    const existingInv = globalInventory.find(x => x.name === val);
    if (existingInv) {
        document.getElementById('adjRowIdx').value = existingInv.rowIdx;
        document.getElementById('adjAlert').value = existingInv.alertQty || 0;
        document.getElementById('adjCost').value = existingInv.cost || 0;
        if (existingInv.supplier) document.getElementById('adjSup').value = existingInv.supplier;
    } else {
        document.getElementById('adjRowIdx').value = '';
    }
};

window.saveInventoryAdjust = function() {
    const idx = document.getElementById('adjRowIdx').value; 
    const name = document.getElementById('adjName').value.trim(); 
    const internalCode = document.getElementById('adjInternalCode').value.trim(); 
    const changeQty = parseFloat(document.getElementById('adjQty').value); 
    const alertQty = parseFloat(document.getElementById('adjAlert').value) || 0; 
    const cost = parseFloat(document.getElementById('adjCost').value) || 0; 
    const sup = document.getElementById('adjSup').value.trim(); 
    const lot = document.getElementById('adjLot').value.trim(); 
    const exp = document.getElementById('adjExp').value; 
    const type = document.getElementById('adjType').value; 
    const memo = document.getElementById('adjMemo').value.trim();
    const invoiceNo = document.getElementById('adjInvoiceNo').value.trim(); 
    const arrivalDate = document.getElementById('adjArrivalDate').value;
    
    if(!name || isNaN(changeQty) || changeQty === 0) return alert("請選定品名並輸入非零異動數量");
    
    const payload = { 
        name: name, internalCode: internalCode, changeQty: changeQty, alertQty: alertQty, 
        cost: cost, supplier: sup, lot: lot, expiry: exp, type: type, memo: memo, 
        invoiceNo: invoiceNo, arrivalDate: arrivalDate, staff: myName 
    };

    let currentNewQty = changeQty;

    if(idx) { 
        const v = globalInventory.find(x => x.rowIdx === parseInt(idx)); 
        if(v) { 
            v.qty += changeQty; 
            currentNewQty = v.qty; 
            v.alertQty = alertQty; v.cost = cost; v.supplier = sup; 
            if(internalCode) v.internalCode = internalCode; 
            
            let batches = window.parseBatchesSafely(v.batchesStr, v.qty);
            if (lot || exp) {
                let bIdx = batches.findIndex(b => b.lot === lot && b.exp === exp);
                if (bIdx >= 0) batches[bIdx].qty += changeQty;
                else batches.push({ lot: lot, exp: exp, qty: changeQty });
            }
            v.batchesStr = JSON.stringify(batches);
        } 
    } else { 
        let newBatches = [];
        if (lot || exp) newBatches.push({ lot: lot, exp: exp, qty: changeQty });
        globalInventory.push({
            rowIdx: Date.now(), name: name, internalCode: internalCode, qty: changeQty, 
            alertQty: alertQty, cost: cost, supplier: sup, batchesStr: JSON.stringify(newBatches)
        }); 
    }
    
    globalInvLogs.unshift({
        time: Date.now(), staff: myName, name: name, type: type, qtyChange: changeQty, 
        newQty: currentNewQty, 
        lot: lot, invoiceNo: invoiceNo, arrivalDate: arrivalDate, memo: memo
    });
    
    if(typeof window.populateLogDropdowns === 'function') window.populateLogDropdowns(); 
    window.renderInventory(); 
    window.renderInvLogs(); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adjInvModal')).hide(); 
    pushToSyncQueue('adjustInventory', payload, null);
};

// ============================================================================
// 欠貨出貨與批號連動選擇 (Shipment)
// ============================================================================
let lastPendingShipmentCount = -1;

window.updateShipmentDropdowns = function(pendingArr) {
    const clients = [...new Set(pendingArr.map(s => s.client).filter(x => x))].sort();
    const names = [...new Set(pendingArr.map(s => s.name).filter(x => x))].sort();

    const clientSelect = document.getElementById('stkShipFilterClient');
    if (clientSelect) {
        const currentClient = clientSelect.value;
        clientSelect.innerHTML = '<option value="">🏢 所有客戶</option>' + clients.map(c => `<option value="${escapeQuotes(c)}">${c}</option>`).join('');
        if (clients.includes(currentClient)) clientSelect.value = currentClient;
    }

    const nameSelect = document.getElementById('stkShipFilterName');
    if (nameSelect) {
        const currentName = nameSelect.value;
        nameSelect.innerHTML = '<option value="">📦 所有品名</option>' + names.map(n => `<option value="${escapeQuotes(n)}">${n}</option>`).join('');
        if (names.includes(currentName)) nameSelect.value = currentName;
    }
};

window.renderShipments = debounce(function() {
    const c = document.getElementById('stkShipContainer'); 
    const pendingAll = globalSalesDetails.filter(s => s.shipStatus !== '已結案' && s.shipStatus !== '作廢');
    
    // 【雙層篩選器動態載入】只要未結案項目總數有變動，就重新整理一次下拉選單
    if (pendingAll.length !== lastPendingShipmentCount) {
        window.updateShipmentDropdowns(pendingAll);
        lastPendingShipmentCount = pendingAll.length;
    }

    const term = (document.getElementById('stkShipSearch').value || '').toLowerCase();
    const fClient = document.getElementById('stkShipFilterClient').value;
    const fName = document.getElementById('stkShipFilterName').value;

    let filtered = pendingAll;

    if (fClient) filtered = filtered.filter(s => s.client === fClient);
    if (fName) filtered = filtered.filter(s => s.name === fName);
    if (term) {
        filtered = filtered.filter(s => 
            (s.client || '').toLowerCase().includes(term) ||
            (s.name || '').toLowerCase().includes(term) ||
            (s.paperNo || '').toLowerCase().includes(term) ||
            (s.orderNo || '').toLowerCase().includes(term)
        );
    }
    
    if(filtered.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">✅ 無符合條件的欠貨項目</div>';
    
    c.innerHTML = filtered.map(s => {
        let remain = s.qty - s.shippedQty;
        return `<div class="item-row bg-white shadow-sm mb-2">
            <div class="d-flex justify-content-between mb-2">
                <div><div class="fw-bold text-dark fs-6">${s.name}</div><div class="small text-muted mt-1">${s.client} | 發票: ${s.paperNo}</div></div>
                <div>
                    <button class="btn btn-sm btn-outline-warning text-dark fw-bold me-1" onclick="openPurchaseOrderModal(${s.rowIdx})">🛒 訂貨</button>
                    <button class="btn btn-sm btn-primary fw-bold" onclick="openShipModal(${s.rowIdx})">📦 出貨</button>
                </div>
            </div>
            <div class="d-flex gap-3 small"><span class="text-secondary">總訂購: ${s.qty}</span><span class="text-success">已出: ${s.shippedQty}</span><span class="text-danger fw-bold">欠貨: ${remain}</span></div>
        </div>`;
    }).join('');
}, 300);

window.openShipModal = function(rowIdx) {
    const s = globalSalesDetails.find(x => x.rowIdx === rowIdx); if(!s) return;
    document.getElementById('shipRowIdx').value = rowIdx; 
    document.getElementById('shipItemName').innerText = s.name; 
    document.getElementById('shipTotalQty').innerText = s.qty; 
    document.getElementById('shipDoneQty').innerText = s.shippedQty;
    const remain = s.qty - s.shippedQty; 
    document.getElementById('shipRemainQty').innerText = remain; 
    document.getElementById('shipNowQty').value = remain; 
    document.getElementById('shipNowQty').max = remain;

    const inv = globalInventory.find(x => x.name === s.name);
    const batchSelect = document.getElementById('shipBatchSelect');
    batchSelect.innerHTML = '';
    if (inv && inv.batchesStr) {
        let batches = window.parseBatchesSafely(inv.batchesStr, inv.qty);
        if (batches.length > 0) {
            batchSelect.innerHTML = '<option value="">不指定批號 (自動扣減總庫存)</option>' +
                batches.map(b => `<option value="${escapeQuotes(b.lot)}" data-exp="${escapeQuotes(b.exp)}" data-qty="${b.qty}">${b.lot} (庫存: ${b.qty})</option>`).join('');
        } else {
            batchSelect.innerHTML = '<option value="">此商品無批號紀錄 (將扣減總庫存)</option>';
        }
    } else {
        batchSelect.innerHTML = '<option value="">此商品無庫存紀錄 (將扣抵負數總庫存)</option>';
    }
    
    window.updateShipBatchInfo();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipModal')).show();
};

window.updateShipBatchInfo = function() {
    const select = document.getElementById('shipBatchSelect');
    const expEl = document.getElementById('shipBatchExp');
    const stockEl = document.getElementById('shipBatchStock');
    if (select.selectedIndex > 0) {
        const opt = select.options[select.selectedIndex];
        expEl.innerText = opt.getAttribute('data-exp') || '無效期紀錄';
        stockEl.innerText = opt.getAttribute('data-qty') || '0';
    } else {
        expEl.innerText = '--';
        stockEl.innerText = '--';
    }
};

window.confirmShipment = function() {
    const rowIdx = parseInt(document.getElementById('shipRowIdx').value); 
    const qty = parseFloat(document.getElementById('shipNowQty').value);
    const batchTarget = document.getElementById('shipBatchSelect').value;
    
    if(isNaN(qty) || qty <= 0) return alert("數量錯誤"); 
    const s = globalSalesDetails.find(x => x.rowIdx === rowIdx); if(!s) return; 
    if(qty > (s.qty - s.shippedQty)) return alert("出貨量不可大於欠貨量");
    
    s.shippedQty += qty; 
    if(s.shippedQty >= s.qty) s.shipStatus = '已結案'; else s.shipStatus = '部分出貨';
    
    let inv = globalInventory.find(x => x.name === s.name); 
    if (inv) {
        inv.qty -= qty;
        if (batchTarget) {
            let batches = window.parseBatchesSafely(inv.batchesStr, inv.qty + qty);
            let bIdx = batches.findIndex(b => b.lot === batchTarget);
            if (bIdx >= 0) {
                batches[bIdx].qty -= qty;
            }
            inv.batchesStr = JSON.stringify(batches.filter(b => b.qty > 0));
        }
    } else {
        globalInventory.push({rowIdx:0, name: s.name, qty: -qty, alertQty: 0, cost: 0, supplier: '', internalCode: '', batchesStr: '[]'});
    }
    
    let currentInvQty = inv ? inv.qty : -qty; 
    globalInvLogs.unshift({ 
        time: Date.now(), staff: myName, name: s.name, type: '分批出貨', 
        qtyChange: -qty, newQty: currentInvQty, lot: batchTarget, 
        orderNo: s.paperNo, memo: `單號: ${s.paperNo} ${batchTarget ? '(指定出貨批號:'+batchTarget+')' : ''}` 
    });
    
    if(typeof window.populateLogDropdowns === 'function') window.populateLogDropdowns(); 
    window.renderInvLogs(); window.renderInventory(); window.renderShipments(); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('shipModal')).hide(); 
    
    pushToSyncQueue('updateShipment', {
        updates: [{rowIdx: rowIdx, paperNo: s.paperNo, client: s.client, name: s.name, shipQty: qty, totalQty: s.qty, batchTarget: batchTarget}], 
        staff: myName
    }, null); 
    
    showToast("🚚 出貨與庫存扣抵完成，已自動排程至送貨追蹤表單");
};

// ============================================================================
// 向廠商訂貨 (PO)
// ============================================================================
window.triggerPoClientChange = function(clientName) {
    const cObj = globalClients.find(x => x.name === clientName);
    document.getElementById('poAddress').value = cObj ? (cObj.address || '') : '';
    
    const deptSelect = document.getElementById('poReceiveDept');
    deptSelect.innerHTML = '';
    if (cObj && cObj.receiveDept) {
        const depts = cObj.receiveDept.split(/[,，\n]+/).map(str => str.trim()).filter(x => x);
        if (depts.length > 0) {
            deptSelect.innerHTML = depts.map(d => `<option value="${d}">${d}</option>`).join('');
        } else {
            deptSelect.innerHTML = `<option value="">無資料</option>`;
        }
    } else {
        deptSelect.innerHTML = `<option value="">無資料</option>`;
    }
};

window.openPurchaseOrderModal = function(salesRowIdx) {
    const s = globalSalesDetails.find(x => x.rowIdx === salesRowIdx); if(!s) return;
    
    document.getElementById('poDate').value = getTodayStr();
    document.getElementById('poSupplier').value = '';
    document.getElementById('poSupPhone').value = '';
    document.getElementById('poSupFax').value = '';
    document.getElementById('poMemo').value = '';
    document.getElementById('poItemName').value = s.name;
    document.getElementById('poOrderNo').value = s.orderNo || '';
    
    const remainQty = s.qty - s.shippedQty;
    document.getElementById('poQty').value = remainQty;

    const p = globalCatalog.find(x => x.clientName === s.client && x.productName === s.name);
    let intCode = '';
    if (p) {
        intCode = p.internalCode || p.assetCode || '';
        document.getElementById('poInternalCode').value = intCode;
        
        let inv = globalInventory.find(x => x.name === s.name);
        document.getElementById('poUnitPrice').value = inv ? (inv.cost || 0) : 0;

        if (intCode) {
            const parts = intCode.split('-');
            if (parts.length > 1) {
                const supCodeMatch = parts[1];
                const supplier = globalSuppliers.find(x => x.code === supCodeMatch);
                if (supplier) {
                    document.getElementById('poSupplier').value = supplier.name || '';
                    document.getElementById('poSupPhone').value = supplier.phone || '';
                    document.getElementById('poSupFax').value = supplier.fax || '';
                }
            }
        }
    }

    let poClientEl = document.getElementById('poClientName');
    if (poClientEl.tagName.toLowerCase() !== 'select') {
        let newSelect = document.createElement('select');
        newSelect.id = 'poClientName';
        newSelect.className = (poClientEl.className || '').replace('form-control', 'form-select');
        if (!newSelect.className.includes('form-select')) newSelect.className += ' form-select';
        newSelect.onchange = function() { window.triggerPoClientChange(this.value); };
        poClientEl.parentNode.replaceChild(newSelect, poClientEl);
        poClientEl = newSelect;
    }
    
    poClientEl.innerHTML = '<option value="">請選擇客戶...</option>' + globalClients.map(c => `<option value="${escapeQuotes(c.name)}">${c.name}</option>`).join('');
    poClientEl.value = s.client;
    window.triggerPoClientChange(s.client);

    bootstrap.Modal.getOrCreateInstance(document.getElementById('purchaseOrderModal')).show();
};

window.confirmPurchaseOrder = function() {
    const qty = parseFloat(document.getElementById('poQty').value);
    if (isNaN(qty) || qty <= 0) return alert("請輸入正確的訂貨數量！");
    
    const snapData = {
        poDate: document.getElementById('poDate').value,
        poOrderNo: document.getElementById('poOrderNo').value,
        poSupplier: document.getElementById('poSupplier').value,
        poSupPhone: document.getElementById('poSupPhone').value,
        poSupFax: document.getElementById('poSupFax').value,
        poItemName: document.getElementById('poItemName').value,
        poInternalCode: document.getElementById('poInternalCode').value,
        poUnitPrice: document.getElementById('poUnitPrice').value,
        poClientName: document.getElementById('poClientName').value, 
        poReceiveDept: document.getElementById('poReceiveDept').value,
        poAddress: document.getElementById('poAddress').value,
        poQty: qty,
        poMemo: document.getElementById('poMemo').value
    };

    const payload = {
        name: snapData.poItemName,
        staff: myName,
        orderNo: snapData.poOrderNo,
        orderDate: snapData.poDate,
        memo: snapData.poMemo,
        snapshot: JSON.stringify(snapData) 
    };

    let inv = globalInventory.find(x => x.name === snapData.poItemName);
    let currentQty = inv ? inv.qty : 0;
    globalInvLogs.unshift({
        rowIdx: Date.now(), 
        time: Date.now(), 
        staff: myName, 
        name: snapData.poItemName, 
        type: '向廠商訂貨', 
        qtyChange: 0, 
        newQty: currentQty, 
        orderNo: snapData.poOrderNo,
        arrivalDate: snapData.poDate, 
        memo: snapData.poMemo,
        snapshot: payload.snapshot
    });

    pushToSyncQueue('submitPurchaseOrder', payload, null);
    window.renderInvLogs();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('purchaseOrderModal')).hide();
    
    showToast("🛒 訂貨單已記錄！即將列印...");
    setTimeout(() => { window.printPurchaseOrder(snapData); }, 500);
};

window.reprintPurchaseOrderFast = function(idx) {
    const l = globalInvLogs.find(x => x.rowIdx === idx);
    if (!l || !l.snapshot) return alert("無快照可列印！");
    try {
        const snapData = JSON.parse(l.snapshot);
        window.printPurchaseOrder(snapData);
    } catch(e) {
        alert("快照資料解析失敗");
    }
};

window.printPurchaseOrder = function(data) {
    const totalAmount = parseFloat(data.poQty) * parseFloat(data.poUnitPrice || 0);
    const dateStr = data.poDate ? data.poDate.replace(/-/g, '/') : getTodayStr().replace(/-/g, '/');

    const html = `
        <div style="max-width: 800px; margin: 0 auto; background: #fff; padding: 15mm 20mm; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000;">
            <div style="text-align: center; font-size: 26px; font-weight: 900; letter-spacing: 5px; margin-bottom: 10px; color: #000;">長固實業有限公司 - 訂貨單</div>
            
            <table style="width: 100%; border: none; margin-bottom: 15px; font-size: 14px; color: #000;">
                <tr>
                    <td style="width: 50%; vertical-align: top;">
                        <div style="font-weight: bold; font-size: 16px;">TO: ${escapeQuotes(data.poSupplier)}</div>
                        <div style="margin-top: 5px;">電話: ${escapeQuotes(data.poSupPhone)}</div>
                        <div>傳真: ${escapeQuotes(data.poSupFax)}</div>
                        <div style="margin-top: 15px; color: #000; font-size: 18px; font-weight: bold;">客戶: ${escapeQuotes(data.poClientName)}</div>
                        <div style="margin-top: 5px; font-weight: bold; font-size: 15px; color: #d32f2f;">訂單號碼: ${escapeQuotes(data.poOrderNo || '無')}</div>
                    </td>
                    <td style="width: 50%; vertical-align: top; text-align: right; line-height: 1.6;">
                        <div style="font-weight: bold;">訂貨日期: ${dateStr}</div>
                        <div style="margin-top: 5px;">統一編號: 86477073</div>
                        <div>公司地址: 台中市西區中美街639號</div>
                        <div>發票地址: 新北市三重區重新路5段609巷6號4樓</div>
                        <div>電話: (04)23269591 &nbsp; FAX: (04)23268576</div>
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 15px; color: #000;">
                <thead>
                    <tr style="background-color: #f8f9fa;">
                        <th style="border: 2px solid #000; padding: 10px; text-align: left;">長固代號 / 品名</th>
                        <th style="border: 2px solid #000; padding: 10px; width: 80px; text-align: center;">數量</th>
                        <th style="border: 2px solid #000; padding: 10px; width: 100px; text-align: right;">單價</th>
                        <th style="border: 2px solid #000; padding: 10px; width: 120px; text-align: right;">總計</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid #000; padding: 15px 10px; text-align: left;">
                            <div style="font-weight: bold; margin-bottom: 5px;">${escapeQuotes(data.poInternalCode)}</div>
                            <div>${escapeQuotes(data.poItemName)}</div>
                        </td>
                        <td style="border: 1px solid #000; padding: 15px 10px; text-align: center; font-size: 18px; font-weight: bold;">${data.poQty}</td>
                        <td style="border: 1px solid #000; padding: 15px 10px; text-align: right;">${Number(data.poUnitPrice).toLocaleString()}</td>
                        <td style="border: 1px solid #000; padding: 15px 10px; text-align: right; font-weight: bold;">${totalAmount.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="margin-top: 15px; font-size: 14px; border: 1px solid #000; padding: 10px; background-color: #fcfcfc; color: #000;">
                <div style="margin-bottom: 5px;"><strong>📍 送貨地點：</strong>${escapeQuotes(data.poAddress)}</div>
                <div style="margin-bottom: 5px;"><strong>📦 收貨單位：</strong>${escapeQuotes(data.poReceiveDept)}</div>
                <div><strong>📝 備註事項：</strong>${escapeQuotes(data.poMemo)}</div>
            </div>
        </div>
    `;

    const printPoArea = document.getElementById('printPoArea');
    if (printPoArea) {
        printPoArea.innerHTML = html;
        if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A5', 'landscape');
        if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printPoArea');
    }
};

// ============================================================================
// 管理員後台 (Admin) 模組
// ============================================================================
window.openSearchModal = function(type, callback) {
    currentSearchCallback = callback; 
    document.getElementById('searchModalList').innerHTML = ''; 
    document.getElementById('searchModalInput').value = '';
    
    if(type === 'client' || type === 'admin_client' || type === 'client_ord' || type === 'client_quo') { 
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
        else if(type.startsWith('item_quo_')) clientName = document.getElementById('e_quoClient').value; 
        else clientName = document.getElementById('invClientInput').value; 
        
        if(!clientName) { alert('請先選擇客戶！'); return; } 
        currentSearchSource = globalCatalog.filter(p => p.clientName === clientName).map((p, idx) => ({ text: p.productName, sub: `單價: $${p.price} / ${p.unit}`, val: p.productName, idx: idx, ref: p })); 
    }
    
    window.renderSearchList(currentSearchSource); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('searchModal')).show(); 
    setTimeout(()=> document.getElementById('searchModalInput').focus(), 500);
};

window.filterSearchModal = debounce(function() { 
    const term = (document.getElementById('searchModalInput').value || '').toLowerCase(); 
    window.renderSearchList(currentSearchSource.filter(s => (s.text||'').toLowerCase().includes(term) || ((s.sub||'').toLowerCase().includes(term)))); 
}, 300);

window.renderSearchList = function(arr) { 
    document.getElementById('searchModalList').innerHTML = arr.map(item => `<button class="search-btn-item" onclick="onSearchSelect('${escapeQuotes(item.val)}')"><div class="d-flex justify-content-between align-items-center"><span>${item.text}</span><span class="badge bg-secondary">${item.sub}</span></div></button>`).join(''); 
};

window.onSearchSelect = function(val) { 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('searchModal')).hide(); 
    if(currentSearchCallback) currentSearchCallback(val); 
};

window.populateAdminClientFilter = function() { 
    if(document.getElementById('admItemFilterSelect')) {
        document.getElementById('admItemFilterSelect').innerHTML = '<option value="">📂 所有客戶 (顯示全部)</option>' + globalClients.map(c => `<option value="${escapeQuotes(c.name||'')}">${c.name||''}</option>`).join(''); 
    }
};

window.renderAdminClients = debounce(function() { 
    const term = (document.getElementById('admClientSearch').value || '').toLowerCase(); 
    let arr = globalClients;
    if(term) {
        arr = arr.filter(c => (c.name||'').toLowerCase().includes(term) || String(c.taxId||'').includes(term));
    }
    
    document.getElementById('admClientList').innerHTML = arr.map(c => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6">${c.name}</div><div class="small text-muted mt-1">統編: ${c.taxId||'無'}</div></div><button class="btn btn-outline-danger btn-sm fw-bold px-3" onclick="openEditClientModal('${escapeQuotes(c.name)}', '${escapeQuotes(c.taxId)}')">📝 編輯</button></div>`).join(''); 
}, 300);

window.openNewClientModal = function() { 
    document.getElementById('addClientName').value = ''; 
    document.getElementById('addClientTaxId').value = ''; 
    document.getElementById('addClientAddress').value = ''; 
    document.getElementById('addClientReceiveDept').value = ''; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).show(); 
};

window.submitNewClientOptimistic = function() { 
    const name = document.getElementById('addClientName').value.trim(); 
    const taxId = document.getElementById('addClientTaxId').value.trim(); 
    const address = document.getElementById('addClientAddress').value.trim(); 
    const receiveDept = document.getElementById('addClientReceiveDept').value.trim(); 
    if(!name) return alert('名稱必填'); 
    
    globalClients.push({ name, taxId, address, receiveDept }); 
    if(typeof window.populateAdminClientFilter === 'function') window.populateAdminClientFilter(); 
    window.renderAdminClients(); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addClientModal')).hide(); 
    pushToSyncQueue('addClientData', {clientName: name, taxId, address, receiveDept}, null); 
};

window.openEditClientModal = function(name, taxId) { 
    const c = globalClients.find(x => x.name === name);
    document.getElementById('editClientOldName').value = name; 
    document.getElementById('editClientName').value = name; 
    document.getElementById('editClientTaxId').value = taxId; 
    document.getElementById('editClientAddress').value = c ? (c.address || '') : '';
    document.getElementById('editClientReceiveDept').value = c ? (c.receiveDept || '') : '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editClientModal')).show(); 
};

window.submitEditClientOptimistic = function() { 
    const old = document.getElementById('editClientOldName').value; 
    const name = document.getElementById('editClientName').value.trim(); 
    const tax = document.getElementById('editClientTaxId').value.trim(); 
    const address = document.getElementById('editClientAddress').value.trim(); 
    const receiveDept = document.getElementById('editClientReceiveDept').value.trim(); 
    if(!name) return; 
    
    const c = globalClients.find(x => x.name === old); 
    if(c) { c.name = name; c.taxId = tax; c.address = address; c.receiveDept = receiveDept; } 
    globalCatalog.forEach(p => { if(p.clientName === old) p.clientName = name; }); 
    
    if(typeof window.populateAdminClientFilter === 'function') window.populateAdminClientFilter(); 
    window.renderAdminClients(); window.renderAdminItems(); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editClientModal')).hide(); 
    pushToSyncQueue('updateClientData', {oldName: old, newName: name, newTaxId: tax, address, receiveDept}, null); 
};

window.renderAdminItems = debounce(function() { 
    const f = document.getElementById('admItemFilterSelect').value; 
    const t = (document.getElementById('admItemSearch').value || '').toLowerCase(); 
    let arr = globalCatalog; 
    
    if(f) arr = arr.filter(p => p.clientName === f); 
    if(t) arr = arr.filter(p => (p.productName||'').toLowerCase().includes(t) || (p.clientName||'').toLowerCase().includes(t)); 
    
    document.getElementById('admItemList').innerHTML = arr.length ? arr.map(p => `<div class="item-row bg-white d-flex justify-content-between align-items-center shadow-sm"><div><div class="fw-bold text-dark fs-6 mb-2">${p.productName} <span class="badge bg-secondary ms-1">${p.internalCode||''}</span></div><div class="d-flex align-items-center"><span class="badge bg-light text-dark border me-2 align-self-center">${p.clientName}</span><div class="bg-success text-white px-2 py-1 rounded shadow-sm d-inline-block"><span class="fw-bold">NT$ ${p.price}</span></div><span class="text-muted small fw-bold ms-1">/ ${p.unit}</span></div></div><button class="btn btn-outline-primary btn-sm fw-bold px-3 ms-2" onclick="openAdminItemModal(${p.rowIndex})">📝</button></div>`).join('') : '<div class="text-center text-muted py-4">查無對應品項</div>'; 
}, 300);

window.openAdminItemModal = function(idx) { 
    const m = document.getElementById('editItemModal'); 
    const ipt = document.getElementById('editItemClientDisplay'); 
    if(idx) { 
        const p = globalCatalog.find(x => x.rowIndex === idx); 
        document.getElementById('editItemRowIndex').value = idx; 
        ipt.value = p.clientName; 
        document.getElementById('editItemClientVal').value = p.clientName; 
        ipt.onclick = null; ipt.classList.remove('fake-input-btn'); 
        document.getElementById('editItemName').value = p.productName; 
        document.getElementById('editItemInternalCode').value = p.internalCode || ''; 
        document.getElementById('editItemUnit').value = p.unit; 
        document.getElementById('editItemPrice').value = p.price; 
    } else { 
        document.getElementById('editItemRowIndex').value = ''; 
        ipt.value = ''; ipt.onclick = triggerItemClientSelect; ipt.classList.add('fake-input-btn'); 
        document.getElementById('editItemName').value = ''; 
        document.getElementById('editItemInternalCode').value = ''; 
        document.getElementById('editItemUnit').value = '式'; 
        document.getElementById('editItemPrice').value = ''; 
    } 
    bootstrap.Modal.getOrCreateInstance(m).show(); 
};

window.triggerItemClientSelect = function() { 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).hide(); 
    window.openSearchModal('admin_client', (val) => { 
        document.getElementById('editItemClientDisplay').value = val; 
        document.getElementById('editItemClientVal').value = val; 
        setTimeout(()=> bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).show(), 400); 
    }); 
};

window.submitEditItemOptimistic = function() { 
    const idx = document.getElementById('editItemRowIndex').value; 
    const client = document.getElementById('editItemClientVal').value; 
    const name = document.getElementById('editItemName').value.trim(); 
    const internalCode = document.getElementById('editItemInternalCode').value.trim(); 
    const unit = document.getElementById('editItemUnit').value.trim(); 
    const price = document.getElementById('editItemPrice').value; 
    
    if(!client || !name || !price) return alert('必填未填'); 
    
    const payload = { 
        rowIndex: idx ? parseInt(idx) : null, 
        clientName: client, 
        productName: name, 
        internalCode: internalCode, 
        unit: unit, 
        price: Number(price) 
    }; 
    
    if(idx) { 
        const p = globalCatalog.find(x => x.rowIndex === payload.rowIndex); 
        if(p) Object.assign(p, payload); 
    } else { 
        globalCatalog.push({ 
            rowIndex: Date.now(), 
            clientName: client, 
            productName: name, 
            internalCode: internalCode, 
            unit: unit, 
            price: Number(price) 
        }); 
    } 
    
    window.renderAdminItems(); 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editItemModal')).hide(); 
    
    pushToSyncQueue('saveAdminItem', payload, null); 
};
