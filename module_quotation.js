/**
 * ============================================================================
 * 模組 5：開立估價單與動態列印 (module_quotation.js)
 * ============================================================================
 */

window.renderQuotationList = debounce(function() {
    const searchTerm = document.getElementById('quoSearchInput').value.toLowerCase();
    
    let filtered = globalQuotes;
    if (searchTerm) {
        filtered = filtered.filter(q => 
            q.client.toLowerCase().includes(searchTerm) || 
            q.quoteNo.toLowerCase().includes(searchTerm) || 
            q.jsonStr.toLowerCase().includes(searchTerm)
        );
    }

    let pending = filtered.filter(q => q.status === '待確認');
    let verified = filtered.filter(q => q.status !== '待確認');

    function buildQuoHtml(dataArr, isPendingTab) {
        if(dataArr.length === 0) return '<div class="text-center text-muted py-4">目前沒有資料</div>';
        
        let groups = {};
        dataArr.forEach(q => {
            let gid = q.mergeId || `Single_${q.rowIdx}`;
            if (!groups[gid]) groups[gid] = { isMerged: !!q.mergeId, client: q.client, quotes: [] };
            groups[gid].quotes.push(q);
        });

        let html = '';
        for (let gid in groups) {
            const group = groups[gid];
            const isMerged = group.isMerged;
            
            let titleHtml = `<div class="fw-bold text-dark fs-6">${group.client} ${isMerged ? '<span class="badge bg-primary ms-2">🔗 已合併</span>' : ''}</div>`;
            
            let allItemsDesc = group.quotes.map(q => {
                let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
                let itemsStr = items.map(i => `<div>${i.name} <span class="badge bg-light text-dark border ms-1">x${i.qty}</span></div>`).join('');
                return `<div class="mt-2 pt-2 border-top">
                            <span class="small fw-bold text-secondary">單號: ${q.quoteNo} (${q.quoteDate})</span>
                            <div class="small text-muted mt-1">${itemsStr}</div>
                        </div>`;
            }).join('');

            let actionBtns = '';
            if (isPendingTab) {
                // 【修復】列印估價單功能
                actionBtns += `<button class="btn btn-sm btn-outline-info fw-bold me-1 text-dark" onclick="printQuotation('${gid}')">🖨️ 列印出單</button>`;
                actionBtns += `<button class="btn btn-sm btn-outline-danger fw-bold me-1" onclick="voidQuotation('${gid}')">🗑️ 作廢</button>`;
                if (!isMerged) {
                    actionBtns += `<button class="btn btn-sm btn-outline-secondary fw-bold me-1" onclick="openQuotationModal(${group.quotes[0].rowIdx})">📝 編輯</button>`;
                }
                actionBtns += `<button class="btn btn-sm btn-success fw-bold text-white shadow-sm" onclick="verifyQuotationToInvoice('${gid}')">✅ 核銷轉發票</button>`;
            } else {
                let statusBadge = '';
                if(group.quotes[0].status === '已核銷') statusBadge = '<span class="badge bg-success">已核銷</span>';
                else if(group.quotes[0].status === '已作廢') statusBadge = '<span class="badge bg-danger">已作廢</span>';
                actionBtns += statusBadge;
            }

            let checkboxHtml = '';
            if (isPendingTab) {
                const val = isMerged ? `M_${gid}` : `S_${group.quotes[0].rowIdx}`;
                checkboxHtml = `<input class="form-check-input me-3 cb-quo" type="checkbox" value="${val}" data-client="${escapeQuotes(group.client)}" style="transform: scale(1.3); flex-shrink: 0;">`;
            }

            html += `<div class="item-row bg-white shadow-sm p-3 mb-3 ${isMerged ? 'border-primary' : ''}">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="d-flex align-items-center">
                        ${checkboxHtml}
                        ${titleHtml}
                    </div>
                    <div>${actionBtns}</div>
                </div>
                ${allItemsDesc}
            </div>`;
        }
        return html;
    }

    document.getElementById('quoPendingListContainer').innerHTML = buildQuoHtml(pending, true);
    document.getElementById('quoVerifiedListContainer').innerHTML = buildQuoHtml(verified, false);

}, 300);

window.openQuotationModal = function(idx) {
    currentQuoItems = [];
    document.getElementById('e_quoMemo').value = '';
    document.getElementById('e_quoUseSeal').checked = true;

    if(idx) {
        const q = globalQuotes.find(x => x.rowIdx === idx);
        document.getElementById('e_quoRow').value = idx;
        document.getElementById('e_quoDate').value = q.quoteDate;
        document.getElementById('e_quoNo').value = q.quoteNo;
        document.getElementById('e_quoClient').value = q.client;
        document.getElementById('e_quoUseSeal').checked = q.useSeal;
        document.getElementById('e_quoMemo').value = q.memo || ''; 
        
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            const rowId = `quo_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
            currentQuoItems.push({ id: rowId, name: i.name||'', price: i.price||0, qty: i.qty||1, unit: i.unit||'式', brandModel: i.brandModel||'', memo: i.memo||'', showBrand: !!i.brandModel });
        });
    } else {
        document.getElementById('e_quoRow').value = '';
        document.getElementById('e_quoDate').value = getTodayStr();
        document.getElementById('e_quoNo').value = '';
        document.getElementById('e_quoClient').value = '';
        document.getElementById('e_quoMemo').value = '';
        addQuotationManualItemRow();
    }
    reRenderQuotationItems();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editQuoModal')).show();
};

window.addQuotationManualItemRow = function() {
    const rowId = `quo_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    currentQuoItems.push({ id: rowId, name: '', price: 0, qty: 1, unit: '式', brandModel: '', memo: '', showBrand: false });
    reRenderQuotationItems();
};

window.renderSingleQuotationItem = function(item) {
    let subtotal = (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 0);
    
    return `<div class="item-row p-3 mb-2 bg-white border border-secondary shadow-sm draggable-row" id="${item.id}" draggable="true" ondragstart="handleDragStart(event, '${item.id}', 'quotation')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${item.id}', 'quotation')" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)">
        <div class="drag-handle position-absolute" style="top:10px; left:10px; cursor:grab; font-size: 1.2rem; color: #adb5bd;" title="按住拖曳排序">☰</div>
        <button class="btn btn-sm btn-outline-danger position-absolute" style="top:8px; right:8px;" onclick="removeQuotationItem('${item.id}')">✕</button>
        
        <div class="mb-2 pe-4 ps-4">
            <label class="form-label small fw-bold text-muted mb-1">品名 <span class="text-danger">*</span></label>
            <input type="text" class="form-control fake-input-btn form-control-sm fw-bold fs-6 border-primary" id="quo_name_${item.id}" value="${escapeQuotes(item.name)}" readonly placeholder="點此對應產品庫..." onclick="openSearchModal('item_quo_${item.id}', (val)=>selectProductForQuo('${item.id}', val))">
        </div>
        <div class="row g-2 ps-4 mb-2">
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">數量</label><input type="number" class="form-control form-control-sm fw-bold text-danger text-center" id="quo_qty_${item.id}" value="${item.qty}" min="0" step="any" oninput="updateQuoQty('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">單位</label><input type="text" class="form-control form-control-sm text-center" id="quo_unit_${item.id}" value="${escapeQuotes(item.unit)}" oninput="updateQuoUnit('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">單價(含稅)</label><input type="number" class="form-control form-control-sm text-end" id="quo_price_${item.id}" value="${item.price}" min="0" step="any" oninput="updateQuoPrice('${item.id}', this.value)"></div>
            <div class="col-3"><label class="form-label small fw-bold text-muted mb-1">小計(含稅)</label><input type="text" class="form-control form-control-sm bg-light text-end fw-bold text-primary" value="$${Math.round(subtotal).toLocaleString()}" readonly></div>
        </div>
        <div class="row g-2 ps-4 align-items-end">
            <div class="col-12">
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="quo_showBrand_${item.id}" ${item.showBrand ? 'checked' : ''} onchange="toggleQuoBrand('${item.id}', this.checked)">
                    <label class="form-check-label small fw-bold text-muted" for="quo_showBrand_${item.id}">需要填寫廠牌型號</label>
                </div>
                <div id="quo_brandBox_${item.id}" style="display: ${item.showBrand ? 'block' : 'none'};">
                    <input type="text" class="form-control form-control-sm mb-2" placeholder="輸入廠牌型號..." value="${escapeQuotes(item.brandModel)}" oninput="updateQuoBrand('${item.id}', this.value)">
                </div>
            </div>
            <div class="col-12"><label class="form-label small fw-bold text-muted mb-1">單項備註</label><input type="text" class="form-control form-control-sm text-secondary" placeholder="選填..." value="${escapeQuotes(item.memo)}" oninput="updateQuoMemo('${item.id}', this.value)"></div>
        </div>
    </div>`;
};

window.reRenderQuotationItems = function() { 
    document.getElementById('e_quoItemsContainer').innerHTML = currentQuoItems.map(renderSingleQuotationItem).join(''); 
};

window.selectClientForQuotation = function(val) {
    document.getElementById('e_quoClient').value = val;
    currentQuoItems = [];
    addQuotationManualItemRow();
};

window.selectProductForQuo = function(rowId, prodName) {
    const client = document.getElementById('e_quoClient').value;
    const p = globalCatalog.find(x => x.clientName === client && x.productName === prodName);
    if(p) {
        const item = currentQuoItems.find(x => x.id === rowId);
        if(item) {
            item.name = p.productName;
            item.price = p.price || 0;
            item.unit = p.unit || '式';
        }
        reRenderQuotationItems();
    }
};

window.updateQuoQty = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.qty = Math.max(0, parseFloat(val)||0); reRenderQuotationItems(); } };
window.updateQuoUnit = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.unit = val; } };
window.updateQuoPrice = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.price = Math.max(0, parseFloat(val)||0); reRenderQuotationItems(); } };
window.updateQuoBrand = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) item.brandModel = val; };
window.updateQuoMemo = function(id, val) { const item = currentQuoItems.find(x=>x.id===id); if(item) item.memo = val; };
window.toggleQuoBrand = function(id, isChecked) { const item = currentQuoItems.find(x=>x.id===id); if(item) { item.showBrand = isChecked; reRenderQuotationItems(); } };
window.removeQuotationItem = function(id) { currentQuoItems = currentQuoItems.filter(x=>x.id!==id); reRenderQuotationItems(); };

window.saveEditQuotation = function() {
    const idx = document.getElementById('e_quoRow').value;
    const date = document.getElementById('e_quoDate').value;
    const no = document.getElementById('e_quoNo').value.trim();
    const client = document.getElementById('e_quoClient').value;
    const useSeal = document.getElementById('e_quoUseSeal').checked;
    const memo = document.getElementById('e_quoMemo').value.trim(); 
    
    if(!date || !no || !client) return alert("估價日期、編號與客戶名稱皆為必填！");
    
    let items = [];
    for(let i of currentQuoItems) {
        if(!i.name || i.qty <= 0) return alert("所有品項必須填寫名稱且數量需大於0！");
        items.push({ name: i.name, qty: i.qty, unit: i.unit, price: i.price, brandModel: i.showBrand ? i.brandModel : '', memo: i.memo });
    }
    if(items.length === 0) return alert("請至少新增一項品項！");

    const payload = { rowIdx: idx ? parseInt(idx) : null, quoteDate: date, quoteNo: no, clientName: client, useSeal: useSeal, items: items, status: '待確認', staff: myName, memo: memo };

    if(idx) {
        const q = globalQuotes.find(x => x.rowIdx === parseInt(idx));
        if(q) { q.quoteDate=date; q.quoteNo=no; q.client=client; q.useSeal=useSeal; q.jsonStr=JSON.stringify(items); q.memo=memo; }
    } else {
        globalQuotes.unshift({ rowIdx: Date.now(), time: Date.now(), quoteNo: no, quoteDate: date, client: client, status: '待確認', jsonStr: JSON.stringify(items), useSeal: useSeal, mergeId: '', staff: myName, memo: memo });
    }

    pushToSyncQueue('saveQuotation', payload, null);
    window.renderQuotationList();
    bootstrap.Modal.getInstance(document.getElementById('editQuoModal')).hide();
    showToast("💾 估價單已儲存");
};

window.groupMergeQuotations = function() {
    const cbs = document.querySelectorAll('.cb-quo:checked');
    if(cbs.length < 2) return alert('請至少勾選 2 筆估價單進行合併！');
    
    let client = ''; let valid = true; let idsToMerge = [];
    cbs.forEach(cb => {
        if(!client) client = cb.dataset.client; else if(client !== cb.dataset.client) valid = false;
        const val = cb.value;
        if(val.startsWith('M_')) {
            const groupQuotes = globalQuotes.filter(q => q.mergeId === val.replace('M_',''));
            idsToMerge.push(...groupQuotes.map(q => q.rowIdx));
        } else {
            idsToMerge.push(parseInt(val.replace('S_','')));
        }
    });

    if(!valid) return alert('⚠️ 合併防呆：不可將「不同客戶」的估價單合併在一起！請重新勾選。');
    const newMergeId = 'MG_' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    
    globalQuotes.forEach(q => { if(idsToMerge.includes(q.rowIdx)) q.mergeId = newMergeId; });
    pushToSyncQueue('mergeQuotations', { rowIndices: idsToMerge, mergeId: newMergeId }, null);
    window.renderQuotationList();
    showToast("🔗 估價單已成功合併！");
};

window.groupUnmergeQuotations = function() {
    const cbs = document.querySelectorAll('.cb-quo:checked');
    if(cbs.length === 0) return alert('請先勾選已合併的估價單群組！');
    
    let idsToUnmerge = [];
    cbs.forEach(cb => {
        const val = cb.value;
        if(val.startsWith('M_')) {
            const groupQuotes = globalQuotes.filter(q => q.mergeId === val.replace('M_',''));
            idsToUnmerge.push(...groupQuotes.map(q => q.rowIdx));
        }
    });

    if(idsToUnmerge.length === 0) return showToast("勾選的皆為單筆估價單，不需解除合併。");
    globalQuotes.forEach(q => { if(idsToUnmerge.includes(q.rowIdx)) q.mergeId = ''; });
    pushToSyncQueue('unmergeQuotations', { rowIndices: idsToUnmerge }, null);
    window.renderQuotationList();
    showToast("✂️ 已解除合併拆分為單筆！");
};

let tempVoidGroupData = []; 

window.voidQuotation = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if(quotesInGroup.length === 0) return;

    let allItems = [];
    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => { i.sourceRowIdx = q.rowIdx; i.sourceQuoteNo = q.quoteNo; allItems.push(i); });
    });

    if(allItems.length <= 1) {
        if(confirm("確定要將此估價單作廢嗎？")) {
            const ids = quotesInGroup.map(q => q.rowIdx);
            quotesInGroup.forEach(q => q.status = '已作廢');
            pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已作廢' }, null);
            window.renderQuotationList();
        }
    } else {
        tempVoidGroupData = quotesInGroup;
        let html = allItems.map((item, idx) => {
            return `<div class="form-check mb-2 p-2 border-bottom"><input class="form-check-input cb-void-item" type="checkbox" value="${idx}" id="cb_void_${idx}" style="transform: scale(1.3); margin-right: 10px;"><label class="form-check-label fw-bold" for="cb_void_${idx}">${item.name} <span class="badge bg-secondary ms-1">x${item.qty}</span><div class="small text-muted fw-normal mt-1">來源: ${item.sourceQuoteNo}</div></label></div>`;
        }).join('');
        document.getElementById('vq_itemsList').innerHTML = html;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('voidQuoItemsModal')).show();
    }
};

window.confirmVoidQuotationItems = function() {
    const cbs = document.querySelectorAll('.cb-void-item:checked');
    if(cbs.length === 0) return alert('請至少勾選一項要作廢的品項！');

    let allItems = [];
    tempVoidGroupData.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => { i.sourceRowIdx = q.rowIdx; allItems.push(i); });
    });

    if(cbs.length === allItems.length) {
        const ids = tempVoidGroupData.map(q => q.rowIdx);
        tempVoidGroupData.forEach(q => q.status = '已作廢');
        pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已作廢' }, null);
        window.renderQuotationList();
        bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
        return;
    }

    let selectedIndices = Array.from(cbs).map(cb => parseInt(cb.value));
    
    tempVoidGroupData.forEach(q => {
        let origItems = []; try { origItems = JSON.parse(q.jsonStr); } catch(e){}
        let keepItems = []; let voidItems = [];
        
        origItems.forEach(oi => {
            let matchIdx = allItems.findIndex(ai => ai.sourceRowIdx === q.rowIdx && ai.name === oi.name && ai.qty === oi.qty);
            if(selectedIndices.includes(matchIdx)) {
                voidItems.push(oi);
                selectedIndices = selectedIndices.filter(x => x !== matchIdx);
            } else { keepItems.push(oi); }
        });

        if(voidItems.length > 0) {
            q.jsonStr = JSON.stringify(keepItems);
            globalQuotes.unshift({ rowIdx: Date.now()+Math.random(), time: Date.now(), quoteNo: q.quoteNo+"-作廢", quoteDate: q.quoteDate, client: q.client, status: '已作廢', jsonStr: JSON.stringify(voidItems), useSeal: q.useSeal, mergeId: '', staff: myName, memo: q.memo });
            
            pushToSyncQueue('splitAndVoidQuotationItems', {
                rowIdx: q.rowIdx, quoteNo: q.quoteNo, quoteDate: q.quoteDate, clientName: q.client, useSeal: q.useSeal, staff: myName, keepItems: keepItems, voidItems: voidItems
            }, null);
        }
    });

    window.renderQuotationList();
    bootstrap.Modal.getInstance(document.getElementById('voidQuoItemsModal')).hide();
    showToast("🗑️ 指定品項已成功拆分並作廢！");
};

window.verifyQuotationToInvoice = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if(quotesInGroup.length === 0) return;

    const clientName = quotesInGroup[0].client;
    const cObj = globalClients.find(x => x.name === clientName);
    const taxId = cObj ? cObj.taxId : '';
    const quoteNos = quotesInGroup.map(q => q.quoteNo).join(', ');

    enterSystem('invoice');
    document.getElementById('invClientInput').value = clientName; 
    currentInvoiceData.clientName = clientName; 
    currentInvoiceData.taxId = taxId; 
    document.getElementById('invClientInfo').innerText = `✓ 綁定成功 (統編: ${taxId||'無'})`; 
    document.getElementById('invClientInfo').style.display = 'block'; 
    document.getElementById('btnNext1').style.display = 'block'; 
    document.getElementById('invOrderNo').value = `[估價單核銷]-${quoteNos}`;
    currentInvoiceData.items = [];
    document.getElementById('invAiNotice').style.display = 'block';
    
    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        items.forEach(i => {
            const rowId = `invR_${Date.now()}_${Math.random().toString(36).substring(2)}`; 
            const p = globalCatalog.find(x => x.clientName === clientName && x.productName === i.name);
            let internalCode = p ? (p.internalCode || p.assetCode) : '';
            let fullMemo = ((i.brandModel ? i.brandModel + ' ' : '') + (i.memo || '')).trim();

            currentInvoiceData.items.push({ 
                id: rowId, 
                product: { productName: i.name, unit: i.unit, price: i.price, internalCode: internalCode }, 
                qty: i.qty, orderRef: q.quoteNo, deptRef: fullMemo 
            });
        });
    });

    const ids = quotesInGroup.map(q => q.rowIdx);
    quotesInGroup.forEach(q => q.status = '已核銷');
    pushToSyncQueue('updateQuotationStatus', { rowIndices: ids, status: '已核銷' }, null);

    if (typeof reRenderInvoiceItems === "function") reRenderInvoiceItems();
    if (typeof goStep === "function") goStep(2); 
    showToast("✅ 已將估價單品項全數載入發票系統！您可以自由刪減本次要開立的品項 (每張發票限5筆)。");
};

// ============================================================================
// 【全新補齊】完美動態預覽列印估價單 (支援 A4 滿版與印章浮水印)
// ============================================================================
window.printQuotation = function(gid) {
    const quotesInGroup = globalQuotes.filter(q => q.mergeId === gid || `Single_${q.rowIdx}` === gid);
    if (quotesInGroup.length === 0) return;

    const clientName = quotesInGroup[0].client;
    const quoteNos = quotesInGroup.map(q => q.quoteNo).join(', ');
    const quoteDate = quotesInGroup[0].quoteDate;
    const useSeal = quotesInGroup[0].useSeal;
    
    // 合併所有的備註
    const mainMemo = quotesInGroup.map(q => q.memo).filter(x => x).join(' / ');

    // 取出所有品項
    let allItems = [];
    quotesInGroup.forEach(q => {
        let items = []; try { items = JSON.parse(q.jsonStr); } catch(e){}
        allItems.push(...items);
    });

    let totalAmount = 0;
    
    // 渲染表格內容
    let tbodyHtml = allItems.map((item, idx) => {
        const price = parseFloat(item.price) || 0;
        const qty = parseFloat(item.qty) || 0;
        const subtotal = Math.round(price * qty); // 系統自動含稅計算
        totalAmount += subtotal;

        let extDesc = [];
        if (item.brandModel) extDesc.push(`廠牌型號: ${item.brandModel}`);
        if (item.memo) extDesc.push(item.memo);
        let descHtml = extDesc.length > 0 ? `<div style="font-size: 0.85em; color: #555; margin-top: 4px;">${escapeQuotes(extDesc.join(' | '))}</div>` : '';

        return `
            <tr>
                <td style="border: 1px solid #000; padding: 10px; text-align: center;">${idx + 1}</td>
                <td style="border: 1px solid #000; padding: 10px; text-align: left;">
                    <div style="font-weight: bold;">${escapeQuotes(item.name)}</div>
                    ${descHtml}
                </td>
                <td style="border: 1px solid #000; padding: 10px; text-align: center;">${qty}</td>
                <td style="border: 1px solid #000; padding: 10px; text-align: center;">${escapeQuotes(item.unit)}</td>
                <td style="border: 1px solid #000; padding: 10px; text-align: right;">$${price.toLocaleString()}</td>
                <td style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">$${subtotal.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    // 大小章設定 (如果是 True 就顯示)
    const sealHtml = useSeal ? `
        <div style="position: absolute; right: 80px; bottom: -20px; width: 140px; height: 140px; border: 4px solid rgba(211, 47, 47, 0.55); border-radius: 50%; display: flex; justify-content: center; align-items: center; color: rgba(211, 47, 47, 0.55); font-size: 1.2rem; font-weight: bold; transform: rotate(-15deg); pointer-events: none; z-index: 10;">
            長固實業<br>報價專用章
        </div>
    ` : '';

    // 生成完整 A4 排版 HTML
    const html = `
        <div style="padding: 20px; max-width: 900px; margin: 0 auto; position: relative; font-family: 'MingLiU', '微軟正黑體', sans-serif; color: #000; background: #fff;">
            <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="margin: 0; font-weight: 900; letter-spacing: 5px; font-size: 28px;">長固實業有限公司</h2>
                <h3 style="margin: 10px 0 0 0; font-weight: bold; letter-spacing: 15px; font-size: 22px;">估價單</h3>
            </div>

            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 15px; line-height: 1.6;">
                <div style="width: 55%;">
                    <div style="font-size: 18px; border-bottom: 1px solid #000; padding-bottom: 5px; margin-bottom: 10px;">
                        <strong>客戶名稱：${escapeQuotes(clientName)}</strong> <span style="font-size: 14px; margin-left: 10px;">鈞鑒</span>
                    </div>
                    <div><strong>估價單號：</strong>${escapeQuotes(quoteNos)}</div>
                    <div><strong>估價日期：</strong>${quoteDate.replace(/-/g, '/')}</div>
                </div>
                <div style="width: 40%; text-align: right; font-size: 14px;">
                    <div><strong>統一編號：</strong>86477073</div>
                    <div><strong>公司地址：</strong>台中市西區中美街639號</div>
                    <div><strong>聯絡電話：</strong>(04) 2326-9591</div>
                    <div><strong>傳真號碼：</strong>(04) 2326-8576</div>
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 15px; border: 2px solid #000;">
                <thead>
                    <tr style="background-color: #f1f3f5;">
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; width: 60px; text-align: center;">項次</th>
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; text-align: center;">品名及規格</th>
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; width: 70px; text-align: center;">數量</th>
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; width: 70px; text-align: center;">單位</th>
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; width: 120px; text-align: center;">單價(含稅)</th>
                        <th style="border: 1px solid #000; border-bottom: 2px solid #000; padding: 10px; width: 130px; text-align: center;">總價(含稅)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="5" style="border: 1px solid #000; padding: 12px; text-align: right; font-weight: bold; letter-spacing: 2px;">總金額 (含稅)</td>
                        <td style="border: 1px solid #000; padding: 12px; text-align: right; font-weight: bold; font-size: 18px; color: #d32f2f;">$${totalAmount.toLocaleString()}</td>
                    </tr>
                </tfoot>
            </table>

            <div style="margin-top: 20px; font-size: 14px; border: 1px solid #000; padding: 15px; position: relative; min-height: 120px;">
                <div style="font-weight: bold; margin-bottom: 5px;">備註事項：</div>
                <div style="white-space: pre-wrap; line-height: 1.6;">${escapeQuotes(mainMemo) || '無'}</div>
                ${sealHtml}
            </div>

            <div style="margin-top: 60px; display: flex; justify-content: space-between; font-size: 16px; padding: 0 40px;">
                <div>客戶簽章：___________________</div>
                <div>業務經辦：&nbsp;${myName}</div>
            </div>
        </div>
    `;

    const printQuoteArea = document.getElementById('printQuoteArea');
    if (printQuoteArea) {
        printQuoteArea.innerHTML = html;
        
        // 【關鍵】估價單套用 A4 直式 (Portrait) 排版
        if (typeof applyPrintStyle === 'function') applyPrintStyle('A4', 'portrait');
        if (typeof showPrintPreview === 'function') showPrintPreview('printQuoteArea');
    } else {
        alert('系統錯誤：找不到估價單列印區塊');
    }
};
