/**
 * ============================================================================
 * 模組 6：送貨追蹤與電子簽收模組 (module_delivery.js)
 * 全新獨立模組：負責物流狀態追蹤、A5 送貨單列印與 Canvas 電子簽收
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

    // 關鍵字篩選
    if (term) {
        arr = arr.filter(d => 
            (d.client || '').toLowerCase().includes(term) ||
            (d.paperNo || '').toLowerCase().includes(term) ||
            (d.itemsStr || '').toLowerCase().includes(term) ||
            (d.memo || '').toLowerCase().includes(term)
        );
    }

    // 送貨方式篩選
    if (filterMethod) arr = arr.filter(d => d.deliveryMethod === filterMethod);
    // 狀態篩選
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
            return `<div class="mt-1 text-secondary">▪ ${i.name} <span class="badge bg-light border text-dark ms-1">x${i.qty}</span> ${lotBadge}</div>`;
        }).join('');

        let badgeStatus = '';
        if (d.status === '已送貨') badgeStatus = `<span class="badge bg-success ms-2">🟢 已送貨</span>`;
        else if (d.status === '已結案') badgeStatus = `<span class="badge bg-secondary ms-2">✅ 已簽收結案</span>`;

        let methodBadge = d.deliveryMethod ? `<span class="badge bg-warning text-dark ms-2">🚚 ${d.deliveryMethod}</span>` : '';

        let actionBtns = '';
        let checkboxHtml = '';

        if (isPending) {
            checkboxHtml = `<input class="form-check-input me-3 cb-del" type="checkbox" value="${d.rowIdx}" style="transform: scale(1.3); flex-shrink: 0;">`;
            actionBtns = `<button class="btn btn-sm btn-primary fw-bold" onclick="openDeliveryActionModal([${d.rowIdx}])">執行送貨</button>`;
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
                        <div class="small text-muted mt-1">發票/單號: <span class="fw-bold">${d.paperNo}</span></div>
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
// 2. 執行送貨與編輯資訊 (Delivery Action)
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
    document.getElementById('da_method').value = '';
    document.getElementById('da_memo').value = '';

    // 若為單筆編輯，載入既有資料
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

    ids.forEach(idx => {
        const d = globalDeliveries.find(x => x.rowIdx === idx);
        if (d) {
            d.status = '已送貨';
            d.deliveryDate = date;
            d.deliveryMethod = method;
            d.memo = memo;
            
            // 寫入後端
            pushToSyncQueue('updateDeliveryInfo', {
                rowIdx: idx, status: '已送貨', deliveryDate: date, deliveryMethod: method, memo: memo
            }, null);
        }
    });

    window.renderDeliveryList();
    bootstrap.Modal.getInstance(document.getElementById('deliveryActionModal')).hide();
    showToast("🚚 送貨資訊已儲存並移至已送貨區！");
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
    
    // 生成上方迷你 A5 預覽圖
    const previewContainer = document.getElementById('ds_previewContainer');
    previewContainer.innerHTML = buildDeliveryPrintHtml(idx, true); // true 代表產生迷你預覽版

    bootstrap.Modal.getOrCreateInstance(document.getElementById('deliverySignModal')).show();
    
    // 延遲初始化 Canvas，確保 Modal 展開後能抓到正確寬高
    setTimeout(() => {
        initSignaturePad();
    }, 300);
};

function initSignaturePad() {
    signatureCanvas = document.getElementById('signaturePad');
    signatureCtx = signatureCanvas.getContext('2d');
    
    // 解決高解析度模糊問題
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

    // 支援手機觸控
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
    
    // 檢查是否有簽名 (簡單透過像素比對，全白代表沒簽)
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
// 4. 完美還原 A5 實體送貨單 (列印與預覽引擎)
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
    
    // 【優化 1】將時間格式轉換為純淨的 YYYY/M/D 格式
    let dateStr = d.deliveryDate ? d.deliveryDate : getTodayStr();
    let dObj = new Date(dateStr);
    if (!isNaN(dObj.getTime())) {
        dateStr = `${dObj.getFullYear()}/${dObj.getMonth() + 1}/${dObj.getDate()}`;
    } else {
        dateStr = dateStr.replace(/-/g, '/');
    }

    // 【優化 2】透過發票號碼去歷史紀錄反查真實的「訂單號碼」
    const hRec = globalHistory.find(x => x.paperNo === d.paperNo && d.paperNo !== '');
    const actualOrderNo = hRec && hRec.orderNo ? hRec.orderNo : '';

    let totalAmount = 0;
    const totalRows = Math.max(items.length, 5); // 至少保留 5 行的空間讓版面好看

    // 取得商品單價以計算金額 (透過 globalCatalog 對應)
    let tbodyHtml = '';
    for (let i = 0; i < totalRows; i++) {
        if (i < items.length) {
            const item = items[i];
            const p = globalCatalog.find(x => x.productName === item.name && x.clientName === d.client);
            const price = p ? Number(p.price) : 0;
            const subtotal = price * Number(item.qty);
            totalAmount += subtotal;

            let specDesc = item.name;
            if (item.batchTarget) specDesc += ` <span style="font-size: 0.85em; color: #555;">(批號: ${item.batchTarget})</span>`;

            tbodyHtml += `
                <tr>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${item.internalCode || ''}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: left;">${specDesc}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: center;">${item.qty}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: right;">${price.toLocaleString()}</td>
                    <td style="border: 1px solid #000; padding: 5px; text-align: right;">${subtotal.toLocaleString()}</td>
                    ${i === 0 ? `<td rowspan="${totalRows}" style="width: 25%; border: 1px solid #000; padding: 5px; vertical-align: top; text-align: center; position: relative;">${getSignatureImgHtml(d)}</td>` : ''}
                </tr>
            `;
        } else {
            // 補齊空列
            tbodyHtml += `
                <tr>
                    <td style="border: 1px solid #000; padding: 5px;">&nbsp;</td>
                    <td style="border: 1px solid #000; padding: 5px;"></td>
                    <td style="border: 1px solid #000; padding: 5px;"></td>
                    <td style="border: 1px solid #000; padding: 5px;"></td>
                    <td style="border: 1px solid #000; padding: 5px;"></td>
                    ${i === 0 ? `<td rowspan="${totalRows}" style="width: 25%; border: 1px solid #000; padding: 5px; vertical-align: top; text-align: center; position: relative;">${getSignatureImgHtml(d)}</td>` : ''}
                </tr>
            `;
        }
    }

    // A5 橫向排版 (高度較扁，寬度較寬)
    // isPreviewMode 如果是 true，將縮小比例以符合手機畫面
    const containerStyle = isPreviewMode 
        ? `width: 100%; min-width: 600px; transform: scale(0.9); transform-origin: top left; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000;` 
        : `width: 100%; max-width: 1000px; margin: 0 auto; background: #fff; padding: 10mm 15mm; box-sizing: border-box; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000; min-height: 130mm; display: flex; flex-direction: column;`;

    return `
        <div style="${containerStyle}">
            <!-- 表頭區塊 -->
            <div style="position: relative; text-align: center; margin-bottom: 20px;">
                <div style="font-size: 26px; font-weight: 900; letter-spacing: 5px;">長固實業有限公司</div>
                <div style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 15px; margin-top: 5px; border-bottom: 2px double #000; padding-bottom: 5px;">送貨單</div>
                <div style="position: absolute; right: 0; bottom: 0; font-size: 20px; font-weight: bold;">No. <span style="color: #d32f2f;">${d.rowIdx.toString().padStart(5, '0')}</span></div>
            </div>

            <!-- 客戶與日期 -->
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px; font-size: 16px; font-weight: bold;">
                <div style="width: 60%;">客 戶 名 稱：<span style="border-bottom: 1px solid #000; display: inline-block; width: 70%; padding-bottom: 2px;">${escapeQuotes(d.client)}</span>
                    <div style="margin-top: 5px; font-size: 14px; font-weight: bold; color: #d32f2f;">訂單號碼：${escapeQuotes(actualOrderNo || '無')}</div>
                </div>
                <div style="width: 30%; text-align: right;">${dateStr}</div>
            </div>

            <!-- 核心明細表格 -->
            <table style="width: 100%; border-collapse: collapse; font-size: 15px; border: 2px solid #000; flex-grow: 1;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 8px; width: 15%; text-align: center;">編  號</th>
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
                        <td colspan="4" style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right;">發票編號：${escapeQuotes(d.paperNo || '')}</td>
                        <td style="border: 1px solid #000; padding: 8px; font-weight: bold; text-align: right; background-color: #f9f9f9;">${totalAmount.toLocaleString()}</td>
                        <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">總 計 新 台 幣</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

// 產生合成簽名的圖片標籤
function getSignatureImgHtml(deliveryObj) {
    if (deliveryObj.signature && deliveryObj.signature.length > 50) {
        return `<img src="${deliveryObj.signature}" style="max-width: 95%; max-height: 120px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); mix-blend-mode: multiply;">`;
    }
    return '';
}
