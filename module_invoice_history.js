/**
 * ============================================================================
 * 模組 3：開立發票、歷史紀錄與報表 + 跨系統報表智慧勾稽比對中心 (module_invoice_history.js)
 * 【防連點、強健比對、三聯發票單價修正 ＆ 跨系統 AI 報表比對旗艦版】
 * ============================================================================
 */

// ============================================================================
// 發票模組 - 步驟與選項控制
// ============================================================================
window.goStep = function(s) { 
    document.querySelectorAll('#sys-invoice .step-card').forEach(c => c.style.display = 'none'); 
    document.getElementById('invStep'+s).style.display = 'block'; 
    document.getElementById('mainApp').scrollTo(0,0); 
};

window.selectClientForInvoice = function(name) { 
    const c = globalClients.find(x => x.name === name); 
    if(!c) return; 
    document.getElementById('invClientInput').value = name; 
    currentInvoiceData.clientName = name; 
    currentInvoiceData.taxId = c.taxId; 
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${c.taxId||'無'})`; 
    document.getElementById('invClientInfo').style.display = 'block'; 
    document.getElementById('btnNext1').style.display = 'block'; 
    document.getElementById('invOrderNo').value = ''; 
    selectedOrderCache = []; 
    document.getElementById('invAiNotice').style.display = 'none'; 
};

window.borrowInvoiceNo = function() { 
    const tempNo = "[借用中]-" + Math.floor(Math.random() * 10000000); 
    document.getElementById('invPaperNo').value = tempNo; 
    showToast("✅ 已帶入借用單號，請繼續開立，日後可至紀錄補登"); 
};

// ============================================================================
// 發票模組 - 品項拖曳與渲染
// ============================================================================
window.renderSingleInvoiceItem = function(item) {
    let isMatch = item.product ? true : false;
    let price = item.product ? item.product.price : 0;
    let unit = item.product ? item.product.unit : '式';
    let name = item.product ? item.product.productName : '';
    
    let orderRefStr = item.orderRef || '';
    let deptRefStr = item.deptRef || '';
    let combinedRef = (orderRefStr + ' ' + deptRefStr).trim();

    return `<div class="item-row border-primary draggable-row" id="${item.id}" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'invoice')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${item.id}', 'invoice')" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">
        <div class="drag-handle position-absolute" style="top:10px; left:10px; cursor:grab; font-size: 1.2rem; color: #adb5bd;" title="按住拖曳排序">☰</div>
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:10px; right:10px;" onclick="removeInvItem('${item.id}')">✕</button>
        <div class="ps-4">
            <label class="form-label text-primary fw-bold small">${isMatch ? '✅ 已對應價表' : '⚠️ 價格或品項待確'}</label>
            <input type="text" class="form-control fake-input-btn mb-2" id="prodInput_${item.id}" value="${escapeQuotes(name)}" readonly placeholder="點此選擇品項..." onclick="openSearchModal('item_${item.id}', (val)=>selectProductForInv('${item.id}', val))">
            <div id="prodInfo_${item.id}" class="small text-muted mb-2 px-1">${isMatch ? `單價: $${price} | 單位: ${unit}` : ''}</div>
            <div class="row g-2">
                <div class="col-6"><label class="form-label fw-bold small">本次開立數量 (可修改)</label><input type="number" class="form-control" id="qty_${item.id}" value="${item.qty}" min="0" step="any" oninput="updateInvQty('${item.id}', this.value)"></div>
                <div class="col-6"><label class="form-label fw-bold small">歸屬訂單 / 單位</label><input type="text" class="form-control bg-light text-secondary" value="${escapeQuotes(combinedRef)}" readonly></div>
            </div>
        </div>
    </div>`;
};

window.reRenderInvoiceItems = function() {
    document.getElementById('invItemsContainer').innerHTML = currentInvoiceData.items.map(renderSingleInvoiceItem).join('');
    updateInvAddBtn();
};

window.addInvoiceItemRow = function() { 
    const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`; 
    currentInvoiceData.items.push({ id: rowId, product: null, qty: 1, orderRef: '', deptRef: '' }); 
    reRenderInvoiceItems();
    setTimeout(() => document.getElementById('mainApp').scrollTo({top: document.getElementById('mainApp').scrollHeight, behavior: 'smooth'}), 100); 
};

window.selectProductForInv = function(rowId, prodName) { 
    const p = window.findProductRobust ? window.findProductRobust(currentInvoiceData.clientName, null, prodName) : globalCatalog.find(x => x.clientName === currentInvoiceData.clientName && x.productName === prodName); 
    if(!p) return; 
    const item = currentInvoiceData.items.find(x => x.id === rowId); 
    if(item) item.product = p; 
    reRenderInvoiceItems(); 
};

window.updateInvQty = function(rowId, qty) { 
    const item = currentInvoiceData.items.find(x => x.id === rowId); 
    if(item) item.qty = Math.max(0, parseFloat(qty) || 0); 
};

window.removeInvItem = function(rowId) { 
    currentInvoiceData.items = currentInvoiceData.items.filter(x => x.id !== rowId); 
    reRenderInvoiceItems(); 
};

window.updateInvAddBtn = function() { 
    document.getElementById('btnAddInvItem').style.display = currentInvoiceData.items.length >= 10 ? 'none' : 'block'; 
};

// ============================================================================
// 發票模組 - 預覽與送出
// ============================================================================
window.generatePreview = function() {
    try {
        const validItems = currentInvoiceData.items.filter(x => x && x.product && parseFloat(x.qty) > 0);
        if(validItems.length === 0) return alert('請完整選擇品項並輸入大於零的數量！');

        let totalWithTax = 0;
        let sumUnTaxedSub = 0;
        let maxUnTaxedIndex = -1;
        let maxUnTaxedValue = -1;

        const orderNoStr = document.getElementById('invOrderNo') ? document.getElementById('invOrderNo').value : ''; 
        const invDateStr = document.getElementById('invDate').value ? document.getElementById('invDate').value : getTodayStr();

        validItems.forEach((item, idx) => { 
            let price = Math.max(0, parseFloat(item.product.price) || 0); 
            let qty = Math.max(0, parseFloat(item.qty) || 0); 
            const sub = price * qty; 
            totalWithTax += sub; 

            let unTaxedSub = Math.round(qty * (price / 1.05));
            item.adjustedUnTaxedSub = unTaxedSub;
            sumUnTaxedSub += unTaxedSub;

            if (unTaxedSub > maxUnTaxedValue) {
                maxUnTaxedValue = unTaxedSub;
                maxUnTaxedIndex = idx;
            }

            let remark = `${item.orderRef ? item.orderRef : (idx === 0 && orderNoStr ? orderNoStr : '')} ${item.deptRef ? item.deptRef : ''}`.trim(); 
            item.formattedRemark = remark; 
        });

        totalWithTax = Math.round(totalWithTax); 
        const netTotal = Math.round(totalWithTax / 1.05); 
        const tax = totalWithTax - netTotal;

        const diff = netTotal - sumUnTaxedSub;
        if (diff !== 0 && maxUnTaxedIndex !== -1) {
            validItems[maxUnTaxedIndex].adjustedUnTaxedSub += diff;
        }

        const prevBody = document.getElementById('prevTableBody'); prevBody.innerHTML = '';
        validItems.forEach((item) => {
            let price = Math.max(0, parseFloat(item.product.price) || 0); 
            let qty = Math.max(0, parseFloat(item.qty) || 0); 
            const sub = price * qty; 
            prevBody.innerHTML += `<tr><td class="text-start">${item.product.productName||'未知'}</td><td>${qty} ${item.product.unit||'式'}</td><td class="text-end">$${price.toFixed(3)}</td><td class="text-end">$${sub.toLocaleString()}</td><td class="text-center small text-secondary">${item.formattedRemark}</td></tr>`; 
        });

        currentInvoiceData.finalNet = netTotal; 
        currentInvoiceData.finalTax = tax; 
        currentInvoiceData.finalTotal = totalWithTax; 
        currentInvoiceData.validItems = validItems; 
        currentInvoiceData.detailsStr = validItems.map(x => `${x.product.productName || ''} x${x.qty} (單價: $${(parseFloat(x.product.price)||0).toFixed(3)}) ${x.formattedRemark ? '[' + x.formattedRemark + ']' : ''}`).join('\n');

        setSafeText('prevClientName', currentInvoiceData.clientName || '無'); 
        setSafeText('prevTaxId', currentInvoiceData.taxId || '無'); 
        setSafeText('prevOrderNo', orderNoStr || '無'); 
        setSafeText('prevPaperNo', document.getElementById('invPaperNo') ? document.getElementById('invPaperNo').value.toUpperCase() : '無'); 
        setSafeText('prevInvDate', invDateStr); 
        setSafeText('prevNet', netTotal.toLocaleString()); 
        setSafeText('prevTax', tax.toLocaleString()); 
        setSafeText('prevTotal', totalWithTax.toLocaleString()); 
        
        goStep(4);
    } catch(err) { alert("預覽結算時發生錯誤: " + err.message); }
};

window.submitInvoiceOptimistic = function() {
    const btn = event ? event.currentTarget : null;
    if(window.lockButton(btn)) return; // 防連點保護

    const orderNo = document.getElementById('invOrderNo').value; 
    const paperNo = document.getElementById('invPaperNo').value.toUpperCase(); 
    const invDateVal = document.getElementById('invDate').value; 
    const invDateTimestamp = invDateVal ? new Date(invDateVal).getTime() : Date.now();
    
    const payloadItems = currentInvoiceData.validItems.map(i => ({ 
        name: i.product.productName, internalCode: i.product.internalCode || i.product.assetCode || "", 
        qty: i.qty, unit: i.product.unit, price: i.product.price, subtotal: Math.round(i.qty * i.product.price) 
    }));
    
    const payload = { 
        invDate: invDateTimestamp, staff: myName, clientName: currentInvoiceData.clientName, 
        taxId: currentInvoiceData.taxId, netTotal: currentInvoiceData.finalNet, 
        tax: currentInvoiceData.finalTax, totalWithTax: currentInvoiceData.finalTotal, 
        detailsStr: currentInvoiceData.detailsStr, paperNo: paperNo, orderNo: orderNo, items: payloadItems 
    };
    
    const newInvRowIdx = Date.now();
    globalHistory.unshift({ 
        rowIdx: newInvRowIdx, time: invDateTimestamp, staff: myName, client: payload.clientName, 
        taxId: payload.taxId, net: payload.netTotal, tax: payload.tax, total: payload.totalWithTax, 
        details: payload.detailsStr, paperNo: payload.paperNo, orderNo: payload.orderNo, status: "正常", historyLog: "[]" 
    });
    
    payloadItems.forEach(pi => { 
        let tempIdx = -Math.floor(Math.random() * 1000000); 
        globalSalesDetails.unshift({ 
            rowIdx: tempIdx, time: invDateTimestamp, paperNo: paperNo, client: payload.clientName, 
            orderNo: orderNo, name: pi.name, qty: pi.qty, price: pi.price, subtotal: pi.subtotal, 
            shippedQty: 0, shipStatus: '待出貨', lot: '', expiry: ''
        }); 
    });
    
    pushToSyncQueue('submitInvoice', payload, null);
    if (typeof window.renderOrderList === 'function') window.renderOrderList();
    
    setSafeText('visBuyer', payload.clientName); 
    setSafeText('visTaxId', payload.taxId); 
    setSafeText('visPaperNo', paperNo); 
    setSafeText('visInvDate', invDateVal.replace(/-/g, '/')); 
    setSafeText('visNet', payload.netTotal.toLocaleString()); 
    setSafeText('visTax', payload.tax.toLocaleString()); 
    setSafeText('visTotal', payload.totalWithTax.toLocaleString());
    
    const tbody = document.getElementById('visTbody'); tbody.innerHTML = '';
    for(let i=0; i < Math.max(currentInvoiceData.validItems.length, 5); i++) {
        if(i < currentInvoiceData.validItems.length) {
            const item = currentInvoiceData.validItems[i]; 
            // 三聯式統一發票「單價」直接由「未含稅總價 ÷ 數量」計算（如 1010 ÷ 20 = 50.5）
            const unTaxedS = Number(item.adjustedUnTaxedSub) || 0;
            const qtyNum = parseFloat(item.qty) || 1;
            const unTaxedP = Number((unTaxedS / qtyNum).toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
            tbody.innerHTML += `<tr><td class="text-start highlight-data">${item.product.productName}</td><td class="highlight-data">${item.qty} ${item.product.unit}</td><td class="text-end highlight-data">${unTaxedP}</td><td class="text-end highlight-data">${unTaxedS.toLocaleString()}</td><td class="highlight-data" style="font-size:0.8rem;">${item.formattedRemark}</td></tr>`;
        } else { tbody.innerHTML += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>`; }
    }
    goStep(5);
};

window.resetInvoiceSystem = function() { 
    document.getElementById('invDate').value = getTodayStr(); 
    document.getElementById('invClientInput').value=''; 
    document.getElementById('invOrderNo').value=''; 
    document.getElementById('invPaperNo').value=''; 
    document.getElementById('invItemsContainer').innerHTML=''; 
    currentInvoiceData={clientName:'', taxId:'', items:[]}; 
    selectedOrderCache=[]; 
    goStep(1); 
};

// ============================================================================
// 歷史紀錄與報表模組
// ============================================================================
window.updateHistoryDropdowns = function() { 
    const staffs = [...new Set(globalHistory.map(h => h.staff || '').filter(x => x))].sort(); 
    const clients = [...new Set(globalHistory.map(h => h.client || '').filter(x => x))].sort(); 
    if(document.getElementById('histFilterStaff')) {
        document.getElementById('histFilterStaff').innerHTML = '<option value="">👤 員工</option>' + staffs.map(s => `<option value="${escapeQuotes(s)}">${s}</option>`).join(''); 
    }
    if(document.getElementById('histFilterClient')) {
        document.getElementById('histFilterClient').innerHTML = '<option value="">🏢 客戶</option>' + clients.map(c => `<option value="${escapeQuotes(c)}">${c}</option>`).join(''); 
    }
};

window.renderHistory = debounce(function() {
    if (typeof window.initReconcileCenterUI === 'function') window.initReconcileCenterUI();

    const fStaff = document.getElementById('histFilterStaff').value; 
    const fClient = document.getElementById('histFilterClient').value; 
    const fDate = document.getElementById('histFilterDate').value; 
    const fStatus = document.getElementById('histFilterStatus').value; 
    const term = (document.getElementById('histSearch').value || '').toLowerCase();
    
    let filtered = globalHistory;
    if(fStaff) filtered = filtered.filter(h => h.staff === fStaff); 
    if(fClient) filtered = filtered.filter(h => h.client === fClient); 
    if(fStatus) filtered = filtered.filter(h => h.status === fStatus);
    if(fDate) { 
        const target = new Date(fDate).setHours(0,0,0,0); 
        filtered = filtered.filter(h => { const d = new Date(h.time).setHours(0,0,0,0); return d === target; }); 
    }
    
    if(term) {
        filtered = filtered.filter(h => 
            (h.client || '').toLowerCase().includes(term) || 
            String(h.paperNo || '').toLowerCase().includes(term) || 
            (h.details || '').toLowerCase().includes(term)
        );
    }
    
    const c = document.getElementById('histListContainer'); 
    if(filtered.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無紀錄</div>';
    
    c.innerHTML = filtered.map(h => {
        const d = new Date(h.time); 
        const dateStr = isNaN(d.getTime()) ? '未知' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const isVoid = h.status === '作廢'; 
        const isEdited = h.historyLog && h.historyLog.length > 2;
        let badgeHTML = isVoid ? '<span class="badge bg-danger ms-1">已作廢</span>' : '';
        if(isEdited && !isVoid) {
            try { 
                badgeHTML += `<span class="badge bg-warning text-dark ms-1" onclick="alert('修改紀錄：\\n${escapeQuotes(JSON.parse(h.historyLog).join('\\n'))}')" style="cursor:pointer;">⚠️ 已修改</span>`; 
            } catch(e) { 
                badgeHTML += `<span class="badge bg-warning text-dark ms-1">⚠️ 已修改</span>`; 
            }
        }
        
        if(h.orderNo && String(h.orderNo).includes('估價單核銷')) {
            badgeHTML += `<span class="badge bg-primary ms-1">📑 估價單核銷</span>`;
        }

        const isBorrowed = String(h.paperNo).startsWith('[借用中]');
        
        let paperNoHtml = '';
        if (h.paperNo) {
            paperNoHtml = isBorrowed ? '<span class="text-danger">⚠️ ' + h.paperNo + '</span>' : '發票: ' + h.paperNo;
        }

        let actionBtns = '';
        if (!isVoid) {
            actionBtns += `<button class="btn btn-sm btn-outline-info me-1 fw-bold" onclick="printDeliveryNote(${h.rowIdx})">🖨️ 列印出單</button>`;
            if (isBorrowed) actionBtns += `<button class="btn btn-sm btn-danger me-1 fw-bold" onclick="openSuppInvModal(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">📝 補登發票</button>`;
            actionBtns += `<button class="btn btn-sm btn-outline-danger me-1" onclick="voidInv(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">作廢</button>`;
            actionBtns += `<button class="btn btn-sm btn-outline-secondary" onclick="openEditInv(${h.rowIdx})">編輯</button>`;
        }

        return `<div class="item-row bg-white shadow-sm p-3 ${isVoid?'status-void':''}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                <div><div class="fw-bold fs-6 text-dark">${h.client} ${badgeHTML}</div><div class="small text-muted">單號: ${h.orderNo||'--'} | 開立: ${h.staff}</div></div>
                <div class="text-end"><div class="badge bg-light text-dark border">${dateStr}</div><div class="small mt-1 fw-bold ${isBorrowed?'text-danger':'text-primary'}">${paperNoHtml}</div></div>
            </div>
            <div class="history-details text-muted mb-3">${h.details}</div>
            <div class="d-flex justify-content-between align-items-center">
                <div>${actionBtns}</div>
                <span class="fw-bold text-danger fs-5">$${Number(h.total).toLocaleString()}</span>
            </div>
        </div>`;
    }).join('');
}, 300);

window.openSuppInvModal = function(idx, oldPaperNo) {
    document.getElementById('supp_invRowIdx').value = idx; 
    document.getElementById('supp_oldPaperNo').value = oldPaperNo; 
    document.getElementById('supp_newPaperNo').value = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('suppInvModal')).show();
};

window.confirmSupplementInvoice = function() {
    const btn = event ? event.currentTarget : null;

    const idx = parseInt(document.getElementById('supp_invRowIdx').value);
    const oldPaperNo = document.getElementById('supp_oldPaperNo').value;
    const newPaperNo = document.getElementById('supp_newPaperNo').value.trim().toUpperCase();
    if (!newPaperNo) return alert("請輸入正確的發票號碼！");
    if(window.lockButton(btn)) return; // 防連點保護
    
    showLoading("連動更新中...");
    pushToSyncQueue('supplementInvoiceNo', { rowIdx: idx, oldPaperNo: oldPaperNo, newPaperNo: newPaperNo, staff: myName }, () => {
        hideLoading();
        bootstrap.Modal.getInstance(document.getElementById('suppInvModal')).hide();
        showToast("✅ 發票號碼已成功補登並連動更新");
        refreshData(); 
    });
};

// ============================================================================
// 出貨單列印 (已完美結合明細中的批號與效期)
// ============================================================================
window.printDeliveryNote = function(idx) {
    const h = globalHistory.find(x => x.rowIdx === idx); 
    if (!h) return;
    const items = globalSalesDetails.filter(s => s.paperNo === h.paperNo && s.shipStatus !== '作廢');
    const printDate = new Date(h.time);
    const dateStr = isNaN(printDate.getTime()) ? getTodayStr().replace(/-/g, '/') : `${printDate.getFullYear()}年${printDate.getMonth() + 1}月${printDate.getDate()}日`;

    let tbodyHtml = '';
    if (items.length > 0) {
        items.forEach(item => {
            let expClean = '';
            if (item.expiry) {
                expClean = (typeof cleanDateStr === 'function') ? cleanDateStr(item.expiry).replace(/-/g, '/') : item.expiry;
            }
            const lotExp = `${item.lot || ''} ${expClean}`.trim();

            tbodyHtml += `
                <tr>
                    <td style="border: 1px solid #333; padding: 8px; text-align: left;">${item.name}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center;">${item.qty}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center;">0</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: right;">${Number(item.price).toLocaleString()}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: right;">${Number(item.subtotal).toLocaleString()}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center; font-size: 11px;">${lotExp}</td>
                </tr>
            `;
        });
    } else {
        tbodyHtml = `<tr><td colspan="6" style="border: 1px solid #333; padding: 8px; text-align: center;">(無明細資料或為舊資料)</td></tr>`;
    }

    const html = `
        <div style="max-width: 800px; margin: 0 auto; background: #fff; padding: 15mm 20mm; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000;">
            <table style="width: 100%; border: none; margin-bottom: 15px;">
                <tr>
                    <td style="width: 50%; vertical-align: top;">
                        <div style="font-weight: bold; font-size: 16px;">TO:</div>
                        <div style="font-weight: bold; font-size: 22px; margin-top: 5px; letter-spacing: 2px;">${h.client}</div>
                        <div style="margin-top: 10px; font-weight: bold; font-size: 15px; color: #d32f2f;">訂單號碼: ${escapeQuotes(h.orderNo || '無')}</div>
                    </td>
                    <td style="width: 50%; vertical-align: top; font-size: 14px; line-height: 1.6; text-align: right;">
                        <div style="font-weight: bold; font-size: 16px;">FROM: 長固實業有限公司</div>
                        <div>新北市三重區重新路五段609巷6號4樓</div>
                        <div>TEL: (02) 2999-3881 &nbsp; 2999-3593</div>
                        <div>FAX: 886-2-2999-3495</div>
                        <div style="margin-top: 5px;">${dateStr} &nbsp;&nbsp; 1/1</div>
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                <thead>
                    <tr style="background-color: #f8f9fa;">
                        <th style="border: 1px solid #333; padding: 8px; text-align: center;">品名</th>
                        <th style="border: 1px solid #333; padding: 8px; width: 60px; text-align: center;">數量</th>
                        <th style="border: 1px solid #333; padding: 8px; width: 60px; text-align: center;">欠貨</th>
                        <th style="border: 1px solid #333; padding: 8px; width: 80px; text-align: center;">單價</th>
                        <th style="border: 1px solid #333; padding: 8px; width: 120px; text-align: center;">小計</th>
                        <th style="border: 1px solid #333; padding: 8px; width: 100px; text-align: center;">批號/效期</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4" style="border: 1px solid #333; padding: 8px; text-align: right; font-weight: bold;">*總計*</td>
                        <td style="border: 1px solid #333; padding: 8px; text-align: right; font-weight: bold;">${Number(h.total).toLocaleString()}</td>
                        <td style="border: 1px solid #333; padding: 8px;"></td>
                    </tr>
                </tfoot>
            </table>

            <div style="margin-top: 15px; font-size: 14px; line-height: 1.6;">
                <p style="margin-bottom: 5px;">以上貨品數量及單價請查核.</p>
                <p style="margin-bottom: 15px;">附發票號碼: <strong style="font-size: 16px;">${h.paperNo || ''}</strong></p>
                <div style="margin-top: 30px;">
                    <div style="width: 45%;">簽收: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div>
                </div>
            </div>
        </div>
    `;

    const printArea = document.getElementById('printArea');
    if(printArea) {
        printArea.innerHTML = html;
        if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A5', 'landscape');
        if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printArea');
    }
};

// ============================================================================
// 【發票雙向作廢】連動註銷明細、返還庫存、作廢送貨單
// ============================================================================
window.voidInv = function(idx, pNo) { 
    const btn = event ? event.currentTarget : null;

    if(confirm("確定作廢？系統將自動：\n1. 註銷此發票帳款\n2. 註銷銷售明細\n3. 註銷對應的送貨單\n4. 【自動返還已出貨之庫存數量】")) { 
        if(window.lockButton(btn)) return; // 防連點保護
        const h = globalHistory.find(x=>x.rowIdx === idx); 
        if(h) h.status = '作廢'; 
        
        globalSalesDetails.forEach(sd => { 
            if(sd.paperNo === pNo && sd.shipStatus !== '作廢') { 
                sd.shipStatus = '作廢'; 
                if (sd.shippedQty > 0) {
                    let inv = globalInventory.find(x=>x.name === sd.name); 
                    if(inv) inv.qty += sd.shippedQty; 
                    globalInvLogs.unshift({ time: Date.now(), staff: myName, name: sd.name, type: '作廢返還', qtyChange: sd.shippedQty, newQty: inv ? inv.qty : sd.shippedQty, memo: `作廢單號: ${pNo}` });
                }
            } 
        });

        globalDeliveries.forEach(d => {
            if (d.paperNo && d.paperNo.includes(pNo) && d.status !== '已作廢') {
                d.status = '已作廢';
            }
        });
        
        if(typeof window.populateLogDropdowns === 'function') window.populateLogDropdowns(); 
        window.renderHistory(); 
        if(typeof window.renderOrderList === 'function') window.renderOrderList();
        if(typeof window.renderInventory === 'function') window.renderInventory(); 
        if(typeof window.renderInvLogs === 'function') window.renderInvLogs(); 
        if(typeof window.renderShipments === 'function') window.renderShipments(); 
        if(typeof window.renderDeliveryList === 'function') window.renderDeliveryList();
        window.generateReport(); 
        
        pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: idx, staff: myName, paperNo: pNo}, null); 
        showToast("🗑️ 已作廢並返還庫存，相關送貨單已同步註銷");
    } 
};

window.openEditInv = function(idx) { 
    const h = globalHistory.find(x=>x.rowIdx === idx); 
    if(!h) return; 
    document.getElementById('e_invRow').value = idx; 
    document.getElementById('e_invPaper').value = h.paperNo; 
    document.getElementById('e_invOrder').value = h.orderNo; 
    document.getElementById('e_invNet').value = h.net; 
    document.getElementById('e_invTotal').value = h.total; 
    document.getElementById('e_invDetails').value = h.details; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvModal')).show(); 
};

window.saveEditInvoice = function() { 
    const btn = event ? event.currentTarget : null;
    if(window.lockButton(btn)) return; // 防連點保護

    const idx = parseInt(document.getElementById('e_invRow').value); 
    const h = globalHistory.find(x=>x.rowIdx === idx); 
    const oldPaperNo = h ? h.paperNo : '';
    const newPaperNo = document.getElementById('e_invPaper').value.trim().toUpperCase();
    const data = { 
        client: h.client, taxId: h.taxId, paperNo: newPaperNo, 
        orderNo: document.getElementById('e_invOrder').value, net: document.getElementById('e_invNet').value, 
        tax: Math.round(document.getElementById('e_invTotal').value - document.getElementById('e_invNet').value), 
        total: document.getElementById('e_invTotal').value, details: document.getElementById('e_invDetails').value 
    }; 
    if(h) {
        Object.assign(h, data);
        h.historyLog = "[\"修改紀錄存在\"]";
        // 若編輯時修改了發票號碼，同步更新記憶體與後台的銷售明細發票號碼，防止出貨明細脫鉤
        if (oldPaperNo && newPaperNo && oldPaperNo !== newPaperNo) {
            globalSalesDetails.forEach(sd => {
                if (sd.paperNo === oldPaperNo) sd.paperNo = newPaperNo;
            });
            pushToSyncQueue('supplementInvoiceNo', { rowIdx: idx, oldPaperNo: oldPaperNo, newPaperNo: newPaperNo, staff: myName }, null);
        }
    } 
    window.renderHistory(); 
    if(typeof window.renderOrderList === 'function') window.renderOrderList();
    bootstrap.Modal.getInstance(document.getElementById('editInvModal')).hide(); 
    pushToSyncQueue('updateInvoiceRecord', {action:'edit', rowIdx: idx, staff: myName, data: data}, null); 
};

window.setReportDate = function(days) { 
    const e = new Date(); const s = new Date(); 
    s.setDate(s.getDate() - (days - 1)); 
    document.getElementById('repEnd').valueAsDate = e; 
    document.getElementById('repStart').valueAsDate = s; 
    generateReport(); 
};

window.setReportMonth = function() { 
    const val = document.getElementById('repMonthPicker').value; 
    if(!val) return; 
    const [year, month] = val.split('-'); 
    document.getElementById('repStart').valueAsDate = new Date(year, month - 1, 1); 
    document.getElementById('repEnd').valueAsDate = new Date(year, month, 0); 
    generateReport(); 
};

window.generateReport = function() {
    if (typeof window.initReconcileCenterUI === 'function') window.initReconcileCenterUI();

    const sVal = document.getElementById('repStart').value; 
    const eVal = document.getElementById('repEnd').value; 
    if(!sVal || !eVal) return;
    
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); 
    const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    
    let rCount=0, rNet=0, rTotal=0; const clientStats = {};
    globalHistory.forEach(h => { 
        const d = new Date(h.time); 
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { 
            rCount++; rNet += Number(h.net); rTotal += Number(h.total); 
            if(!clientStats[h.client]) clientStats[h.client] = 0; 
            clientStats[h.client] += Number(h.total); 
        } 
    });
    
    document.getElementById('repCount').innerText = `${rCount} 張`; 
    document.getElementById('repNet').innerText = `$${rNet.toLocaleString()}`; 
    document.getElementById('repTotal').innerText = `$${rTotal.toLocaleString()}`;
};

window.exportReportToEmail = function() {
    const sVal = document.getElementById('repStart').value; 
    const eVal = document.getElementById('repEnd').value; 
    if(!sVal || !eVal) return alert("請先設定報表統計日期範圍！");
    
    let modalEl = document.getElementById('dynamicEmailModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="dynamicEmailModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-light">
                        <h5 class="modal-title fw-bold text-dark">📧 選擇報表收件信箱</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="small text-muted mb-3">請勾選要發送 Excel 報表的對象 (資料連動自後台「收件信箱管理」)</div>
                        <div id="dynamicEmailCheckboxes" class="d-flex flex-column gap-2"></div>
                    </div>
                    <div class="modal-footer border-0">
                        <button type="button" class="btn btn-secondary fw-bold" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-primary fw-bold" onclick="confirmExportReport()">確認並寄出</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    const container = document.getElementById('dynamicEmailCheckboxes');
    if (!emailSettingsData || !emailSettingsData.list || emailSettingsData.list.length === 0) {
        container.innerHTML = '<div class="text-danger fw-bold py-3 text-center">找不到信箱清單，請確認後台「收件信箱管理」是否有資料！</div>';
    } else {
        container.innerHTML = emailSettingsData.list.map((item, idx) => {
            let memoHtml = item.memo ? '<span class="badge bg-secondary ms-2">' + item.memo + '</span>' : '';
            return `<div class="form-check p-3 border rounded bg-white shadow-sm d-flex align-items-center mb-2">
                <input class="form-check-input dyn-email-cb m-0 me-3" type="checkbox" value="${item.email}" id="dyn_em_${idx}" style="transform: scale(1.3); cursor: pointer;">
                <label class="form-check-label fw-bold text-dark w-100" for="dyn_em_${idx}" style="cursor: pointer;">
                    ${item.email} ${memoHtml}
                </label>
             </div>`;
        }).join('');
    }
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('dynamicEmailModal')).show();
};

window.confirmExportReport = function() {
    const btn = event ? event.currentTarget : null;

    const cbs = document.querySelectorAll('.dyn-email-cb:checked');
    const emails = Array.from(cbs).map(cb => cb.value);
    if(emails.length === 0) return alert("請至少勾選一個收件信箱！");
    if(window.lockButton(btn)) return; // 防連點保護
    
    const emailStr = emails.join(','); 
    
    const sVal = document.getElementById('repStart').value; 
    const eVal = document.getElementById('repEnd').value; 
    
    bootstrap.Modal.getInstance(document.getElementById('dynamicEmailModal')).hide();
    showLoading("產生 Excel 中...");
    
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); 
    const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    
    let rCount=0, rNet=0, rTax=0, rTotal=0; const clientStats = {}; const details = []; const lines = [];
    globalHistory.forEach(h => { 
        const d = new Date(h.time); 
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { 
            rCount++; rNet += Number(h.net); rTax += Number(h.tax); rTotal += Number(h.total); 
            if(!clientStats[h.client]) clientStats[h.client] = 0; 
            clientStats[h.client] += Number(h.total); 
            details.push({ date: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: h.paperNo, orderNo: h.orderNo, status: h.status, staff: h.staff, client: h.client, taxId: h.taxId, net: h.net, tax: h.tax, total: h.total, desc: h.details }); 
        } 
    });
    
    globalSalesDetails.forEach(s => { 
        const d = new Date(s.time); 
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && s.shipStatus !== '作廢') { 
            lines.push({
                rowIdx: s.rowIdx,
                time: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`,
                paperNo: s.paperNo,
                client: s.client,
                orderNo: s.orderNo,
                name: s.name,
                qty: s.qty,
                price: s.price,
                subtotal: s.subtotal || Math.round((Number(s.price)||0) * (Number(s.qty)||0)),
                shipStatus: s.shipStatus,
                shippedQty: s.shippedQty
            }); 
        } 
    });
    
    const payload = { 
        email: emailStr, 
        dateRange: `${sVal} ~ ${eVal}`, summary: { count: rCount, net: rNet, tax: rTax, total: rTotal }, 
        clientStats: Object.keys(clientStats).map(k=>({name:k, total:clientStats[k]})).sort((a,b)=>b.total-a.total), 
        details: details.reverse(), lineItems: lines.reverse() 
    };
    
    callApi('exportExcelReport', payload).then(res => { 
        hideLoading(); showToast(`✅ 報表已成功寄送至所選信箱！`); 
    }).catch(err => { hideLoading(); alert("匯出失敗：" + err.message); });
};

// ============================================================================
// 🤖 跨系統報表智慧勾稽比對中心 (位於「紀錄與報表 ＞ 統計報表」子模組)
// ============================================================================
window.reconcileState = {
    fileName: '',
    extRawRows: [],
    erpGeneratedRows: [],
    startDate: '',
    endDate: '',
    results: [],
    currentFilter: 'ALL_DIFF',
    searchTerm: ''
};

// 自動將比對中心 UI 掛載於「統計報表」子模組內
window.initReconcileCenterUI = function() {
    if (document.getElementById('reconcileCenterCard')) return;
    const repTotalEl = document.getElementById('repTotal');
    if (!repTotalEl) return;

    // 尋找「統計報表」子模組的容器
    let reportPane = repTotalEl.closest('.tab-pane') || repTotalEl.closest('.card')?.parentElement || repTotalEl.parentElement;
    if (!reportPane) return;

    const cardHtml = `
    <div id="reconcileCenterCard" class="card border-0 shadow-sm mt-4 mb-4" style="border-top: 4px solid #0d6efd !important;">
        <div class="card-body p-3 p-md-4">
            <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 border-bottom pb-3">
                <div>
                    <h5 class="fw-bold text-dark mb-1">🤖 跨系統報表智慧勾稽比對中心</h5>
                    <div class="small text-muted">
                        上傳外部系統發票檔（如 <code>INVOICES-1151014.xlsx</code>），系統將自動識別日期區間、於後台生成本系統「出貨明細」並針對 6 大核心欄位進行雙向精準比對。
                    </div>
                </div>
                <div class="mt-2 mt-md-0 d-flex gap-2">
                    <label class="btn btn-primary fw-bold shadow-sm mb-0" style="cursor: pointer;">
                        📂 上傳外部系統報表 (.xlsx / .csv)
                        <input type="file" id="extReportFileInput" accept=".xlsx,.xls,.csv" style="display: none;" onchange="window.handleExternalReportUpload(this)">
                    </label>
                    <button id="btnDownloadReconcileExcel" class="btn btn-success fw-bold shadow-sm" style="display: none;" onclick="window.exportReconciliationExcel()">
                        📥 下載比對差異報告 (.xlsx)
                    </button>
                </div>
            </div>

            <!-- 檔案與自動識別區間資訊列 -->
            <div id="recMetaBar" class="p-3 rounded bg-light border mb-3" style="display: none;">
                <div class="row g-2 align-items-center">
                    <div class="col-12 col-md-5">
                        <div class="small text-muted fw-bold">📄 已載入外部檔案：</div>
                        <div id="recFileNameDisplay" class="fw-bold text-primary text-truncate"></div>
                    </div>
                    <div class="col-12 col-md-5">
                        <div class="small text-muted fw-bold mb-1">📅 自動識別比對區間（可手動微調重算）：</div>
                        <div class="d-flex align-items-center gap-1">
                            <input type="date" id="recStartDate" class="form-control form-control-sm fw-bold">
                            <span class="fw-bold text-muted">~</span>
                            <input type="date" id="recEndDate" class="form-control form-control-sm fw-bold">
                        </div>
                    </div>
                    <div class="col-12 col-md-2 text-end">
                        <button class="btn btn-sm btn-outline-primary fw-bold w-100 mt-2 mt-md-4" onclick="window.runReportReconciliation()">
                            🔄 重新比對
                        </button>
                    </div>
                </div>
            </div>

            <!-- 四大稽核狀態 KPI 篩選小卡 -->
            <div id="recKpiRow" class="row g-2 mb-3" style="display: none;">
                <div class="col-6 col-md-2">
                    <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ALL_DIFF" style="cursor:pointer; background:#fff8f6; border-color:#dc3545 !important;" onclick="window.setReconcileFilter('ALL_DIFF')">
                        <div class="small fw-bold text-danger">⚠️ 異常總數</div>
                        <div class="fs-4 fw-bold text-danger" id="recCountAllDiff">0</div>
                        <div class="text-muted" style="font-size:0.75rem;">需人工複查</div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_VALUE_DIFF" style="cursor:pointer; background:#fffdf5;" onclick="window.setReconcileFilter('VALUE_DIFF')">
                        <div class="small fw-bold text-warning text-dark">🟡 欄位資料相異</div>
                        <div class="fs-4 fw-bold text-dark" id="recCountValDiff">0</div>
                        <div class="text-muted" style="font-size:0.75rem;">代號/數量/單價/總價/客戶</div>
                    </div>
                </div>
                <div class="col-6 col-md-3">
                    <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ONLY_EXT" style="cursor:pointer; background:#fff5f5;" onclick="window.setReconcileFilter('ONLY_EXT')">
                        <div class="small fw-bold text-danger">🔴 僅外部系統有</div>
                        <div class="fs-4 fw-bold text-danger" id="recCountOnlyExt">0</div>
                        <div class="text-muted" style="font-size:0.75rem;">本系統出貨明細缺漏</div>
                    </div>
                </div>
                <div class="col-6 col-md-2">
                    <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ONLY_ERP" style="cursor:pointer; background:#f0f7ff;" onclick="window.setReconcileFilter('ONLY_ERP')">
                        <div class="small fw-bold text-primary">🔵 僅本系統有</div>
                        <div class="fs-4 fw-bold text-primary" id="recCountOnlyErp">0</div>
                        <div class="text-muted" style="font-size:0.75rem;">外部系統缺漏/借用</div>
                    </div>
                </div>
                <div class="col-12 col-md-2">
                    <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_MATCH" style="cursor:pointer; background:#f3fbf6;" onclick="window.setReconcileFilter('MATCH')">
                        <div class="small fw-bold text-success">🟢 完全吻合</div>
                        <div class="fs-4 fw-bold text-success" id="recCountMatch">0</div>
                        <div class="text-muted" style="font-size:0.75rem;">6大欄位一致</div>
                    </div>
                </div>
            </div>

            <!-- 搜尋與顯示切換列 -->
            <div id="recFilterToolbar" class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3" style="display: none !important;">
                <div class="btn-group btn-group-sm" role="group">
                    <button type="button" class="btn btn-outline-danger active fw-bold" id="btnRecTab_ALL_DIFF" onclick="window.setReconcileFilter('ALL_DIFF')">⚠️ 全部異常</button>
                    <button type="button" class="btn btn-outline-warning text-dark fw-bold" id="btnRecTab_VALUE_DIFF" onclick="window.setReconcileFilter('VALUE_DIFF')">🟡 資料相異</button>
                    <button type="button" class="btn btn-outline-danger fw-bold" id="btnRecTab_ONLY_EXT" onclick="window.setReconcileFilter('ONLY_EXT')">🔴 僅外部有</button>
                    <button type="button" class="btn btn-outline-primary fw-bold" id="btnRecTab_ONLY_ERP" onclick="window.setReconcileFilter('ONLY_ERP')">🔵 僅本系統有</button>
                    <button type="button" class="btn btn-outline-success fw-bold" id="btnRecTab_MATCH" onclick="window.setReconcileFilter('MATCH')">🟢 完全吻合</button>
                    <button type="button" class="btn btn-outline-secondary fw-bold" id="btnRecTab_ALL" onclick="window.setReconcileFilter('ALL')">📋 顯示全部</button>
                </div>
                <div style="min-width: 240px; flex-grow: 1; max-width: 360px;">
                    <input type="text" id="recSearchInput" class="form-control form-control-sm" placeholder="🔍 搜尋發票號碼、客戶、CUSTID、長固代號、品名..." oninput="window.onReconcileSearch(this.value)">
                </div>
            </div>

            <!-- 比對結果清單容器 -->
            <div id="recResultContainer">
                <div class="text-center text-muted py-4 border rounded bg-light">
                    請點擊右上角「<strong>📂 上傳外部系統報表</strong>」開始自動勾稽比對
                </div>
            </div>
        </div>
    </div>`;

    reportPane.insertAdjacentHTML('beforeend', cardHtml);
};

// 解析外部報表的各種日期格式 (支援 '01-Oct-26', Excel 序列數字, '2026/10/01', 民國年 '1151014')
window.parseExternalDateStr = function(rawVal) {
    if (rawVal === undefined || rawVal === null || rawVal === '') return null;

    // 1. 若為 Excel 日期序列數字 (例如 46296)
    if (typeof rawVal === 'number' && rawVal > 25000 && rawVal < 80000) {
        const utcDays = Math.floor(rawVal - 25569);
        const d = new Date(utcDays * 86400 * 1000);
        if (!isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        }
    }

    const s = String(rawVal).trim();
    if (!s) return null;

    // 2. 處理 DD-MMM-YY 或 DD-MMM-YYYY (例如 01-Oct-26, 14-Oct-2026)
    const mEng = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})$/);
    if (mEng) {
        const day = parseInt(mEng[1], 10);
        const monStr = mEng[2].toLowerCase();
        let yr = parseInt(mEng[3], 10);
        if (yr < 100) yr += (yr >= 70 ? 1900 : 2000);
        const monMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        const mon = monMap[monStr];
        if (mon && day >= 1 && day <= 31) {
            return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    // 3. 處理 YYYY/MM/DD 或 YYYY-MM-DD 或民國 YYY/MM/DD
    const mSlash = s.match(/^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mSlash) {
        let yr = parseInt(mSlash[1], 10);
        if (yr < 1911) yr += 1911;
        const mon = parseInt(mSlash[2], 10);
        const day = parseInt(mSlash[3], 10);
        if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
            return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    // 4. 一般 Date 解析
    const dObj = new Date(s);
    if (!isNaN(dObj.getTime())) {
        return `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(dObj.getDate()).padStart(2, '0')}`;
    }

    return null;
};

// 處理外部報表檔案上傳
window.handleExternalReportUpload = function(input) {
    if (!input.files || !input.files[0]) return;
    if (typeof XLSX === 'undefined') {
        alert("Excel 解析引擎仍在載入中，請稍候 1 秒再試！");
        return;
    }

    const file = input.files[0];
    const fileName = file.name;
    showLoading("📂 正在解析外部系統報表並自動識別日期區間...");

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', raw: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            if (!aoa || aoa.length < 2) {
                hideLoading();
                return alert("上傳的報表檔案無內容或格式不符！");
            }

            // 尋找表頭列 (預設第 1 列，若包含 INVOICE / CUSTID / NOINVOICE 則動態對齊，同時強制兼容固定欄位位置 B,C,D,E,G,H,J)
            let headerRowIdx = 0;
            for (let r = 0; r < Math.min(10, aoa.length); r++) {
                const rowStr = aoa[r].map(x => String(x || '').toUpperCase().trim()).join(',');
                if (rowStr.includes('CUSTID') || rowStr.includes('NOINVOICE') || rowStr.includes('ISPN')) {
                    headerRowIdx = r;
                    break;
                }
            }

            const headers = (aoa[headerRowIdx] || []).map(x => String(x || '').toUpperCase().trim());
            const findCol = (colName, defaultIdx) => {
                const idx = headers.indexOf(colName);
                return idx >= 0 ? idx : defaultIdx;
            };

            // 依照使用者指定對應：B欄(1):CUSTID, C欄(2):DATE, D欄(3):ISPN, E欄(4):QTY, G欄(6):PRICE, H欄(7):TOTAL, J欄(9):NOINVOICE
            const idxSysInv = findCol('INVOICE', 0);
            const idxCustId = findCol('CUSTID', 1);
            const idxDate   = findCol('DATE', 2);
            const idxIspn   = findCol('ISPN', 3);
            const idxQty    = findCol('QTY', 4);
            const idxQtyDel = findCol('QTYDEL', 5);
            const idxPrice  = findCol('PRICE', 6);
            const idxTotal  = findCol('TOTAL', 7);
            const idxNote1  = findCol('NOTE1', 8);
            const idxNoInv  = findCol('NOINVOICE', 9);
            const idxPoNum  = findCol('PONUMBER', 10);

            let parsedRows = [];
            let detectedDates = [];

            for (let r = headerRowIdx + 1; r < aoa.length; r++) {
                const row = aoa[r];
                if (!row || row.length === 0) continue;

                const sysInv = String(row[idxSysInv] || '').trim();
                const custId = String(row[idxCustId] || '').trim();
                const rawDate = row[idxDate];
                const ispn = String(row[idxIspn] || '').trim();
                const qty = Math.round((parseFloat(row[idxQty]) || 0) * 1000) / 1000;
                const qtyDel = Math.round((parseFloat(row[idxQtyDel]) || 0) * 1000) / 1000;
                const price = Math.round((parseFloat(row[idxPrice]) || 0) * 1000) / 1000;
                const total = Math.round((parseFloat(row[idxTotal]) || 0) * 100) / 100;
                const note1 = String(row[idxNote1] || '').trim();
                const noInvoice = String(row[idxNoInv] || '').trim().toUpperCase();
                const poNumber = String(row[idxPoNum] || '').trim();

                // 忽略完全空白的列
                if (!sysInv && !custId && !ispn && !noInvoice && qty === 0 && total === 0) continue;

                const cleanDate = window.parseExternalDateStr(rawDate);
                if (cleanDate) detectedDates.push(cleanDate);

                parsedRows.push({
                    excelRowNo: r + 1,
                    sysInv: sysInv,
                    custId: custId,
                    date: cleanDate || String(rawDate || ''),
                    ispn: ispn,
                    qty: qty,
                    qtyDel: qtyDel,
                    price: price,
                    total: total,
                    note1: note1,
                    noInvoice: noInvoice,
                    poNumber: poNumber
                });
            }

            if (parsedRows.length === 0) {
                hideLoading();
                return alert("外部報表中未解析到任何有效明細資料列！");
            }

            // 自動決定起訖日期區間
            let minDate = '';
            let maxDate = '';
            if (detectedDates.length > 0) {
                detectedDates.sort();
                minDate = detectedDates[0];
                maxDate = detectedDates[detectedDates.length - 1];
            } else {
                // 若檔案內無日期，嘗試從檔名如 INVOICES-1151014.xlsx 推算當月 1 號至該日
                const fnMatch = fileName.match(/(\d{3})(\d{2})(\d{2})/);
                if (fnMatch) {
                    const yr = parseInt(fnMatch[1], 10) + 1911;
                    const mon = fnMatch[2];
                    const day = fnMatch[3];
                    minDate = `${yr}-${mon}-01`;
                    maxDate = `${yr}-${mon}-${day}`;
                } else {
                    minDate = document.getElementById('repStart')?.value || getTodayStr();
                    maxDate = document.getElementById('repEnd')?.value || getTodayStr();
                }
            }

            window.reconcileState.fileName = fileName;
            window.reconcileState.extRawRows = parsedRows;
            window.reconcileState.startDate = minDate;
            window.reconcileState.endDate = maxDate;

            document.getElementById('recMetaBar').style.display = 'block';
            document.getElementById('recStartDate').value = minDate;
            document.getElementById('recEndDate').value = maxDate;

            // 同步更新上方統計報表的日期區間
            if (document.getElementById('repStart')) document.getElementById('repStart').value = minDate;
            if (document.getElementById('repEnd')) document.getElementById('repEnd').value = maxDate;
            if (typeof window.generateReport === 'function') window.generateReport();

            hideLoading();
            window.runReportReconciliation();
        } catch (err) {
            hideLoading();
            console.error("解析外部報表失敗:", err);
            alert("解析外部報表時發生錯誤：" + err.message);
        } finally {
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

// 執行「本系統出貨明細（後台自動生成）」與「外部系統報表」六大欄位深度比對
window.runReportReconciliation = function() {
    const extRows = window.reconcileState.extRawRows || [];
    if (extRows.length === 0) return alert("請先上傳外部系統報表！");

    const sVal = document.getElementById('recStartDate').value;
    const eVal = document.getElementById('recEndDate').value;
    if (!sVal || !eVal) return alert("請設定有效的比對起訖日期！");

    window.reconcileState.startDate = sVal;
    window.reconcileState.endDate = eVal;

    const sDate = new Date(sVal); sDate.setHours(0, 0, 0, 0);
    const eDate = new Date(eVal); eDate.setHours(23, 59, 59, 999);

    // 1. 在後台自動生成對應日期區間的「本系統報表 - 出貨明細」
    // 欄位結構對應：[開立日期(A), 發票號碼(B), 客戶名稱(C), 訂單編號(D), 長固代號(E), 品名(F), 開立數量(G), 單價(含稅)(H), 總價(含稅)(I), 出貨狀態(J), 已出貨數量(K)]
    const erpRows = [];
    (globalSalesDetails || []).forEach(s => {
        if (s.shipStatus === '作廢') return;
        const d = new Date(s.time);
        if (isNaN(d.getTime()) || d < sDate || d > eDate) return;

        // 確認對應發票在發票總表是否已被作廢
        const parentInv = (globalHistory || []).find(h => h.paperNo === s.paperNo);
        if (parentInv && parentInv.status === '作廢') return;

        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const cat = (typeof window.findProductRobust === 'function')
            ? window.findProductRobust(s.client, null, s.name)
            : (globalCatalog || []).find(c => c.productName === s.name && c.clientName === s.client);
        const internalCode = String(cat ? (cat.internalCode || cat.assetCode || '') : '').trim();
        const qty = Math.round((Number(s.qty) || 0) * 1000) / 1000;
        const price = Math.round((Number(s.price) || 0) * 1000) / 1000;
        const expectedSub = Math.round(qty * price);
        const rawSub = Math.round((Number(s.subtotal) || 0) * 100) / 100;
        // 若舊資料因同發票同品名導致 subtotal 異常，自動提供精準乘積與原始值雙重比對
        const subtotal = rawSub > 0 ? rawSub : expectedSub;

        erpRows.push({
            rowIdx: s.rowIdx,
            date: dateStr,
            paperNo: String(s.paperNo || '').trim().toUpperCase(),
            client: String(s.client || '').trim(),
            orderNo: String(s.orderNo || '').trim(),
            internalCode: internalCode,
            name: String(s.name || '').trim(),
            qty: qty,
            price: price,
            subtotal: subtotal,
            expectedSubtotal: expectedSub,
            shipStatus: s.shipStatus || '待出貨',
            shippedQty: Number(s.shippedQty) || 0
        });
    });

    window.reconcileState.erpGeneratedRows = erpRows;

    // 過濾外部報表於該日期區間內的明細（若外部列無日期則一併納入檢查）
    const extFiltered = extRows.filter(r => {
        if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return true;
        const d = new Date(r.date); d.setHours(12, 0, 0, 0);
        return d >= sDate && d <= eDate;
    });

    document.getElementById('recFileNameDisplay').innerHTML = `
        ${escapeQuotes(window.reconcileState.fileName)}
        <span class="badge bg-secondary ms-2">外部明細: ${extFiltered.length} 筆</span>
        <span class="badge bg-primary ms-1">本系統同區間出貨明細: ${erpRows.length} 筆</span>
    `;

    // 2. 將兩邊資料依「發票號碼 (B欄 vs J欄 NOINVOICE)」分組，且同發票同長固代號先行智慧歸戶
    const groupItemsByCode = (items, isErp) => {
        const map = new Map();
        items.forEach(item => {
            const codeKey = String(isErp ? item.internalCode : item.ispn).replace(/\s+/g, '').toUpperCase() || `__NOCODE_${Math.random()}`;
            if (!map.has(codeKey)) {
                map.set(codeKey, {
                    code: isErp ? item.internalCode : item.ispn,
                    qty: 0,
                    price: item.price,
                    total: 0,
                    expectedTotal: 0,
                    count: 0,
                    rawItems: []
                });
            }
            const g = map.get(codeKey);
            g.qty = Math.round((g.qty + item.qty) * 1000) / 1000;
            g.total = Math.round((g.total + (isErp ? item.subtotal : item.total)) * 100) / 100;
            g.expectedTotal = Math.round((g.expectedTotal + (isErp ? item.expectedSubtotal : Math.round(item.qty * item.price))) * 100) / 100;
            g.count += 1;
            g.rawItems.push(item);
        });
        return Array.from(map.values());
    };

    const erpByInv = new Map();
    erpRows.forEach(r => {
        const key = r.paperNo || '__EMPTY_ERP_INV__';
        if (!erpByInv.has(key)) erpByInv.set(key, []);
        erpByInv.get(key).push(r);
    });

    const extByInv = new Map();
    const extEmptyInvRows = [];
    extFiltered.forEach(r => {
        if (!r.noInvoice) {
            extEmptyInvRows.push(r);
        } else {
            const key = r.noInvoice;
            if (!extByInv.has(key)) extByInv.set(key, []);
            extByInv.get(key).push(r);
        }
    });

    const allInvNos = Array.from(new Set([...erpByInv.keys(), ...extByInv.keys()])).sort();
    const results = [];

    // 輔助函式：執行單一配對項目的 6 大欄位比對
    const comparePairedGroup = (invNo, erpG, extG) => {
        const eFirst = erpG.rawItems[0];
        const xFirst = extG.rawItems[0];

        const erpClient = eFirst.client;
        const extCustId = xFirst.custId;
        const clientCheck = (typeof window.matchClientWithCustId === 'function')
            ? window.matchClientWithCustId(erpClient, extCustId)
            : { isMatch: false, extClientName: extCustId };

        const cleanErpCode = String(erpG.code || '').replace(/\s+/g, '').toUpperCase();
        const cleanExtCode = String(extG.code || '').replace(/\s+/g, '').toUpperCase();
        const isCodeMatch = (cleanErpCode !== '' && cleanErpCode === cleanExtCode);

        const isQtyMatch = Math.abs(erpG.qty - extG.qty) < 0.001;
        const isPriceMatch = Math.abs(erpG.price - extG.price) < 0.01;
        const isTotalMatch = Math.abs(erpG.total - extG.total) < 0.5;

        const diffs = [];
        const diffFields = {};

        if (!clientCheck.isMatch) {
            diffs.push(`客戶不符 (本系統: ${erpClient} vs 外部CUSTID: ${extCustId} [${clientCheck.extClientName}])`);
            diffFields.client = true;
        }
        if (!isCodeMatch) {
            diffs.push(`長固代號不符 (本系統E欄: ${erpG.code || '無'} vs 外部D欄ISPN: ${extG.code || '無'})`);
            diffFields.code = true;
        }
        if (!isQtyMatch) {
            diffs.push(`開立數量不符 (本系統G欄: ${erpG.qty} vs 外部E欄QTY: ${extG.qty})`);
            diffFields.qty = true;
        }
        if (!isPriceMatch) {
            diffs.push(`單價不符 (本系統H欄: $${erpG.price} vs 外部G欄PRICE: $${extG.price})`);
            diffFields.price = true;
        }
        if (!isTotalMatch) {
            let totalNote = `總價不符 (本系統I欄: $${erpG.total.toLocaleString()} vs 外部H欄TOTAL: $${extG.total.toLocaleString()})`;
            if (Math.abs(erpG.expectedTotal - extG.total) < 0.5 && erpG.total !== erpG.expectedTotal) {
                totalNote += ` [註: 本系統單價×數量=$${erpG.expectedTotal.toLocaleString()} 與外部吻合，係舊報表合併品項小計顯示問題]`;
            }
            diffs.push(totalNote);
            diffFields.total = true;
        }

        const erpCustIds = (typeof window.resolveClientCustIds === 'function')
            ? window.resolveClientCustIds(erpClient, '', '')
            : '';

        results.push({
            category: diffs.length === 0 ? 'MATCH' : 'VALUE_DIFF',
            invNo: invNo,
            date: eFirst.date || xFirst.date,
            erpClient: erpClient,
            erpCustIds: erpCustIds,
            extCustId: extCustId,
            extClientName: clientCheck.extClientName,
            erpCode: erpG.code || '(未填代號)',
            extCode: extG.code || '(未填ISPN)',
            erpName: eFirst.name,
            erpOrderNo: eFirst.orderNo,
            extPoNo: xFirst.poNumber || xFirst.note1 || '',
            extSysInv: xFirst.sysInv || '',
            erpQty: erpG.qty,
            extQty: extG.qty,
            erpPrice: erpG.price,
            extPrice: extG.price,
            erpTotal: erpG.total,
            extTotal: extG.total,
            erpMergeCount: erpG.count,
            extMergeCount: extG.count,
            diffs: diffs,
            diffFields: diffFields
        });
    };

    allInvNos.forEach(invNo => {
        const eItems = erpByInv.get(invNo) || [];
        const xItems = extByInv.get(invNo) || [];

        // 情況 A：兩邊都有這張發票號碼
        if (eItems.length > 0 && xItems.length > 0) {
            const eGroups = groupItemsByCode(eItems, true);
            const xGroups = groupItemsByCode(xItems, false);
            const usedE = new Set();
            const usedX = new Set();

            // 第一輪：優先以「相同長固代號 (E欄 === D欄 ISPN)」配對
            eGroups.forEach((eg, eIdx) => {
                const eCode = String(eg.code || '').replace(/\s+/g, '').toUpperCase();
                if (!eCode) return;
                const xIdx = xGroups.findIndex((xg, idx) => !usedX.has(idx) && String(xg.code || '').replace(/\s+/g, '').toUpperCase() === eCode);
                if (xIdx >= 0) {
                    usedE.add(eIdx);
                    usedX.add(xIdx);
                    comparePairedGroup(invNo, eg, xGroups[xIdx]);
                }
            });

            // 第二輪：同張發票內剩餘未配對項目，若「數量+單價+總價」相同，代表人員選錯長固代號，將其配對並標示代號差異
            eGroups.forEach((eg, eIdx) => {
                if (usedE.has(eIdx)) return;
                const xIdx = xGroups.findIndex((xg, idx) =>
                    !usedX.has(idx) &&
                    Math.abs(eg.qty - xg.qty) < 0.001 &&
                    Math.abs(eg.price - xg.price) < 0.01
                );
                if (xIdx >= 0) {
                    usedE.add(eIdx);
                    usedX.add(xIdx);
                    comparePairedGroup(invNo, eg, xGroups[xIdx]);
                }
            });

            // 第三輪：同張發票若兩邊各只剩 1 筆未配對，直接並排配對以利人工對照
            const remE = eGroups.map((g, i) => ({ g, i })).filter(x => !usedE.has(x.i));
            const remX = xGroups.map((g, i) => ({ g, i })).filter(x => !usedX.has(x.i));
            const pairLen = Math.min(remE.length, remX.length);
            for (let k = 0; k < pairLen; k++) {
                usedE.add(remE[k].i);
                usedX.add(remX[k].i);
                comparePairedGroup(invNo, remE[k].g, remX[k].g);
            }

            // 第四輪：同張發票內多出或少掉的品項明細
            eGroups.forEach((eg, eIdx) => {
                if (usedE.has(eIdx)) return;
                const eFirst = eg.rawItems[0];
                results.push({
                    category: 'ONLY_ERP',
                    invNo: invNo,
                    date: eFirst.date,
                    erpClient: eFirst.client,
                    erpCustIds: window.resolveClientCustIds ? window.resolveClientCustIds(eFirst.client, '', '') : '',
                    extCustId: '--',
                    extClientName: '--',
                    erpCode: eg.code || '(無代號)',
                    extCode: '--',
                    erpName: eFirst.name,
                    erpOrderNo: eFirst.orderNo,
                    extPoNo: '--',
                    extSysInv: '--',
                    erpQty: eg.qty,
                    extQty: null,
                    erpPrice: eg.price,
                    extPrice: null,
                    erpTotal: eg.total,
                    extTotal: null,
                    erpMergeCount: eg.count,
                    extMergeCount: 0,
                    diffs: [`同發票(${invNo})內，本系統多出此品項明細，外部系統無此品項`],
                    diffFields: { missingExt: true }
                });
            });

            xGroups.forEach((xg, xIdx) => {
                if (usedX.has(xIdx)) return;
                const xFirst = xg.rawItems[0];
                const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId('', xFirst.custId) : { extClientName: xFirst.custId };
                results.push({
                    category: 'ONLY_EXT',
                    invNo: invNo,
                    date: xFirst.date,
                    erpClient: '--',
                    erpCustIds: '--',
                    extCustId: xFirst.custId,
                    extClientName: cInfo.extClientName,
                    erpCode: '--',
                    extCode: xg.code || '(無ISPN)',
                    erpName: '(外部獨有品項)',
                    erpOrderNo: '--',
                    extPoNo: xFirst.poNumber || xFirst.note1 || '',
                    extSysInv: xFirst.sysInv || '',
                    erpQty: null,
                    extQty: xg.qty,
                    erpPrice: null,
                    extPrice: xg.price,
                    erpTotal: null,
                    extTotal: xg.total,
                    erpMergeCount: 0,
                    extMergeCount: xg.count,
                    diffs: [`同發票(${invNo})內，外部系統有此品項，但本系統出貨明細缺漏`],
                    diffFields: { missingErp: true }
                });
            });
        }
        // 情況 B：僅本系統有此發票 (外部系統無此發票號碼)
        else if (eItems.length > 0 && xItems.length === 0) {
            const eGroups = groupItemsByCode(eItems, true);
            const isBorrowed = String(invNo).startsWith('[借用中]');
            eGroups.forEach(eg => {
                const eFirst = eg.rawItems[0];
                const reason = isBorrowed
                    ? `本系統為「借用發票(${invNo})」尚未補登正式發票號碼（訂單號: ${eFirst.orderNo || '無'}）`
                    : `本系統有此發票明細(${invNo})，但外部系統報表查無此發票號碼`;
                results.push({
                    category: 'ONLY_ERP',
                    invNo: invNo,
                    date: eFirst.date,
                    erpClient: eFirst.client,
                    erpCustIds: window.resolveClientCustIds ? window.resolveClientCustIds(eFirst.client, '', '') : '',
                    extCustId: '--',
                    extClientName: '--',
                    erpCode: eg.code || '(無代號)',
                    extCode: '--',
                    erpName: eFirst.name,
                    erpOrderNo: eFirst.orderNo,
                    extPoNo: '--',
                    extSysInv: '--',
                    erpQty: eg.qty,
                    extQty: null,
                    erpPrice: eg.price,
                    extPrice: null,
                    erpTotal: eg.total,
                    extTotal: null,
                    erpMergeCount: eg.count,
                    extMergeCount: 0,
                    diffs: [reason],
                    diffFields: { missingExt: true }
                });
            });
        }
        // 情況 C：僅外部系統有此發票 (本系統「出貨明細」查無此發票號碼)
        else if (xItems.length > 0 && eItems.length === 0) {
            const xGroups = groupItemsByCode(xItems, false);
            // 檢查這張發票是否存在於本系統「發票總表 (globalHistory)」中
            const inHistory = (globalHistory || []).find(h => String(h.paperNo || '').trim().toUpperCase() === invNo);
            xGroups.forEach(xg => {
                const xFirst = xg.rawItems[0];
                const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId(inHistory ? inHistory.client : '', xFirst.custId) : { extClientName: xFirst.custId };
                let reason = `外部系統有此發票(${invNo})，但本系統「出貨明細」查無紀錄`;
                if (inHistory) {
                    reason += ` (⚠️ 系統偵測到此發票存在於本系統「發票總表」[${inHistory.client} 總計:$${inHistory.total}]，但「出貨明細」中無對應項目或單號未連動)`;
                }
                results.push({
                    category: 'ONLY_EXT',
                    invNo: invNo,
                    date: xFirst.date,
                    erpClient: inHistory ? `${inHistory.client} (僅存於發票總表)` : '--',
                    erpCustIds: '--',
                    extCustId: xFirst.custId,
                    extClientName: cInfo.extClientName,
                    erpCode: '--',
                    extCode: xg.code || '(無ISPN)',
                    erpName: inHistory ? `發票總表明細: ${inHistory.details || ''}` : '(本系統無此發票)',
                    erpOrderNo: inHistory ? (inHistory.orderNo || '') : '--',
                    extPoNo: xFirst.poNumber || xFirst.note1 || '',
                    extSysInv: xFirst.sysInv || '',
                    erpQty: null,
                    extQty: xg.qty,
                    erpPrice: null,
                    extPrice: xg.price,
                    erpTotal: null,
                    extTotal: xg.total,
                    erpMergeCount: 0,
                    extMergeCount: xg.count,
                    diffs: [reason],
                    diffFields: { missingErp: true }
                });
            });
        }
    });

    // 處理外部系統報表中「未填寫發票號碼 (NOINVOICE 為空白)」的項目
    extEmptyInvRows.forEach(xRow => {
        const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId('', xRow.custId) : { extClientName: xRow.custId };
        results.push({
            category: 'ONLY_EXT',
            invNo: '(外部未填發票號碼)',
            date: xRow.date,
            erpClient: '--',
            erpCustIds: '--',
            extCustId: xRow.custId,
            extClientName: cInfo.extClientName,
            erpCode: '--',
            extCode: xRow.ispn || '(無ISPN)',
            erpName: `外部單號: ${xRow.sysInv || '無'} (PONUMBER: ${xRow.poNumber || xRow.note1 || '無'})`,
            erpOrderNo: '--',
            extPoNo: xRow.poNumber || xRow.note1 || '',
            extSysInv: xRow.sysInv || '',
            erpQty: null,
            extQty: xRow.qty,
            erpPrice: null,
            extPrice: xRow.price,
            erpTotal: null,
            extTotal: xRow.total,
            erpMergeCount: 0,
            extMergeCount: 1,
            diffs: [`外部系統此筆紀錄未填寫發票號碼 (NOINVOICE 空白，外部單號: ${xRow.sysInv}，訂單號: ${xRow.poNumber || xRow.note1 || '無'})`],
            diffFields: { missingErp: true }
        });
    });

    window.reconcileState.results = results;

    // 統計各分類數量
    const countValDiff = results.filter(r => r.category === 'VALUE_DIFF').length;
    const countOnlyExt = results.filter(r => r.category === 'ONLY_EXT').length;
    const countOnlyErp = results.filter(r => r.category === 'ONLY_ERP').length;
    const countMatch   = results.filter(r => r.category === 'MATCH').length;
    const countAllDiff = countValDiff + countOnlyExt + countOnlyErp;

    document.getElementById('recCountAllDiff').innerText = countAllDiff;
    document.getElementById('recCountValDiff').innerText = countValDiff;
    document.getElementById('recCountOnlyExt').innerText = countOnlyExt;
    document.getElementById('recCountOnlyErp').innerText = countOnlyErp;
    document.getElementById('recCountMatch').innerText   = countMatch;

    document.getElementById('recKpiRow').style.display = 'flex';
    document.getElementById('recFilterToolbar').style.setProperty('display', 'flex', 'important');
    document.getElementById('btnDownloadReconcileExcel').style.display = 'inline-block';

    // 若有異常預設顯示「全部異常」，若 100% 吻合則顯示「完全吻合」
    window.setReconcileFilter(countAllDiff > 0 ? 'ALL_DIFF' : 'MATCH');
    showToast(`✅ 比對完成！共發現 ${countAllDiff} 筆差異項目、${countMatch} 筆完全吻合`);
};

window.setReconcileFilter = function(filterType) {
    window.reconcileState.currentFilter = filterType;
    ['ALL_DIFF', 'VALUE_DIFF', 'ONLY_EXT', 'ONLY_ERP', 'MATCH', 'ALL'].forEach(t => {
        const btn = document.getElementById('btnRecTab_' + t);
        if (btn) {
            if (t === filterType) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        const kpi = document.getElementById('kpi_' + t);
        if (kpi) {
            kpi.style.boxShadow = (t === filterType) ? '0 0 0 3px rgba(13,110,253,0.35)' : '';
        }
    });
    window.renderReconcileTable();
};

window.onReconcileSearch = debounce(function(val) {
    window.reconcileState.searchTerm = (val || '').trim().toLowerCase();
    window.renderReconcileTable();
}, 250);

// 渲染左右對照式差異檢視表
window.renderReconcileTable = function() {
    const container = document.getElementById('recResultContainer');
    if (!container) return;

    const filter = window.reconcileState.currentFilter || 'ALL_DIFF';
    const term = window.reconcileState.searchTerm || '';
    let list = window.reconcileState.results || [];

    if (filter === 'ALL_DIFF') list = list.filter(r => r.category !== 'MATCH');
    else if (filter !== 'ALL') list = list.filter(r => r.category === filter);

    if (term) {
        list = list.filter(r =>
            String(r.invNo || '').toLowerCase().includes(term) ||
            String(r.erpClient || '').toLowerCase().includes(term) ||
            String(r.extCustId || '').toLowerCase().includes(term) ||
            String(r.extClientName || '').toLowerCase().includes(term) ||
            String(r.erpCode || '').toLowerCase().includes(term) ||
            String(r.extCode || '').toLowerCase().includes(term) ||
            String(r.erpName || '').toLowerCase().includes(term) ||
            String(r.erpOrderNo || '').toLowerCase().includes(term) ||
            String(r.extPoNo || '').toLowerCase().includes(term) ||
            r.diffs.join(' ').toLowerCase().includes(term)
        );
    }

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-light">🎉 此分類條件下沒有任何紀錄</div>`;
        return;
    }

    const badgeMap = {
        'VALUE_DIFF': '<span class="badge bg-warning text-dark">🟡 欄位數值相異</span>',
        'ONLY_EXT': '<span class="badge bg-danger">🔴 僅外部系統有 (本系統出貨明細缺漏)</span>',
        'ONLY_ERP': '<span class="badge bg-primary">🔵 僅本系統有 (外部系統缺漏/借用單號)</span>',
        'MATCH': '<span class="badge bg-success">🟢 六大欄位完全吻合</span>'
    };

    const rowsHtml = list.map((r, idx) => {
        const df = r.diffFields || {};
        const hlStyle = 'background-color: #ffe3e3; color: #c92a2a; font-weight: bold; padding: 2px 6px; border-radius: 4px; display: inline-block;';

        const clientCell = `
            <div><small class="text-muted">本系統(C欄):</small> <span style="${df.client ? hlStyle : 'font-weight:bold;'}">${escapeQuotes(r.erpClient)}</span></div>
            <div class="mt-1"><small class="text-muted">外部(B欄CUSTID):</small> <span style="${df.client ? hlStyle : ''}">${escapeQuotes(r.extCustId)} <small class="text-secondary">(${escapeQuotes(r.extClientName)})</small></span></div>
        `;

        const codeCell = `
            <div><small class="text-muted">本系統(E欄):</small> <span style="${df.code ? hlStyle : 'font-weight:bold;'}">${escapeQuotes(r.erpCode)}</span></div>
            <div class="mt-1"><small class="text-muted">外部(D欄ISPN):</small> <span style="${df.code ? hlStyle : ''}">${escapeQuotes(r.extCode)}</span></div>
            <div class="small text-secondary mt-1 text-truncate" style="max-width: 240px;" title="${escapeQuotes(r.erpName)}">${escapeQuotes(r.erpName)}</div>
        `;

        const qtyCell = `
            <div><small class="text-muted">本系統(G欄):</small> <span style="${df.qty ? hlStyle : 'font-weight:bold;'}">${r.erpQty !== null ? r.erpQty : '--'}</span> ${r.erpMergeCount > 1 ? `<span class="badge bg-light text-secondary border">合併${r.erpMergeCount}筆</span>` : ''}</div>
            <div class="mt-1"><small class="text-muted">外部(E欄QTY):</small> <span style="${df.qty ? hlStyle : ''}">${r.extQty !== null ? r.extQty : '--'}</span> ${r.extMergeCount > 1 ? `<span class="badge bg-light text-secondary border">合併${r.extMergeCount}筆</span>` : ''}</div>
        `;

        const priceCell = `
            <div><small class="text-muted">本系統(H欄):</small> <span style="${df.price ? hlStyle : 'font-weight:bold;'}">${r.erpPrice !== null ? '$' + r.erpPrice.toLocaleString() : '--'}</span></div>
            <div class="mt-1"><small class="text-muted">外部(G欄PRICE):</small> <span style="${df.price ? hlStyle : ''}">${r.extPrice !== null ? '$' + r.extPrice.toLocaleString() : '--'}</span></div>
        `;

        const totalCell = `
            <div><small class="text-muted">本系統(I欄):</small> <span style="${df.total ? hlStyle : 'font-weight:bold;'}">${r.erpTotal !== null ? '$' + r.erpTotal.toLocaleString() : '--'}</span></div>
            <div class="mt-1"><small class="text-muted">外部(H欄TOTAL):</small> <span style="${df.total ? hlStyle : ''}">${r.extTotal !== null ? '$' + r.extTotal.toLocaleString() : '--'}</span></div>
        `;

        const diffDescHtml = r.diffs.length > 0
            ? r.diffs.map(d => `<div class="text-danger small fw-bold mb-1">▪ ${escapeQuotes(d)}</div>`).join('')
            : `<div class="text-success small fw-bold">✓ 發票、客戶代號、長固代號、數量、單價、總價全數吻合</div>`;

        return `
        <tr style="${r.category !== 'MATCH' ? 'background-color: #fffdfd;' : ''}">
            <td class="text-center fw-bold text-secondary">${idx + 1}</td>
            <td>
                <div class="fw-bold text-primary fs-6">${escapeQuotes(r.invNo)}</div>
                <div class="small text-muted">${escapeQuotes(r.date || '')}</div>
                <div class="mt-1">${badgeMap[r.category] || ''}</div>
                ${r.erpOrderNo && r.erpOrderNo !== '--' ? `<div class="small text-secondary mt-1">本系統單號: ${escapeQuotes(r.erpOrderNo)}</div>` : ''}
                ${r.extPoNo && r.extPoNo !== '--' ? `<div class="small text-secondary">外部單號/備註: ${escapeQuotes(r.extPoNo)}</div>` : ''}
            </td>
            <td>${clientCell}</td>
            <td>${codeCell}</td>
            <td class="text-end">${qtyCell}</td>
            <td class="text-end">${priceCell}</td>
            <td class="text-end">${totalCell}</td>
            <td style="min-width: 220px;">${diffDescHtml}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <div class="table-responsive border rounded shadow-sm" style="max-height: 620px; overflow-y: auto;">
        <table class="table table-hover table-bordered align-middle mb-0" style="font-size: 0.88rem;">
            <thead class="table-light position-sticky top-0" style="z-index: 5;">
                <tr>
                    <th class="text-center" style="width: 45px;">#</th>
                    <th style="min-width: 150px;">發票號碼 (B欄 vs J欄)</th>
                    <th style="min-width: 190px;">客戶名稱 (C欄 vs B欄CUSTID)</th>
                    <th style="min-width: 190px;">長固代號 (E欄 vs D欄ISPN)</th>
                    <th class="text-end" style="min-width: 125px;">數量 (G欄 vs E欄)</th>
                    <th class="text-end" style="min-width: 130px;">單價 (H欄 vs G欄)</th>
                    <th class="text-end" style="min-width: 135px;">總價 (I欄 vs H欄)</th>
                    <th style="min-width: 240px;">AI 智慧勾稽診斷說明</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    </div>`;
};

// 匯出精美排版好的跨系統比對差異 Excel 檔案
window.exportReconciliationExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍後再試！");
    const results = window.reconcileState.results || [];
    if (results.length === 0) return alert("目前無比對結果可供下載！");

    const statusLabelMap = {
        'VALUE_DIFF': '🟡 欄位數值相異',
        'ONLY_EXT': '🔴 僅外部系統有 (本系統出貨明細缺漏)',
        'ONLY_ERP': '🔵 僅本系統有 (外部系統缺漏/借用)',
        'MATCH': '🟢 完全吻合'
    };

    const buildSheetRows = (targetList) => {
        const header = [
            "比對狀態",
            "日期",
            "發票號碼 (本系統B欄 / 外部J欄NOINVOICE)",
            "本系統客戶名稱 (C欄)",
            "外部客戶代號 (B欄CUSTID)",
            "外部代號對應客戶名",
            "本系統長固代號 (E欄)",
            "外部長固代號 (D欄ISPN)",
            "品名規格",
            "本系統數量 (G欄)",
            "外部數量 (E欄QTY)",
            "數量差額",
            "本系統單價 (H欄)",
            "外部單價 (G欄PRICE)",
            "單價差額",
            "本系統總價 (I欄)",
            "外部總價 (H欄TOTAL)",
            "總價差額",
            "本系統訂單號碼",
            "外部PONUMBER/備註",
            "差異原因與人工複查說明"
        ];

        const rows = [header];
        targetList.forEach(r => {
            const qtyDiff = (r.erpQty !== null && r.extQty !== null) ? (r.erpQty - r.extQty) : '';
            const priceDiff = (r.erpPrice !== null && r.extPrice !== null) ? Math.round((r.erpPrice - r.extPrice) * 1000) / 1000 : '';
            const totalDiff = (r.erpTotal !== null && r.extTotal !== null) ? Math.round((r.erpTotal - r.extTotal) * 100) / 100 : '';

            rows.push([
                statusLabelMap[r.category] || r.category,
                r.date || '',
                r.invNo || '',
                r.erpClient || '',
                r.extCustId || '',
                r.extClientName || '',
                r.erpCode || '',
                r.extCode || '',
                r.erpName || '',
                r.erpQty !== null ? r.erpQty : '',
                r.extQty !== null ? r.extQty : '',
                qtyDiff,
                r.erpPrice !== null ? r.erpPrice : '',
                r.extPrice !== null ? r.extPrice : '',
                priceDiff,
                r.erpTotal !== null ? r.erpTotal : '',
                r.extTotal !== null ? r.extTotal : '',
                totalDiff,
                r.erpOrderNo || '',
                r.extPoNo || '',
                r.diffs.length > 0 ? r.diffs.join('； ') : '6大欄位完全吻合'
            ]);
        });
        return rows;
    };

    const setSheetColWidths = (ws) => {
        ws['!cols'] = [
            { wch: 28 }, { wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 16 },
            { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 34 }, { wch: 14 },
            { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
            { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 18 },
            { wch: 65 }
        ];
    };

    const allDiffList = results.filter(r => r.category !== 'MATCH');
    const valDiffList = results.filter(r => r.category === 'VALUE_DIFF');
    const missingList = results.filter(r => r.category === 'ONLY_EXT' || r.category === 'ONLY_ERP');
    const matchList   = results.filter(r => r.category === 'MATCH');

    const wb = XLSX.utils.book_new();

    // 工作表 1: 異常差異總表 (最優先供人工複查)
    const wsAllDiff = XLSX.utils.aoa_to_sheet(buildSheetRows(allDiffList));
    setSheetColWidths(wsAllDiff);
    XLSX.utils.book_append_sheet(wb, wsAllDiff, "1_異常差異總表");

    // 工作表 2: 欄位數值不符明細
    const wsValDiff = XLSX.utils.aoa_to_sheet(buildSheetRows(valDiffList));
    setSheetColWidths(wsValDiff);
    XLSX.utils.book_append_sheet(wb, wsValDiff, "2_欄位數值不符明細");

    // 工作表 3: 單邊缺漏明細
    const wsMissing = XLSX.utils.aoa_to_sheet(buildSheetRows(missingList));
    setSheetColWidths(wsMissing);
    XLSX.utils.book_append_sheet(wb, wsMissing, "3_單邊缺漏明細");

    // 工作表 4: 完全吻合明細
    const wsMatch = XLSX.utils.aoa_to_sheet(buildSheetRows(matchList));
    setSheetColWidths(wsMatch);
    XLSX.utils.book_append_sheet(wb, wsMatch, "4_完全吻合明細");

    // 工作表 5: 後台自動生成之本系統同區間「出貨明細」原始基準表
    const erpHeader = ["開立日期", "發票號碼", "客戶名稱", "訂單編號", "長固代號", "品名", "開立數量", "單價(含稅)", "總價(含稅)", "出貨狀態", "已出貨數量"];
    const erpRows = [erpHeader];
    (window.reconcileState.erpGeneratedRows || []).forEach(r => {
        erpRows.push([r.date, r.paperNo, r.client, r.orderNo, r.internalCode, r.name, r.qty, r.price, r.subtotal, r.shipStatus, r.shippedQty]);
    });
    const wsErpBase = XLSX.utils.aoa_to_sheet(erpRows);
    wsErpBase['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsErpBase, "5_本系統同區間出貨明細");

    const rangeStr = `${window.reconcileState.startDate || ''}_至_${window.reconcileState.endDate || ''}`;
    const outFileName = `長固ERP_跨系統比對差異報告_${rangeStr}.xlsx`;
    XLSX.writeFile(wb, outFileName);
    showToast("📥 跨系統比對差異 Excel 報表已成功下載！");
};
