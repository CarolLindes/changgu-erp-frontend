/**
 * ============================================================================
 * 模組 3：開立發票、歷史紀錄、統計報表五表預覽中心、跨系統比對 ＆ 三聯/二聯發票明細表 (module_invoice_history.js)
 * 【防連點、待補訂單號連動補登、統計報表5表互動預覽/選印/分享/寄信 ＆ 稅捐處雙明細表旗艦版】
 * ============================================================================
 */

// ============================================================================
// 0. 發票字軌智慧識別引擎 (自動分辨「三聯式 / 二聯式」與「法定雙月所屬期別」)
// ============================================================================
const TRACK_TYPE_OVERRIDE_STORAGE_KEY = 'changgu_erp_invoice_track_type_overrides_v1';

window.BUILTIN_INVOICE_TRACK_TYPES = {
    // 三聯式字軌
    'EC': 'THREE_PART',
    'CA': 'THREE_PART',
    'ZX': 'THREE_PART',
    'XV': 'THREE_PART',
    'VT': 'THREE_PART',
    'TT': 'THREE_PART',
    'RT': 'THREE_PART',
    // 二聯式字軌
    'EE': 'TWO_PART',
    'CC': 'TWO_PART',
    'ZZ': 'TWO_PART'
};

window.BUILTIN_TRACK_BI_MONTH_MAP = {
    'RT': [9, 10],
    'TT': [11, 12],
    'VT': [1, 2],
    'XV': [3, 4],
    'ZX': [5, 6],
    'ZZ': [5, 6],
    'CA': [7, 8],
    'CC': [7, 8],
    'EC': [9, 10],
    'EE': [9, 10]
};

window.getTrackTypeOverrides = function() {
    try {
        const raw = localStorage.getItem(TRACK_TYPE_OVERRIDE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
};

window.setTrackTypeOverride = function(track, formType) {
    if (!track || track.length !== 2) return;
    const cleanTrack = String(track).trim().toUpperCase();
    const map = window.getTrackTypeOverrides();
    map[cleanTrack] = formType;
    try {
        localStorage.setItem(TRACK_TYPE_OVERRIDE_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {}
};

window.getBiMonthPair = function(month) {
    const m = parseInt(month, 10) || 1;
    const startM = (m % 2 === 1) ? m : (m - 1);
    return [startM, startM + 1];
};

window.checkTrackPeriodMatch = function(track, targetWestYear, targetMonth) {
    const cleanTrack = String(track || '').trim().toUpperCase();
    if (cleanTrack.length !== 2) return { isMatch: true, expectedMonths: null };

    const targetPair = window.getBiMonthPair(targetMonth);

    if (window.BUILTIN_TRACK_BI_MONTH_MAP[cleanTrack]) {
        const expPair = window.BUILTIN_TRACK_BI_MONTH_MAP[cleanTrack];
        const isMatch = expPair.includes(Number(targetMonth));
        return { isMatch: isMatch, expectedMonths: expPair };
    }

    const pairCounts = {};
    let totalValid = 0;
    (globalHistory || []).forEach(h => {
        if (!h || h.status === '作廢') return;
        const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!pNo.startsWith(cleanTrack)) return;
        const d = new Date(h.time);
        if (isNaN(d.getTime())) return;
        const m = d.getMonth() + 1;
        const pair = window.getBiMonthPair(m);
        const key = pair.join('-');
        pairCounts[key] = (pairCounts[key] || 0) + 1;
        totalValid++;
    });

    if (totalValid >= 5) {
        let dominantKey = null;
        let maxCnt = 0;
        Object.keys(pairCounts).forEach(k => {
            if (pairCounts[k] > maxCnt) {
                maxCnt = pairCounts[k];
                dominantKey = k;
            }
        });
        if (dominantKey && (maxCnt / totalValid) >= 0.8) {
            const expPair = dominantKey.split('-').map(Number);
            const isMatch = expPair.includes(Number(targetMonth));
            return { isMatch: isMatch, expectedMonths: expPair };
        }
    }

    return { isMatch: true, expectedMonths: targetPair };
};

window.getInvoiceFormTypeByTrack = function(trackOrPaperNo, fallbackTaxId) {
    const cleanStr = String(trackOrPaperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const m = cleanStr.match(/^([A-Z]{2})/);
    const track = m ? m[1] : '';

    if (track) {
        const overrides = window.getTrackTypeOverrides();
        if (overrides[track]) return overrides[track];

        if (window.BUILTIN_INVOICE_TRACK_TYPES[track]) {
            return window.BUILTIN_INVOICE_TRACK_TYPES[track];
        }

        const sameTrackInvs = (globalHistory || []).filter(h => {
            if (!h || h.status === '作廢') return false;
            const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            return pNo.startsWith(track);
        });

        if (sameTrackInvs.length > 0) {
            let withTaxIdCount = 0;
            let withoutTaxIdCount = 0;
            sameTrackInvs.forEach(h => {
                const cObj = (globalClients || []).find(c => c.name === h.client);
                const tId = String(h.taxId || (cObj ? cObj.taxId : '') || '').trim();
                if (/^\d{8}$/.test(tId)) withTaxIdCount++;
                else withoutTaxIdCount++;
            });
            if (withoutTaxIdCount > withTaxIdCount) return 'TWO_PART';
            if (withTaxIdCount > 0) return 'THREE_PART';
        }
    }

    if (fallbackTaxId !== undefined) {
        return /^\d{8}$/.test(String(fallbackTaxId || '').trim()) ? 'THREE_PART' : 'TWO_PART';
    }
    return 'THREE_PART';
};

window.getPrefixHammingDistance = function(strA, strB) {
    const a = String(strA || '');
    const b = String(strB || '');
    if (a.length !== 6 || b.length !== 6) return 99;
    let diff = 0;
    for (let i = 0; i < 6; i++) {
        if (a[i] !== b[i]) diff++;
    }
    return diff;
};

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
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${c.taxId||'無 — 適用二聯式發票'})`; 
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
// 發票模組 - 預覽與送出 (自動依字軌識別三聯式 / 二聯式)
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
        const paperNoVal = document.getElementById('invPaperNo') ? document.getElementById('invPaperNo').value.toUpperCase() : '';
        const formType = window.getInvoiceFormTypeByTrack(paperNoVal, currentInvoiceData.taxId);
        const isTwoPart = (formType === 'TWO_PART');

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
        currentInvoiceData.formType = formType;
        currentInvoiceData.detailsStr = validItems.map(x => `${x.product.productName || ''} x${x.qty} (單價: $${(parseFloat(x.product.price)||0).toFixed(3)}) ${x.formattedRemark ? '[' + x.formattedRemark + ']' : ''}`).join('\n');

        setSafeText('prevClientName', currentInvoiceData.clientName || '無'); 
        setSafeText('prevTaxId', currentInvoiceData.taxId || (isTwoPart ? '無 (二聯式)' : '無')); 
        setSafeText('prevOrderNo', orderNoStr || '無'); 
        setSafeText('prevPaperNo', (paperNoVal || '無') + (isTwoPart ? ' [📗二聯式]' : ' [📘三聯式]')); 
        setSafeText('prevInvDate', invDateStr); 
        setSafeText('prevNet', netTotal.toLocaleString()); 
        setSafeText('prevTax', tax.toLocaleString()); 
        setSafeText('prevTotal', totalWithTax.toLocaleString()); 
        
        goStep(4);
    } catch(err) { alert("預覽結算時發生錯誤: " + err.message); }
};

window.submitInvoiceOptimistic = function() {
    const btn = event ? event.currentTarget : null;
    if(window.lockButton(btn)) return;

    const orderNo = document.getElementById('invOrderNo').value.trim(); 
    const paperNo = document.getElementById('invPaperNo').value.toUpperCase(); 
    const invDateVal = document.getElementById('invDate').value; 
    const invDateTimestamp = invDateVal ? new Date(invDateVal).getTime() : Date.now();
    const isTwoPart = (window.getInvoiceFormTypeByTrack(paperNo, currentInvoiceData.taxId) === 'TWO_PART');
    
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
            orderNo: orderNo, name: pi.name, qty: pi.qty, unit: pi.unit, price: pi.price, subtotal: pi.subtotal, 
            shippedQty: 0, shipStatus: '待出貨', lot: '', expiry: '',
            payStatus: '未收款', paidAmount: 0, payDate: '', paymentNo: ''
        }); 
    });
    
    pushToSyncQueue('submitInvoice', payload, null);
    if (typeof window.renderOrderList === 'function') window.renderOrderList();
    
    const headerSubEl = document.querySelector('#invStep5 .invoice-header .fs-5');
    if (headerSubEl) {
        headerSubEl.innerText = isTwoPart ? '（二聯式）' : '（三聯式）';
    }

    setSafeText('visBuyer', payload.clientName); 
    setSafeText('visTaxId', payload.taxId || (isTwoPart ? '（二聯式免填統編）' : '')); 
    setSafeText('visPaperNo', paperNo); 
    setSafeText('visInvDate', invDateVal.replace(/-/g, '/')); 
    setSafeText('visNet', isTwoPart ? payload.totalWithTax.toLocaleString() + ' (含稅)' : payload.netTotal.toLocaleString()); 
    setSafeText('visTax', isTwoPart ? '內含' : payload.tax.toLocaleString()); 
    setSafeText('visTotal', payload.totalWithTax.toLocaleString());
    
    const tbody = document.getElementById('visTbody'); tbody.innerHTML = '';
    for(let i=0; i < Math.max(currentInvoiceData.validItems.length, 5); i++) {
        if(i < currentInvoiceData.validItems.length) {
            const item = currentInvoiceData.validItems[i]; 
            const qtyNum = parseFloat(item.qty) || 1;
            if (isTwoPart) {
                const taxIncP = Number(item.product.price || 0);
                const taxIncS = Math.round(qtyNum * taxIncP);
                tbody.innerHTML += `<tr><td class="text-start highlight-data">${item.product.productName}</td><td class="highlight-data">${item.qty} ${item.product.unit}</td><td class="text-end highlight-data">${taxIncP.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td class="text-end highlight-data">${taxIncS.toLocaleString()}</td><td class="highlight-data" style="font-size:0.8rem;">${item.formattedRemark}</td></tr>`;
            } else {
                const unTaxedS = Number(item.adjustedUnTaxedSub) || 0;
                const unTaxedP = Number((unTaxedS / qtyNum).toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
                tbody.innerHTML += `<tr><td class="text-start highlight-data">${item.product.productName}</td><td class="highlight-data">${item.qty} ${item.product.unit}</td><td class="text-end highlight-data">${unTaxedP}</td><td class="text-end highlight-data">${unTaxedS.toLocaleString()}</td><td class="highlight-data" style="font-size:0.8rem;">${item.formattedRemark}</td></tr>`;
            }
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
// 歷史紀錄模組 (含三聯式/二聯式字軌智慧徽章 ＆ 待補訂單號碼一鍵補登按鈕)
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
            String(h.orderNo || '').toLowerCase().includes(term) || 
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
        const isPendOrd = window.isPendingOrderNo ? window.isPendingOrderNo(h.orderNo) : (!h.orderNo || h.orderNo === '無');
        const formType = window.getInvoiceFormTypeByTrack(h.paperNo, h.taxId);
        const formTypeBadge = !isBorrowed && h.paperNo
            ? (formType === 'TWO_PART'
                ? `<span class="badge bg-success bg-opacity-10 text-success border border-success ms-1">📗 二聯式</span>`
                : `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary ms-1">📘 三聯式</span>`)
            : '';
        
        let paperNoHtml = '';
        if (h.paperNo) {
            paperNoHtml = isBorrowed ? '<span class="text-danger">⚠️ ' + h.paperNo + '</span>' : '發票: ' + h.paperNo + formTypeBadge;
        }

        const orderNoDisplayHtml = isPendOrd
            ? `<span class="text-danger fw-bold">⏳ ${escapeQuotes(h.orderNo || '[待補單號]')}</span>`
            : escapeQuotes(h.orderNo || '--');

        let actionBtns = '';
        if (!isVoid) {
            actionBtns += `<button class="btn btn-sm btn-outline-info me-1 fw-bold" onclick="printDeliveryNote(${h.rowIdx})">🖨️ 列印出單</button>`;
            if (isBorrowed) actionBtns += `<button class="btn btn-sm btn-danger me-1 fw-bold" onclick="openSuppInvModal(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">📝 補登發票</button>`;
            if (isPendOrd && typeof window.openSuppOrderNoModal === 'function') {
                actionBtns += `<button class="btn btn-sm btn-warning text-dark me-1 fw-bold shadow-sm" onclick="window.openSuppOrderNoModal({ invoiceRowIdx: ${h.rowIdx}, oldOrderNo: '${escapeQuotes(h.orderNo || '')}', clientName: '${escapeQuotes(h.client || '')}' })">📝 補登訂單號</button>`;
            }
            actionBtns += `<button class="btn btn-sm btn-outline-danger me-1" onclick="voidInv(${h.rowIdx}, '${escapeQuotes(h.paperNo)}')">作廢</button>`;
            actionBtns += `<button class="btn btn-sm btn-outline-secondary" onclick="openEditInv(${h.rowIdx})">編輯</button>`;
        }

        return `<div class="item-row bg-white shadow-sm p-3 ${isVoid?'status-void':''}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                <div><div class="fw-bold fs-6 text-dark">${h.client} ${badgeHTML}</div><div class="small text-muted">單號: ${orderNoDisplayHtml} | 開立: ${h.staff}</div></div>
                <div class="text-end"><div class="badge bg-light text-dark border">${dateStr}</div><div class="small mt-1 fw-bold ${isBorrowed?'text-danger':'text-primary'}">${paperNoHtml}</div></div>
            </div>
            <div class="history-details text-muted mb-3">${h.details}</div>
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-1">
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
    if(window.lockButton(btn)) return;
    
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
        if(window.lockButton(btn)) return;
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
        if(document.getElementById('tdControlPanel')) window.onTaxPeriodChange();
        
        pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: idx, staff: myName, paperNo: pNo}, null); 
        showToast("🗑️ 已作廢並返還庫存，相關送貨單已同步註銷");
    } 
};

window.openEditInv = function(idx, suggestedPaperNo = null, suggestedDateStr = null) { 
    const h = globalHistory.find(x=>x.rowIdx === idx); 
    if(!h) return; 

    const paperInput = document.getElementById('e_invPaper');
    if (paperInput && !document.getElementById('e_invDate')) {
        const dateWrapper = document.createElement('div');
        dateWrapper.className = 'mb-2';
        dateWrapper.innerHTML = `<label class="small text-primary fw-bold">📅 開立日期 (可修正跨期誤植日期)</label><input type="date" class="form-control fw-bold text-primary border-primary" id="e_invDate">`;
        paperInput.parentElement.parentElement.insertBefore(dateWrapper, paperInput.parentElement);
    }

    const d = new Date(h.time);
    const curDateStr = !isNaN(d.getTime())
        ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        : getTodayStr();

    document.getElementById('e_invRow').value = idx; 
    if (document.getElementById('e_invDate')) {
        document.getElementById('e_invDate').value = suggestedDateStr || curDateStr;
    }
    document.getElementById('e_invPaper').value = suggestedPaperNo || h.paperNo; 
    document.getElementById('e_invOrder').value = h.orderNo; 
    document.getElementById('e_invNet').value = h.net; 
    document.getElementById('e_invTotal').value = h.total; 
    document.getElementById('e_invDetails').value = h.details; 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editInvModal')).show(); 
};

window.saveEditInvoice = function() { 
    const btn = event ? event.currentTarget : null;
    if(window.lockButton(btn)) return;

    const idx = parseInt(document.getElementById('e_invRow').value); 
    const h = globalHistory.find(x=>x.rowIdx === idx); 
    if (!h) return;

    const oldPaperNo = h.paperNo || '';
    const newPaperNo = document.getElementById('e_invPaper').value.trim().toUpperCase();
    const newDateVal = document.getElementById('e_invDate')?.value || '';
    const newTimestamp = newDateVal ? (new Date(newDateVal + 'T12:00:00').getTime() || h.time) : h.time;

    const data = { 
        client: h.client,
        taxId: h.taxId,
        paperNo: newPaperNo, 
        orderNo: document.getElementById('e_invOrder').value,
        net: Number(document.getElementById('e_invNet').value) || 0, 
        tax: Math.round((Number(document.getElementById('e_invTotal').value) || 0) - (Number(document.getElementById('e_invNet').value) || 0)), 
        total: Number(document.getElementById('e_invTotal').value) || 0,
        details: document.getElementById('e_invDetails').value 
    }; 

    const dateChanged = (Math.abs(newTimestamp - Number(h.time)) > 43200000);
    Object.assign(h, data);
    h.time = newTimestamp;
    h.historyLog = "[\"修改紀錄存在\"]";

    if (oldPaperNo && newPaperNo && oldPaperNo !== newPaperNo) {
        globalSalesDetails.forEach(sd => {
            if (sd.paperNo === oldPaperNo) {
                sd.paperNo = newPaperNo;
                if (dateChanged) sd.time = newTimestamp;
            }
        });
        pushToSyncQueue('supplementInvoiceNo', { rowIdx: idx, oldPaperNo: oldPaperNo, newPaperNo: newPaperNo, staff: myName }, null);
    } else if (dateChanged && newPaperNo) {
        globalSalesDetails.forEach(sd => {
            if (sd.paperNo === newPaperNo) sd.time = newTimestamp;
        });
    }

    try {
        if (typeof supabaseClient !== 'undefined') {
            supabaseClient.from('invoices').update({
                time: newTimestamp,
                paper_no: newPaperNo,
                order_no: data.orderNo,
                net: data.net,
                tax: data.tax,
                total: data.total,
                details: data.details
            }).eq('row_idx', idx).then();

            if (dateChanged && newPaperNo) {
                supabaseClient.from('sales_details').update({
                    time: newTimestamp,
                    paper_no: newPaperNo
                }).eq('paper_no', newPaperNo).then();
            }
        }
    } catch (e) {}

    window.renderHistory(); 
    if(typeof window.renderOrderList === 'function') window.renderOrderList();
    if(document.getElementById('tdControlPanel')) window.onTaxPeriodChange();
    bootstrap.Modal.getInstance(document.getElementById('editInvModal')).hide(); 
    pushToSyncQueue('updateInvoiceRecord', {action:'edit', rowIdx: idx, staff: myName, data: data}, null); 
    showToast("✅ 發票資料與日期已成功修正並連動更新！");
};

// ============================================================================
// 📊 【核心升級】統計報表 — 五表連動預覽、網頁互動、下鑽查詢、多選列印與分享/寄信中心
// ============================================================================
window.statReportViewState = {
    startDate: '',
    endDate: '',
    clientFilter: '',
    staffFilter: '',
    formTypeFilter: 'ALL', // 'ALL' | 'THREE_PART' | 'TWO_PART'
    includeVoid: false,
    searchTerm: '',
    activeSheet: 'STAT_S1', // 'STAT_S1' (發票總表) | 'STAT_S2' (出貨明細) | 'STAT_S3' (目前庫存表) | 'STAT_S4' (客戶營收分析表) | 'STAT_S5' (品項銷售統計表)
    drillFilter: null       // { type: 'CLIENT' | 'INVOICE' | 'PRODUCT', value: '', title: '' }
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

window.setReportQuickPreset = function(preset) {
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let sStr = '';
    let eStr = '';

    if (preset === 'THIS_MONTH') {
        sStr = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
        eStr = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else if (preset === 'LAST_MONTH') {
        sStr = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        eStr = fmt(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (preset === 'THIS_QUARTER') {
        const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
        sStr = fmt(new Date(now.getFullYear(), qStartMonth, 1));
        eStr = fmt(now);
    } else if (preset === 'THIS_YEAR') {
        sStr = `${now.getFullYear()}-01-01`;
        eStr = `${now.getFullYear()}-12-31`;
    }

    if (sStr && eStr) {
        if (document.getElementById('repStart')) document.getElementById('repStart').value = sStr;
        if (document.getElementById('repEnd')) document.getElementById('repEnd').value = eStr;
        window.generateReport();
    }
};

// 動態升級「統計報表」頁籤的 KPI 卡片為可點擊互動卡片，並建立「五表預覽與列印中心」全螢幕視窗
window.enhanceReportTabUI = function() {
    ['repCount', 'repNet', 'repTotal'].forEach((id, idx) => {
        const valEl = document.getElementById(id);
        if (!valEl) return;
        const cardBox = valEl.parentElement;
        if (cardBox && !cardBox.dataset.interactiveBound) {
            cardBox.dataset.interactiveBound = '1';
            cardBox.style.cursor = 'pointer';
            cardBox.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
            cardBox.title = '點擊開啟「銷售發票與出貨統計報表 — 五表連動預覽、列印與分享中心」';
            cardBox.onmouseover = function() {
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 6px 16px rgba(13,110,253,0.18)';
            };
            cardBox.onmouseout = function() {
                this.style.transform = '';
                this.style.boxShadow = '';
            };
            cardBox.onclick = function() {
                const defaultSheet = idx === 2 ? 'STAT_S4' : 'STAT_S1';
                window.openStatReportModal(defaultSheet);
            };
            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'mt-1';
            badgeDiv.innerHTML = `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary" style="font-size:0.7rem;">📊 點擊預覽五表與列印</span>`;
            cardBox.appendChild(badgeDiv);
        }
    });

    // 在統計報表主按鈕上方注入快捷期間切換與「📊 預覽五表內容 / 選印 / 下載」雙按鈕組
    const repTotalEl = document.getElementById('repTotal');
    if (repTotalEl && !document.getElementById('statQuickActionToolbar')) {
        const kpiRow = repTotalEl.closest('.row');
        if (kpiRow) {
            const actionBar = document.createElement('div');
            actionBar.id = 'statQuickActionToolbar';
            actionBar.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2 p-2 bg-white border rounded shadow-sm mb-3';
            actionBar.innerHTML = `
                <div class="d-flex flex-wrap align-items-center gap-1">
                    <span class="small fw-bold text-secondary me-1">⚡ 快速期間：</span>
                    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="window.setReportQuickPreset('THIS_MONTH')">本月</button>
                    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="window.setReportQuickPreset('LAST_MONTH')">上月</button>
                    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="window.setReportQuickPreset('THIS_QUARTER')">本季</button>
                    <button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="window.setReportQuickPreset('THIS_YEAR')">今年度</button>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn btn-primary fw-bold shadow-sm px-3" onclick="window.openStatReportModal('STAT_S1')">
                        📊 預覽五表內容 / 選印 / 下載 Excel
                    </button>
                    <button type="button" class="btn btn-outline-success fw-bold shadow-sm px-3" onclick="window.openEmailModalFromStatReport()">
                        📧 直接選信箱寄送 Excel
                    </button>
                </div>
            `;
            kpiRow.parentNode.insertBefore(actionBar, kpiRow.nextSibling);
        }
    }

    // 建立「📊 銷售發票與出貨統計報表 — 五表連動預覽與列印中心」全螢幕彈跳視窗
    if (!document.getElementById('statReportPreviewModal')) {
        const modalHtml = `
        <div class="modal fade" id="statReportPreviewModal" tabindex="-1">
            <div class="modal-dialog modal-fullscreen-lg-down modal-xl" style="max-width: 96vw;">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white py-2" style="background: linear-gradient(90deg, #0d6efd 0%, #0a58ca 100%);">
                        <div>
                            <h5 class="modal-title fw-bold mb-0">📊 銷售發票與出貨統計報表 — 五表連動預覽、選印與分享中心</h5>
                            <div class="small opacity-75">即時檢視【1.發票總表】、【2.出貨明細】、【3.目前庫存表】、【4.客戶營收分析表】、【5.品項銷售統計表】，支援點擊下鑽、勾選工作表列印、轉存 PDF、下載 Excel 與寄信！</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light p-3">
                        <!-- 頂部：區間搜尋、複合篩選與列印/下載/寄信控制列 -->
                        <div class="row g-2 mb-3">
                            <div class="col-12 col-lg-7">
                                <div class="p-3 bg-white border rounded shadow-sm h-100">
                                    <!-- 第一排：起訖日期區間 ＋ 快捷期間按鈕 -->
                                    <div class="d-flex flex-wrap align-items-center gap-2 mb-2 pb-2 border-bottom">
                                        <span class="small fw-bold text-primary">📅 統計期間：</span>
                                        <div class="d-flex align-items-center gap-1">
                                            <input type="date" id="srStartDate" class="form-control form-control-sm fw-bold border-primary" onchange="window.onChangeStatReportModalFilter()">
                                            <span class="fw-bold text-muted">～</span>
                                            <input type="date" id="srEndDate" class="form-control form-control-sm fw-bold border-primary" onchange="window.onChangeStatReportModalFilter()">
                                        </div>
                                        <div class="btn-group btn-group-sm flex-wrap" role="group">
                                            <button type="button" class="btn btn-outline-primary fw-bold" onclick="window.setStatReportModalQuickDate('THIS_MONTH')">本月</button>
                                            <button type="button" class="btn btn-outline-primary fw-bold" onclick="window.setStatReportModalQuickDate('LAST_MONTH')">上月</button>
                                            <button type="button" class="btn btn-outline-primary fw-bold" onclick="window.setStatReportModalQuickDate('DAYS_30')">近30天</button>
                                            <button type="button" class="btn btn-outline-primary fw-bold" onclick="window.setStatReportModalQuickDate('THIS_QUARTER')">本季</button>
                                            <button type="button" class="btn btn-outline-primary fw-bold" onclick="window.setStatReportModalQuickDate('THIS_YEAR')">今年</button>
                                        </div>
                                    </div>

                                    <!-- 第二排：客戶、員工、聯式、包含作廢開關、關鍵字搜尋 -->
                                    <div class="d-flex flex-wrap align-items-center gap-2">
                                        <select id="srClientFilter" class="form-select form-select-sm fw-bold text-dark" style="max-width: 195px;" onchange="window.onChangeStatReportModalFilter()">
                                            <option value="">🏢 所有客戶 (全部)</option>
                                        </select>
                                        <select id="srStaffFilter" class="form-select form-select-sm fw-bold text-secondary" style="max-width: 135px;" onchange="window.onChangeStatReportModalFilter()">
                                            <option value="">👤 所有員工</option>
                                        </select>
                                        <select id="srFormTypeFilter" class="form-select form-select-sm fw-bold text-secondary" style="max-width: 145px;" onchange="window.onChangeStatReportModalFilter()">
                                            <option value="ALL">🧾 全部發票聯式</option>
                                            <option value="THREE_PART">📘 僅三聯式發票</option>
                                            <option value="TWO_PART">📗 僅二聯式發票</option>
                                        </select>
                                        <input type="search" id="srSearchInput" class="form-control form-control-sm fw-bold" style="max-width: 200px;" placeholder="🔍 搜發票、單號、品名..." oninput="window.onChangeStatReportModalFilter()">
                                        <div class="form-check form-switch mb-0 ms-1">
                                            <input class="form-check-input" type="checkbox" id="srIncludeVoidSwitch" onchange="window.onChangeStatReportModalFilter()" style="cursor:pointer;">
                                            <label class="form-check-label small fw-bold text-danger" for="srIncludeVoidSwitch" style="cursor:pointer;">顯示作廢發票</label>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 右側：列印前勾選工作表 (單選/多選) ＋ 預覽列印/分享PDF ＋ 下載Excel ＋ 寄信 -->
                            <div class="col-12 col-lg-5">
                                <div class="p-3 bg-white border border-primary rounded shadow-sm h-100 d-flex flex-column justify-content-between">
                                    <div>
                                        <div class="small fw-bold text-primary mb-1">
                                            🖨️ 列印前勾選要列印的工作表（可單選或多選）：
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectStatPrintSheets('ALL')">[全選五表]</a>
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectStatPrintSheets('CORE')">[印總表+分析]</a>
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectStatPrintSheets('CURRENT')">[僅印目前頁籤]</a>
                                        </div>
                                        <div class="d-flex flex-wrap gap-2 mt-1">
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintStat_s1" checked>1.發票總表
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintStat_s2" checked>2.出貨明細
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintStat_s3">3.目前庫存
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintStat_s4" checked>4.客戶營收
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintStat_s5">5.品項統計
                                            </label>
                                        </div>
                                    </div>
                                    <div class="d-flex flex-wrap gap-2 mt-2">
                                        <button type="button" class="btn btn-primary fw-bold shadow-sm flex-grow-1" onclick="window.printSelectedStatReportSheets()">
                                            🖨️ 預覽列印 / 📤 分享PDF
                                        </button>
                                        <button type="button" class="btn btn-success fw-bold shadow-sm" onclick="window.downloadStatReportExcelDirect()">
                                            📥 下載Excel (.xlsx)
                                        </button>
                                        <button type="button" class="btn btn-dark fw-bold shadow-sm" onclick="window.openEmailModalFromStatReport()">
                                            📧 寄送報表信箱
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 區間即時 KPI 統計總覽列 -->
                        <div class="row g-2 mb-3 text-center">
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">🧾 總開立張數 (有效發票)</div>
                                    <div class="fs-5 fw-bold text-dark mt-1" id="srKpiCount">0 張</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">📘 總銷售額 (未稅)</div>
                                    <div class="fs-5 fw-bold text-primary mt-1" id="srKpiNet">$0</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">📙 總營業稅額 (5%)</div>
                                    <div class="fs-5 fw-bold text-secondary mt-1" id="srKpiTax">$0</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm" style="border-bottom: 3px solid #dc3545 !important;">
                                    <div class="small text-danger fw-bold">🔴 總計金額 (含稅)</div>
                                    <div class="fs-4 fw-bold text-danger mt-1" id="srKpiTotal">$0</div>
                                </div>
                            </div>
                        </div>

                        <!-- 五大工作表分頁切換列 -->
                        <div class="d-flex flex-wrap justify-content-between align-items-center bg-white border rounded-top px-3 pt-2 border-bottom-0">
                            <ul class="nav nav-tabs border-bottom-0" id="srSheetTabs">
                                <li class="nav-item">
                                    <button type="button" class="nav-link active fw-bold" id="srTabBtn_STAT_S1" onclick="window.switchStatReportSheet('STAT_S1')">
                                        📑 1. 發票總表 <span class="badge bg-primary ms-1" id="srBadge_s1">0 張</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="srTabBtn_STAT_S2" onclick="window.switchStatReportSheet('STAT_S2')">
                                        📑 2. 出貨明細 <span class="badge bg-info text-dark ms-1" id="srBadge_s2">0 筆</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="srTabBtn_STAT_S3" onclick="window.switchStatReportSheet('STAT_S3')">
                                        📑 3. 目前庫存表 <span class="badge bg-secondary ms-1" id="srBadge_s3">0 項</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="srTabBtn_STAT_S4" onclick="window.switchStatReportSheet('STAT_S4')">
                                        📑 4. 客戶營收分析表 <span class="badge bg-success ms-1" id="srBadge_s4">0 客戶</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="srTabBtn_STAT_S5" onclick="window.switchStatReportSheet('STAT_S5')">
                                        📑 5. 品項銷售統計表 <span class="badge bg-warning text-dark ms-1" id="srBadge_s5">0 品項</span>
                                    </button>
                                </li>
                            </ul>
                            <div class="pb-2 d-flex align-items-center gap-2">
                                <span id="srDrillBanner" style="display:none;"></span>
                                <span class="small fw-bold text-secondary" id="srPeriodRangeLabel">報表期間：--</span>
                            </div>
                        </div>

                        <!-- 工作表內容渲染容器 -->
                        <div class="bg-white border rounded-bottom shadow-sm p-3" id="srSheetContentContainer" style="min-height: 430px; max-height: 60vh; overflow: auto;">
                        </div>
                    </div>
                    <div class="modal-footer bg-white py-2 d-flex justify-content-between">
                        <div class="small text-secondary">
                            💡 <strong>互動秘訣</strong>：點擊「<strong>4.客戶營收分析表</strong>」的客戶名稱可下鑽查看該客戶發票；點擊「<strong>1.發票總表</strong>」的發票號碼可下鑽查看該張發票的出貨與收款狀態！
                        </div>
                        <button type="button" class="btn btn-secondary fw-bold px-4" data-bs-dismiss="modal">關閉視窗</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
};

window.generateReport = function() {
    window.enhanceReportTabUI();
    if (typeof window.initReconcileCenterUI === 'function') window.initReconcileCenterUI();

    const sEl = document.getElementById('repStart');
    const eEl = document.getElementById('repEnd');
    if (!sEl || !eEl) return;

    if (!sEl.value || !eEl.value) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        sEl.value = `${firstDay.getFullYear()}-${String(firstDay.getMonth()+1).padStart(2,'0')}-01`;
        eEl.value = getTodayStr();
    }

    const sVal = sEl.value; 
    const eVal = eEl.value; 
    if(!sVal || !eVal) return;
    
    const sDate = new Date(sVal); sDate.setHours(0,0,0,0); 
    const eDate = new Date(eVal); eDate.setHours(23,59,59,999);
    
    let rCount=0, rNet=0, rTotal=0;
    globalHistory.forEach(h => { 
        const d = new Date(h.time); 
        if(!isNaN(d.getTime()) && d >= sDate && d <= eDate && h.status !== '作廢') { 
            rCount++;
            rNet += Number(h.net) || 0;
            rTotal += Number(h.total) || 0; 
        } 
    });
    
    if (document.getElementById('repCount')) document.getElementById('repCount').innerText = `${rCount} 張`; 
    if (document.getElementById('repNet')) document.getElementById('repNet').innerText = `$${rNet.toLocaleString()}`; 
    if (document.getElementById('repTotal')) document.getElementById('repTotal').innerText = `$${rTotal.toLocaleString()}`;
};

// 開啟「📊 銷售發票與出貨統計報表 — 五表連動預覽與列印中心」
window.openStatReportModal = function(initialSheet = 'STAT_S1') {
    window.enhanceReportTabUI();
    const sv = window.statReportViewState;

    const mainStart = document.getElementById('repStart')?.value || '';
    const mainEnd = document.getElementById('repEnd')?.value || '';
    if (!mainStart || !mainEnd) {
        window.generateReport();
    }

    sv.startDate = document.getElementById('repStart')?.value || getTodayStr();
    sv.endDate = document.getElementById('repEnd')?.value || getTodayStr();
    sv.drillFilter = null;
    if (initialSheet) sv.activeSheet = initialSheet;

    // 填充客戶與員工篩選下拉選單
    const clientSel = document.getElementById('srClientFilter');
    if (clientSel) {
        const cSet = new Set();
        (globalHistory || []).forEach(h => { if (h.client) cSet.add(h.client); });
        const sortedC = Array.from(cSet).sort();
        clientSel.innerHTML = '<option value="">🏢 所有客戶 (全部)</option>' +
            sortedC.map(c => `<option value="${escapeQuotes(c)}">${escapeQuotes(c)}</option>`).join('');
        clientSel.value = sv.clientFilter || '';
    }

    const staffSel = document.getElementById('srStaffFilter');
    if (staffSel) {
        const sSet = new Set();
        (globalHistory || []).forEach(h => { if (h.staff) sSet.add(h.staff); });
        const sortedS = Array.from(sSet).sort();
        staffSel.innerHTML = '<option value="">👤 所有員工</option>' +
            sortedS.map(s => `<option value="${escapeQuotes(s)}">${escapeQuotes(s)}</option>`).join('');
        staffSel.value = sv.staffFilter || '';
    }

    if (document.getElementById('srStartDate')) document.getElementById('srStartDate').value = sv.startDate;
    if (document.getElementById('srEndDate')) document.getElementById('srEndDate').value = sv.endDate;
    if (document.getElementById('srFormTypeFilter')) document.getElementById('srFormTypeFilter').value = sv.formTypeFilter || 'ALL';
    if (document.getElementById('srIncludeVoidSwitch')) document.getElementById('srIncludeVoidSwitch').checked = !!sv.includeVoid;
    if (document.getElementById('srSearchInput')) document.getElementById('srSearchInput').value = sv.searchTerm || '';

    window.renderStatReportModalContent();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('statReportPreviewModal')).show();
};

window.setStatReportModalQuickDate = function(preset) {
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let sStr = '';
    let eStr = '';

    if (preset === 'THIS_MONTH') {
        sStr = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
        eStr = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else if (preset === 'LAST_MONTH') {
        sStr = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        eStr = fmt(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (preset === 'DAYS_30') {
        const d30 = new Date(now);
        d30.setDate(now.getDate() - 29);
        sStr = fmt(d30);
        eStr = fmt(now);
    } else if (preset === 'THIS_QUARTER') {
        const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
        sStr = fmt(new Date(now.getFullYear(), qStartMonth, 1));
        eStr = fmt(now);
    } else if (preset === 'THIS_YEAR') {
        sStr = `${now.getFullYear()}-01-01`;
        eStr = `${now.getFullYear()}-12-31`;
    }

    if (sStr && eStr) {
        if (document.getElementById('srStartDate')) document.getElementById('srStartDate').value = sStr;
        if (document.getElementById('srEndDate')) document.getElementById('srEndDate').value = eStr;
        if (document.getElementById('repStart')) document.getElementById('repStart').value = sStr;
        if (document.getElementById('repEnd')) document.getElementById('repEnd').value = eStr;
        window.onChangeStatReportModalFilter();
    }
};

window.onChangeStatReportModalFilter = debounce(function() {
    const sv = window.statReportViewState;
    sv.startDate = document.getElementById('srStartDate')?.value || '';
    sv.endDate = document.getElementById('srEndDate')?.value || '';
    sv.clientFilter = document.getElementById('srClientFilter')?.value || '';
    sv.staffFilter = document.getElementById('srStaffFilter')?.value || '';
    sv.formTypeFilter = document.getElementById('srFormTypeFilter')?.value || 'ALL';
    sv.includeVoid = !!document.getElementById('srIncludeVoidSwitch')?.checked;
    sv.searchTerm = (document.getElementById('srSearchInput')?.value || '').trim();

    if (sv.startDate && document.getElementById('repStart')) document.getElementById('repStart').value = sv.startDate;
    if (sv.endDate && document.getElementById('repEnd')) document.getElementById('repEnd').value = sv.endDate;
    window.generateReport();
    window.renderStatReportModalContent();
}, 150);

window.switchStatReportSheet = function(sheetId, keepDrill = false) {
    const sv = window.statReportViewState;
    sv.activeSheet = sheetId;
    if (!keepDrill && (sheetId === 'STAT_S3' || sheetId === 'STAT_S4' || sheetId === 'STAT_S5')) {
        sv.drillFilter = null;
    }
    ['STAT_S1', 'STAT_S2', 'STAT_S3', 'STAT_S4', 'STAT_S5'].forEach(s => {
        const btn = document.getElementById(`srTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === sheetId);
    });
    window.renderStatReportModalContent();
};

window.quickSelectStatPrintSheets = function(mode) {
    const ids = ['cbPrintStat_s1', 'cbPrintStat_s2', 'cbPrintStat_s3', 'cbPrintStat_s4', 'cbPrintStat_s5'];
    if (mode === 'ALL') {
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.checked = true; });
    } else if (mode === 'CORE') {
        ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.checked = (i === 0 || i === 3 || i === 4); });
    } else if (mode === 'CURRENT') {
        const curIdx = ['STAT_S1', 'STAT_S2', 'STAT_S3', 'STAT_S4', 'STAT_S5'].indexOf(window.statReportViewState.activeSheet);
        ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.checked = (i === curIdx); });
    }
};

// 建立統計報表 5 大工作表完整資料模型
window.buildStatReportDataModel = function() {
    const sv = window.statReportViewState;
    const sVal = sv.startDate || document.getElementById('repStart')?.value || getTodayStr();
    const eVal = sv.endDate || document.getElementById('repEnd')?.value || getTodayStr();

    const sDate = new Date(sVal); sDate.setHours(0, 0, 0, 0);
    const eDate = new Date(eVal); eDate.setHours(23, 59, 59, 999);
    const term = (sv.searchTerm || '').toLowerCase();
    const drill = sv.drillFilter;

    let validCount = 0;
    let netSum = 0;
    let taxSum = 0;
    let totalSum = 0;

    const detailsList = [];
    const clientMap = new Map();

    // 1. 掃描發票總表 (globalHistory)
    (globalHistory || []).forEach(h => {
        const d = new Date(h.time);
        if (isNaN(d.getTime()) || d < sDate || d > eDate) return;
        const isVoid = (h.status === '作廢');
        if (isVoid && !sv.includeVoid) return;

        const fType = window.getInvoiceFormTypeByTrack(h.paperNo, h.taxId);
        if (sv.formTypeFilter !== 'ALL' && fType !== sv.formTypeFilter) return;
        if (sv.clientFilter && h.client !== sv.clientFilter) return;
        if (sv.staffFilter && h.staff !== sv.staffFilter) return;

        if (term) {
            const m =
                String(h.paperNo || '').toLowerCase().includes(term) ||
                String(h.client || '').toLowerCase().includes(term) ||
                String(h.orderNo || '').toLowerCase().includes(term) ||
                String(h.details || '').toLowerCase().includes(term) ||
                String(h.staff || '').toLowerCase().includes(term);
            if (!m) return;
        }

        const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        const cObj = (globalClients || []).find(c => c.name === h.client);
        const taxIdStr = h.taxId || (cObj ? cObj.taxId : '') || '';
        const netVal = Number(h.net) || 0;
        const taxVal = Number(h.tax) || 0;
        const totVal = Number(h.total) || 0;

        if (!isVoid) {
            validCount++;
            netSum += netVal;
            taxSum += taxVal;
            totalSum += totVal;

            const cKey = h.client || '未命名客戶';
            if (!clientMap.has(cKey)) {
                clientMap.set(cKey, {
                    name: cKey,
                    custId: window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(cKey) : '',
                    taxId: taxIdStr,
                    invCount: 0,
                    net: 0,
                    tax: 0,
                    total: 0
                });
            }
            const cStat = clientMap.get(cKey);
            cStat.invCount++;
            cStat.net += netVal;
            cStat.tax += taxVal;
            cStat.total += totVal;
        }

        // 若有下鑽條件，檢查是否符合下鑽顯示
        if (drill) {
            if (drill.type === 'CLIENT' && h.client !== drill.value) return;
            if (drill.type === 'INVOICE' && h.paperNo !== drill.value) return;
            if (drill.type === 'PRODUCT' && !String(h.details || '').includes(drill.value)) return;
        }

        detailsList.push({
            rowIdx: h.rowIdx,
            date: dateStr,
            paperNo: h.paperNo || '',
            formType: fType,
            client: h.client || '',
            taxId: taxIdStr,
            orderNo: h.orderNo || '',
            status: h.status || '正常',
            staff: h.staff || '',
            net: netVal,
            tax: taxVal,
            total: totVal,
            desc: h.details || ''
        });
    });

    // 2. 掃描出貨明細 (globalSalesDetails) 與累計品項銷售統計
    const lineItemsList = [];
    const prodMap = new Map();

    (globalSalesDetails || []).forEach(s => {
        if (s.shipStatus === '歷史已結案') return;
        const d = new Date(s.time);
        if (isNaN(d.getTime()) || d < sDate || d > eDate) return;

        const isVoid = (s.shipStatus === '作廢');
        if (isVoid && !sv.includeVoid) return;

        const fType = window.getInvoiceFormTypeByTrack(s.paperNo);
        if (sv.formTypeFilter !== 'ALL' && fType !== sv.formTypeFilter) return;
        if (sv.clientFilter && s.client !== sv.clientFilter) return;

        if (sv.staffFilter) {
            const pInv = (globalHistory || []).find(h => h.paperNo === s.paperNo);
            if (pInv && pInv.staff !== sv.staffFilter) return;
        }

        const cat = (typeof window.findProductRobust === 'function')
            ? window.findProductRobust(s.client, null, s.name)
            : (globalCatalog || []).find(c => c.productName === s.name && c.clientName === s.client);

        let intCode = cat ? (cat.internalCode || '') : '';
        let astCode = cat ? (cat.assetCode || '') : '';
        if (typeof window.splitCombinedCodePair === 'function' && (/[\/／\|]/.test(intCode) || /[\/／\|]/.test(astCode))) {
            const sr = window.splitCombinedCodePair(intCode, astCode);
            intCode = sr.internalCode;
            astCode = sr.assetCode;
        }

        if (term) {
            const m =
                String(s.paperNo || '').toLowerCase().includes(term) ||
                String(s.client || '').toLowerCase().includes(term) ||
                String(s.orderNo || '').toLowerCase().includes(term) ||
                String(s.name || '').toLowerCase().includes(term) ||
                String(intCode || '').toLowerCase().includes(term) ||
                String(astCode || '').toLowerCase().includes(term);
            if (!m) return;
        }

        const qty = Number(s.qty) || 0;
        const price = Number(s.price) || 0;
        const subtotal = Number(s.subtotal) || Math.round(qty * price);
        const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

        if (!isVoid) {
            const pKey = s.name || '未知品項';
            if (!prodMap.has(pKey)) {
                prodMap.set(pKey, {
                    name: pKey,
                    code: intCode || astCode || '',
                    assetCode: astCode || '',
                    qty: 0,
                    total: 0,
                    orderCount: 0
                });
            }
            const pStat = prodMap.get(pKey);
            pStat.qty = Math.round((pStat.qty + qty) * 1000) / 1000;
            pStat.total += subtotal;
            pStat.orderCount++;
            if (!pStat.code && intCode) pStat.code = intCode;
        }

        if (drill) {
            if (drill.type === 'CLIENT' && s.client !== drill.value) return;
            if (drill.type === 'INVOICE' && s.paperNo !== drill.value) return;
            if (drill.type === 'PRODUCT' && s.name !== drill.value) return;
        }

        lineItemsList.push({
            rowIdx: s.rowIdx,
            time: dateStr,
            paperNo: s.paperNo || '',
            client: s.client || '',
            orderNo: s.orderNo || '',
            internalCode: intCode,
            assetCode: astCode,
            name: s.name || '',
            qty: qty,
            price: price,
            subtotal: subtotal,
            shipStatus: s.shipStatus || '待出貨',
            shippedQty: Number(s.shippedQty) || 0,
            payStatus: s.payStatus || '未收款',
            paymentNo: s.paymentNo || ''
        });
    });

    // 3. 目前庫存表 (globalInventory)
    let invList = (globalInventory || []).map(inv => ({
        name: inv.name || '',
        internalCode: inv.internalCode || '',
        assetCodeCombined: inv.assetCodeCombined || '',
        supplier: inv.supplier || '',
        qty: Number(inv.qty) || 0,
        alertQty: Number(inv.alertQty) || 0,
        cost: Number(inv.cost) || 0
    }));
    if (term) {
        invList = invList.filter(i =>
            i.name.toLowerCase().includes(term) ||
            i.internalCode.toLowerCase().includes(term) ||
            i.assetCodeCombined.toLowerCase().includes(term) ||
            i.supplier.toLowerCase().includes(term)
        );
    }

    const clientStats = Array.from(clientMap.values()).sort((a, b) => b.total - a.total);
    const productStats = Array.from(prodMap.values()).sort((a, b) => b.total - a.total);

    return {
        dateRange: `${sVal} ~ ${eVal}`,
        summary: {
            count: validCount,
            net: netSum,
            tax: taxSum,
            total: totalSum
        },
        details: detailsList,
        lineItems: lineItemsList,
        inventory: invList,
        clientStats: clientStats,
        productStats: productStats
    };
};

// 渲染「統計報表五表預覽中心」視窗內容
window.renderStatReportModalContent = function() {
    const container = document.getElementById('srSheetContentContainer');
    if (!container) return;

    const model = window.buildStatReportDataModel();
    const sv = window.statReportViewState;

    setSafeText('srKpiCount', `${model.summary.count} 張`);
    setSafeText('srKpiNet', '$' + model.summary.net.toLocaleString());
    setSafeText('srKpiTax', '$' + model.summary.tax.toLocaleString());
    setSafeText('srKpiTotal', '$' + model.summary.total.toLocaleString());

    setSafeText('srBadge_s1', `${model.details.length} 張`);
    setSafeText('srBadge_s2', `${model.lineItems.length} 筆`);
    setSafeText('srBadge_s3', `${model.inventory.length} 項`);
    setSafeText('srBadge_s4', `${model.clientStats.length} 客戶`);
    setSafeText('srBadge_s5', `${model.productStats.length} 品項`);
    setSafeText('srPeriodRangeLabel', `報表期間：${model.dateRange}`);

    const drillEl = document.getElementById('srDrillBanner');
    if (drillEl) {
        if (sv.drillFilter) {
            drillEl.style.display = 'inline-block';
            drillEl.innerHTML = `
                <span class="badge bg-warning text-dark fs-6">
                    🔎 下鑽篩選中：${escapeQuotes(sv.drillFilter.title)}
                    <a href="javascript:void(0)" class="text-danger fw-bold ms-1 text-decoration-none" onclick="window.clearStatReportDrill()">[✕ 清除篩選]</a>
                </span>`;
        } else {
            drillEl.style.display = 'none';
            drillEl.innerHTML = '';
        }
    }

    ['STAT_S1', 'STAT_S2', 'STAT_S3', 'STAT_S4', 'STAT_S5'].forEach(s => {
        const btn = document.getElementById(`srTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === sv.activeSheet);
    });

    if (sv.activeSheet === 'STAT_S1') {
        container.innerHTML = window.generateStatSheet1Html(model, false);
    } else if (sv.activeSheet === 'STAT_S2') {
        container.innerHTML = window.generateStatSheet2Html(model, false);
    } else if (sv.activeSheet === 'STAT_S3') {
        container.innerHTML = window.generateStatSheet3Html(model, false);
    } else if (sv.activeSheet === 'STAT_S4') {
        container.innerHTML = window.generateStatSheet4Html(model, false);
    } else {
        container.innerHTML = window.generateStatSheet5Html(model, false);
    }
};

window.drillDownStatReport = function(type, val, title, targetSheet = 'STAT_S2') {
    window.statReportViewState.drillFilter = { type, value: val, title };
    window.switchStatReportSheet(targetSheet, true);
    showToast(`🔎 已下鑽篩選「${title}」`);
};

window.clearStatReportDrill = function() {
    window.statReportViewState.drillFilter = null;
    window.renderStatReportModalContent();
};

// 產生【工作表 1：發票總表】HTML
window.generateStatSheet1Html = function(model, forPrint = false) {
    const list = model.details || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選期間與篩選條件下沒有發票紀錄</div>`;
    }

    let subNet = 0, subTax = 0, subTot = 0;
    const rowsHtml = list.map((d, idx) => {
        const isVoid = d.status === '作廢';
        if (!isVoid) {
            subNet += d.net;
            subTax += d.tax;
            subTot += d.total;
        }
        const typeBadge = !forPrint
            ? (d.formType === 'TWO_PART' ? '<span class="badge bg-success bg-opacity-10 text-success border border-success ms-1">二聯</span>' : '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary ms-1">三聯</span>')
            : '';
        const invClick = !forPrint
            ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownStatReport('INVOICE', '${escapeQuotes(d.paperNo)}', '發票 ${escapeQuotes(d.paperNo)} 之出貨明細', 'STAT_S2')" title="點擊下鑽查看此發票之出貨與收款狀態"`
            : '';
        const isPendOrd = window.isPendingOrderNo ? window.isPendingOrderNo(d.orderNo) : (!d.orderNo || d.orderNo === '無');
        const ordHtml = isPendOrd && !forPrint
            ? `<span class="text-danger fw-bold">${escapeQuotes(d.orderNo || '[待補單號]')}</span> <button class="btn btn-sm btn-warning text-dark py-0 px-1 fw-bold" style="font-size:0.7rem;" onclick="window.openSuppOrderNoModal({ invoiceRowIdx: ${d.rowIdx}, oldOrderNo: '${escapeQuotes(d.orderNo || '')}', clientName: '${escapeQuotes(d.client)}' })">補單號</button>`
            : escapeQuotes(d.orderNo || '');

        return `
        <tr style="${isVoid ? 'background-color:#fff5f5; color:#999; text-decoration:line-through;' : ''}">
            <td class="text-center text-muted">${idx + 1}</td>
            <td class="text-nowrap">${escapeQuotes(d.date)}</td>
            <td class="fw-bold text-primary text-nowrap" ${invClick}>${escapeQuotes(d.paperNo)}${typeBadge}</td>
            <td class="fw-bold">${escapeQuotes(d.client)}</td>
            <td class="font-monospace">${escapeQuotes(d.taxId)}</td>
            <td>${ordHtml}</td>
            <td class="text-center">${isVoid ? '<span class="badge bg-danger">作廢</span>' : '<span class="badge bg-success">正常</span>'}</td>
            <td class="text-center">${escapeQuotes(d.staff)}</td>
            <td class="text-end">$${d.net.toLocaleString()}</td>
            <td class="text-end">$${d.tax.toLocaleString()}</td>
            <td class="text-end fw-bold text-danger">$${d.total.toLocaleString()}</td>
            <td class="small text-secondary" style="white-space:pre-wrap; max-width:260px;">${escapeQuotes(d.desc)}</td>
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 1：【發票總表】（共 ${list.length} 筆）</h6>
            <span class="small text-muted">報表期間：${escapeQuotes(model.dateRange)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.73rem' : '0.83rem'}; border-color: #adb5bd;">
                <thead style="background-color: #cfe2ff;">
                    <tr>
                        <th class="text-center" style="width:40px;">#</th>
                        <th>開立日期</th>
                        <th>發票號碼</th>
                        <th>客戶名稱</th>
                        <th>統一編號</th>
                        <th>訂單編號</th>
                        <th class="text-center">狀態</th>
                        <th class="text-center">開立人員</th>
                        <th class="text-end">銷售額(未稅)</th>
                        <th class="text-end">營業稅額</th>
                        <th class="text-end">總計(含稅)</th>
                        <th>明細內容</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #cfe2ff; border-top: 2px solid #0d6efd;">
                        <td colspan="8" class="text-end fw-bold">本表有效發票合計：</td>
                        <td class="text-end fw-bold text-primary">$${subNet.toLocaleString()}</td>
                        <td class="text-end fw-bold">$${subTax.toLocaleString()}</td>
                        <td class="text-end fw-bold text-danger fs-6">$${subTot.toLocaleString()}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 產生【工作表 2：出貨明細】HTML
window.generateStatSheet2Html = function(model, forPrint = false) {
    const list = model.lineItems || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選期間內沒有出貨明細紀錄</div>`;
    }

    let sumQty = 0, sumSub = 0;
    const rowsHtml = list.map((l, idx) => {
        sumQty = Math.round((sumQty + (Number(l.qty) || 0)) * 1000) / 1000;
        sumSub += (Number(l.subtotal) || 0);
        const shipBadge = l.shipStatus === '已結案'
            ? `<span class="badge bg-success">已結案</span>`
            : `<span class="badge bg-warning text-dark">${escapeQuotes(l.shipStatus)}</span>`;
        const payBadge = l.payStatus === '已沖帳'
            ? `<span class="badge bg-success">🟢 已沖帳</span>`
            : `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger">未收款</span>`;

        return `
        <tr>
            <td class="text-center text-muted">${idx + 1}</td>
            <td class="text-nowrap">${escapeQuotes(l.time)}</td>
            <td class="fw-bold text-primary text-nowrap">${escapeQuotes(l.paperNo)}</td>
            <td class="fw-bold">${escapeQuotes(l.client)}</td>
            <td>${escapeQuotes(l.orderNo)}</td>
            <td><code>${escapeQuotes(l.internalCode)}</code>${l.assetCode ? `<div class="small text-primary">資材: ${escapeQuotes(l.assetCode)}</div>` : ''}</td>
            <td class="fw-bold text-dark">${escapeQuotes(l.name)}</td>
            <td class="text-center fw-bold">${l.qty}</td>
            <td class="text-end">$${Number(l.price).toLocaleString()}</td>
            <td class="text-end fw-bold text-danger">$${Number(l.subtotal).toLocaleString()}</td>
            <td class="text-center">${shipBadge} <small class="text-muted">(${l.shippedQty}/${l.qty})</small></td>
            ${!forPrint ? `<td class="text-center">${payBadge}</td>` : ''}
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 2：【出貨明細】（共 ${list.length} 筆品項明細）</h6>
            <span class="small text-muted">報表期間：${escapeQuotes(model.dateRange)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.73rem' : '0.83rem'}; border-color: #adb5bd;">
                <thead style="background-color: #d1e7dd;">
                    <tr>
                        <th class="text-center" style="width:40px;">#</th>
                        <th>開立日期</th>
                        <th>發票號碼</th>
                        <th>客戶名稱</th>
                        <th>訂單編號</th>
                        <th>長固代號 / 資材碼</th>
                        <th>品名規格</th>
                        <th class="text-center">開立數量</th>
                        <th class="text-end">單價(含稅)</th>
                        <th class="text-end">總價(含稅)</th>
                        <th class="text-center">出貨狀態 (已出/總數)</th>
                        ${!forPrint ? '<th class="text-center">收款狀態</th>' : ''}
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #d1e7dd; border-top: 2px solid #198754;">
                        <td colspan="7" class="text-end fw-bold">出貨明細總計：</td>
                        <td class="text-center fw-bold">${sumQty}</td>
                        <td></td>
                        <td class="text-end fw-bold text-danger fs-6">$${sumSub.toLocaleString()}</td>
                        <td colspan="${!forPrint ? '2' : '1'}"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 產生【工作表 3：目前庫存表】HTML
window.generateStatSheet3Html = function(model, forPrint = false) {
    const list = model.inventory || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 目前沒有庫存品項資料</div>`;
    }

    const rowsHtml = list.map((inv, idx) => {
        let statusBadge = '<span class="badge bg-success">🟢 庫存正常</span>';
        let rowStyle = '';
        if (inv.qty <= 0) {
            statusBadge = '<span class="badge bg-danger">🔴 缺貨/負庫存</span>';
            rowStyle = 'background-color: #fff5f5;';
        } else if (inv.qty <= inv.alertQty) {
            statusBadge = '<span class="badge bg-warning text-dark">🟡 低於安全量</span>';
            rowStyle = 'background-color: #fffdf2;';
        }

        return `
        <tr style="${rowStyle}">
            <td class="text-center text-muted">${idx + 1}</td>
            <td class="fw-bold text-dark">${escapeQuotes(inv.name)}</td>
            <td><code>${escapeQuotes(inv.internalCode)}</code></td>
            <td class="small text-primary">${escapeQuotes(inv.assetCodeCombined)}</td>
            <td class="text-end fw-bold ${inv.qty <= 0 ? 'text-danger' : 'text-success'} fs-6">${inv.qty}</td>
            <td class="text-end text-muted">${inv.alertQty}</td>
            <td class="text-center">${statusBadge}</td>
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 3：【目前庫存表】（共 ${list.length} 項庫存產品）</h6>
            <span class="small text-muted">即時庫存快照時間：${getTodayStr()}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.75rem' : '0.85rem'}; border-color: #adb5bd;">
                <thead style="background-color: #e2e3e5;">
                    <tr>
                        <th class="text-center" style="width:45px;">#</th>
                        <th>品名規格</th>
                        <th>長固代號</th>
                        <th>對應醫院資材碼</th>
                        <th class="text-end">目前庫存數量</th>
                        <th class="text-end">安全庫存量</th>
                        <th class="text-center">庫存狀態</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    </div>`;
};

// 產生【工作表 4：客戶營收分析表】HTML (支援點擊客戶下鑽至發票總表或出貨明細)
window.generateStatSheet4Html = function(model, forPrint = false) {
    const list = model.clientStats || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選期間內無客戶營收資料</div>`;
    }

    const grandTotal = model.summary.total || 1;
    const rowsHtml = list.map((c, idx) => {
        const pct = ((c.total / grandTotal) * 100).toFixed(1) + '%';
        const clickInv = !forPrint
            ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownStatReport('CLIENT', '${escapeQuotes(c.name)}', '客戶：${escapeQuotes(c.name)}', 'STAT_S1')" title="點擊下鑽查看此客戶的所有發票"`
            : '';
        const clickLine = !forPrint
            ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownStatReport('CLIENT', '${escapeQuotes(c.name)}', '客戶：${escapeQuotes(c.name)}', 'STAT_S2')" title="點擊下鑽查看此客戶的所有出貨明細"`
            : '';

        return `
        <tr>
            <td class="text-center fw-bold text-secondary">${idx + 1}</td>
            <td class="fw-bold text-primary">${escapeQuotes(c.custId || '--')}</td>
            <td class="fw-bold text-dark" ${clickInv}>${escapeQuotes(c.name)}</td>
            <td class="font-monospace">${escapeQuotes(c.taxId || '--')}</td>
            <td class="text-center fw-bold" ${clickInv}>${c.invCount} 張</td>
            <td class="text-end">$${c.net.toLocaleString()}</td>
            <td class="text-end">$${c.tax.toLocaleString()}</td>
            <td class="text-end fw-bold text-danger fs-6" ${clickLine}>$${c.total.toLocaleString()}</td>
            <td class="text-end fw-bold text-secondary">${pct}</td>
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 4：【客戶營收分析表】（共 ${list.length} 家客戶）</h6>
            <span class="small text-muted">報表期間：${escapeQuotes(model.dateRange)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.75rem' : '0.86rem'}; border-color: #adb5bd;">
                <thead style="background-color: #fff3cd;">
                    <tr>
                        <th class="text-center" style="width:50px;">排行</th>
                        <th>外部代號</th>
                        <th>客戶 / 醫院名稱</th>
                        <th>統一編號</th>
                        <th class="text-center">開立發票張數</th>
                        <th class="text-end">未稅銷售額合計</th>
                        <th class="text-end">營業稅額合計</th>
                        <th class="text-end">總銷售額 (含稅)</th>
                        <th class="text-end">營收佔比</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #fff3cd; border-top: 2px solid #ffc107;">
                        <td colspan="4" class="text-end fw-bold">全體客戶營收總計：</td>
                        <td class="text-center fw-bold">${model.summary.count} 張</td>
                        <td class="text-end fw-bold text-primary">$${model.summary.net.toLocaleString()}</td>
                        <td class="text-end fw-bold">$${model.summary.tax.toLocaleString()}</td>
                        <td class="text-end fw-bold text-danger fs-6">$${model.summary.total.toLocaleString()}</td>
                        <td class="text-end fw-bold">100%</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 產生【工作表 5：品項銷售統計表】HTML (支援點擊品名下鑽查看該品項所有出貨明細)
window.generateStatSheet5Html = function(model, forPrint = false) {
    const list = model.productStats || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選期間內無產品銷售統計資料</div>`;
    }

    const grandTotal = model.summary.total || 1;
    let totalQty = 0, totalAmt = 0;

    const rowsHtml = list.map((p, idx) => {
        totalQty = Math.round((totalQty + p.qty) * 1000) / 1000;
        totalAmt += p.total;
        const pct = ((p.total / grandTotal) * 100).toFixed(1) + '%';
        const clickProd = !forPrint
            ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownStatReport('PRODUCT', '${escapeQuotes(p.name)}', '品項：${escapeQuotes(p.name)}', 'STAT_S2')" title="點擊下鑽查看此產品的所有出貨明細"`
            : '';

        return `
        <tr>
            <td class="text-center fw-bold text-secondary">${idx + 1}</td>
            <td><code>${escapeQuotes(p.code || '--')}</code></td>
            <td class="small text-primary">${escapeQuotes(p.assetCode || '--')}</td>
            <td class="fw-bold text-dark" ${clickProd}>${escapeQuotes(p.name)}</td>
            <td class="text-center">${p.orderCount} 次</td>
            <td class="text-end fw-bold text-primary">${p.qty}</td>
            <td class="text-end fw-bold text-danger fs-6" ${clickProd}>$${p.total.toLocaleString()}</td>
            <td class="text-end fw-bold text-secondary">${pct}</td>
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 5：【品項銷售統計表】（共 ${list.length} 項熱銷產品）</h6>
            <span class="small text-muted">報表期間：${escapeQuotes(model.dateRange)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.75rem' : '0.86rem'}; border-color: #adb5bd;">
                <thead style="background-color: #f8d7da;">
                    <tr>
                        <th class="text-center" style="width:50px;">排行</th>
                        <th>長固代號</th>
                        <th>醫院資材碼</th>
                        <th>品名規格</th>
                        <th class="text-center">出貨筆數</th>
                        <th class="text-end">銷售總數量</th>
                        <th class="text-end">總銷售金額 (含稅)</th>
                        <th class="text-end">營收佔比</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #f8d7da; border-top: 2px solid #dc3545;">
                        <td colspan="5" class="text-end fw-bold">全體品項銷售總計：</td>
                        <td class="text-end fw-bold text-primary">${totalQty}</td>
                        <td class="text-end fw-bold text-danger fs-6">$${totalAmt.toLocaleString()}</td>
                        <td class="text-end fw-bold">100%</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 🖨️ 列印前依勾選的工作表（可單選或多選）產生 A4 橫向分頁預覽列印與 PDF 分享
window.printSelectedStatReportSheets = function() {
    const p1 = document.getElementById('cbPrintStat_s1')?.checked;
    const p2 = document.getElementById('cbPrintStat_s2')?.checked;
    const p3 = document.getElementById('cbPrintStat_s3')?.checked;
    const p4 = document.getElementById('cbPrintStat_s4')?.checked;
    const p5 = document.getElementById('cbPrintStat_s5')?.checked;

    if (!p1 && !p2 && !p3 && !p4 && !p5) {
        return alert("請至少勾選一張要列印的工作表！");
    }

    const model = window.buildStatReportDataModel();
    const blocks = [];

    const buildPrintHeader = (sheetTitle) => `
        <div style="border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #000;">長固實業有限公司 — 銷售發票與出貨統計報表 (${sheetTitle})</div>
                <div style="font-size: 12px; color: #444;">
                    報表期間：${escapeQuotes(model.dateRange)} ｜ 
                    總開立張數：${model.summary.count} 張 ｜ 
                    未稅總額：$${model.summary.net.toLocaleString()} ｜ 
                    營業稅：$${model.summary.tax.toLocaleString()} ｜ 
                    含稅總計：$${model.summary.total.toLocaleString()}
                </div>
            </div>
            <div style="font-size: 12px; color: #333; text-align: right;">
                製表人員：${escapeQuotes(myName || '管理員')} ｜ 列印日期：${getTodayStr()}
            </div>
        </div>
    `;

    if (p1) blocks.push(`<div style="padding:12px; background:#fff;">${buildPrintHeader('1. 發票總表')}${window.generateStatSheet1Html(model, true)}</div>`);
    if (p2) blocks.push(`<div style="padding:12px; background:#fff;">${buildPrintHeader('2. 出貨明細')}${window.generateStatSheet2Html(model, true)}</div>`);
    if (p3) blocks.push(`<div style="padding:12px; background:#fff;">${buildPrintHeader('3. 目前庫存表')}${window.generateStatSheet3Html(model, true)}</div>`);
    if (p4) blocks.push(`<div style="padding:12px; background:#fff;">${buildPrintHeader('4. 客戶營收分析表')}${window.generateStatSheet4Html(model, true)}</div>`);
    if (p5) blocks.push(`<div style="padding:12px; background:#fff;">${buildPrintHeader('5. 品項銷售統計表')}${window.generateStatSheet5Html(model, true)}</div>`);

    const combinedHtml = blocks.map((bHtml, idx) => {
        const isLast = idx === blocks.length - 1;
        return `<div class="${!isLast ? 'print-sheet-page-break' : ''}" style="margin-bottom: 18px;">${bHtml}</div>`;
    }).join('');

    bootstrap.Modal.getInstance(document.getElementById('statReportPreviewModal'))?.hide();

    let printEl = document.getElementById('printStatReportArea');
    if (!printEl) {
        printEl = document.createElement('div');
        printEl.id = 'printStatReportArea';
        printEl.style.display = 'none';
        document.body.appendChild(printEl);
    }
    printEl.innerHTML = combinedHtml;

    window.applyPrintStyle('A4', 'landscape');
    window.showPrintPreview('printStatReportArea');
};

// 📥 直接下載五工作表 Excel (.xlsx) 檔案至電腦/手機
window.downloadStatReportExcelDirect = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 引擎載入中，請稍候！");
    const model = window.buildStatReportDataModel();
    const wb = XLSX.utils.book_new();

    // 工作表 1: 發票總表
    const s1Rows = [
        ["報表期間", model.dateRange, "", "", "", "", "", "", "", "", ""],
        ["總開立張數", model.summary.count, "", "", "", "", "", "", "", "", ""],
        ["總銷售額(未稅)", model.summary.net, "", "", "", "", "", "", "", "", ""],
        ["總營業稅", model.summary.tax, "", "", "", "", "", "", "", "", ""],
        ["總計(含稅)", model.summary.total, "", "", "", "", "", "", "", "", ""],
        ["開立日期", "發票號碼", "客戶名稱", "統一編號", "訂單編號", "狀態", "開立人員", "銷售額", "稅額", "總計", "明細內容"]
    ];
    model.details.forEach(d => {
        s1Rows.push([d.date, d.paperNo, d.client, d.taxId, d.orderNo, d.status, d.staff, d.net, d.tax, d.total, d.desc]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1Rows), "發票總表");

    // 工作表 2: 出貨明細
    const s2Rows = [
        ["開立日期", "發票號碼", "客戶名稱", "訂單編號", "長固代號", "醫院資材碼", "品名", "開立數量", "單價(含稅)", "總價(含稅)", "出貨狀態", "已出貨數量", "收款狀態"]
    ];
    model.lineItems.forEach(l => {
        s2Rows.push([l.time, l.paperNo, l.client, l.orderNo, l.internalCode, l.assetCode, l.name, l.qty, l.price, l.subtotal, l.shipStatus, l.shippedQty, l.payStatus]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2Rows), "出貨明細");

    // 工作表 3: 目前庫存表
    const s3Rows = [["品名", "長固代號", "對應資材碼", "目前庫存數量", "安全庫存量"]];
    model.inventory.forEach(inv => {
        s3Rows.push([inv.name, inv.internalCode, inv.assetCodeCombined, inv.qty, inv.alertQty]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3Rows), "目前庫存表");

    // 工作表 4: 客戶營收分析表
    const s4Rows = [["排行", "客戶代號", "客戶/醫院名稱", "統一編號", "發票張數", "未稅銷售額", "營業稅額", "總銷售額(含稅)"]];
    model.clientStats.forEach((c, idx) => {
        s4Rows.push([idx + 1, c.custId, c.name, c.taxId, c.invCount, c.net, c.tax, c.total]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4Rows), "客戶營收分析表");

    // 工作表 5: 品項銷售統計表
    const s5Rows = [["排行", "長固代號", "醫院資材碼", "品名規格", "出貨筆數", "銷售總數量", "總銷售額(含稅)"]];
    model.productStats.forEach((p, idx) => {
        s5Rows.push([idx + 1, p.code, p.assetCode, p.name, p.orderCount, p.qty, p.total]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s5Rows), "品項銷售統計表");

    const cleanRange = model.dateRange.replace(/[\/\s~]/g, '_');
    XLSX.writeFile(wb, `長固ERP_發票與出貨統計五表_${cleanRange}.xlsx`);
    showToast("📥 已成功下載包含 5 大工作表之統計報表 Excel 檔！");
};

// 點擊原「📥 匯出 Excel 報表並寄信」按鈕時，預設先打開五表互動預覽視窗供確認，亦可從視窗內或副按鈕開啟寄信選單
window.exportReportToEmail = function() {
    window.openStatReportModal('STAT_S1');
};

window.openEmailModalFromStatReport = function() {
    const sVal = document.getElementById('repStart')?.value; 
    const eVal = document.getElementById('repEnd')?.value; 
    if(!sVal || !eVal) return alert("請先設定報表統計日期範圍！");
    
    let modalEl = document.getElementById('dynamicEmailModal');
    if (!modalEl) {
        const modalHtml = `
        <div class="modal fade" id="dynamicEmailModal" tabindex="-1" style="z-index: 1080;">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-dark text-white">
                        <h5 class="modal-title fw-bold">📧 選擇統計報表收件信箱</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="small text-muted mb-3">請勾選要發送 Excel 統計報表的對象 (資料連動自後台「收件信箱管理」)</div>
                        <div id="dynamicEmailCheckboxes" class="d-flex flex-column gap-2"></div>
                    </div>
                    <div class="modal-footer border-0">
                        <button type="button" class="btn btn-secondary fw-bold" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-primary fw-bold px-4" onclick="confirmExportReport()">確認並寄出</button>
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
    if(window.lockButton(btn)) return;
    
    const emailStr = emails.join(','); 
    bootstrap.Modal.getInstance(document.getElementById('dynamicEmailModal')).hide();
    showLoading("產生 Excel 並寄送中...");
    
    const model = window.buildStatReportDataModel();
    const payload = { 
        email: emailStr, 
        dateRange: model.dateRange,
        summary: model.summary, 
        clientStats: model.clientStats.map(c => ({ name: c.name, total: c.total })), 
        productStats: model.productStats,
        details: [...model.details].reverse(),
        lineItems: [...model.lineItems].reverse() 
    };
    
    callApi('exportExcelReport', payload).then(res => { 
        hideLoading(); showToast(`✅ 報表已成功寄送至所選信箱！`); 
    }).catch(err => { hideLoading(); alert("匯出失敗：" + err.message); });
};

// ============================================================================
// 🤖 跨系統報表智慧勾稽比對中心 (含「已覆核專區」、「關閉網頁進度記憶」、「缺漏明細一鍵補登」)
// ============================================================================
const RECONCILE_STORAGE_KEY = 'changgu_erp_reconcile_workspace_v2';

window.reconcileState = {
    fileName: '',
    extRawRows: [],
    erpGeneratedRows: [],
    startDate: '',
    endDate: '',
    results: [],
    reviewedMap: {},
    lastSavedAt: '',
    currentFilter: 'ALL_DIFF',
    searchTerm: ''
};
window.saveReconcileWorkspace = function() {
    try {
        const now = new Date();
        const timeStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        window.reconcileState.lastSavedAt = timeStr;

        const dataToSave = {
            fileName: window.reconcileState.fileName,
            extRawRows: window.reconcileState.extRawRows,
            startDate: window.reconcileState.startDate,
            endDate: window.reconcileState.endDate,
            reviewedMap: window.reconcileState.reviewedMap || {},
            lastSavedAt: timeStr
        };
        localStorage.setItem(RECONCILE_STORAGE_KEY, JSON.stringify(dataToSave));
        const saveBadge = document.getElementById('recAutoSaveBadge');
        if (saveBadge) {
            saveBadge.innerText = `💾 進度已自動記憶 (${timeStr})`;
            saveBadge.style.display = 'inline-block';
        }
    } catch (e) {
        console.warn("儲存比對進度快取失敗:", e);
    }
};

window.loadReconcileWorkspace = function() {
    try {
        const raw = localStorage.getItem(RECONCILE_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.extRawRows) || parsed.extRawRows.length === 0) return false;

        window.reconcileState.fileName = parsed.fileName || '上次未完成報表';
        window.reconcileState.extRawRows = parsed.extRawRows;
        window.reconcileState.startDate = parsed.startDate || '';
        window.reconcileState.endDate = parsed.endDate || '';
        window.reconcileState.reviewedMap = parsed.reviewedMap || {};
        window.reconcileState.lastSavedAt = parsed.lastSavedAt || '';

        if (document.getElementById('recMetaBar')) {
            document.getElementById('recMetaBar').style.display = 'block';
            document.getElementById('recStartDate').value = window.reconcileState.startDate;
            document.getElementById('recEndDate').value = window.reconcileState.endDate;
        }
        const saveBadge = document.getElementById('recAutoSaveBadge');
        if (saveBadge && window.reconcileState.lastSavedAt) {
            saveBadge.innerText = `💾 已自動還原上次進度 (${window.reconcileState.lastSavedAt})`;
            saveBadge.style.display = 'inline-block';
        }
        window.runReportReconciliation(true);
        return true;
    } catch (e) {
        console.warn("讀取比對進度快取失敗:", e);
        return false;
    }
};

window.clearReconcileWorkspace = function() {
    if (!confirm("確定要清除目前的比對檔案與所有「已覆核」記憶進度嗎？\n(適用於開始新月份的報表比對)")) return;
    localStorage.removeItem(RECONCILE_STORAGE_KEY);
    window.reconcileState = {
        fileName: '',
        extRawRows: [],
        erpGeneratedRows: [],
        startDate: '',
        endDate: '',
        results: [],
        reviewedMap: {},
        lastSavedAt: '',
        currentFilter: 'ALL_DIFF',
        searchTerm: ''
    };
    if (document.getElementById('recMetaBar')) document.getElementById('recMetaBar').style.display = 'none';
    if (document.getElementById('recKpiRow')) document.getElementById('recKpiRow').style.display = 'none';
    if (document.getElementById('recFilterToolbar')) document.getElementById('recFilterToolbar').style.setProperty('display', 'none', 'important');
    if (document.getElementById('btnDownloadReconcileExcel')) document.getElementById('btnDownloadReconcileExcel').style.display = 'none';
    if (document.getElementById('btnClearReconcileCache')) document.getElementById('btnClearReconcileCache').style.display = 'none';
    if (document.getElementById('recAutoSaveBadge')) document.getElementById('recAutoSaveBadge').style.display = 'none';
    if (document.getElementById('recResultContainer')) {
        document.getElementById('recResultContainer').innerHTML = `
            <div class="text-center text-muted py-4 border rounded bg-light">
                請點擊右上角「<strong>📂 上傳外部系統報表</strong>」開始自動勾稽比對
            </div>`;
    }
    showToast("🗑️ 已清除比對暫存記憶");
};

window.initReconcileCenterUI = function() {
    if (!document.getElementById('reconcileCenterCard')) {
        const repTotalEl = document.getElementById('repTotal');
        if (!repTotalEl) return;

        let reportPane = repTotalEl.closest('.tab-pane') || repTotalEl.closest('.card')?.parentElement || repTotalEl.parentElement;
        if (!reportPane) return;

        const cardHtml = `
        <div id="reconcileCenterCard" class="card border-0 shadow-sm mt-4 mb-4" style="border-top: 4px solid #0d6efd !important;">
            <div class="card-body p-3 p-md-4">
                <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 border-bottom pb-3">
                    <div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <h5 class="fw-bold text-dark mb-0">🤖 跨系統報表智慧勾稽比對中心</h5>
                            <span id="recAutoSaveBadge" class="badge bg-info text-dark" style="display:none;">💾 進度自動記憶中</span>
                        </div>
                        <div class="small text-muted mt-1">
                            上傳外部系統發票檔（如 <code>INVOICES-1151014.xlsx</code>），自動識別區間、支援「<strong>✅ 人工已覆核歸檔</strong>」、「<strong>🛠️ 缺漏明細一鍵補登</strong>」與「<strong>💾 跨日進度自動記憶</strong>」。
                        </div>
                    </div>
                    <div class="mt-2 mt-md-0 d-flex flex-wrap gap-2">
                        <label class="btn btn-primary fw-bold shadow-sm mb-0" style="cursor: pointer;">
                            📂 上傳外部系統報表 (.xlsx / .csv)
                            <input type="file" id="extReportFileInput" accept=".xlsx,.xls,.csv" style="display: none;" onchange="window.handleExternalReportUpload(this)">
                        </label>
                        <button id="btnDownloadReconcileExcel" class="btn btn-success fw-bold shadow-sm" style="display: none;" onclick="window.exportReconciliationExcel()">
                            📥 下載比對差異報告 (.xlsx)
                        </button>
                        <button id="btnClearReconcileCache" class="btn btn-outline-secondary fw-bold" style="display: none;" onclick="window.clearReconcileWorkspace()" title="清除記憶並開始新比對">
                            🗑️ 清除暫存
                        </button>
                    </div>
                </div>

                <div id="recMetaBar" class="p-3 rounded bg-light border mb-3" style="display: none;">
                    <div class="row g-2 align-items-center">
                        <div class="col-12 col-md-5">
                            <div class="small text-muted fw-bold">📄 已載入外部檔案（關閉網頁自動保留）：</div>
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

                <div id="recKpiRow" class="row g-2 mb-3" style="display: none;">
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ALL_DIFF" style="cursor:pointer; background:#fff8f6; border-color:#dc3545 !important;" onclick="window.setReconcileFilter('ALL_DIFF')">
                            <div class="small fw-bold text-danger">⚠️ 待處理異常</div>
                            <div class="fs-4 fw-bold text-danger" id="recCountAllDiff">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">尚未覆核之異常</div>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_VALUE_DIFF" style="cursor:pointer; background:#fffdf5;" onclick="window.setReconcileFilter('VALUE_DIFF')">
                            <div class="small fw-bold text-warning text-dark">🟡 資料相異</div>
                            <div class="fs-4 fw-bold text-dark" id="recCountValDiff">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">代號/數量/金額/客戶</div>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ONLY_EXT" style="cursor:pointer; background:#fff5f5;" onclick="window.setReconcileFilter('ONLY_EXT')">
                            <div class="small fw-bold text-danger">🔴 僅外部有</div>
                            <div class="fs-4 fw-bold text-danger" id="recCountOnlyExt">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">可一鍵補登明細</div>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_ONLY_ERP" style="cursor:pointer; background:#f0f7ff;" onclick="window.setReconcileFilter('ONLY_ERP')">
                            <div class="small fw-bold text-primary">🔵 僅本系統有</div>
                            <div class="fs-4 fw-bold text-primary" id="recCountOnlyErp">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">外部缺漏/借用單</div>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_REVIEWED" style="cursor:pointer; background:#eef2ff; border-color:#6610f2 !important;" onclick="window.setReconcileFilter('REVIEWED')">
                            <div class="small fw-bold" style="color:#6610f2;">☑️ 已覆核專區</div>
                            <div class="fs-4 fw-bold" style="color:#6610f2;" id="recCountReviewed">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">可檢視與隨時還原</div>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <div class="p-2 border rounded text-center shadow-sm rec-kpi-card" id="kpi_MATCH" style="cursor:pointer; background:#f3fbf6;" onclick="window.setReconcileFilter('MATCH')">
                            <div class="small fw-bold text-success">🟢 完全吻合</div>
                            <div class="fs-4 fw-bold text-success" id="recCountMatch">0</div>
                            <div class="text-muted" style="font-size:0.72rem;">6大欄位一致</div>
                        </div>
                    </div>
                </div>

                <div id="recFilterToolbar" class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3" style="display: none !important;">
                    <div class="d-flex flex-wrap gap-1 align-items-center">
                        <div class="btn-group btn-group-sm flex-wrap" role="group">
                            <button type="button" class="btn btn-outline-danger active fw-bold" id="btnRecTab_ALL_DIFF" onclick="window.setReconcileFilter('ALL_DIFF')">⚠️ 待處理異常</button>
                            <button type="button" class="btn btn-outline-warning text-dark fw-bold" id="btnRecTab_VALUE_DIFF" onclick="window.setReconcileFilter('VALUE_DIFF')">🟡 資料相異</button>
                            <button type="button" class="btn btn-outline-danger fw-bold" id="btnRecTab_ONLY_EXT" onclick="window.setReconcileFilter('ONLY_EXT')">🔴 僅外部有</button>
                            <button type="button" class="btn btn-outline-primary fw-bold" id="btnRecTab_ONLY_ERP" onclick="window.setReconcileFilter('ONLY_ERP')">🔵 僅本系統有</button>
                            <button type="button" class="btn btn-outline-dark fw-bold" id="btnRecTab_REVIEWED" onclick="window.setReconcileFilter('REVIEWED')">☑️ 已覆核專區</button>
                            <button type="button" class="btn btn-outline-success fw-bold" id="btnRecTab_MATCH" onclick="window.setReconcileFilter('MATCH')">🟢 完全吻合</button>
                            <button type="button" class="btn btn-outline-secondary fw-bold" id="btnRecTab_ALL" onclick="window.setReconcileFilter('ALL')">📋 全部</button>
                        </div>
                        <button type="button" id="btnBatchReview" class="btn btn-sm btn-success fw-bold ms-1 shadow-sm" onclick="window.batchToggleReconcileReview(true)">
                            ✅ 批次標記已覆核
                        </button>
                        <button type="button" id="btnBatchUnreview" class="btn btn-sm btn-warning fw-bold ms-1 shadow-sm" style="display:none;" onclick="window.batchToggleReconcileReview(false)">
                            ↩️ 批次還原未覆核
                        </button>
                    </div>
                    <div style="min-width: 240px; flex-grow: 1; max-width: 340px;">
                        <input type="text" id="recSearchInput" class="form-control form-control-sm" placeholder="🔍 搜尋發票號碼、客戶、CUSTID、代號、品名..." oninput="window.onReconcileSearch(this.value)">
                    </div>
                </div>

                <div id="recResultContainer">
                    <div class="text-center text-muted py-4 border rounded bg-light">
                        請點擊右上角「<strong>📂 上傳外部系統報表</strong>」開始自動勾稽比對
                    </div>
                </div>
            </div>
        </div>`;

        reportPane.insertAdjacentHTML('beforeend', cardHtml);
    }

    if (!document.getElementById('reconcileFixModal')) {
        const fixModalHtml = `
        <div class="modal fade" id="reconcileFixModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title fw-bold">🛠️ 智慧補登本系統「出貨明細」精靈</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light">
                        <input type="hidden" id="rf_recKey">
                        <div class="row g-2 mb-3">
                            <div class="col-12 col-md-6">
                                <div class="p-2 bg-white border border-primary rounded h-100">
                                    <div class="small fw-bold text-primary border-bottom pb-1 mb-1">📘 本系統「發票總表」既有紀錄對照</div>
                                    <div id="rf_erpHistoryInfo" class="small text-dark" style="white-space: pre-wrap;"></div>
                                </div>
                            </div>
                            <div class="col-12 col-md-6">
                                <div class="p-2 bg-white border border-danger rounded h-100">
                                    <div class="small fw-bold text-danger border-bottom pb-1 mb-1">📙 外部系統報表 (INVOICES) 資料對照</div>
                                    <div id="rf_extReportInfo" class="small text-dark" style="white-space: pre-wrap;"></div>
                                </div>
                            </div>
                        </div>

                        <div class="p-3 bg-white border rounded shadow-sm">
                            <h6 class="fw-bold text-dark border-bottom pb-2 mb-3">✍️ 確認欲補登至本系統「銷售明細總表 (出貨明細)」之內容：</h6>
                            <div class="row g-2 mb-2">
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">開立日期 <span class="text-danger">*</span></label>
                                    <input type="date" id="rf_date" class="form-control fw-bold text-primary">
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">發票號碼 <span class="text-danger">*</span></label>
                                    <input type="text" id="rf_paperNo" class="form-control fw-bold" style="text-transform: uppercase;">
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">訂單編號 (選填)</label>
                                    <input type="text" id="rf_orderNo" class="form-control fw-bold">
                                </div>
                            </div>

                            <div class="mb-2">
                                <label class="small fw-bold text-muted">客戶名稱 <span class="text-danger">*</span></label>
                                <div class="input-group">
                                    <input type="text" id="rf_client" class="form-control fw-bold" placeholder="自動帶入或點擊右側選擇...">
                                    <button class="btn btn-outline-secondary fw-bold" type="button" onclick="openSearchModal('client', (val)=>{ document.getElementById('rf_client').value = val; })">🔍 選客戶</button>
                                </div>
                            </div>

                            <div class="row g-2 mb-2">
                                <div class="col-md-8">
                                    <label class="small fw-bold text-muted">品名規格 <span class="text-danger">*</span></label>
                                    <div class="input-group">
                                        <input type="text" id="rf_name" class="form-control fw-bold text-dark" placeholder="系統自動根據代號/發票總表反查...">
                                        <button class="btn btn-outline-primary fw-bold" type="button" onclick="openSearchModal('item_recfix', (val, ref)=>{ document.getElementById('rf_name').value = val; if(ref){ document.getElementById('rf_code').value = ref.internalCode || ref.assetCode || ''; document.getElementById('rf_unit').value = ref.unit || '式'; if(!document.getElementById('rf_price').value) document.getElementById('rf_price').value = ref.price || 0; window.recalcFixSubtotal(); } })">📦 從合約庫選品名</button>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">長固代號 (ISPN)</label>
                                    <input type="text" id="rf_code" class="form-control fw-bold text-info bg-light">
                                </div>
                            </div>

                            <div class="row g-2 mb-3">
                                <div class="col-md-3">
                                    <label class="small fw-bold text-muted">開立數量 <span class="text-danger">*</span></label>
                                    <input type="number" id="rf_qty" class="form-control fw-bold text-danger text-center" step="any" oninput="window.recalcFixSubtotal()">
                                </div>
                                <div class="col-md-2">
                                    <label class="small fw-bold text-muted">單位</label>
                                    <input type="text" id="rf_unit" class="form-control text-center" value="式">
                                </div>
                                <div class="col-md-3">
                                    <label class="small fw-bold text-muted">單價(含稅) <span class="text-danger">*</span></label>
                                    <input type="number" id="rf_price" class="form-control fw-bold text-end" step="any" oninput="window.recalcFixSubtotal()">
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">總價(含稅) <span class="text-danger">*</span></label>
                                    <input type="number" id="rf_subtotal" class="form-control fw-bold text-primary text-end" step="any">
                                </div>
                            </div>

                            <div class="p-2 rounded bg-light border mb-2">
                                <label class="small fw-bold text-dark d-block mb-1">📦 補登後之出貨與庫存處理方式：</label>
                                <select id="rf_shipStatus" class="form-select form-select-sm fw-bold">
                                    <option value="已結案" selected>🟢 直接標記為「已結案」（僅補齊出貨明細帳務，不重複扣減目前實體庫存）</option>
                                    <option value="待出貨">🟡 標記為「待出貨」（需後續至欠貨出貨模組執行實際扣庫出貨）</option>
                                </select>
                            </div>

                            <div id="rf_createInvBox" class="form-check mt-2" style="display:none;">
                                <input class="form-check-input" type="checkbox" id="rf_alsoCreateInv" checked>
                                <label class="form-check-label small fw-bold text-danger" for="rf_alsoCreateInv">
                                    ⚠️ 本系統「發票總表」亦查無此發票，勾選以同步補登一筆發票總表紀錄
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer bg-white border-0">
                        <button type="button" class="btn btn-secondary fw-bold" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-primary fw-bold px-4 shadow-sm" onclick="window.confirmReconcileFixSubmit()">💾 確認補登並立即重新比對</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', fixModalHtml);
    }

    if ((!window.reconcileState.extRawRows || window.reconcileState.extRawRows.length === 0)) {
        window.loadReconcileWorkspace();
    }
};

window.parseExternalDateStr = function(rawVal) {
    if (rawVal === undefined || rawVal === null || rawVal === '') return null;

    if (typeof rawVal === 'number' && rawVal > 25000 && rawVal < 80000) {
        const utcDays = Math.floor(rawVal - 25569);
        const d = new Date(utcDays * 86400 * 1000);
        if (!isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        }
    }

    const s = String(rawVal).trim();
    if (!s) return null;

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

    const mUsSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mUsSlash) {
        const mon = parseInt(mUsSlash[1], 10);
        const day = parseInt(mUsSlash[2], 10);
        const yr = parseInt(mUsSlash[3], 10);
        if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
            return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    const dObj = new Date(s);
    if (!isNaN(dObj.getTime())) {
        return `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(dObj.getDate()).padStart(2, '0')}`;
    }

    return null;
};

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

                if (!sysInv && !custId && !ispn && !noInvoice) continue;

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

            let minDate = '';
            let maxDate = '';
            if (detectedDates.length > 0) {
                detectedDates.sort();
                minDate = detectedDates[0];
                maxDate = detectedDates[detectedDates.length - 1];
            } else {
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

            if (window.reconcileState.fileName && window.reconcileState.fileName !== fileName && Object.keys(window.reconcileState.reviewedMap || {}).length > 0) {
                if (!confirm(`偵測到上傳新檔案「${fileName}」，是否保留先前已標記為「已覆核」的紀錄？\n(按「確定」保留，按「取消」清空重新開始)`)) {
                    window.reconcileState.reviewedMap = {};
                }
            }

            window.reconcileState.fileName = fileName;
            window.reconcileState.extRawRows = parsedRows;
            window.reconcileState.startDate = minDate;
            window.reconcileState.endDate = maxDate;

            document.getElementById('recMetaBar').style.display = 'block';
            document.getElementById('recStartDate').value = minDate;
            document.getElementById('recEndDate').value = maxDate;

            if (document.getElementById('repStart')) document.getElementById('repStart').value = minDate;
            if (document.getElementById('repEnd')) document.getElementById('repEnd').value = maxDate;
            if (typeof window.generateReport === 'function') window.generateReport();

            window.saveReconcileWorkspace();
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

window.buildReconcileItemKey = function(r) {
    return [
        String(r.invNo || '').trim().toUpperCase(),
        String(r.erpCode || '').trim().toUpperCase(),
        String(r.extCode || '').trim().toUpperCase(),
        String(r.extSysInv || '').trim(),
        r.erpQty !== null ? r.erpQty : 'N',
        r.extQty !== null ? r.extQty : 'N'
    ].join('|');
};

window.runReportReconciliation = function(isSilentRestore = false) {
    const extRows = window.reconcileState.extRawRows || [];
    if (extRows.length === 0) {
        if (!isSilentRestore) alert("請先上傳外部系統報表！");
        return;
    }

    const sVal = document.getElementById('recStartDate').value || window.reconcileState.startDate;
    const eVal = document.getElementById('recEndDate').value || window.reconcileState.endDate;
    if (!sVal || !eVal) return;

    window.reconcileState.startDate = sVal;
    window.reconcileState.endDate = eVal;

    const sDate = new Date(sVal); sDate.setHours(0, 0, 0, 0);
    const eDate = new Date(eVal); eDate.setHours(23, 59, 59, 999);

    const erpRows = [];
    (globalSalesDetails || []).forEach(s => {
        if (s.shipStatus === '作廢' || s.shipStatus === '歷史已結案') return;
        const d = new Date(s.time);
        if (isNaN(d.getTime()) || d < sDate || d > eDate) return;

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

        const itemObj = {
            category: diffs.length === 0 ? 'MATCH' : 'VALUE_DIFF',
            invNo: invNo,
            date: eFirst.date || xFirst.date,
            erpClient: erpClient,
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
            diffFields: diffFields,
            canSupplementErp: false
        };
        itemObj.recKey = window.buildReconcileItemKey(itemObj);
        results.push(itemObj);
    };

    allInvNos.forEach(invNo => {
        const eItems = erpByInv.get(invNo) || [];
        const xItems = extByInv.get(invNo) || [];

        if (eItems.length > 0 && xItems.length > 0) {
            const eGroups = groupItemsByCode(eItems, true);
            const xGroups = groupItemsByCode(xItems, false);
            const usedE = new Set();
            const usedX = new Set();

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

            const remE = eGroups.map((g, i) => ({ g, i })).filter(x => !usedE.has(x.i));
            const remX = xGroups.map((g, i) => ({ g, i })).filter(x => !usedX.has(x.i));
            const pairLen = Math.min(remE.length, remX.length);
            for (let k = 0; k < pairLen; k++) {
                usedE.add(remE[k].i);
                usedX.add(remX[k].i);
                comparePairedGroup(invNo, remE[k].g, remX[k].g);
            }

            eGroups.forEach((eg, eIdx) => {
                if (usedE.has(eIdx)) return;
                const eFirst = eg.rawItems[0];
                const itemObj = {
                    category: 'ONLY_ERP',
                    invNo: invNo,
                    date: eFirst.date,
                    erpClient: eFirst.client,
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
                    diffFields: { missingExt: true },
                    canSupplementErp: false
                };
                itemObj.recKey = window.buildReconcileItemKey(itemObj);
                results.push(itemObj);
            });

            xGroups.forEach((xg, xIdx) => {
                if (usedX.has(xIdx)) return;
                const xFirst = xg.rawItems[0];
                const inHistory = (globalHistory || []).find(h => String(h.paperNo || '').trim().toUpperCase() === invNo);
                const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId(inHistory ? inHistory.client : '', xFirst.custId) : { extClientName: xFirst.custId };
                const itemObj = {
                    category: 'ONLY_EXT',
                    invNo: invNo,
                    date: xFirst.date,
                    erpClient: eItems[0]?.client || (inHistory ? inHistory.client : '--'),
                    extCustId: xFirst.custId,
                    extClientName: cInfo.extClientName,
                    erpCode: '--',
                    extCode: xg.code || '(無ISPN)',
                    erpName: inHistory ? `發票總表明細: ${inHistory.details || ''}` : '(本系統出貨明細缺漏此項)',
                    erpOrderNo: eItems[0]?.orderNo || (inHistory ? inHistory.orderNo : '--'),
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
                    diffs: [`同發票(${invNo})內，外部系統有此品項，但本系統出貨明細缺漏（可點擊右側「🛠️ 補登明細」一鍵補齊）`],
                    diffFields: { missingErp: true },
                    canSupplementErp: true,
                    inHistoryRecord: inHistory || null
                };
                itemObj.recKey = window.buildReconcileItemKey(itemObj);
                results.push(itemObj);
            });
        }
        else if (eItems.length > 0 && xItems.length === 0) {
            const eGroups = groupItemsByCode(eItems, true);
            const isBorrowed = String(invNo).startsWith('[借用中]');
            eGroups.forEach(eg => {
                const eFirst = eg.rawItems[0];
                const reason = isBorrowed
                    ? `本系統為「借用發票(${invNo})」尚未補登正式發票號碼（訂單號: ${eFirst.orderNo || '無'}）`
                    : `本系統有此發票明細(${invNo})，但外部系統報表查無此發票號碼`;
                const itemObj = {
                    category: 'ONLY_ERP',
                    invNo: invNo,
                    date: eFirst.date,
                    erpClient: eFirst.client,
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
                    diffFields: { missingExt: true },
                    canSupplementErp: false
                };
                itemObj.recKey = window.buildReconcileItemKey(itemObj);
                results.push(itemObj);
            });
        }
        else if (xItems.length > 0 && eItems.length === 0) {
            const xGroups = groupItemsByCode(xItems, false);
            const inHistory = (globalHistory || []).find(h => String(h.paperNo || '').trim().toUpperCase() === invNo);
            xGroups.forEach(xg => {
                const xFirst = xg.rawItems[0];
                const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId(inHistory ? inHistory.client : '', xFirst.custId) : { extClientName: xFirst.custId };
                let reason = `外部系統有此發票(${invNo})，但本系統「出貨明細」查無紀錄`;
                if (inHistory) {
                    reason += ` (⚠️ 系統偵測到此發票存在於本系統「發票總表」[${inHistory.client} 總計:$${inHistory.total}]，但「出貨明細」中無對應項目或單號未連動 — 請點擊右側「🛠️ 補登明細」一鍵修復)`;
                }
                const itemObj = {
                    category: 'ONLY_EXT',
                    invNo: invNo,
                    date: xFirst.date,
                    erpClient: inHistory ? `${inHistory.client} (僅存於發票總表)` : '--',
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
                    diffFields: { missingErp: true },
                    canSupplementErp: true,
                    inHistoryRecord: inHistory || null
                };
                itemObj.recKey = window.buildReconcileItemKey(itemObj);
                results.push(itemObj);
            });
        }
    });

    extEmptyInvRows.forEach(xRow => {
        const cInfo = window.matchClientWithCustId ? window.matchClientWithCustId('', xRow.custId) : { extClientName: xRow.custId };
        const itemObj = {
            category: 'ONLY_EXT',
            invNo: '(外部未填發票號碼)',
            date: xRow.date,
            erpClient: '--',
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
            diffFields: { missingErp: true },
            canSupplementErp: false
        };
        itemObj.recKey = window.buildReconcileItemKey(itemObj);
        results.push(itemObj);
    });

    window.reconcileState.results = results;
    window.updateReconcileKpiCounts();

    document.getElementById('recKpiRow').style.display = 'flex';
    document.getElementById('recFilterToolbar').style.setProperty('display', 'flex', 'important');
    document.getElementById('btnDownloadReconcileExcel').style.display = 'inline-block';
    if (document.getElementById('btnClearReconcileCache')) {
        document.getElementById('btnClearReconcileCache').style.display = 'inline-block';
    }

    window.saveReconcileWorkspace();
    window.setReconcileFilter(window.reconcileState.currentFilter || 'ALL_DIFF');
};

window.updateReconcileKpiCounts = function() {
    const results = window.reconcileState.results || [];
    const revMap = window.reconcileState.reviewedMap || {};

    let countValDiff = 0;
    let countOnlyExt = 0;
    let countOnlyErp = 0;
    let countReviewed = 0;
    let countMatch = 0;

    results.forEach(r => {
        const isRev = !!revMap[r.recKey];
        if (r.category === 'MATCH') {
            countMatch++;
        } else if (isRev) {
            countReviewed++;
        } else {
            if (r.category === 'VALUE_DIFF') countValDiff++;
            else if (r.category === 'ONLY_EXT') countOnlyExt++;
            else if (r.category === 'ONLY_ERP') countOnlyErp++;
        }
    });

    const countAllDiff = countValDiff + countOnlyExt + countOnlyErp;

    setSafeText('recCountAllDiff', countAllDiff);
    setSafeText('recCountValDiff', countValDiff);
    setSafeText('recCountOnlyExt', countOnlyExt);
    setSafeText('recCountOnlyErp', countOnlyErp);
    setSafeText('recCountReviewed', countReviewed);
    setSafeText('recCountMatch', countMatch);
};

window.toggleReconcileReviewItem = function(recKey, markReviewed) {
    if (!window.reconcileState.reviewedMap) window.reconcileState.reviewedMap = {};
    if (markReviewed) {
        const now = new Date();
        const tStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        window.reconcileState.reviewedMap[recKey] = {
            time: tStr,
            staff: myName || '管理員'
        };
        showToast("✅ 已標記為「已覆核」並移入已覆核專區");
    } else {
        delete window.reconcileState.reviewedMap[recKey];
        showToast("↩️ 已還原回待處理異常清單");
    }
    window.saveReconcileWorkspace();
    window.updateReconcileKpiCounts();
    window.renderReconcileTable();
};

window.batchToggleReconcileReview = function(markReviewed) {
    const cbs = document.querySelectorAll('.cb-rec-item:checked');
    if (cbs.length === 0) return alert("請先在表格左側勾選至少一筆項目！");

    if (!window.reconcileState.reviewedMap) window.reconcileState.reviewedMap = {};
    const now = new Date();
    const tStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    cbs.forEach(cb => {
        const key = cb.value;
        if (markReviewed) {
            window.reconcileState.reviewedMap[key] = { time: tStr, staff: myName || '管理員' };
        } else {
            delete window.reconcileState.reviewedMap[key];
        }
    });

    window.saveReconcileWorkspace();
    window.updateReconcileKpiCounts();
    window.renderReconcileTable();
    showToast(markReviewed ? `✅ 已批次將 ${cbs.length} 筆標記為「已覆核」` : `↩️ 已批次還原 ${cbs.length} 筆項目`);
};

window.toggleAllReconcileCheckboxes = function(masterCb) {
    document.querySelectorAll('.cb-rec-item').forEach(cb => {
        cb.checked = masterCb.checked;
    });
};

window.setReconcileFilter = function(filterType) {
    window.reconcileState.currentFilter = filterType;
    ['ALL_DIFF', 'VALUE_DIFF', 'ONLY_EXT', 'ONLY_ERP', 'REVIEWED', 'MATCH', 'ALL'].forEach(t => {
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

    const btnBatchRev = document.getElementById('btnBatchReview');
    const btnBatchUnrev = document.getElementById('btnBatchUnreview');
    if (btnBatchRev && btnBatchUnrev) {
        if (filterType === 'REVIEWED') {
            btnBatchRev.style.display = 'none';
            btnBatchUnrev.style.display = 'inline-block';
        } else if (filterType === 'MATCH') {
            btnBatchRev.style.display = 'none';
            btnBatchUnrev.style.display = 'none';
        } else {
            btnBatchRev.style.display = 'inline-block';
            btnBatchUnrev.style.display = 'none';
        }
    }

    window.renderReconcileTable();
};

window.onReconcileSearch = debounce(function(val) {
    window.reconcileState.searchTerm = (val || '').trim().toLowerCase();
    window.renderReconcileTable();
}, 250);

window.renderReconcileTable = function() {
    const container = document.getElementById('recResultContainer');
    if (!container) return;

    const filter = window.reconcileState.currentFilter || 'ALL_DIFF';
    const term = window.reconcileState.searchTerm || '';
    const revMap = window.reconcileState.reviewedMap || {};
    let list = window.reconcileState.results || [];

    if (filter === 'ALL_DIFF') {
        list = list.filter(r => r.category !== 'MATCH' && !revMap[r.recKey]);
    } else if (filter === 'REVIEWED') {
        list = list.filter(r => r.category !== 'MATCH' && !!revMap[r.recKey]);
    } else if (filter === 'MATCH') {
        list = list.filter(r => r.category === 'MATCH');
    } else if (filter !== 'ALL') {
        list = list.filter(r => r.category === filter && !revMap[r.recKey]);
    }

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
        container.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-light">🎉 此分類條件下沒有任何待處理紀錄</div>`;
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
        const isReviewed = !!revMap[r.recKey];
        const revInfo = revMap[r.recKey];
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

        let actionBtnsHtml = '';
        if (r.category !== 'MATCH') {
            if (isReviewed) {
                actionBtnsHtml += `
                    <div class="badge bg-secondary mb-1 d-block">☑️ 已覆核 (${escapeQuotes(revInfo.staff)} ${escapeQuotes(revInfo.time)})</div>
                    <button class="btn btn-sm btn-outline-warning text-dark fw-bold w-100 mb-1" onclick="window.toggleReconcileReviewItem('${escapeQuotes(r.recKey)}', false)">↩️ 還原未覆核</button>
                `;
            } else {
                actionBtnsHtml += `
                    <button class="btn btn-sm btn-success fw-bold w-100 mb-1 shadow-sm" onclick="window.toggleReconcileReviewItem('${escapeQuotes(r.recKey)}', true)">✅ 已覆核</button>
                `;
            }

            if (r.canSupplementErp) {
                actionBtnsHtml += `
                    <button class="btn btn-sm btn-primary fw-bold w-100 shadow-sm" onclick="window.openReconcileFixModal('${escapeQuotes(r.recKey)}')">🛠️ 補登明細</button>
                `;
            }
        } else {
            actionBtnsHtml = `<span class="badge bg-light text-success border">無需處理</span>`;
        }

        const cbCell = r.category !== 'MATCH'
            ? `<input type="checkbox" class="form-check-input cb-rec-item" value="${escapeQuotes(r.recKey)}" style="transform: scale(1.2); cursor:pointer;">`
            : '';

        return `
        <tr style="${isReviewed ? 'background-color: #f8f9ff;' : (r.category !== 'MATCH' ? 'background-color: #fffdfd;' : '')}">
            <td class="text-center">${cbCell}</td>
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
            <td style="min-width: 210px;">${diffDescHtml}</td>
            <td class="text-center" style="min-width: 135px;">${actionBtnsHtml}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <div class="table-responsive border rounded shadow-sm" style="max-height: 640px; overflow-y: auto;">
        <table class="table table-hover table-bordered align-middle mb-0" style="font-size: 0.87rem;">
            <thead class="table-light position-sticky top-0" style="z-index: 5;">
                <tr>
                    <th class="text-center" style="width: 38px;"><input type="checkbox" class="form-check-input" onchange="window.toggleAllReconcileCheckboxes(this)" title="全選本頁"></th>
                    <th class="text-center" style="width: 42px;">#</th>
                    <th style="min-width: 145px;">發票號碼 (B欄 vs J欄)</th>
                    <th style="min-width: 185px;">客戶名稱 (C欄 vs B欄CUSTID)</th>
                    <th style="min-width: 185px;">長固代號 (E欄 vs D欄ISPN)</th>
                    <th class="text-end" style="min-width: 120px;">數量 (G欄 vs E欄)</th>
                    <th class="text-end" style="min-width: 125px;">單價 (H欄 vs G欄)</th>
                    <th class="text-end" style="min-width: 130px;">總價 (I欄 vs H欄)</th>
                    <th style="min-width: 220px;">AI 智慧勾稽診斷說明</th>
                    <th class="text-center" style="min-width: 135px;">覆核與補登操作</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    </div>`;
};

window.openReconcileFixModal = function(recKey) {
    const r = (window.reconcileState.results || []).find(x => x.recKey === recKey);
    if (!r) return;

    document.getElementById('rf_recKey').value = recKey;

    const inHistory = (globalHistory || []).find(h => String(h.paperNo || '').trim().toUpperCase() === r.invNo);
    const erpInfoEl = document.getElementById('rf_erpHistoryInfo');
    const extInfoEl = document.getElementById('rf_extReportInfo');

    if (inHistory) {
        const d = new Date(inHistory.time);
        const dtStr = isNaN(d.getTime()) ? r.date : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        erpInfoEl.innerText = `發票號碼：${inHistory.paperNo}\n開立日期：${dtStr}\n客戶名稱：${inHistory.client}\n訂單編號：${inHistory.orderNo || '無'}\n發票總額：$${Number(inHistory.total).toLocaleString()}\n購買明細原文：\n${inHistory.details || '(無)'}`;
        document.getElementById('rf_createInvBox').style.display = 'none';
        document.getElementById('rf_alsoCreateInv').checked = false;
    } else {
        erpInfoEl.innerText = `⚠️ 本系統「發票總表」與「出貨明細」皆查無發票 ${r.invNo}。\n（您可以在下方勾選同步補登至發票總表與出貨明細）`;
        document.getElementById('rf_createInvBox').style.display = 'block';
        document.getElementById('rf_alsoCreateInv').checked = true;
    }

    extInfoEl.innerText = `發票號碼 (NOINVOICE)：${r.invNo}\n外部日期 (DATE)：${r.date || '無'}\n客戶代號 (CUSTID)：${r.extCustId} (${r.extClientName})\n產品代號 (ISPN)：${r.extCode}\n數量 (QTY)：${r.extQty} | 單價：$${r.extPrice} | 總價：$${r.extTotal}\n外部單號/PONUMBER：${r.extPoNo || r.extSysInv || '無'}`;

    let prefillDate = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : getTodayStr();
    if (inHistory && inHistory.time) {
        const hd = new Date(inHistory.time);
        if (!isNaN(hd.getTime())) {
            prefillDate = `${hd.getFullYear()}-${String(hd.getMonth()+1).padStart(2,'0')}-${String(hd.getDate()).padStart(2,'0')}`;
        }
    }

    const prefillClient = inHistory
        ? inHistory.client
        : (window.getErpClientNameByCustId ? window.getErpClientNameByCustId(r.extCustId) : r.extClientName);

    const prefillOrderNo = (inHistory && inHistory.orderNo) ? inHistory.orderNo : (r.extPoNo !== '--' ? r.extPoNo : '');
    const prodLookup = window.findProductNameByCode ? window.findProductNameByCode(r.extCode, prefillClient) : { name: '', unit: '式' };

    let fallbackNameFromHistory = '';
    if (inHistory && inHistory.details) {
        const firstLine = String(inHistory.details).split('\n')[0];
        const m = firstLine.match(/^(.*)\s+x[0-9.]+/);
        if (m) fallbackNameFromHistory = m[1].trim();
    }

    document.getElementById('rf_date').value = prefillDate;
    document.getElementById('rf_paperNo').value = r.invNo;
    document.getElementById('rf_orderNo').value = prefillOrderNo;
    document.getElementById('rf_client').value = prefillClient;
    document.getElementById('rf_code').value = r.extCode !== '(無ISPN)' ? r.extCode : '';
    document.getElementById('rf_name').value = (prodLookup.name && prodLookup.name !== r.extCode) ? prodLookup.name : (fallbackNameFromHistory || prodLookup.name || '');
    document.getElementById('rf_unit').value = prodLookup.unit || '式';
    document.getElementById('rf_qty').value = r.extQty || 1;
    document.getElementById('rf_price').value = r.extPrice || 0;
    document.getElementById('rf_subtotal').value = r.extTotal || Math.round((r.extQty || 0) * (r.extPrice || 0));
    document.getElementById('rf_shipStatus').value = '已結案';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('reconcileFixModal')).show();
};

window.recalcFixSubtotal = function() {
    const q = parseFloat(document.getElementById('rf_qty').value) || 0;
    const p = parseFloat(document.getElementById('rf_price').value) || 0;
    document.getElementById('rf_subtotal').value = Math.round(q * p);
};

window.confirmReconcileFixSubmit = function() {
    const btn = event ? event.currentTarget : null;

    const dateVal = document.getElementById('rf_date').value;
    const paperNo = document.getElementById('rf_paperNo').value.trim().toUpperCase();
    const orderNo = document.getElementById('rf_orderNo').value.trim();
    const client = document.getElementById('rf_client').value.trim();
    const name = document.getElementById('rf_name').value.trim();
    const code = document.getElementById('rf_code').value.trim();
    const unit = document.getElementById('rf_unit').value.trim() || '式';
    const qty = parseFloat(document.getElementById('rf_qty').value);
    const price = parseFloat(document.getElementById('rf_price').value) || 0;
    const subtotal = parseFloat(document.getElementById('rf_subtotal').value) || Math.round(qty * price);
    const shipStatus = document.getElementById('rf_shipStatus').value;
    const alsoCreateInv = document.getElementById('rf_alsoCreateInv').checked && document.getElementById('rf_createInvBox').style.display !== 'none';

    if (!dateVal || !paperNo || !client || !name || isNaN(qty) || qty <= 0) {
        return alert("請完整填寫日期、發票號碼、客戶名稱、品名與大於 0 的數量！");
    }
    if (window.lockButton(btn)) return;

    const timestamp = new Date(dateVal).getTime() || Date.now();
    const newRowIdx = Date.now() + Math.floor(Math.random() * 1000);
    const shippedQty = shipStatus === '已結案' ? qty : 0;

    globalSalesDetails.unshift({
        rowIdx: newRowIdx,
        time: timestamp,
        paperNo: paperNo,
        client: client,
        orderNo: orderNo,
        name: name,
        qty: qty,
        unit: unit,
        price: price,
        subtotal: subtotal,
        shipStatus: shipStatus,
        shippedQty: shippedQty,
        lot: '',
        expiry: '',
        payStatus: '未收款',
        paidAmount: 0,
        payDate: '',
        paymentNo: ''
    });

    if (code && !window.findProductRobust(client, code, name)) {
        globalCatalog.push({
            rowIndex: window.getNextCatalogRowIndex ? window.getNextCatalogRowIndex() : 99999,
            assetCode: '',
            internalCode: code,
            clientName: client,
            productName: name,
            unit: unit,
            price: price
        });
    }

    const cObj = (globalClients || []).find(c => c.name === client);
    const taxId = cObj ? (cObj.taxId || '') : '';

    if (alsoCreateInv) {
        const net = Math.round(subtotal / 1.05);
        const tax = subtotal - net;
        const detailLine = `${name} x${qty} (單價: $${price.toFixed(3)}) ${orderNo ? '[' + orderNo + ']' : ''}`.trim();
        globalHistory.unshift({
            rowIdx: newRowIdx + 1,
            time: timestamp,
            staff: myName,
            client: client,
            taxId: taxId,
            net: net,
            tax: tax,
            total: subtotal,
            details: detailLine,
            paperNo: paperNo,
            orderNo: orderNo,
            status: '正常',
            historyLog: '["跨系統勾稽補登"]'
        });
    }

    pushToSyncQueue('supplementSalesDetail', {
        rowIdx: newRowIdx,
        time: timestamp,
        paperNo: paperNo,
        client: client,
        taxId: taxId,
        orderNo: orderNo,
        name: name,
        qty: qty,
        unit: unit,
        price: price,
        subtotal: subtotal,
        shipStatus: shipStatus,
        shippedQty: shippedQty,
        alsoCreateInvoiceRecord: alsoCreateInv,
        staff: myName
    }, () => {
        bootstrap.Modal.getInstance(document.getElementById('reconcileFixModal')).hide();
        window.runReportReconciliation(true);
        showToast(`✅ 已成功補登發票 ${paperNo} 之出貨明細，比對結果已即時更新！`);
    });
};

window.exportReconciliationExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍後再試！");
    const results = window.reconcileState.results || [];
    if (results.length === 0) return alert("目前無比對結果可供下載！");

    const revMap = window.reconcileState.reviewedMap || {};

    const statusLabelMap = {
        'VALUE_DIFF': '🟡 欄位數值相異',
        'ONLY_EXT': '🔴 僅外部系統有 (本系統出貨明細缺漏)',
        'ONLY_ERP': '🔵 僅本系統有 (外部系統缺漏/借用)',
        'MATCH': '🟢 完全吻合'
    };

    const buildSheetRows = (targetList) => {
        const header = [
            "比對狀態",
            "人工覆核狀態",
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
            const revInfo = revMap[r.recKey];
            const revText = revInfo ? `☑️ 已覆核 (${revInfo.staff} ${revInfo.time})` : (r.category === 'MATCH' ? '系統自動吻合' : '⚠️ 待處理');

            rows.push([
                statusLabelMap[r.category] || r.category,
                revText,
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
            { wch: 26 }, { wch: 24 }, { wch: 12 }, { wch: 22 }, { wch: 30 },
            { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 34 },
            { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
            { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 18 },
            { wch: 18 }, { wch: 65 }
        ];
    };

    const unreviewedDiffList = results.filter(r => r.category !== 'MATCH' && !revMap[r.recKey]);
    const valDiffList        = results.filter(r => r.category === 'VALUE_DIFF' && !revMap[r.recKey]);
    const missingList        = results.filter(r => (r.category === 'ONLY_EXT' || r.category === 'ONLY_ERP') && !revMap[r.recKey]);
    const reviewedList       = results.filter(r => r.category !== 'MATCH' && !!revMap[r.recKey]);
    const matchList          = results.filter(r => r.category === 'MATCH');

    const wb = XLSX.utils.book_new();

    const wsAllDiff = XLSX.utils.aoa_to_sheet(buildSheetRows(unreviewedDiffList));
    setSheetColWidths(wsAllDiff);
    XLSX.utils.book_append_sheet(wb, wsAllDiff, "1_待處理異常總表");

    const wsValDiff = XLSX.utils.aoa_to_sheet(buildSheetRows(valDiffList));
    setSheetColWidths(wsValDiff);
    XLSX.utils.book_append_sheet(wb, wsValDiff, "2_欄位數值不符明細");

    const wsMissing = XLSX.utils.aoa_to_sheet(buildSheetRows(missingList));
    setSheetColWidths(wsMissing);
    XLSX.utils.book_append_sheet(wb, wsMissing, "3_單邊缺漏明細");

    const wsReviewed = XLSX.utils.aoa_to_sheet(buildSheetRows(reviewedList));
    setSheetColWidths(wsReviewed);
    XLSX.utils.book_append_sheet(wb, wsReviewed, "4_人工已覆核專區");

    const wsMatch = XLSX.utils.aoa_to_sheet(buildSheetRows(matchList));
    setSheetColWidths(wsMatch);
    XLSX.utils.book_append_sheet(wb, wsMatch, "5_完全吻合明細");

    const rangeStr = `${window.reconcileState.startDate || ''}_至_${window.reconcileState.endDate || ''}`;
    const outFileName = `長固ERP_跨系統比對差異報告_${rangeStr}.xlsx`;
    XLSX.writeFile(wb, outFileName);
    showToast("📥 跨系統比對差異 Excel 報表已成功下載！");
};
// ============================================================================
// 【📋 營業人使用三聯式 ＆ 二聯式統一發票明細表】（1:1 復刻稅捐處標準 A4 直式雙表格）
// 支援：字軌與雙月期別智慧攔截、異常單號診斷修正、唯一單號精確計數、本月 401 銷項匯總、多冊合併列印與 Excel 匯出
// ============================================================================
const TAX_MANUAL_VOID_STORAGE_KEY = 'changgu_erp_tax_manual_voids_v1';

window.loadManualVoidSuffixes = function() {
    try {
        const raw = localStorage.getItem(TAX_MANUAL_VOID_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
};

window.saveManualVoidSuffixes = function() {
    try {
        localStorage.setItem(TAX_MANUAL_VOID_STORAGE_KEY, JSON.stringify(window.taxDetailState.manualVoidSuffixes || {}));
    } catch (e) {}
};

window.taxDetailState = {
    formType: 'THREE_PART', // 'THREE_PART' (三聯式) | 'TWO_PART' (二聯式)
    rocYear: new Date().getFullYear() - 1911,
    month: new Date().getMonth() + 1,
    companyTaxId: '86477073',
    companyName: '長固實業股份有限公司',
    taxRegNo: localStorage.getItem('changgu_tax_reg_no') || '',
    taxOfficeCode: localStorage.getItem('changgu_tax_office_code') || '',
    declareDate: getTodayStr(),
    track: 'EC',
    prefix6: '',
    rangeHalf: '00-49', // '00-49' | '50-99'
    pageTotalSheets: 1,
    pageCurrentSheet: 1,
    manualVoidSuffixes: window.loadManualVoidSuffixes(),
    detectedBooklets: [],      // 當前所選聯式 (三聯或二聯) 的有效冊別
    allMonthBooklets: [],      // 該月份全部有效冊別 (含三聯與二聯)
    anomalies: {
        crossPeriod: [],       // 🔴 跨期字軌日期誤植 (如 10 月出現 5-6 月的 ZX 字軌)
        typoPrefixes: [],      // 🟡 疑似前六碼打錯之孤立冊別 (如 EC-528665 vs EC-525665)
        duplicates: []         // 🟣 同號碼重複建檔之發票
    }
};

window.initTaxDetailTab = function() {
    const root = document.getElementById('taxDetailModuleRoot');
    if (!root) return;

    if (!document.getElementById('tdControlPanel')) {
        const curRocYear = new Date().getFullYear() - 1911;
        let yearOpts = '';
        for (let y = curRocYear - 2; y <= curRocYear + 2; y++) {
            yearOpts += `<option value="${y}" ${y === window.taxDetailState.rocYear ? 'selected' : ''}>中華民國 ${y} 年 (${y + 1911})</option>`;
        }

        let monthOpts = '';
        for (let m = 1; m <= 12; m++) {
            monthOpts += `<option value="${m}" ${m === window.taxDetailState.month ? 'selected' : ''}>${m} 月份</option>`;
        }

        root.innerHTML = `
        <div id="tdControlPanel" class="p-3 bg-light border rounded shadow-sm mb-3">
            <!-- 頂部：📘 三聯式 ⇄ 📗 二聯式 大型分流切換按鈕與列印/匯出操作列 -->
            <div class="d-flex flex-wrap justify-content-between align-items-center border-bottom pb-3 mb-3 gap-2">
                <div class="d-flex flex-wrap align-items-center gap-2">
                    <div class="btn-group shadow-sm" role="group">
                        <button type="button" id="btnTaxTypeThree" class="btn btn-primary fw-bold px-3 py-2" onclick="window.setTaxDetailFormType('THREE_PART')">
                            📘 營業人使用三聯式統一發票明細表
                        </button>
                        <button type="button" id="btnTaxTypeTwo" class="btn btn-outline-success bg-white fw-bold px-3 py-2" onclick="window.setTaxDetailFormType('TWO_PART')">
                            📗 營業人使用二聯式統一發票明細表
                        </button>
                    </div>
                </div>

                <div class="d-flex flex-wrap gap-2">
                    <button class="btn btn-primary fw-bold shadow-sm" onclick="window.printCurrentTaxDetailSheet()">
                        🖨️ 列印本張明細表 (A4直式)
                    </button>
                    <button class="btn btn-success fw-bold shadow-sm" id="btnPrintCurrentTypeAll" onclick="window.printAllMonthTaxDetailSheets(false)">
                        📚 列印本月全部三聯式冊別
                    </button>
                    <button class="btn btn-dark fw-bold shadow-sm" onclick="window.printAllMonthTaxDetailSheets(true)" title="一次合併預覽並列印本月所有三聯式與二聯式明細表">
                        🖨️ 合併列印本月三聯＋二聯全冊
                    </button>
                    <button class="btn btn-outline-success bg-white fw-bold shadow-sm" onclick="window.exportMonthTaxDetailExcel()">
                        📥 匯出本月明細表 Excel (.xlsx)
                    </button>
                </div>
            </div>

            <!-- 📊 本月三聯式＋二聯式 營業稅申報總覽卡片 (自動排除跨期誤植字軌) -->
            <div class="row g-2 mb-3">
                <div class="col-12 col-md-4">
                    <div class="p-2 bg-white border rounded shadow-sm h-100" style="border-left: 4px solid #0d6efd !important;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="small fw-bold text-primary">📘 本月三聯式發票匯總</span>
                            <span class="badge bg-primary" id="tdSumThreeBooks">0 冊 / 0 張</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-baseline mt-1">
                            <span class="small text-muted">未稅銷售額：<strong class="text-dark" id="tdSumThreeNet">$0</strong></span>
                            <span class="small text-muted">5%稅額：<strong class="text-danger" id="tdSumThreeTax">$0</strong></span>
                        </div>
                    </div>
                </div>
                <div class="col-12 col-md-4">
                    <div class="p-2 bg-white border rounded shadow-sm h-100" style="border-left: 4px solid #198754 !important;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="small fw-bold text-success">📗 本月二聯式發票匯總 (含稅折算)</span>
                            <span class="badge bg-success" id="tdSumTwoBooks">0 冊 / 0 張</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-baseline mt-1">
                            <span class="small text-muted">含稅總額：<strong class="text-dark" id="tdSumTwoGross">$0</strong></span>
                            <span class="small text-muted">折算未稅 <strong class="text-primary" id="tdSumTwoNet">$0</strong> ｜ 稅 <strong class="text-danger" id="tdSumTwoTax">$0</strong></span>
                        </div>
                    </div>
                </div>
                <div class="col-12 col-md-4">
                    <div class="p-2 bg-white border rounded shadow-sm h-100" style="border-left: 4px solid #dc3545 !important;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="small fw-bold text-danger">🧾 本月銷項營業稅總計 (三聯＋二聯)</span>
                            <span class="badge bg-danger" id="tdSumAllCount">共 0 張應稅</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-baseline mt-1">
                            <span class="small text-muted">未稅總銷售額：<strong class="text-dark fs-6" id="tdSumAllNet">$0</strong></span>
                            <span class="small text-muted">總銷項稅額：<strong class="text-danger fs-6" id="tdSumAllTax">$0</strong></span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 第一排：所屬中華民國年月、申報日期、營業人統編與名稱 -->
            <div class="row g-2 mb-2">
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">中華民國年份</label>
                    <select id="td_rocYear" class="form-select form-select-sm fw-bold text-primary" onchange="window.onTaxPeriodChange()">
                        ${yearOpts}
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">所屬月份</label>
                    <select id="td_month" class="form-select form-select-sm fw-bold text-primary" onchange="window.onTaxPeriodChange()">
                        ${monthOpts}
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">申報日期</label>
                    <input type="date" id="td_declareDate" class="form-control form-control-sm fw-bold" value="${window.taxDetailState.declareDate}" onchange="window.renderTaxDetailPreview()">
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">統一編號 (預設固定)</label>
                    <input type="text" id="td_companyTaxId" class="form-control form-control-sm fw-bold text-center" maxlength="8" value="86477073" oninput="window.renderTaxDetailPreview()">
                </div>
                <div class="col-12 col-md-4">
                    <label class="small fw-bold text-muted">營業人名稱 (預設固定)</label>
                    <input type="text" id="td_companyName" class="form-control form-control-sm fw-bold" value="長固實業股份有限公司" oninput="window.renderTaxDetailPreview()">
                </div>
            </div>

            <!-- 第二排：發票字軌 (含字軌屬性切換)、前六位號碼、冊別區間、稅籍編號與頁次 -->
            <div class="row g-2 align-items-end mb-2">
                <div class="col-5 col-md-2">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <label class="small fw-bold text-danger mb-0">發票字軌 *</label>
                        <a href="javascript:void(0)" id="td_trackTypeToggleBadge" class="badge bg-primary text-decoration-none" onclick="window.toggleCurrentTrackFormType()" title="點擊可將此字軌永久切換為三聯式或二聯式">📘三聯字軌</a>
                    </div>
                    <input type="text" id="td_track" class="form-control form-control-sm fw-bold text-center text-uppercase border-danger" maxlength="2" placeholder="如: EC / EE" value="${window.taxDetailState.track}" oninput="this.value=this.value.toUpperCase(); window.onManualTrackInput()">
                </div>
                <div class="col-7 col-md-2">
                    <label class="small fw-bold text-danger">發票前六位號碼 *</label>
                    <input type="text" id="td_prefix6" class="form-control form-control-sm fw-bold text-center border-danger" maxlength="6" inputmode="numeric" placeholder="如: 525667" value="${window.taxDetailState.prefix6}" oninput="window.renderTaxDetailPreview()">
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-primary">每本末二位區間 (50張)</label>
                    <select id="td_rangeHalf" class="form-select form-select-sm fw-bold border-primary" onchange="window.renderTaxDetailPreview()">
                        <option value="00-49">00 ~ 49 (上冊 50張)</option>
                        <option value="50-99">50 ~ 99 (下冊 50張)</option>
                    </select>
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">稅籍編號 (9碼，自動記憶)</label>
                    <input type="text" id="td_taxRegNo" class="form-control form-control-sm text-center" maxlength="9" placeholder="9碼稅籍編號" value="${escapeQuotes(window.taxDetailState.taxRegNo)}" oninput="localStorage.setItem('changgu_tax_reg_no', this.value); window.renderTaxDetailPreview()">
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">稽徵機關編號 (選填)</label>
                    <input type="text" id="td_taxOfficeCode" class="form-control form-control-sm text-center" placeholder="選填" value="${escapeQuotes(window.taxDetailState.taxOfficeCode)}" oninput="localStorage.setItem('changgu_tax_office_code', this.value); window.renderTaxDetailPreview()">
                </div>
                <div class="col-6 col-md-2">
                    <label class="small fw-bold text-muted">頁次 (共 X 張之第 Y 張)</label>
                    <div class="input-group input-group-sm">
                        <span class="input-group-text">共</span>
                        <input type="number" id="td_totalSheets" class="form-control text-center fw-bold" min="1" value="1" oninput="window.renderTaxDetailPreview()">
                        <span class="input-group-text">第</span>
                        <input type="number" id="td_currentSheet" class="form-control text-center fw-bold" min="1" value="1" oninput="window.renderTaxDetailPreview()">
                    </div>
                </div>
            </div>

            <!-- 智慧偵測該月份已開立發票冊別快選列 (依三聯式 / 二聯式自動分流，並依唯一單號精確計數) -->
            <div class="pt-2 border-top mt-2">
                <div class="d-flex flex-wrap align-items-center gap-1">
                    <span class="small fw-bold text-secondary me-1" id="td_bookletPromptLabel">✨ 系統自動偵測本月已開立之【三聯式】發票字軌冊別（點擊一鍵帶入）：</span>
                    <div id="td_bookletPills" class="d-flex flex-wrap gap-1"></div>
                </div>

                <!-- 🩺 跨期字軌 / 疑似打錯前六碼 / 重複單號 智慧診斷與一鍵修正專區 -->
                <div id="td_anomaliesContainer" class="mt-2"></div>

                <div class="small text-muted mt-1">
                    💡 <strong>互動小提示</strong>：1. 若某張紙本發票為「手寫作廢」，直接點擊下方表格該列即可在「空白 ⇄ 作廢」間切換（自動記憶）；2. 點擊字軌上方「📘三聯字軌 / 📗二聯字軌」小標籤可手動變更該字軌歸屬。
                </div>
            </div>
        </div>

        <!-- 螢幕即時預覽容器 -->
        <div id="tdPreviewWrapper" class="bg-secondary bg-opacity-10 p-2 p-md-3 rounded border overflow-auto">
            <div id="tdSheetPreviewContainer" style="min-width: 760px; max-width: 820px; margin: 0 auto; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.15);"></div>
        </div>`;
    }

    window.onTaxPeriodChange();
};

window.setTaxDetailFormType = function(formType) {
    window.taxDetailState.formType = formType;
    const isTwo = (formType === 'TWO_PART');

    const btnThree = document.getElementById('btnTaxTypeThree');
    const btnTwo = document.getElementById('btnTaxTypeTwo');
    if (btnThree && btnTwo) {
        btnThree.className = isTwo ? 'btn btn-outline-primary bg-white fw-bold px-3 py-2' : 'btn btn-primary fw-bold px-3 py-2';
        btnTwo.className = isTwo ? 'btn btn-success fw-bold px-3 py-2' : 'btn btn-outline-success bg-white fw-bold px-3 py-2';
    }

    const btnPrintAll = document.getElementById('btnPrintCurrentTypeAll');
    if (btnPrintAll) {
        btnPrintAll.innerHTML = isTwo ? '📚 列印本月全部二聯式冊別' : '📚 列印本月全部三聯式冊別';
    }

    const promptLabel = document.getElementById('td_bookletPromptLabel');
    if (promptLabel) {
        promptLabel.innerHTML = isTwo
            ? '✨ 系統自動偵測本月已開立之【<strong class="text-success">📗 二聯式</strong>】發票字軌冊別（點擊一鍵帶入）：'
            : '✨ 系統自動偵測本月已開立之【<strong class="text-primary">📘 三聯式</strong>】發票字軌冊別（點擊一鍵帶入）：';
    }

    window.onTaxPeriodChange();
};

window.onManualTrackInput = function() {
    const trk = (document.getElementById('td_track')?.value || '').trim().toUpperCase();
    window.updateTrackTypeBadgeUI(trk);
    window.renderTaxDetailPreview();
};

window.updateTrackTypeBadgeUI = function(track) {
    const badge = document.getElementById('td_trackTypeToggleBadge');
    if (!badge) return;
    if (!track || track.length < 2) {
        badge.innerText = window.taxDetailState.formType === 'TWO_PART' ? '📗二聯字軌' : '📘三聯字軌';
        badge.className = window.taxDetailState.formType === 'TWO_PART' ? 'badge bg-success text-decoration-none' : 'badge bg-primary text-decoration-none';
        return;
    }
    const fType = window.getInvoiceFormTypeByTrack(track);
    if (fType === 'TWO_PART') {
        badge.innerText = `📗 ${track}=二聯(點此改三聯)`;
        badge.className = 'badge bg-success text-decoration-none';
    } else {
        badge.innerText = `📘 ${track}=三聯(點此改二聯)`;
        badge.className = 'badge bg-primary text-decoration-none';
    }
};

window.toggleCurrentTrackFormType = function() {
    const trk = (document.getElementById('td_track')?.value || '').trim().toUpperCase();
    if (!trk || trk.length !== 2) return alert("請先在發票字軌欄位輸入 2 碼英文字軌！");

    const currentType = window.getInvoiceFormTypeByTrack(trk);
    const nextType = currentType === 'TWO_PART' ? 'THREE_PART' : 'TWO_PART';
    window.setTrackTypeOverride(trk, nextType);

    showToast(`🏷️ 已將字軌「${trk}」永久設定為【${nextType === 'TWO_PART' ? '📗 二聯式' : '📘 三聯式'}】！`);
    window.setTaxDetailFormType(nextType);
};

window.onTaxPeriodChange = function() {
    const rocY = parseInt(document.getElementById('td_rocYear')?.value, 10) || (new Date().getFullYear() - 1911);
    const mon = parseInt(document.getElementById('td_month')?.value, 10) || (new Date().getMonth() + 1);
    const westY = rocY + 1911;
    const activeFormType = window.taxDetailState.formType || 'THREE_PART';

    window.taxDetailState.rocYear = rocY;
    window.taxDetailState.month = mon;

    const bookMap = new Map();
    const crossPeriodList = [];
    const invOccurrenceMap = new Map();

    (globalHistory || []).forEach(h => {
        const d = new Date(h.time);
        if (isNaN(d.getTime())) return;
        if (d.getFullYear() !== westY || (d.getMonth() + 1) !== mon) return;

        const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const m = pNo.match(/^([A-Z]{2})(\d{6})(\d{2})$/);
        if (!m) return;

        const trk = m[1];
        const pfx = m[2];
        const suf2 = m[3];
        const sufNum = parseInt(suf2, 10);
        const half = sufNum < 50 ? '00-49' : '50-99';
        const fType = window.getInvoiceFormTypeByTrack(trk, h.taxId);

        const periodCheck = window.checkTrackPeriodMatch(trk, westY, mon);
        if (!periodCheck.isMatch) {
            const expPair = periodCheck.expectedMonths || [5, 6];
            const sugMonth = expPair[1] || expPair[0] || 6;
            const origDay = Math.min(28, d.getDate() || 15);
            const suggestedDateStr = `${westY}-${String(sugMonth).padStart(2, '0')}-${String(origDay).padStart(2, '0')}`;
            crossPeriodList.push({
                record: h,
                paperNo: h.paperNo || pNo,
                track: trk,
                prefix6: pfx,
                half: half,
                expectedPeriodStr: `${expPair[0]}~${expPair[1]}月`,
                currentDateStr: `${westY}-${String(mon).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
                suggestedDateStr: suggestedDateStr
            });
            return;
        }

        if (!invOccurrenceMap.has(pNo)) invOccurrenceMap.set(pNo, []);
        invOccurrenceMap.get(pNo).push(h);

        const key = `${trk}_${pfx}_${half}`;
        if (!bookMap.has(key)) {
            bookMap.set(key, {
                track: trk,
                prefix6: pfx,
                half: half,
                uniqueInvs: new Set(),
                rawRows: [],
                count: 0,
                formType: fType
            });
        }
        const bEntry = bookMap.get(key);
        bEntry.uniqueInvs.add(pNo);
        bEntry.rawRows.push(h);
        bEntry.count = bEntry.uniqueInvs.size;
    });

    const allBooklets = Array.from(bookMap.values()).sort((a, b) => {
        const ka = `${a.track}${a.prefix6}_${a.half}`;
        const kb = `${b.track}${b.prefix6}_${b.half}`;
        return ka.localeCompare(kb);
    });

    const typoPrefixesList = [];
    allBooklets.forEach(bSmall => {
        if (bSmall.count > 3) return;
        const mainCandidate = allBooklets.find(bMain =>
            bMain.track === bSmall.track &&
            bMain.prefix6 !== bSmall.prefix6 &&
            bMain.count >= 5 &&
            window.getPrefixHammingDistance(bSmall.prefix6, bMain.prefix6) === 1
        );
        if (mainCandidate) {
            bSmall.isSuspiciousTypo = true;
            bSmall.suggestedPrefix6 = mainCandidate.prefix6;
            bSmall.rawRows.forEach(r => {
                const cleanNo = String(r.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                const suf = cleanNo.slice(-2);
                typoPrefixesList.push({
                    record: r,
                    wrongPaperNo: r.paperNo,
                    wrongBookStr: `${bSmall.track}-${bSmall.prefix6} (${bSmall.half})`,
                    suggestedPaperNo: `${bSmall.track}${mainCandidate.prefix6}${suf}`,
                    mainBookStr: `${mainCandidate.track}-${mainCandidate.prefix6}`
                });
            });
        }
    });

    const duplicateList = [];
    invOccurrenceMap.forEach((rows, fullNo) => {
        const activeRows = rows.filter(r => r.status !== '作廢');
        if (activeRows.length > 1) {
            duplicateList.push({
                fullNo: fullNo,
                count: activeRows.length,
                rows: activeRows
            });
        }
    });

    window.taxDetailState.allMonthBooklets = allBooklets;
    window.taxDetailState.anomalies = {
        crossPeriod: crossPeriodList,
        typoPrefixes: typoPrefixesList,
        duplicates: duplicateList
    };

    const filteredBooklets = allBooklets.filter(b => b.formType === activeFormType);
    window.taxDetailState.detectedBooklets = filteredBooklets;

    window.updateMonthBothTypesSummaryBanner(rocY, mon);

    const pillsContainer = document.getElementById('td_bookletPills');
    if (pillsContainer) {
        if (filteredBooklets.length === 0) {
            const typeName = activeFormType === 'TWO_PART' ? '二聯式 (如 EE/CC/ZZ)' : '三聯式 (如 EC/CA/ZX)';
            pillsContainer.innerHTML = `<span class="badge bg-light text-muted border">此月份 (${rocY}年${mon}月) 尚無已開立之${typeName}發票紀錄，可手動輸入字軌與前六位號碼</span>`;
        } else {
            const btnStyle = activeFormType === 'TWO_PART' ? 'btn-outline-success' : 'btn-outline-primary';
            const badgeStyle = activeFormType === 'TWO_PART' ? 'bg-success' : 'bg-primary';
            const icon = activeFormType === 'TWO_PART' ? '📗' : '📘';
            pillsContainer.innerHTML = filteredBooklets.map((b, idx) => {
                const warnTag = b.isSuspiciousTypo ? `<span class="badge bg-warning text-dark ms-1" title="疑似前六碼打錯 (與 ${b.suggestedPrefix6} 僅差1碼)">⚠️疑似誤植</span>` : '';
                return `
                <button type="button" class="btn btn-sm ${b.isSuspiciousTypo ? 'btn-outline-danger' : btnStyle} fw-bold py-0 px-2" onclick="window.selectTaxBooklet(${idx})">
                    ${icon} ${b.track}-${b.prefix6} (${b.half}) <span class="badge ${badgeStyle} ms-1">${b.count}張</span>${warnTag}
                </button>`;
            }).join('');
        }
    }

    window.renderTaxAnomaliesBox();

    if (filteredBooklets.length > 0) {
        window.selectTaxBooklet(0);
    } else {
        const defaultTrk = activeFormType === 'TWO_PART' ? 'EE' : 'EC';
        if (document.getElementById('td_track')) document.getElementById('td_track').value = defaultTrk;
        if (document.getElementById('td_prefix6')) document.getElementById('td_prefix6').value = '';
        if (document.getElementById('td_totalSheets')) document.getElementById('td_totalSheets').value = 1;
        if (document.getElementById('td_currentSheet')) document.getElementById('td_currentSheet').value = 1;
        window.updateTrackTypeBadgeUI(defaultTrk);
        window.renderTaxDetailPreview();
    }
};

window.renderTaxAnomaliesBox = function() {
    const box = document.getElementById('td_anomaliesContainer');
    if (!box) return;

    const { crossPeriod, typoPrefixes, duplicates } = window.taxDetailState.anomalies || { crossPeriod: [], typoPrefixes: [], duplicates: [] };
    if (crossPeriod.length === 0 && typoPrefixes.length === 0 && duplicates.length === 0) {
        box.innerHTML = '';
        return;
    }

    let itemsHtml = '';

    crossPeriod.forEach(cp => {
        const r = cp.record;
        itemsHtml += `
        <div class="d-flex flex-wrap justify-content-between align-items-center py-1 border-bottom gap-2">
            <div>
                <span class="badge bg-danger me-1">🔴 跨期字軌已自動攔截排除</span>
                發票 <strong class="text-danger">${escapeQuotes(cp.paperNo)}</strong>（客戶：<strong>${escapeQuotes(r.client)}</strong>｜金額：$${Number(r.total || 0).toLocaleString()}）
                <span class="text-secondary">開立日填為 <code>${cp.currentDateStr}</code>，但字軌 <strong>${cp.track}</strong> 屬於 <strong>${cp.expectedPeriodStr}</strong> 期別！</span>
            </div>
            <div class="d-flex gap-1">
                <button type="button" class="btn btn-sm btn-danger fw-bold py-0 px-2" onclick="window.openEditInv(${r.rowIdx}, '${escapeQuotes(cp.paperNo)}', '${cp.suggestedDateStr}')">
                    ✏️ 修正日期/單號 (建議改回 ${cp.suggestedDateStr})
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="window.previewAnomalyBooklet('${cp.track}', '${cp.prefix6}', '${cp.half}')">
                    👁️ 臨時預覽此冊
                </button>
            </div>
        </div>`;
    });

    typoPrefixes.forEach(tp => {
        const r = tp.record;
        itemsHtml += `
        <div class="d-flex flex-wrap justify-content-between align-items-center py-1 border-bottom gap-2">
            <div>
                <span class="badge bg-warning text-dark me-1">🟡 疑似發票前六碼誤植</span>
                發票 <strong class="text-danger">${escapeQuotes(tp.wrongPaperNo)}</strong>（客戶：<strong>${escapeQuotes(r.client)}</strong>｜$${Number(r.total || 0).toLocaleString()}）
                <span class="text-secondary">位於孤立冊別 <code>${tp.wrongBookStr}</code>，與主冊 <strong>${tp.mainBookStr}</strong> 僅差 1 碼，是否應為 <strong class="text-primary">${tp.suggestedPaperNo}</strong>？</span>
            </div>
            <div>
                <button type="button" class="btn btn-sm btn-warning text-dark fw-bold py-0 px-2" onclick="window.openEditInv(${r.rowIdx}, '${escapeQuotes(tp.suggestedPaperNo)}')">
                    ✏️ 一鍵改為 ${tp.suggestedPaperNo}
                </button>
            </div>
        </div>`;
    });

    duplicates.forEach(dup => {
        const firstRow = dup.rows[0];
        const secondRow = dup.rows[1];
        itemsHtml += `
        <div class="d-flex flex-wrap justify-content-between align-items-center py-1 border-bottom gap-2">
            <div>
                <span class="badge bg-dark me-1">🟣 同發票號碼重複建檔 (${dup.count}筆)</span>
                發票 <strong class="text-primary">${escapeQuotes(dup.fullNo)}</strong>（客戶：<strong>${escapeQuotes(firstRow.client)}</strong>）在系統內重複出現 ${dup.count} 筆有效紀錄（明細表已自動去重只取 1 筆）。
            </div>
            <div class="d-flex gap-1">
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold py-0 px-2" onclick="window.openEditInv(${secondRow.rowIdx})">
                    ✏️ 檢查/修改第2筆單號
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger fw-bold py-0 px-2" onclick="window.voidInv(${secondRow.rowIdx}, '${escapeQuotes(secondRow.paperNo)}')">
                    🗑️ 作廢多餘紀錄
                </button>
            </div>
        </div>`;
    });

    box.innerHTML = `
        <div class="alert alert-warning border-warning py-2 px-3 mb-1 shadow-sm" style="font-size: 0.82rem;">
            <div class="fw-bold text-dark mb-1">
                🩺 系統智慧偵測到本月有以下「跨期字軌 / 疑似打錯號碼 / 重複建檔」異常（點擊右側按鈕即可一鍵修正）：
            </div>
            ${itemsHtml}
        </div>
    `;
};

window.previewAnomalyBooklet = function(track, prefix6, half) {
    if (document.getElementById('td_track')) document.getElementById('td_track').value = track;
    if (document.getElementById('td_prefix6')) document.getElementById('td_prefix6').value = prefix6;
    if (document.getElementById('td_rangeHalf')) document.getElementById('td_rangeHalf').value = half;
    window.updateTrackTypeBadgeUI(track);
    window.renderTaxDetailPreview();
};

window.selectTaxBooklet = function(idx) {
    const booklets = window.taxDetailState.detectedBooklets || [];
    const b = booklets[idx];
    if (!b) return;

    document.getElementById('td_track').value = b.track;
    document.getElementById('td_prefix6').value = b.prefix6;
    document.getElementById('td_rangeHalf').value = b.half;
    document.getElementById('td_totalSheets').value = booklets.length;
    document.getElementById('td_currentSheet').value = idx + 1;

    window.updateTrackTypeBadgeUI(b.track);
    window.renderTaxDetailPreview();
};

window.toggleManualVoidOnTaxSheet = function(track, prefix6, suffix2) {
    const fullNo = `${track}${prefix6}${suffix2}`;
    const inSystem = (globalHistory || []).find(h => String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === fullNo);
    if (inSystem) {
        alert(`發票號碼 ${fullNo} 已存在於系統紀錄中（買受人：${inSystem.client}，狀態：${inSystem.status}）。\n若要變更系統內已開立發票的狀態，請至「發票紀錄」頁籤操作。`);
        return;
    }

    const key = `${track}${prefix6}_${suffix2}`;
    if (window.taxDetailState.manualVoidSuffixes[key]) {
        delete window.taxDetailState.manualVoidSuffixes[key];
        showToast(`已將 ${track}-${prefix6}${suffix2} 還原為「空白」`);
    } else {
        window.taxDetailState.manualVoidSuffixes[key] = true;
        showToast(`已將 ${track}-${prefix6}${suffix2} 手動標記為「作廢」`);
    }
    window.saveManualVoidSuffixes();
    window.renderTaxDetailPreview();
};

window.updateMonthBothTypesSummaryBanner = function(rocYear, month) {
    const threeStats = window.calculateMonthGrandTaxStats(rocYear, month, 'THREE_PART');
    const twoStats = window.calculateMonthGrandTaxStats(rocYear, month, 'TWO_PART');

    const allBooks = window.taxDetailState.allMonthBooklets || [];
    const threeBookCnt = allBooks.filter(b => b.formType === 'THREE_PART').length;
    const twoBookCnt = allBooks.filter(b => b.formType === 'TWO_PART').length;

    setSafeText('tdSumThreeBooks', `${threeBookCnt} 冊 / ${threeStats.taxableCount} 張應稅`);
    setSafeText('tdSumThreeNet', '$' + threeStats.netSum.toLocaleString());
    setSafeText('tdSumThreeTax', '$' + threeStats.taxSum.toLocaleString());

    setSafeText('tdSumTwoBooks', `${twoBookCnt} 冊 / ${twoStats.taxableCount} 張應稅`);
    setSafeText('tdSumTwoGross', '$' + twoStats.grossSum.toLocaleString());
    setSafeText('tdSumTwoNet', '$' + twoStats.netSum.toLocaleString());
    setSafeText('tdSumTwoTax', '$' + twoStats.taxSum.toLocaleString());

    const combinedCount = threeStats.taxableCount + twoStats.taxableCount;
    const combinedNet = threeStats.netSum + twoStats.netSum;
    const combinedTax = threeStats.taxSum + twoStats.taxSum;

    setSafeText('tdSumAllCount', `共 ${combinedCount} 張應稅`);
    setSafeText('tdSumAllNet', '$' + combinedNet.toLocaleString());
    setSafeText('tdSumAllTax', '$' + combinedTax.toLocaleString());
};

window.buildSingleTaxDetailSheetHtml = function(params, isPrintMode = false) {
    const {
        formType, rocYear, month, companyTaxId, companyName, taxRegNo, taxOfficeCode,
        declareDate, track, prefix6, rangeHalf, totalSheets, currentSheet,
        monthGrandStats
    } = params;

    const isTwoPart = (formType === 'TWO_PART');
    const cleanTrack = String(track || '').trim().toUpperCase();
    const cleanPrefix6 = String(prefix6 || '').trim();

    const invMap = new Map();
    (globalHistory || []).forEach(h => {
        const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!pNo) return;
        if (!invMap.has(pNo) || h.status !== '作廢') {
            invMap.set(pNo, h);
        }
    });

    const startNum = rangeHalf === '50-99' ? 50 : 0;
    const slots = [];

    let sheetTaxableCount = 0;
    let sheetVoidCount = 0;
    let sheetBlankCount = 0;
    let sheetGrossSum = 0;
    let sheetNetSum = 0;
    let sheetTaxSum = 0;

    for (let i = 0; i < 50; i++) {
        const num = startNum + i;
        const suf2 = String(num).padStart(2, '0');
        const fullNo = `${cleanTrack}${cleanPrefix6}${suf2}`;
        const manualVoidKey = `${cleanTrack}${cleanPrefix6}_${suf2}`;

        const matchedInv = (cleanTrack.length === 2 && cleanPrefix6.length === 6) ? invMap.get(fullNo) : null;
        let slotData = {
            num: num,
            suf2: suf2,
            tens: Math.floor(num / 10),
            units: num % 10,
            buyerTaxId: '',
            netStr: '',
            grossStr: '',
            isTaxable: false,
            taxStr: '',
            remark: '',
            rowType: 'BLANK'
        };

        if (matchedInv) {
            if (matchedInv.status === '作廢') {
                slotData.remark = '作廢';
                slotData.rowType = 'VOID';
                sheetVoidCount++;
            } else {
                const cObj = (globalClients || []).find(c => c.name === matchedInv.client);
                const bTaxId = String(matchedInv.taxId || (cObj ? cObj.taxId : '') || '').trim();
                const grossVal = Math.round(Number(matchedInv.total) || 0);
                const netVal = Math.round(Number(matchedInv.net) || Math.round(grossVal / 1.05));
                const taxVal = Math.round(Number(matchedInv.tax) || (grossVal - netVal));

                slotData.buyerTaxId = bTaxId;
                slotData.netStr = netVal.toLocaleString();
                slotData.grossStr = grossVal.toLocaleString();
                slotData.isTaxable = true;
                slotData.taxStr = taxVal.toLocaleString();
                slotData.remark = '';
                slotData.rowType = 'TAXABLE';

                sheetTaxableCount++;
                sheetGrossSum += grossVal;
                sheetNetSum += netVal;
                sheetTaxSum += taxVal;
            }
        } else if (window.taxDetailState.manualVoidSuffixes[manualVoidKey]) {
            slotData.remark = '作廢';
            slotData.rowType = 'VOID';
            sheetVoidCount++;
        } else {
            sheetBlankCount++;
        }

        slots.push(slotData);
    }

    if (isTwoPart) {
        sheetNetSum = Math.round((sheetGrossSum * 100) / 105);
        sheetTaxSum = Math.round(sheetNetSum * 0.05);
    }

    const periodTaxableCount = Math.max(sheetTaxableCount, monthGrandStats.taxableCount);
    const periodVoidCount    = Math.max(sheetVoidCount, monthGrandStats.voidCount);
    const periodBlankCount   = Math.max(sheetBlankCount, monthGrandStats.blankCount);
    const periodGrossSum     = Math.max(sheetGrossSum, monthGrandStats.grossSum || 0);
    const periodNetSum       = isTwoPart
        ? Math.round((periodGrossSum * 100) / 105)
        : Math.max(sheetNetSum, monthGrandStats.netSum);
    const periodTaxSum       = isTwoPart
        ? Math.round(periodNetSum * 0.05)
        : Math.max(sheetTaxSum, monthGrandStats.taxSum);

    const taxIdChars = String(companyTaxId || '86477073').padEnd(8, ' ').slice(0, 8).split('');
    const taxRegChars = String(taxRegNo || '').padEnd(9, ' ').slice(0, 9).split('');
    const trackChars = cleanTrack.padEnd(2, ' ').slice(0, 2).split('');
    const pfxChars = cleanPrefix6.padEnd(6, ' ').slice(0, 6).split('');

    let decRocY = rocYear, decM = '', decD = '';
    if (declareDate) {
        const dd = new Date(declareDate);
        if (!isNaN(dd.getTime())) {
            decRocY = dd.getFullYear() - 1911;
            decM = dd.getMonth() + 1;
            decD = dd.getDate();
        }
    }

    const getSpanForLeftTens = (rowIndex) => {
        if (rowIndex === 0) return 10;
        if (rowIndex === 10) return 10;
        if (rowIndex === 20) return 5;
        return 0;
    };
    const getSpanForRightTens = (rowIndex) => {
        if (rowIndex === 0) return 5;
        if (rowIndex === 5) return 10;
        if (rowIndex === 15) return 10;
        return 0;
    };

    const cellBorder = 'border: 1px solid #000;';
    let rows25Html = '';

    for (let r = 0; r < 25; r++) {
        const leftSlot = slots[r];
        const rightSlot = slots[r + 25];

        const lSpan = getSpanForLeftTens(r);
        const rSpan = getSpanForRightTens(r);

        const lTensCell = lSpan > 0
            ? `<td rowspan="${lSpan}" style="${cellBorder} width: 15px; text-align: center; vertical-align: middle; font-weight: bold; font-size: 12px; padding: 0;">${leftSlot.tens}</td>`
            : '';
        const rTensCell = rSpan > 0
            ? `<td rowspan="${rSpan}" style="${cellBorder} width: 15px; text-align: center; vertical-align: middle; font-weight: bold; font-size: 12px; padding: 0; border-left: 2px solid #000;">${rightSlot.tens}</td>`
            : '';

        const clickAttrL = !isPrintMode ? `onclick="window.toggleManualVoidOnTaxSheet('${cleanTrack}','${cleanPrefix6}','${leftSlot.suf2}')" style="cursor:pointer;" title="點擊切換空白/作廢"` : '';
        const clickAttrR = !isPrintMode ? `onclick="window.toggleManualVoidOnTaxSheet('${cleanTrack}','${cleanPrefix6}','${rightSlot.suf2}')" style="cursor:pointer;" title="點擊切換空白/作廢"` : '';

        if (isTwoPart) {
            rows25Html += `
            <tr style="height: 20px;">
                <!-- 左半欄 (00~24 或 50~74) -->
                ${lTensCell}
                <td ${clickAttrL} style="${cellBorder} width: 18px; text-align: center; font-weight: bold; font-size: 11.5px; padding: 0;">${leftSlot.units}</td>
                <td ${clickAttrL} style="${cellBorder} width: 138px; text-align: right; font-size: 12.5px; font-weight: bold; padding: 0 6px;">${leftSlot.grossStr}</td>
                <td ${clickAttrL} style="${cellBorder} width: 28px; text-align: center; font-size: 12px; font-weight: bold; padding: 0;">${leftSlot.isTaxable ? '✓' : ''}</td>
                <td ${clickAttrL} style="${cellBorder} width: 28px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrL} style="${cellBorder} width: 28px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrL} style="${cellBorder} width: 88px; text-align: center; font-size: 11.5px; color: ${leftSlot.rowType === 'VOID' ? '#c92a2a' : '#000'}; font-weight: bold; padding: 0 2px;">${escapeQuotes(leftSlot.remark)}</td>

                <!-- 右半欄 (25~49 或 75~99) -->
                ${rTensCell}
                <td ${clickAttrR} style="${cellBorder} width: 18px; text-align: center; font-weight: bold; font-size: 11.5px; padding: 0;">${rightSlot.units}</td>
                <td ${clickAttrR} style="${cellBorder} width: 138px; text-align: right; font-size: 12.5px; font-weight: bold; padding: 0 6px;">${rightSlot.grossStr}</td>
                <td ${clickAttrR} style="${cellBorder} width: 28px; text-align: center; font-size: 12px; font-weight: bold; padding: 0;">${rightSlot.isTaxable ? '✓' : ''}</td>
                <td ${clickAttrR} style="${cellBorder} width: 28px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrR} style="${cellBorder} width: 28px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrR} style="${cellBorder} width: 88px; text-align: center; font-size: 11.5px; color: ${rightSlot.rowType === 'VOID' ? '#c92a2a' : '#000'}; font-weight: bold; padding: 0 2px;">${escapeQuotes(rightSlot.remark)}</td>
            </tr>`;
        } else {
            rows25Html += `
            <tr style="height: 20px;">
                <!-- 左半欄 (00~24 或 50~74) -->
                ${lTensCell}
                <td ${clickAttrL} style="${cellBorder} width: 16px; text-align: center; font-weight: bold; font-size: 11.5px; padding: 0;">${leftSlot.units}</td>
                <td ${clickAttrL} style="${cellBorder} width: 78px; text-align: center; font-family: monospace; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; padding: 0 2px;">${escapeQuotes(leftSlot.buyerTaxId)}</td>
                <td ${clickAttrL} style="${cellBorder} width: 78px; text-align: right; font-size: 12px; font-weight: bold; padding: 0 4px;">${leftSlot.netStr}</td>
                <td ${clickAttrL} style="${cellBorder} width: 20px; text-align: center; font-size: 12px; font-weight: bold; padding: 0;">${leftSlot.isTaxable ? '✓' : ''}</td>
                <td ${clickAttrL} style="${cellBorder} width: 20px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrL} style="${cellBorder} width: 20px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrL} style="${cellBorder} width: 54px; text-align: right; font-size: 12px; font-weight: bold; padding: 0 4px;">${leftSlot.taxStr}</td>
                <td ${clickAttrL} style="${cellBorder} width: 44px; text-align: center; font-size: 11.5px; color: ${leftSlot.rowType === 'VOID' ? '#c92a2a' : '#000'}; font-weight: bold; padding: 0 2px;">${escapeQuotes(leftSlot.remark)}</td>

                <!-- 右半欄 (25~49 或 75~99) -->
                ${rTensCell}
                <td ${clickAttrR} style="${cellBorder} width: 16px; text-align: center; font-weight: bold; font-size: 11.5px; padding: 0;">${rightSlot.units}</td>
                <td ${clickAttrR} style="${cellBorder} width: 78px; text-align: center; font-family: monospace; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; padding: 0 2px;">${escapeQuotes(rightSlot.buyerTaxId)}</td>
                <td ${clickAttrR} style="${cellBorder} width: 78px; text-align: right; font-size: 12px; font-weight: bold; padding: 0 4px;">${rightSlot.netStr}</td>
                <td ${clickAttrR} style="${cellBorder} width: 20px; text-align: center; font-size: 12px; font-weight: bold; padding: 0;">${rightSlot.isTaxable ? '✓' : ''}</td>
                <td ${clickAttrR} style="${cellBorder} width: 20px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrR} style="${cellBorder} width: 20px; text-align: center; font-size: 11px; padding: 0;"></td>
                <td ${clickAttrR} style="${cellBorder} width: 54px; text-align: right; font-size: 12px; font-weight: bold; padding: 0 4px;">${rightSlot.taxStr}</td>
                <td ${clickAttrR} style="${cellBorder} width: 44px; text-align: center; font-size: 11.5px; color: ${rightSlot.rowType === 'VOID' ? '#c92a2a' : '#000'}; font-weight: bold; padding: 0 2px;">${escapeQuotes(rightSlot.remark)}</td>
            </tr>`;
        }
    }

    const pageBreakStyle = isPrintMode ? 'page-break-after: always; break-after: page;' : '';
    const sheetTitleText = isTwoPart ? '營業人使用二聯式統一發票明細表' : '營業人使用三聯式統一發票明細表';
    const footerSheetTypeText = isTwoPart ? '二聯式' : '三聯式';

    const mainTableHeaderHtml = isTwoPart ? `
        <thead>
            <tr style="background-color: #f8f9fa;">
                <th colspan="2" rowspan="2" style="${cellBorder} text-align: center; padding: 2px; line-height: 1.15;">末二位<br>號 碼</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 1px;">發 票 總 計 金 額</th>
                <th colspan="3" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 2px;">課 稅 別</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 2px;">備 註</th>

                <th colspan="2" rowspan="2" style="${cellBorder} border-left: 2px solid #000; text-align: center; padding: 2px; line-height: 1.15;">末二位<br>號 碼</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 1px;">發 票 總 計 金 額</th>
                <th colspan="3" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 2px;">課 稅 別</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; letter-spacing: 2px;">備 註</th>
            </tr>
            <tr style="background-color: #f8f9fa; font-size: 10.5px;">
                <th style="${cellBorder} text-align: center; padding: 1px;">應<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px; line-height: 1.05;">零<br>稅<br>率</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">免<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">應<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px; line-height: 1.05;">零<br>稅<br>率</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">免<br>稅</th>
            </tr>
        </thead>
    ` : `
        <thead>
            <tr style="background-color: #f8f9fa;">
                <th colspan="2" rowspan="2" style="${cellBorder} text-align: center; padding: 2px; line-height: 1.15;">末二位<br>號 碼</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; line-height: 1.15;">買 受 人<br>統一編號</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">銷 售 額</th>
                <th colspan="3" style="${cellBorder} text-align: center; padding: 2px;">課 稅 別</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">稅 額</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">備 註</th>

                <th colspan="2" rowspan="2" style="${cellBorder} border-left: 2px solid #000; text-align: center; padding: 2px; line-height: 1.15;">末二位<br>號 碼</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px; line-height: 1.15;">買 受 人<br>統一編號</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">銷 售 額</th>
                <th colspan="3" style="${cellBorder} text-align: center; padding: 2px;">課 稅 別</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">稅 額</th>
                <th rowspan="2" style="${cellBorder} text-align: center; padding: 2px;">備 註</th>
            </tr>
            <tr style="background-color: #f8f9fa; font-size: 10.5px;">
                <th style="${cellBorder} text-align: center; padding: 1px;">應<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px; line-height: 1.05;">零<br>稅<br>率</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">免<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">應<br>稅</th>
                <th style="${cellBorder} text-align: center; padding: 1px; line-height: 1.05;">零<br>稅<br>率</th>
                <th style="${cellBorder} text-align: center; padding: 1px;">免<br>稅</th>
            </tr>
        </thead>
    `;

    const bottomSummaryTableHtml = isTwoPart ? `
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; border-top: none; font-size: 11px;">
            <tr>
                <td rowspan="3" style="${cellBorder} width: 46px; text-align: center; font-weight: bold; padding: 2px; line-height: 1.3;">
                    區分<br>項目
                </td>
                <td colspan="5" style="${cellBorder} text-align: center; font-weight: bold; padding: 2px; letter-spacing: 2px;">
                    發 票 使 用 情 形
                </td>
                <td colspan="5" style="${cellBorder} border-left: 2px solid #000; text-align: center; font-weight: bold; padding: 2px; letter-spacing: 2px;">
                    銷 售 額 及 稅 額 計 算
                </td>
            </tr>
            <tr>
                <td colspan="5" style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    使 用 份 數
                </td>
                <td colspan="3" style="${cellBorder} border-left: 2px solid #000; text-align: center; font-weight: bold; padding: 2px; letter-spacing: 4px;">
                    應     稅
                </td>
                <td style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    零 稅 率
                </td>
                <td style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    免 稅
                </td>
            </tr>
            <tr style="text-align: center; font-weight: bold; font-size: 10.5px;">
                <td style="${cellBorder} width: 40px; padding: 2px;">應稅</td>
                <td style="${cellBorder} width: 42px; padding: 2px;">零稅率</td>
                <td style="${cellBorder} width: 40px; padding: 2px;">免稅</td>
                <td style="${cellBorder} width: 40px; padding: 2px;">作廢</td>
                <td style="${cellBorder} width: 40px; padding: 2px;">空白</td>
                <td style="${cellBorder} border-left: 2px solid #000; width: 92px; padding: 2px; line-height: 1.15;">
                    發票總金額<br>(1)
                </td>
                <td style="${cellBorder} width: 100px; padding: 1px 2px; line-height: 1.1;">
                    銷售額<br>
                    <span style="display:inline-flex; align-items:center; justify-content:center; font-size:9.5px;">
                        (2)=(1)×
                        <span style="display:inline-block; text-align:center; line-height:1; margin-left:2px;">
                            <span style="border-bottom:1px solid #000; display:block; padding:0 1px;">100</span>
                            <span style="display:block; padding:0 1px;">105</span>
                        </span>
                    </span>
                </td>
                <td style="${cellBorder} width: 82px; padding: 2px; line-height: 1.15;">
                    稅額<br><span style="font-size:9.5px;">(3)=(2)×5%</span>
                </td>
                <td style="${cellBorder} width: 74px; padding: 2px;">銷 售 額</td>
                <td style="${cellBorder} width: 74px; padding: 2px;">銷 售 額</td>
            </tr>
            <tr style="height: 24px;">
                <td style="${cellBorder} text-align: center; font-weight: bold; line-height: 1.15; padding: 2px;">本表<br>合計</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${sheetTaxableCount}</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${sheetVoidCount}</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${sheetBlankCount}</td>
                <td style="${cellBorder} border-left: 2px solid #000; text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${sheetGrossSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${sheetNetSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${sheetTaxSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; padding: 0 4px;">0</td>
                <td style="${cellBorder} text-align: right; padding: 0 4px;">0</td>
            </tr>
            <tr style="height: 24px;">
                <td style="${cellBorder} text-align: center; font-weight: bold; line-height: 1.15; padding: 2px;">本期(月)<br>總 計</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${periodTaxableCount}</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${periodVoidCount}</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 12.5px;">${periodBlankCount}</td>
                <td style="${cellBorder} border-left: 2px solid #000; text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${periodGrossSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${periodNetSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 12.5px; padding: 0 4px;">${periodTaxSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; padding: 0 4px;">0</td>
                <td style="${cellBorder} text-align: right; padding: 0 4px;">0</td>
            </tr>
        </table>
    ` : `
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; border-top: none; font-size: 11.5px;">
            <tr>
                <td rowspan="3" style="${cellBorder} width: 52px; text-align: center; font-weight: bold; padding: 2px; line-height: 1.3;">
                    區 分<br>項 目
                </td>
                <td colspan="5" style="${cellBorder} text-align: center; font-weight: bold; padding: 2px; letter-spacing: 2px;">
                    發 票 使 用 情 形
                </td>
                <td colspan="4" style="${cellBorder} border-left: 2px solid #000; text-align: center; font-weight: bold; padding: 2px; letter-spacing: 2px;">
                    銷 售 額 及 稅 額 計 算
                </td>
            </tr>
            <tr>
                <td colspan="5" style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    使 用 份 數
                </td>
                <td colspan="2" style="${cellBorder} border-left: 2px solid #000; text-align: center; font-weight: bold; padding: 2px;">
                    應   稅
                </td>
                <td style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    零 稅 率
                </td>
                <td style="${cellBorder} text-align: center; font-weight: bold; padding: 2px;">
                    免 稅
                </td>
            </tr>
            <tr style="text-align: center; font-weight: bold;">
                <td style="${cellBorder} width: 48px; padding: 2px;">應 稅</td>
                <td style="${cellBorder} width: 48px; padding: 2px;">零稅率</td>
                <td style="${cellBorder} width: 48px; padding: 2px;">免 稅</td>
                <td style="${cellBorder} width: 48px; padding: 2px;">作 廢</td>
                <td style="${cellBorder} width: 48px; padding: 2px;">空 白</td>
                <td style="${cellBorder} border-left: 2px solid #000; width: 110px; padding: 2px;">銷 售 額</td>
                <td style="${cellBorder} width: 85px; padding: 2px;">稅 額</td>
                <td style="${cellBorder} width: 90px; padding: 2px;">銷 售 額</td>
                <td style="${cellBorder} width: 90px; padding: 2px;">銷 售 額</td>
            </tr>
            <tr style="height: 24px;">
                <td style="${cellBorder} text-align: center; font-weight: bold; line-height: 1.15; padding: 2px;">本 表<br>合 計</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${sheetTaxableCount}</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${sheetVoidCount}</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${sheetBlankCount}</td>
                <td style="${cellBorder} border-left: 2px solid #000; text-align: right; font-weight: bold; font-size: 13px; padding: 0 5px;">${sheetNetSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 13px; padding: 0 5px;">${sheetTaxSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; padding: 0 5px;">0</td>
                <td style="${cellBorder} text-align: right; padding: 0 5px;">0</td>
            </tr>
            <tr style="height: 24px;">
                <td style="${cellBorder} text-align: center; font-weight: bold; line-height: 1.15; padding: 2px;">本期(月)<br>總 計</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${periodTaxableCount}</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-size: 12px;">0</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${periodVoidCount}</td>
                <td style="${cellBorder} text-align: center; font-weight: bold; font-size: 13px;">${periodBlankCount}</td>
                <td style="${cellBorder} border-left: 2px solid #000; text-align: right; font-weight: bold; font-size: 13px; padding: 0 5px;">${periodNetSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; font-weight: bold; font-size: 13px; padding: 0 5px;">${periodTaxSum.toLocaleString()}</td>
                <td style="${cellBorder} text-align: right; padding: 0 5px;">0</td>
                <td style="${cellBorder} text-align: right; padding: 0 5px;">0</td>
            </tr>
        </table>
    `;

    return `
    <div class="tax-detail-a4-page" style="width: 210mm; min-height: 292mm; max-height: 296mm; margin: 0 auto; padding: 7mm 10mm; box-sizing: border-box; background: #fff; color: #000; font-family: 'DFKai-SB', 'BiauKai', '標楷體', 'MingLiU', '微軟正黑體', serif; position: relative; ${pageBreakStyle}">
        
        <!-- 頂部標題區 -->
        <div style="text-align: center; position: relative; margin-bottom: 4px;">
            <div style="font-size: 22px; font-weight: bold; letter-spacing: 5px;">${sheetTitleText}</div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 2px; letter-spacing: 2px;">
                中華民國 <span style="display:inline-block; min-width: 32px; border-bottom: 1px solid #000;">${rocYear}</span> 年
                <span style="display:inline-block; min-width: 28px; border-bottom: 1px solid #000;">${month}</span> 月份
            </div>
        </div>

        <!-- 頂部營業人基本資料與發票字軌號碼區 -->
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; border-bottom: none; font-size: 12px;">
            <tr>
                <td style="${cellBorder} width: 72px; text-align: center; font-weight: bold; padding: 3px;">統一編號</td>
                ${taxIdChars.map(ch => `<td style="${cellBorder} width: 22px; text-align: center; font-weight: bold; font-size: 14px; font-family: monospace;">${escapeQuotes(ch)}</td>`).join('')}
                <td style="${cellBorder} width: 82px; text-align: center; font-weight: bold; padding: 3px;">營業人名稱</td>
                <td colspan="2" style="${cellBorder} padding: 3px 8px; font-weight: bold; font-size: 14px;">${escapeQuotes(companyName)}</td>
            </tr>
            <tr>
                <td style="${cellBorder} text-align: center; font-weight: bold; padding: 3px;">稅籍編號</td>
                ${taxRegChars.map(ch => `<td style="${cellBorder} width: 20px; text-align: center; font-weight: bold; font-size: 13px; font-family: monospace;">${escapeQuotes(ch)}</td>`).join('')}
                <td style="${cellBorder} text-align: center; font-size: 11px; line-height: 1.2; padding: 2px 4px; width: 115px;">
                    所屬年月及發票字軌<br>號碼請營業人填註
                </td>
                <td style="${cellBorder} padding: 3px 6px;">
                    <div style="display: flex; align-items: center; justify-content: space-around; flex-wrap: nowrap;">
                        <div style="display: flex; align-items: center; gap: 3px;">
                            <span style="font-weight: bold; font-size: 11.5px;">發票字軌：</span>
                            <span style="display: inline-block; width: 22px; height: 20px; line-height: 20px; border: 1px solid #000; text-align: center; font-weight: bold; font-size: 13px;">${escapeQuotes(trackChars[0])}</span>
                            <span style="display: inline-block; width: 22px; height: 20px; line-height: 20px; border: 1px solid #000; text-align: center; font-weight: bold; font-size: 13px;">${escapeQuotes(trackChars[1])}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 2px;">
                            <span style="font-weight: bold; font-size: 11.5px;">發票前六位號碼：</span>
                            ${pfxChars.map(d => `<span style="display: inline-block; width: 19px; height: 20px; line-height: 20px; border: 1px solid #000; text-align: center; font-weight: bold; font-size: 13px; font-family: monospace;">${escapeQuotes(d)}</span>`).join('')}
                        </div>
                    </div>
                </td>
            </tr>
        </table>

        <!-- 中間 50 格雙欄明細主表 -->
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 11.5px;">
            ${mainTableHeaderHtml}
            <tbody>
                ${rows25Html}
            </tbody>
        </table>

        <!-- 底部統計區：發票使用情形 ＆ 銷售額及稅額計算 -->
        ${bottomSummaryTableHtml}

        <!-- 最底部申報單位、申報日期、稽徵機關編號與頁次說明區 -->
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; border-top: none; font-size: 11.5px;">
            <tr style="height: 56px;">
                <td style="${cellBorder} width: 36px; text-align: center; font-weight: bold; line-height: 1.3; padding: 3px;">
                    申<br>報<br>單<br>位
                </td>
                <td style="${cellBorder} width: 120px; text-align: center; vertical-align: bottom; padding: 4px; color: #555; font-size: 10.5px;">
                    (請蓋用統一<br>發票專用章)
                </td>
                <td style="${cellBorder} width: 135px; vertical-align: middle; padding: 4px 6px; font-weight: bold; line-height: 1.6;">
                    申報日期：<br>
                    <span style="display:inline-block; min-width:24px; text-align:center;">${decRocY}</span>年
                    <span style="display:inline-block; min-width:18px; text-align:center;">${decM}</span>月
                    <span style="display:inline-block; min-width:18px; text-align:center;">${decD}</span>日
                </td>
                <td style="${cellBorder} width: 115px; vertical-align: top; padding: 4px 6px; font-weight: bold;">
                    稽徵機關編號<br>
                    <div style="margin-top: 8px; text-align: center; font-size: 13px;">${escapeQuotes(taxOfficeCode)}</div>
                </td>
                <td style="${cellBorder} vertical-align: middle; padding: 4px 8px; line-height: 1.55;">
                    <div style="font-weight: bold;">
                        頁次：本表為本期(月)${footerSheetTypeText}發票明細表共
                        <span style="display:inline-block; min-width: 22px; text-align:center; border-bottom: 1px solid #000;">${totalSheets}</span>
                        張之第
                        <span style="display:inline-block; min-width: 22px; text-align:center; border-bottom: 1px solid #000;">${currentSheet}</span>
                        張
                    </div>
                    <div style="font-size: 10.5px; margin-top: 3px;">
                        第一聯：申報聯，申報主管稽徵機關。<br>
                        第二聯：存查聯，由營業人存查。
                    </div>
                </td>
            </tr>
        </table>

        <div style="text-align: right; font-size: 10.5px; margin-top: 2px; font-weight: bold;">(21×29.7)</div>
    </div>`;
};

window.calculateMonthGrandTaxStats = function(rocYear, month, targetFormType) {
    const westY = Number(rocYear) + 1911;
    const fType = targetFormType || window.taxDetailState.formType || 'THREE_PART';
    const allBooks = window.taxDetailState.allMonthBooklets || [];
    const booklets = allBooks.filter(b => b.formType === fType);

    const invMap = new Map();
    (globalHistory || []).forEach(h => {
        const d = new Date(h.time);
        if (isNaN(d.getTime()) || d.getFullYear() !== westY || (d.getMonth() + 1) !== Number(month)) return;
        const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!pNo) return;
        if (!invMap.has(pNo) || h.status !== '作廢') invMap.set(pNo, h);
    });

    let taxableCount = 0;
    let voidCount = 0;
    let blankCount = 0;
    let grossSum = 0;
    let netSum = 0;
    let taxSum = 0;

    if (booklets.length === 0) {
        return { taxableCount: 0, voidCount: 0, blankCount: 50, grossSum: 0, netSum: 0, taxSum: 0 };
    }

    booklets.forEach(b => {
        const startNum = b.half === '50-99' ? 50 : 0;
        for (let i = 0; i < 50; i++) {
            const suf2 = String(startNum + i).padStart(2, '0');
            const fullNo = `${b.track}${b.prefix6}${suf2}`;
            const mKey = `${b.track}${b.prefix6}_${suf2}`;
            const matched = invMap.get(fullNo);

            if (matched) {
                if (matched.status === '作廢') {
                    voidCount++;
                } else {
                    taxableCount++;
                    const gVal = Math.round(Number(matched.total) || 0);
                    const nVal = Math.round(Number(matched.net) || Math.round(gVal / 1.05));
                    const tVal = Math.round(Number(matched.tax) || (gVal - nVal));
                    grossSum += gVal;
                    netSum += nVal;
                    taxSum += tVal;
                }
            } else if (window.taxDetailState.manualVoidSuffixes[mKey]) {
                voidCount++;
            } else {
                blankCount++;
            }
        }
    });

    if (fType === 'TWO_PART') {
        netSum = Math.round((grossSum * 100) / 105);
        taxSum = Math.round(netSum * 0.05);
    }

    return { taxableCount, voidCount, blankCount, grossSum, netSum, taxSum };
};

window.getCurrentTaxFormParams = function() {
    const formType = window.taxDetailState.formType || 'THREE_PART';
    const rocYear = parseInt(document.getElementById('td_rocYear')?.value, 10) || window.taxDetailState.rocYear;
    const month = parseInt(document.getElementById('td_month')?.value, 10) || window.taxDetailState.month;
    const declareDate = document.getElementById('td_declareDate')?.value || getTodayStr();
    const companyTaxId = document.getElementById('td_companyTaxId')?.value || '86477073';
    const companyName = document.getElementById('td_companyName')?.value || '長固實業股份有限公司';
    const track = (document.getElementById('td_track')?.value || (formType === 'TWO_PART' ? 'EE' : 'EC')).trim().toUpperCase();
    const prefix6 = (document.getElementById('td_prefix6')?.value || '').trim();
    const rangeHalf = document.getElementById('td_rangeHalf')?.value || '00-49';
    const taxRegNo = document.getElementById('td_taxRegNo')?.value || '';
    const taxOfficeCode = document.getElementById('td_taxOfficeCode')?.value || '';
    const totalSheets = parseInt(document.getElementById('td_totalSheets')?.value, 10) || 1;
    const currentSheet = parseInt(document.getElementById('td_currentSheet')?.value, 10) || 1;

    const monthGrandStats = window.calculateMonthGrandTaxStats(rocYear, month, formType);

    return {
        formType, rocYear, month, declareDate, companyTaxId, companyName,
        track, prefix6, rangeHalf, taxRegNo, taxOfficeCode,
        totalSheets, currentSheet, monthGrandStats
    };
};

window.renderTaxDetailPreview = function() {
    const container = document.getElementById('tdSheetPreviewContainer');
    if (!container) return;
    const params = window.getCurrentTaxFormParams();
    container.innerHTML = window.buildSingleTaxDetailSheetHtml(params, false);
};

window.printCurrentTaxDetailSheet = function() {
    const params = window.getCurrentTaxFormParams();
    if (!params.track || params.track.length < 2 || !params.prefix6 || params.prefix6.length < 6) {
        if (!confirm("您尚未完整輸入「2碼發票字軌」與「6碼發票前六位號碼」，確定要列印空白明細表嗎？")) return;
    }

    const printArea = document.getElementById('printTaxDetailArea');
    if (!printArea) return;

    printArea.innerHTML = window.buildSingleTaxDetailSheetHtml(params, false);
    if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A4', 'portrait');
    if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printTaxDetailArea');
};

window.printAllMonthTaxDetailSheets = function(includeBothTypes = false) {
    const baseParams = window.getCurrentTaxFormParams();
    const allBooks = window.taxDetailState.allMonthBooklets || [];
    const targetBooks = includeBothTypes
        ? allBooks
        : (window.taxDetailState.detectedBooklets || []);

    if (targetBooks.length === 0) {
        return alert("此月份未偵測到對應的已開立發票冊別，請先手動輸入字軌與前六位號碼後，點擊「🖨️ 列印本張明細表」。");
    }

    const threeBooks = targetBooks.filter(b => b.formType === 'THREE_PART');
    const twoBooks = targetBooks.filter(b => b.formType === 'TWO_PART');
    const statsThree = window.calculateMonthGrandTaxStats(baseParams.rocYear, baseParams.month, 'THREE_PART');
    const statsTwo = window.calculateMonthGrandTaxStats(baseParams.rocYear, baseParams.month, 'TWO_PART');

    const orderedList = [...threeBooks, ...twoBooks];
    let threeIdx = 0;
    let twoIdx = 0;

    const pagesHtml = orderedList.map((b, idx) => {
        const isTwo = (b.formType === 'TWO_PART');
        if (isTwo) twoIdx++; else threeIdx++;

        const sheetParams = {
            ...baseParams,
            formType: b.formType,
            track: b.track,
            prefix6: b.prefix6,
            rangeHalf: b.half,
            totalSheets: isTwo ? twoBooks.length : threeBooks.length,
            currentSheet: isTwo ? twoIdx : threeIdx,
            monthGrandStats: isTwo ? statsTwo : statsThree
        };
        return window.buildSingleTaxDetailSheetHtml(sheetParams, idx < orderedList.length - 1);
    }).join('');

    const printArea = document.getElementById('printTaxDetailArea');
    if (!printArea) return;

    printArea.innerHTML = pagesHtml;
    if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A4', 'portrait');
    if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printTaxDetailArea');
};

window.exportMonthTaxDetailExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍候！");
    const baseParams = window.getCurrentTaxFormParams();
    const rocY = baseParams.rocYear;
    const mon = baseParams.month;
    const westY = rocY + 1911;

    const allBooks = window.taxDetailState.allMonthBooklets || [];
    const statsThree = window.calculateMonthGrandTaxStats(rocY, mon, 'THREE_PART');
    const statsTwo = window.calculateMonthGrandTaxStats(rocY, mon, 'TWO_PART');

    const invMap = new Map();
    (globalHistory || []).forEach(h => {
        const d = new Date(h.time);
        if (isNaN(d.getTime()) || d.getFullYear() !== westY || (d.getMonth() + 1) !== Number(mon)) return;
        const pNo = String(h.paperNo || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (!pNo) return;
        if (!invMap.has(pNo) || h.status !== '作廢') invMap.set(pNo, h);
    });

    const wb = XLSX.utils.book_new();

    const summaryAoa = [
        [`長固實業股份有限公司 — 中華民國 ${rocY} 年 ${mon} 月份 統一發票明細表申報總覽`],
        ["統一編號", baseParams.companyTaxId, "稅籍編號", baseParams.taxRegNo || "", "申報日期", baseParams.declareDate],
        [],
        ["發票聯式分類", "冊數 (每冊50張)", "應稅份數", "作廢份數", "空白份數", "發票含稅總金額 (1)", "折算/未稅銷售額 (2)", "營業稅額 (3)"],
        [
            "📘 三聯式統一發票",
            allBooks.filter(b => b.formType === 'THREE_PART').length,
            statsThree.taxableCount, statsThree.voidCount, statsThree.blankCount,
            statsThree.grossSum, statsThree.netSum, statsThree.taxSum
        ],
        [
            "📗 二聯式統一發票",
            allBooks.filter(b => b.formType === 'TWO_PART').length,
            statsTwo.taxableCount, statsTwo.voidCount, statsTwo.blankCount,
            statsTwo.grossSum, statsTwo.netSum, statsTwo.taxSum
        ],
        [
            "🧾 本期(月)銷項總計",
            allBooks.length,
            statsThree.taxableCount + statsTwo.taxableCount,
            statsThree.voidCount + statsTwo.voidCount,
            statsThree.blankCount + statsTwo.blankCount,
            statsThree.grossSum + statsTwo.grossSum,
            statsThree.netSum + statsTwo.netSum,
            statsThree.taxSum + statsTwo.taxSum
        ]
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(summaryAoa);
    wsSum['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSum, "0_本月營業稅申報總覽");

    const targetBooks = allBooks.length > 0 ? allBooks : [{
        track: baseParams.track,
        prefix6: baseParams.prefix6 || '000000',
        half: baseParams.rangeHalf,
        formType: baseParams.formType
    }];

    targetBooks.forEach((b, bIdx) => {
        const isTwo = (b.formType === 'TWO_PART');
        const startNum = b.half === '50-99' ? 50 : 0;
        const sheetAoa = [];

        if (isTwo) {
            sheetAoa.push([`營業人使用二聯式統一發票明細表（中華民國 ${rocY} 年 ${mon} 月份）`]);
            sheetAoa.push(["統一編號", baseParams.companyTaxId, "營業人名稱", baseParams.companyName, "發票字軌", b.track, "前六位號碼", b.prefix6, "區間", b.half]);
            sheetAoa.push(["末二位號碼", "完整發票號碼", "客戶名稱(內部參考)", "發票總計金額(含稅)", "課稅別(應稅)", "備註"]);

            let sTaxCnt = 0, sVoidCnt = 0, sBlankCnt = 0, sGross = 0;
            for (let i = 0; i < 50; i++) {
                const suf2 = String(startNum + i).padStart(2, '0');
                const fullNo = `${b.track}${b.prefix6}${suf2}`;
                const mKey = `${b.track}${b.prefix6}_${suf2}`;
                const inv = invMap.get(fullNo);

                if (inv) {
                    if (inv.status === '作廢') {
                        sVoidCnt++;
                        sheetAoa.push([suf2, fullNo, inv.client || '', '', '', '作廢']);
                    } else {
                        const gVal = Math.round(Number(inv.total) || 0);
                        sTaxCnt++;
                        sGross += gVal;
                        sheetAoa.push([suf2, fullNo, inv.client || '', gVal, '✓', '']);
                    }
                } else if (window.taxDetailState.manualVoidSuffixes[mKey]) {
                    sVoidCnt++;
                    sheetAoa.push([suf2, fullNo, '', '', '', '作廢']);
                } else {
                    sBlankCnt++;
                    sheetAoa.push([suf2, fullNo, '', '', '', '']);
                }
            }
            const sNet = Math.round((sGross * 100) / 105);
            const sTax = Math.round(sNet * 0.05);
            sheetAoa.push([]);
            sheetAoa.push(["本表合計", `應稅:${sTaxCnt}份`, `作廢:${sVoidCnt}份`, `空白:${sBlankCnt}份`, `發票總金額(1): ${sGross}`, `銷售額(2)=(1)*100/105: ${sNet}`, `稅額(3)=(2)*5%: ${sTax}`]);
        } else {
            sheetAoa.push([`營業人使用三聯式統一發票明細表（中華民國 ${rocY} 年 ${mon} 月份）`]);
            sheetAoa.push(["統一編號", baseParams.companyTaxId, "營業人名稱", baseParams.companyName, "發票字軌", b.track, "前六位號碼", b.prefix6, "區間", b.half]);
            sheetAoa.push(["末二位號碼", "完整發票號碼", "買受人名稱(內部參考)", "買受人統一編號", "銷售額(未稅)", "課稅別(應稅)", "稅額(5%)", "備註"]);

            let sTaxCnt = 0, sVoidCnt = 0, sBlankCnt = 0, sNet = 0, sTax = 0;
            for (let i = 0; i < 50; i++) {
                const suf2 = String(startNum + i).padStart(2, '0');
                const fullNo = `${b.track}${b.prefix6}${suf2}`;
                const mKey = `${b.track}${b.prefix6}_${suf2}`;
                const inv = invMap.get(fullNo);

                if (inv) {
                    if (inv.status === '作廢') {
                        sVoidCnt++;
                        sheetAoa.push([suf2, fullNo, inv.client || '', '', '', '', '', '作廢']);
                    } else {
                        const cObj = (globalClients || []).find(c => c.name === inv.client);
                        const bTaxId = String(inv.taxId || (cObj ? cObj.taxId : '') || '').trim();
                        const nVal = Math.round(Number(inv.net) || 0);
                        const tVal = Math.round(Number(inv.tax) || 0);
                        sTaxCnt++;
                        sNet += nVal;
                        sTax += tVal;
                        sheetAoa.push([suf2, fullNo, inv.client || '', bTaxId, nVal, '✓', tVal, '']);
                    }
                } else if (window.taxDetailState.manualVoidSuffixes[mKey]) {
                    sVoidCnt++;
                    sheetAoa.push([suf2, fullNo, '', '', '', '', '', '作廢']);
                } else {
                    sBlankCnt++;
                    sheetAoa.push([suf2, fullNo, '', '', '', '', '', '']);
                }
            }
            sheetAoa.push([]);
            sheetAoa.push(["本表合計", `應稅:${sTaxCnt}份`, `作廢:${sVoidCnt}份`, `空白:${sBlankCnt}份`, `未稅銷售額: ${sNet}`, "", `稅額: ${sTax}`, ""]);
        }

        const wsBook = XLSX.utils.aoa_to_sheet(sheetAoa);
        wsBook['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        const prefixTag = isTwo ? '二聯' : '三聯';
        const safeSheetName = `${bIdx + 1}_${prefixTag}_${b.track}${b.prefix6}_${b.half}`.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, wsBook, safeSheetName);
    });

    XLSX.writeFile(wb, `長固ERP_${rocY}年${mon}月_三聯與二聯發票明細表.xlsx`);
    showToast("📥 已成功匯出本月「三聯式＋二聯式統一發票明細表」Excel 檔案！");
};
