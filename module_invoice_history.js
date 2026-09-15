/**
 * ============================================================================
 * 模組 3：開立發票、歷史紀錄與報表 (module_invoice_history.js)
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

// ============================================================================
// 發票模組 - 品項拖曳與渲染
// ============================================================================
window.renderSingleInvoiceItem = function(item) {
    let isMatch = item.product ? true : false;
    let price = item.product ? item.product.price : 0;
    let unit = item.product ? item.product.unit : '式';
    let name = item.product ? item.product.productName : '';
    return `<div class="item-row border-primary draggable-row" id="${item.id}" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'invoice')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${item.id}', 'invoice')" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">
        <div class="drag-handle position-absolute" style="top:10px; left:10px; cursor:grab; font-size: 1.2rem; color: #adb5bd;" title="按住拖曳排序">☰</div>
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:10px; right:10px;" onclick="removeInvItem('${item.id}')">✕</button>
        <div class="ps-4">
            <label class="form-label text-primary fw-bold small">${isMatch ? '✅ 已對應價表' : '⚠️ 價格或品項待確'}</label>
            <input type="text" class="form-control fake-input-btn mb-2" id="prodInput_${item.id}" value="${escapeQuotes(name)}" readonly placeholder="點此選擇品項..." onclick="openSearchModal('item_${item.id}', (val)=>selectProductForInv('${item.id}', val))">
            <div id="prodInfo_${item.id}" class="small text-muted mb-2 px-1">${isMatch ? `單價: $${price} | 單位: ${unit}` : ''}</div>
            <div class="row g-2">
                <div class="col-6"><label class="form-label fw-bold small">本次開立數量 (可修改)</label><input type="number" class="form-control" id="qty_${item.id}" value="${item.qty}" min="0" step="any" oninput="updateInvQty('${item.id}', this.value)"></div>
                <div class="col-6"><label class="form-label fw-bold small">歸屬訂單 / 單位</label><input type="text" class="form-control bg-light text-secondary" value="${escapeQuotes(`${item.orderRef || ''} ${item.deptRef || ''}`.trim())}" readonly></div>
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
    const p = globalCatalog.find(x => x.clientName === currentInvoiceData.clientName && x.productName === prodName); 
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
    const orderNo = document.getElementById('invOrderNo').value; 
    const paperNo = document.getElementById('invPaperNo').value.toUpperCase(); 
    const invDateVal = document.getElementById('invDate').value; 
    const invDateTimestamp = invDateVal ? new Date(invDateVal).getTime() : Date.now();
    
    const payloadItems = currentInvoiceData.validItems.map(i => ({ 
        name: i.product.productName, internalCode: i.product.internalCode || i.product.assetCode || "", 
        qty: i.qty, unit: i.product.unit, price: i.product.price, subtotal: i.qty * i.product.price 
    }));
    
    const payload = { 
        invDate: invDateTimestamp, staff: myName, clientName: currentInvoiceData.clientName, 
        taxId: currentInvoiceData.taxId, netTotal: currentInvoiceData.finalNet, 
        tax: currentInvoiceData.finalTax, totalWithTax: currentInvoiceData.finalTotal, 
        detailsStr: currentInvoiceData.detailsStr, paperNo: paperNo, orderNo: orderNo, items: payloadItems 
    };
    
    globalHistory.unshift({ 
        rowIdx: 9999, time: invDateTimestamp, staff: myName, client: payload.clientName, 
        taxId: payload.taxId, net: payload.netTotal, tax: payload.tax, total: payload.totalWithTax, 
        details: payload.detailsStr, paperNo: payload.paperNo, orderNo: payload.orderNo, status: "正常", historyLog: "[]" 
    });
    
    payloadItems.forEach(pi => { 
        let tempIdx = -Math.floor(Math.random() * 1000000); 
        globalSalesDetails.unshift({ 
            rowIdx: tempIdx, time: invDateTimestamp, paperNo: paperNo, client: payload.clientName, 
            orderNo: orderNo, name: pi.name, qty: pi.qty, price: pi.price, subtotal: pi.subtotal, 
            shippedQty: 0, shipStatus: '待出貨' 
        }); 
    });
    
    pushToSyncQueue('submitInvoice', payload, null);
    
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
            const unTaxedP = (item.product.price / 1.05).toFixed(3); 
            const unTaxedS = item.adjustedUnTaxedSub;
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
window.renderHistory = debounce(function() {
    const fStaff = document.getElementById('histFilterStaff').value; 
    const fClient = document.getElementById('histFilterClient').value; 
    const fDate = document.getElementById('histFilterDate').value; 
    const fStatus = document.getElementById('histFilterStatus').value; 
    const term = document.getElementById('histSearch').value.toLowerCase();
    
    let filtered = globalHistory;
    if(fStaff) filtered = filtered.filter(h => h.staff === fStaff); 
    if(fClient) filtered = filtered.filter(h => h.client === fClient); 
    if(fStatus) filtered = filtered.filter(h => h.status === fStatus);
    if(fDate) { 
        const target = new Date(fDate).setHours(0,0,0,0); 
        filtered = filtered.filter(h => { const d = new Date(h.time).setHours(0,0,0,0); return d === target; }); 
    }
    if(term) filtered = filtered.filter(h => h.client.toLowerCase().includes(term) || String(h.paperNo).toLowerCase().includes(term) || h.details.toLowerCase().includes(term));
    
    const c = document.getElementById('histListContainer'); 
    if(filtered.length === 0) return c.innerHTML = '<div class="text-center text-muted py-4">無紀錄</div>';
    
    c.innerHTML = filtered.map(h => {
        const d = new Date(h.time); 
        const dateStr = isNaN(d.getTime()) ? '未知' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const isVoid = h.status === '作廢'; 
        const isEdited = h.historyLog && h.historyLog.length > 2;
        let badgeHTML = isVoid ? '<span class="badge bg-danger ms-1">已作廢</span>' : '';
        if(isEdited && !isVoid) badgeHTML += `<span class="badge bg-warning text-dark ms-1" onclick="alert('修改紀錄：\\n${escapeQuotes(JSON.parse(h.historyLog).join('\\n'))}')" style="cursor:pointer;">⚠️ 已修改</span>`;
        return `<div class="item-row bg-white shadow-sm p-3 ${isVoid?'status-void':''}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                <div><div class="fw-bold fs-6 text-dark">${h.client} ${badgeHTML}</div><div class="small text-muted">單號: ${h.orderNo||'--'} | 開立: ${h.staff}</div></div>
                <div class="text-end"><div class="badge bg-light text-dark border">${dateStr}</div><div class="small text-muted mt-1 fw-bold text-danger">${h.paperNo?'發票: '+h.paperNo:''}</div></div>
            </div>
            <div class="history-details text-muted mb-3">${h.details}</div>
            <div class="d-flex justify-content-between align-items-center">
                <div>${!isVoid ? `<button class="btn btn-sm btn-outline-info me-1 fw-bold" onclick="printDeliveryNote(${h.rowIdx})">🖨️ 列印出單</button><button class="btn btn-sm btn-outline-danger me-1" onclick="voidInv(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">作廢</button><button class="btn btn-sm btn-outline-secondary" onclick="openEditInv(${h.rowIdx})">編輯</button>` : ''}</div>
                <span class="fw-bold text-danger fs-5">$${Number(h.total).toLocaleString()}</span>
            </div>
        </div>`;
    }).join('');
}, 300);

// 【修復】徹底確保列印出貨單的函數為全域可用
window.printDeliveryNote = function(idx) {
    const h = globalHistory.find(x => x.rowIdx === idx); 
    if (!h) return;
    const items = globalSalesDetails.filter(s => s.paperNo === h.paperNo && s.shipStatus !== '作廢');
    const printDate = new Date(h.time);
    const dateStr = isNaN(printDate.getTime()) ? getTodayStr().replace(/-/g, '/') : `${printDate.getFullYear()}年${printDate.getMonth() + 1}月${printDate.getDate()}日`;

    let tbodyHtml = '';
    if (items.length > 0) {
        items.forEach(item => {
            const inv = globalInventory.find(v => v.name === item.name);
            const lotExp = inv ? `${inv.lot||''} ${inv.expiry||''}`.trim() : '';
            tbodyHtml += `
                <tr>
                    <td style="border: 1px solid #333; padding: 8px; text-align: left;">${item.name}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center;">${item.qty}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center;">0</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: right;">${Number(item.price).toLocaleString()}</td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: right;">
                        ${Number(item.subtotal).toLocaleString()}<br>
                        <span style="font-size: 11px; color: #555;">${item.orderNo || ''}</span>
                    </td>
                    <td style="border: 1px solid #333; padding: 8px; text-align: center; font-size: 11px;">${lotExp}</td>
                </tr>
            `;
        });
    } else {
        tbodyHtml = `<tr><td colspan="6" style="border: 1px solid #333; padding: 8px; text-align: center;">(無明細資料或為舊資料)</td></tr>`;
    }

    const html = `
        <div style="padding: 0; width: 100%; box-sizing: border-box;">
            <table style="width: 100%; border: none; margin-bottom: 15px;">
                <tr>
                    <td style="width: 50%; vertical-align: top;">
                        <div style="font-weight: bold; font-size: 16px;">TO:</div>
                        <div style="font-weight: bold; font-size: 22px; margin-top: 5px; letter-spacing: 2px;">${h.client}</div>
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
                        <th style="border: 1px solid #333; padding: 8px; width: 120px; text-align: center;">小計 客戶訂單號</th>
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
                <div style="display: flex; justify-content: space-between; margin-top: 30px;">
                    <div style="width: 45%;">簽收: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div>
                    <div style="width: 45%;">備考: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('printArea').innerHTML = html;
    
    // 切換列印模式：顯示出貨單，隱藏訂購單
    document.getElementById('printArea').classList.add('print-active');
    if (document.getElementById('printPoArea')) document.getElementById('printPoArea').classList.remove('print-active');
    
    setTimeout(() => { window.print(); }, 300);
};

window.voidInv = function(idx, pNo) { 
    if(confirm("確定作廢？系統將自動：\n1. 註銷此發票帳款\n2. 註銷銷售明細\n3. 【自動返還已出貨之庫存數量】")) { 
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
        
        populateLogDropdowns(); window.renderHistory(); window.renderInventory(); window.renderInvLogs(); renderShipments(); generateReport(); 
        pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: idx, staff: myName, paperNo: pNo}, null); 
        showToast("🗑️ 已作廢並返還庫存");
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
    const idx = parseInt(document.getElementById('e_invRow').value); 
    const h = globalHistory.find(x=>x.rowIdx === idx); 
    const data = { 
        client: h.client, taxId: h.taxId, paperNo: document.getElementById('e_invPaper').value.toUpperCase(), 
        orderNo: document.getElementById('e_invOrder').value, net: document.getElementById('e_invNet').value, 
        tax: Math.round(document.getElementById('e_invTotal').value - document.getElementById('e_invNet').value), 
        total: document.getElementById('e_invTotal').value, details: document.getElementById('e_invDetails').value 
    }; 
    if(h) { Object.assign(h, data); h.historyLog = "[\"修改紀錄存在\"]"; } 
    window.renderHistory(); 
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
    if(!sVal || !eVal) return alert("請先設定日期");
    
    const email = prompt("接收報表的 Email："); if(!email) return; 
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
            lines.push({ time: `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`, paperNo: s.paperNo, client: s.client, orderNo: s.orderNo, name: s.name, qty: s.qty, price: 0, shipStatus: s.shipStatus, shippedQty: s.shippedQty }); 
        } 
    });
    
    const payload = { 
        email: email, dateRange: `${sVal} ~ ${eVal}`, summary: { count: rCount, net: rNet, tax: rTax, total: rTotal }, 
        clientStats: Object.keys(clientStats).map(k=>({name:k, total:clientStats[k]})).sort((a,b)=>b.total-a.total), 
        details: details.reverse(), lineItems: lines.reverse() 
    };
    
    callApi('exportExcelReport', payload).then(res => { 
        hideLoading(); alert(`✅ 報表已寄送至 ${email}`); 
    }).catch(err => { hideLoading(); alert("匯出失敗：" + err.message); });
};
