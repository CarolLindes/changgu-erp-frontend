/**
 * ============================================================================
 * 模組 6：送貨追蹤與電子簽收模組 (module_delivery.js) - 【最終物理合併、拆分與完美按鈕版】
 * ============================================================================
 */

let currentDeliverySignRowIdx = null;

// ============================================================================
// 1. 列表渲染與狀態過濾
// ============================================================================
window.renderDeliveryList = debounce(function() {
    const term = (document.getElementById('delSearchInput').value || '').toLowerCase();
    const filterMethod = document.getElementById('delFilterMethod').value;
    const filterStatus = document.getElementById('delFilterStatus').value;

    let arr = globalDeliveries || [];

    if (term) {
        arr = arr.filter(d => 
            (d.client || '').toLowerCase().includes(term) ||
            (d.paperNo || '').toLowerCase().includes(term) ||
            (d.orderNo || '').toLowerCase().includes(term) ||
            (d.itemsStr || '').toLowerCase().includes(term) ||
            (d.memo || '').toLowerCase().includes(term)
        );
    }

    if (filterMethod) arr = arr.filter(d => d.deliveryMethod === filterMethod);
    if (filterStatus) arr = arr.filter(d => d.status === filterStatus);

    let pending = arr.filter(d => d.status === '待送貨');
    let completed = arr.filter(d => d.status === '已送貨' || d.status === '已結案');

    document.getElementById('delPendingListContainer').innerHTML = buildDeliveryHtml(pending, true);
    document.getElementById('delCompletedListContainer').innerHTML = buildDeliveryHtml(completed, false);
}, 300);

function buildDeliveryHtml(dataArr, isPending) {
    if (dataArr.length === 0) return '<div class="text-center text-muted py-4">目前沒有相關資料</div>';

    return dataArr.map(d => {
        let items = []; try { items = JSON.parse(d.itemsStr); } catch(e){}
        let itemsHtml = items.map(i => {
            let lotBadge = i.batchTarget ? `<span class="badge bg-info text-dark ms-1">批號: ${i.batchTarget}</span>` : '';
            let expBadge = i.exp ? `<span class="badge bg-secondary ms-1">效期: ${i.exp}</span>` : '';
            return `<div class="mt-1 text-secondary">▪ ${i.name} <span class="badge bg-light border text-dark ms-1">x${i.qty}</span> ${lotBadge} ${expBadge}</div>`;
        }).join('');

        let badgeStatus = '';
        if (d.status === '已送貨') badgeStatus = `<span class="badge bg-success ms-2">🟢 已送貨</span>`;
        else if (d.status === '已結案') badgeStatus = `<span class="badge bg-secondary ms-2">✅ 已簽收結案</span>`;

        let methodBadge = d.deliveryMethod ? `<span class="badge bg-warning text-dark ms-2">🚚 ${d.deliveryMethod}</span>` : '';

        let actionBtns = '';
        let checkboxHtml = '';

        if (isPending) {
            checkboxHtml = `<input class="form-check-input me-3 cb-del" type="checkbox" value="${d.rowIdx}" style="transform: scale(1.3); flex-shrink: 0;">`;
            
            // 【優化】按鈕排列順序嚴格遵循：[還原拆分] -> [作廢] -> [執行送貨]
            if (String(d.paperNo).includes(',')) {
                actionBtns += `<button class="btn btn-sm btn-outline-secondary fw-bold me-2" onclick="unmergeDelivery(${d.rowIdx})">✂️ 還原拆分</button>`;
            }
            actionBtns += `<button class="btn btn-sm btn-outline-danger fw-bold me-2" onclick="voidDeliveryAndInvoice(${d.rowIdx})">作廢</button>`;
            actionBtns += `<button class="btn btn-sm btn-primary fw-bold" onclick="openDeliveryActionModal([${d.rowIdx}])">執行送貨</button>`;
        } else {
            if (d.status === '已送貨') {
                actionBtns += `<button class="btn btn-sm btn-outline-danger fw-bold me-1" onclick="returnDelivery(${d.rowIdx})">退回</button>`;
                actionBtns += `<button class="btn btn-sm btn-outline-secondary fw-bold me-1" onclick="openDeliveryActionModal([${d.rowIdx}])">編輯</button>`;
                actionBtns += `<button class="btn btn-sm btn-outline-info text-dark fw-bold me-1" onclick="printDeliverySlip(${d.rowIdx})">🖨️ 印送貨單</button>`;
                actionBtns += `<button class="btn btn-sm btn-success fw-bold shadow-sm" onclick="openSignModal(${d.rowIdx})">✍️ 結案簽收</button>`;
            } else if (d.status === '已結案') {
                actionBtns += `<button class="btn btn-sm btn-outline-info text-dark fw-bold me-1" onclick="printDeliverySlip(${d.rowIdx})">🖨️ 補印已簽收單據</button>`;
                actionBtns += `<span class="text-success fw-bold small"><br>已由客戶確認簽收</span>`;
            }
        }

        let dateMemoInfo = '';
        if (d.deliveryDate) dateMemoInfo += `<span class="text-primary fw-bold me-2">日期: ${d.deliveryDate}</span>`;
        if (d.memo) dateMemoInfo += `<span class="text-muted">備註: ${d.memo}</span>`;

        return `<div class="item-row bg-white shadow-sm p-3 mb-2 border-start border-4 ${d.status === '已結案' ? 'border-secondary opacity-75' : 'border-primary'}">
            <div class="d-flex justify-content-between align-items-start mb-2 border-bottom pb-2">
                <div class="d-flex align-items-center">
                    ${checkboxHtml}
                    <div>
                        <div class="fw-bold text-dark fs-6">${d.client} ${badgeStatus} ${methodBadge}</div>
                        <div class="small text-muted mt-1">訂單號碼: <span class="fw-bold text-dark">${d.orderNo || '無'}</span> | 發票編號: <span class="fw-bold text-primary">${d.paperNo || '無'}</span></div>
                    </div>
                </div>
                <div class="text-end d-flex flex-wrap justify-content-end gap-1" style="max-width: 250px;">
                    ${actionBtns}
                </div>
            </div>
            <div class="small mt-2">${itemsHtml}</div>
            <div class="small mt-2 pt-2 border-top">${dateMemoInfo}</div>
        </div>`;
    }).join('');
}

// ============================================================================
// 作廢送貨單，並雙向連動作廢發票與庫存返還
// ============================================================================
window.voidDeliveryAndInvoice = function(idx) {
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return;
    if (!confirm(`確定要作廢此筆送貨作業嗎？\n⚠️ 系統將自動連動：\n1. 作廢關聯的發票 (${d.paperNo})\n2. 註銷銷售明細\n3. 完整返還出貨庫存`)) return;

    d.status = '已作廢';

    let paperNos = d.paperNo.split(',').map(s=>s.trim()).filter(x=>x);
    paperNos.forEach(pNo => {
        const h = globalHistory.find(x => x.paperNo === pNo);
        if (h) h.status = '作廢';

        globalSalesDetails.forEach(sd => {
            if (sd.paperNo === pNo && sd.shipStatus !== '作廢') {
                sd.shipStatus = '作廢';
                if (sd.shippedQty > 0) {
                    let inv = globalInventory.find(x=>x.name === sd.name);
                    if (inv) inv.qty += sd.shippedQty;
                    globalInvLogs.unshift({ time: Date.now(), staff: myName, name: sd.name, type: '作廢返還', qtyChange: sd.shippedQty, newQty: inv ? inv.qty : sd.shippedQty, memo: `作廢單號: ${pNo}` });
                }
            }
        });

        if (h) {
            pushToSyncQueue('updateInvoiceRecord', {action:'void', rowIdx: h.rowIdx, staff: myName, paperNo: pNo}, null);
        }
    });

    if(typeof window.populateLogDropdowns === 'function') window.populateLogDropdowns();
    if(typeof window.renderHistory === 'function') window.renderHistory();
    if(typeof window.renderInventory === 'function') window.renderInventory();
    if(typeof window.renderInvLogs === 'function') window.renderInvLogs();
    if(typeof window.renderShipments === 'function') window.renderShipments();
    if(typeof window.generateReport === 'function') window.generateReport();
    window.renderDeliveryList();
    
    showToast("🗑️ 已作廢送貨單，並成功連動註銷發票與返還庫存");
};

// ============================================================================
// 2. 批次執行與自動物理合併機制 (支援再合併)
// ============================================================================
window.groupExecuteDelivery = function() {
    const cbs = document.querySelectorAll('.cb-del:checked');
    if(cbs.length === 0) return alert('請先勾選要送貨的項目！');
    let ids = Array.from(cbs).map(cb => parseInt(cb.value));
    openDeliveryActionModal(ids);
};

window.openDeliveryActionModal = function(rowIndices) {
    document.getElementById('da_rowIndices').value = JSON.stringify(rowIndices);
    document.getElementById('da_date').value = getTodayStr();
    
    const methodSelect = document.getElementById('da_method');
    if (!methodSelect.querySelector('option[value="工廠直送"]')) {
        methodSelect.insertAdjacentHTML('beforeend', '<option value="工廠直送">工廠直送</option><option value="親自取貨">親自取貨</option>');
    }
    
    document.getElementById('da_method').value = '';
    document.getElementById('da_memo').value = '';

    if (rowIndices.length === 1) {
        const d = globalDeliveries.find(x => x.rowIdx === rowIndices[0]);
        if (d) {
            if (d.deliveryDate) document.getElementById('da_date').value = d.deliveryDate;
            if (d.deliveryMethod) document.getElementById('da_method').value = d.deliveryMethod;
            if (d.memo) document.getElementById('da_memo').value = d.memo;
        }
    }
    
    bootstrap.Modal.getOrCreateInstance(document.getElementById('deliveryActionModal')).show();
};

window.confirmDeliveryAction = function() {
    const ids = JSON.parse(document.getElementById('da_rowIndices').value);
    const date = document.getElementById('da_date').value;
    const method = document.getElementById('da_method').value;
    const memo = document.getElementById('da_memo').value.trim();

    if (!date || !method) return alert("送貨日期與送貨方式為必填！");

    let clientGroups = {};
    ids.forEach(idx => {
        let d = globalDeliveries.find(x => x.rowIdx === idx);
        if(d) {
            if(!clientGroups[d.client]) clientGroups[d.client] = [];
            clientGroups[d.client].push(d);
        }
    });

    let mergedUpdates = [];
    let rowsToDelete = [];

    for (let client in clientGroups) {
        let group = clientGroups[client];
        if (group.length === 1) {
            let d = group[0];
            d.status = '已送貨'; d.deliveryDate = date; d.deliveryMethod = method; d.memo = memo;
            mergedUpdates.push(d);
        } else {
            let mainD = group[0];
            let mergedItems = [];
            let pNos = new Set(); let oNos = new Set();
            let lots = new Set(); let exps = new Set();

            group.forEach((d, index) => {
                let items = []; try { items = JSON.parse(d.itemsStr); } catch(e){}
                
                // 【關鍵】在合併時，將來源發票與單號紀錄在品項內部，為未來的「還原拆分」做準備
                // 即使是已經被退回的合併單再次合併，也能完美保留最原始的單據來源
                items.forEach(i => {
                    if(!i._sourcePaperNo) i._sourcePaperNo = d.paperNo;
                    if(!i._sourceOrderNo) i._sourceOrderNo = d.orderNo;
                    if(!i._sourceLot) i._sourceLot = d.lot;
                    if(!i._sourceExp) i._sourceExp = d.expiry;
                });
                
                d.paperNo.split(',').map(s=>s.trim()).filter(x=>x).forEach(x=>pNos.add(x));
                (d.orderNo||'').split(',').map(s=>s.trim()).filter(x=>x).forEach(x=>oNos.add(x));
                (d.lot||'').split(',').map(s=>s.trim()).filter(x=>x).forEach(x=>lots.add(x));
                (d.expiry||'').split(',').map(s=>s.trim()).filter(x=>x).forEach(x=>exps.add(x));
                
                if(index > 0) {
                    rowsToDelete.push(d.rowIdx);
                    globalDeliveries = globalDeliveries.filter(x => x.rowIdx !== d.rowIdx); 
                }
                mergedItems.push(...items);
            });
            
            mainD.paperNo = Array.from(pNos).join(', ');
            mainD.orderNo = Array.from(oNos).join(', ');
            mainD.lot = Array.from(lots).join(', ');
            mainD.expiry = Array.from(exps).join(', ');
            mainD.itemsStr = JSON.stringify(mergedItems);
            mainD.status = '已送貨';
            mainD.deliveryDate = date;
            mainD.deliveryMethod = method;
            mainD.memo = memo;
            
            mergedUpdates.push(mainD);
        }
    }

    pushToSyncQueue('mergeAndExecuteDeliveries', {
        mergedUpdates: mergedUpdates, 
        rowsToDelete: rowsToDelete
    }, null);

    window.renderDeliveryList();
    bootstrap.Modal.getInstance(document.getElementById('deliveryActionModal')).hide();
    showToast("🚚 批次送貨處理完成！(同客戶之單據已自動智慧合併)");
};

// ============================================================================
// 還原拆分合併的送貨單
// ============================================================================
window.unmergeDelivery = function(idx) {
    if(!confirm("確定要將此合併送貨單還原拆分為多筆原始單據嗎？")) return;
    
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if(!d) return;

    let items = []; try { items = JSON.parse(d.itemsStr); } catch(e){}
    
    let groups = {};
    items.forEach(i => {
        let pNo = i._sourcePaperNo || d.paperNo;
        if(!groups[pNo]) groups[pNo] = { items: [], orderNo: i._sourceOrderNo||'', lot: i._sourceLot||'', exp: i._sourceExp||'' };
        
        // 抹除追蹤屬性，還原為乾淨的項目
        let cleanItem = { ...i };
        delete cleanItem._sourcePaperNo;
        delete cleanItem._sourceOrderNo;
        delete cleanItem._sourceLot;
        delete cleanItem._sourceExp;
        
        groups[pNo].items.push(cleanItem);
    });

    let newDeliveries = [];
    for (let pNo in groups) {
        let g = groups[pNo];
        newDeliveries.push({
            rowIdx: Date.now() + Math.floor(Math.random() * 10000),
            time: Date.now(),
            paperNo: pNo,
            client: d.client,
            itemsStr: JSON.stringify(g.items),
            status: '待送貨', // 拆分後必定是待送貨狀態
            deliveryDate: '',
            deliveryMethod: '',
            memo: '',
            signature: '',
            staff: myName,
            orderNo: g.orderNo,
            lot: g.lot,
            expiry: g.exp
        });
    }

    globalDeliveries = globalDeliveries.filter(x => x.rowIdx !== idx);
    globalDeliveries.unshift(...newDeliveries);

    pushToSyncQueue('unmergeDeliveries', {
        rowToUnmerge: idx,
        newRows: newDeliveries
    }, null);

    window.renderDeliveryList();
    showToast("✂️ 已成功還原拆分為多筆原始待送貨單！");
};

// ============================================================================
// 3. 狀態退回與電子簽收 (Signature Pad)
// ============================================================================
window.returnDelivery = function(idx) {
    if(!confirm("確定要將此筆資料退回「待送貨」狀態嗎？")) return;
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if(d) d.status = '待送貨';
    pushToSyncQueue('updateDeliveryStatus', { action: 'return', rowIdx: idx }, null);
    window.renderDeliveryList();
    showToast("⏪ 已退回待送貨");
};

let signatureCanvas, signatureCtx;
let isDrawing = false;

window.openSignModal = function(idx) {
    currentDeliverySignRowIdx = idx;
    
    const previewContainer = document.getElementById('ds_previewContainer');
    previewContainer.innerHTML = buildDeliveryPrintHtml(idx, true);

    bootstrap.Modal.getOrCreateInstance(document.getElementById('deliverySignModal')).show();
    
    setTimeout(() => {
        initSignaturePad();
    }, 300);
};

function initSignaturePad() {
    signatureCanvas = document.getElementById('signaturePad');
    signatureCtx = signatureCanvas.getContext('2d');
    
    const rect = signatureCanvas.parentElement.getBoundingClientRect();
    signatureCanvas.width = rect.width;
    signatureCanvas.height = 250;
    
    signatureCtx.lineWidth = 3;
    signatureCtx.lineCap = 'round';
    signatureCtx.strokeStyle = '#000000';
    
    clearSignature();

    signatureCanvas.onmousedown = startDrawing;
    signatureCanvas.onmousemove = draw;
    signatureCanvas.onmouseup = stopDrawing;
    signatureCanvas.onmouseout = stopDrawing;

    signatureCanvas.ontouchstart = (e) => { e.preventDefault(); startDrawing(e.touches[0]); };
    signatureCanvas.ontouchmove = (e) => { e.preventDefault(); draw(e.touches[0]); };
    signatureCanvas.ontouchend = (e) => { e.preventDefault(); stopDrawing(); };
}

function startDrawing(e) {
    isDrawing = true;
    signatureCtx.beginPath();
    const rect = signatureCanvas.getBoundingClientRect();
    signatureCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
    if (!isDrawing) return;
    const rect = signatureCanvas.getBoundingClientRect();
    signatureCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    signatureCtx.stroke();
}

function stopDrawing() {
    isDrawing = false;
    signatureCtx.closePath();
}

window.clearSignature = function() {
    if(signatureCtx && signatureCanvas) {
        signatureCtx.fillStyle = '#ffffff';
        signatureCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
};

window.confirmSignature = function() {
    if (!currentDeliverySignRowIdx) return;
    
    const blank = document.createElement('canvas');
    blank.width = signatureCanvas.width;
    blank.height = signatureCanvas.height;
    const blankCtx = blank.getContext('2d');
    blankCtx.fillStyle = '#ffffff';
    blankCtx.fillRect(0, 0, blank.width, blank.height);
    
    if (signatureCanvas.toDataURL() === blank.toDataURL()) {
        if(!confirm("您尚未簽名，確定要強制結案嗎？")) return;
    }

    const base64Sign = signatureCanvas.toDataURL('image/png');
    
    const d = globalDeliveries.find(x => x.rowIdx === currentDeliverySignRowIdx);
    if(d) {
        d.status = '已結案';
        d.signature = base64Sign;
    }

    pushToSyncQueue('updateDeliveryStatus', { action: 'sign', rowIdx: currentDeliverySignRowIdx, signature: base64Sign }, null);
    
    bootstrap.Modal.getInstance(document.getElementById('deliverySignModal')).hide();
    window.renderDeliveryList();
    showToast("✅ 電子簽收完成，案件已結案歸檔！");
};

// ============================================================================
// 4. 完美還原 A5 實體送貨單 (含分頁列印防破圖引擎)
// ============================================================================
window.printDeliverySlip = function(idx) {
    const html = buildDeliveryPrintHtml(idx, false);
    const printArea = document.getElementById('printDeliveryArea');
    if (printArea) {
        printArea.innerHTML = html;
        if (typeof window.applyPrintStyle === 'function') window.applyPrintStyle('A5', 'landscape');
        if (typeof window.showPrintPreview === 'function') window.showPrintPreview('printDeliveryArea');
    }
};

function buildDeliveryPrintHtml(idx, isPreviewMode) {
    const d = globalDeliveries.find(x => x.rowIdx === idx);
    if (!d) return '';

    let items = []; try { items = JSON.parse(d.itemsStr); } catch(e){}
    
    const dateStr = d.deliveryDate ? d.deliveryDate.replace(/-/g, '/') : getTodayStr().replace(/-/g, '/');
    
    const ROWS_PER_PAGE = 5;
    const totalPages = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
    
    let htmlOutput = '';
    let globalItemIndex = 0;
    let cumulativeTotal = 0;

    for (let page = 1; page <= totalPages; page++) {
        let tbodyHtml = '';
        let pageTotal = 0;

        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            if (globalItemIndex < items.length) {
                const item = items[globalItemIndex];
                const p = globalCatalog.find(x => x.productName === item.name && x.clientName === d.client);
                const price = p ? Number(p.price) : 0;
                const subtotal = price * Number(item.qty);
                pageTotal += subtotal;
                cumulativeTotal += subtotal;

                let specDesc = item.name;
                if (item.batchTarget) specDesc += ` <span style="font-size: 0.85em; color: #555;">(批號: ${item.batchTarget})</span>`;
                if (item.exp) specDesc += ` <span style="font-size: 0.85em; color: #555;">(效期: ${item.exp})</span>`;

                tbodyHtml += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 5px; text-align: center; height: 35px;">${item.orderNo || item._sourceOrderNo || ''}</td>
                        <td style="border: 1px solid #000; padding: 5px; text-align: left;">${specDesc}</td>
                        <td style="border: 1px solid #000; padding: 5px; text-align: center;">${item.qty}</td>
                        <td style="border: 1px solid #000; padding: 5px; text-align: right;">${price.toLocaleString()}</td>
                        <td style="border: 1px solid #000; padding: 5px; text-align: right;">${subtotal.toLocaleString()}</td>
                        ${i === 0 ? `<td rowspan="${ROWS_PER_PAGE}" style="width: 25%; border: 1px solid #000; padding: 5px; vertical-align: top; text-align: center; position: relative;">${getSignatureImgHtml(d)}</td>` : ''}
                    </tr>
                `;
                globalItemIndex++;
            } else {
                tbodyHtml += `
                    <tr>
                        <td style="border: 1px solid #000; padding: 5px; height: 35px;">&nbsp;</td>
                        <td style="border: 1px solid #000; padding: 5px;"></td>
                        <td style="border: 1px solid #000; padding: 5px;"></td>
                        <td style="border: 1px solid #000; padding: 5px;"></td>
                        <td style="border: 1px solid #000; padding: 5px;"></td>
                        ${i === 0 ? `<td rowspan="${ROWS_PER_PAGE}" style="width: 25%; border: 1px solid #000; padding: 5px; vertical-align: top; text-align: center; position: relative;">${getSignatureImgHtml(d)}</td>` : ''}
                    </tr>
                `;
            }
        }

        const containerStyle = isPreviewMode 
            ? `width: 100%; min-width: 600px; transform: scale(0.9); transform-origin: top left; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000; margin-bottom: 20px; background: #fff; padding: 15px; border: 1px solid #ccc;` 
            : `width: 100%; max-width: 1000px; margin: 0 auto; background: #fff; padding: 10mm 15mm; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000; min-height: 130mm; display: flex; flex-direction: column; page-break-after: ${page < totalPages ? 'always' : 'auto'};`;

        const totalDisplay = (page === totalPages) ? cumulativeTotal.toLocaleString() : `(接下頁) 小計: ${pageTotal.toLocaleString()}`;
        const totalLabel = (page === totalPages) ? '總 計 新 台 幣' : '本 頁 小 計';

        htmlOutput += `
            <div style="${containerStyle}">
                <div style="position: relative; text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 26px; font-weight: 900; letter-spacing: 5px;">長固實業有限公司</div>
                    <div style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 15px; margin-top: 5px; border-bottom: 2px double #000; padding-bottom: 5px;">送貨單</div>
                    <div style="position: absolute; right: 0; bottom: 0; font-size: 20px; font-weight: bold;">
                        No. <span style="color: #d32f2f;">${d.rowIdx.toString().padStart(5, '0')}</span>
                        <div style="font-size: 12px; color: #666; margin-top: 5px; letter-spacing: 1px; font-weight: normal;">頁次: ${page} / ${totalPages}</div>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px; font-size: 16px; font-weight: bold;">
                    <div style="width: 60%;">客 戶 名 稱：<span style="border-bottom: 1px solid #000; display: inline-block; width: 70%; padding-bottom: 2px;">${escapeQuotes(d.client)}</span></div>
                    <div style="width: 30%; text-align: right;">${dateStr.split('/')[0]} 年 ${dateStr.split('/')[1]} 月 ${dateStr.split('/')[2]} 日</div>
                </div>

                <table style="width: 100%; border-collapse: collapse; font-size: 15px; border: 2px solid #000; flex-grow: 1;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #000; padding: 8px; width: 15%; text-align: center;">訂單號碼</th>
                            <th style="border: 1px solid #000; padding: 8px; width: 35%; text-align: center;">品  名  規  格</th>
                            <th style="border: 1px solid #000; padding: 8px; width: 8%; text-align: center;">數 量</th>
                            <th style="border: 1px solid #000; padding: 8px; width: 12%; text-align: center;">單 價</th>
                            <th style="border: 1px solid #000; padding: 8px; width: 12%; text-align: center;">金  額</th>
                            <th style="border: 1px solid #000; padding: 8px; width: 18%; text-align: center;">客 戶 簽 收</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHtml}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right;"></td>
                            <td style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right; background-color: #f9f9f9;">${totalDisplay}</td>
                            <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${totalLabel}</td>
                        </tr>
                    </tfoot>
                </table>
                
                <div style="margin-top: 15px; font-size: 14px; line-height: 1.6;">
                    <p style="margin-bottom: 15px;">以上貨品數量及單價請查核.</p>
                    <div style="margin-top: 30px;">
                        <div style="width: 45%;">簽收: <span style="border-bottom: 1px solid #000; display: inline-block; width: 75%;">&nbsp;</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    return htmlOutput;
}

function getSignatureImgHtml(deliveryObj) {
    if (deliveryObj.signature && deliveryObj.signature.length > 50) {
        return `<img src="${deliveryObj.signature}" crossorigin="anonymous" style="max-width: 95%; max-height: 120px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); mix-blend-mode: multiply;">`;
    }
    return '';
}
