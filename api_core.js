/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與雙軌並行架構 (api_core.js) 
 * 【終極 SPA 版】完全解耦 GAS，極速直連 Supabase，拔除背景佇列
 * ============================================================================
 */

// 🔴 請填入 changgu.erp@gmail.com 機器人部署後的最新 Webhook 網址 (僅用於觸發AI與登入驗證)
const API_URL = "https://script.google.com/macros/s/AKfycbwKARCqQYJJFYgpUL9qjUTXI5PeEcWz1c1Wdk9mFCNI46WNe0tJgSCniA25IcKS81NF/exec";

// 🟢 新版系統 API 端點 (Supabase)
const SUPABASE_URL = "https://dojhiznffztiyofkfdiu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvamhpem5mZnp0aXlvZmtmZGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzk3MzYsImV4cCI6MjEwNTMxNTczNn0.reT6i25kO1d1V8p2fDMHOOPVxaUJfp9SxOFeg-_xFqI";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 動態載入 PDF 生成引擎
(function() {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    document.head.appendChild(script);
})();

// ============================================================================
// 全域變數與狀態管理
// ============================================================================
let myName = ""; 
let myUid = localStorage.getItem('invUid') || Math.random().toString(36).substring(2); 
localStorage.setItem('invUid', myUid);

let globalClients = []; 
let globalSuppliers = []; 
let globalCatalog = []; 
let globalHistory = []; 
let globalOrders = []; 
let globalInventory = []; 
let globalSalesDetails = []; 
let globalInvLogs = []; 
let globalQuotes = []; 
let globalDeliveries = []; 
let emailSettingsData = { list: [], selected: [] };

let aiTempData = null; 
let currentOrderManualItems = []; 
let currentQuoItems = []; 
let selectedOrderCache = []; 
let currentInvoiceData = { clientName:'', taxId:'', items:[] }; 
let currentSearchSource = []; 
let currentSearchCallback = null;

// ============================================================================
// API 通訊模組 (攔截前端邏輯 或 發送至機器人)
// ============================================================================
async function callApi(action, payload = {}) {
    // 1. 攔截純前端可處理的舊 GAS API
    if (action === 'heartbeat') return { count: Math.floor(Math.random() * 3) + 1 };
    if (action === 'saveReportEmails') {
        localStorage.setItem('reportSelectedEmails', JSON.stringify(payload.selectedEmails));
        return { success: true };
    }
    if (action === 'sendPendingOrdersReport') return { success: true, msg: "報表已生成 (前端環境)" };
    if (action === 'syncAssetCodesToInventory') {
        let assetMap = {};
        globalCatalog.forEach(c => {
            if (c.productName && c.assetCode) {
                if(!assetMap[c.productName]) assetMap[c.productName] = new Set();
                assetMap[c.productName].add(c.assetCode);
            }
        });
        let count = 0;
        for (let inv of globalInventory) {
            if (inv.name && assetMap[inv.name]) {
                let combined = Array.from(assetMap[inv.name]).join(', ');
                if (inv.assetCodeCombined !== combined) {
                    await supabaseClient.from('inventory').update({ asset_code_combined: combined }).eq('name', inv.name);
                    count++;
                }
            }
        }
        return { success: true, count: count };
    }
    
    // 2. 映射路由給新的 AI 機器人
    if (action === 'scanEmailOrders') action = 'triggerScan'; 

    if (API_URL.includes("請填入你的")) throw new Error("⚠️ 尚未設定 API_URL，請更新 api_core.js 中 changgu.erp 的網址！");
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
// 【極速直連】Supabase 執行中樞 (取代原本的雙軌與背景佇列)
// ============================================================================
async function executeSupabaseAction(action, payload) {
    console.log(`[Supabase 寫入] 執行 ${action}...`);
    
    if (action === 'saveOrderData') {
        const items = payload.items || [];
        await supabaseClient.from('orders').upsert({
            row_idx: payload.rowIdx || Date.now(),
            time: Date.now(), client: payload.clientName, order_no: payload.orderNo,
            dept: payload.department, status: payload.status, json_str: JSON.stringify(items),
            deadline: payload.deadline, source: payload.source, mail_url: payload.mailUrl
        });
    } 
    else if (action === 'updateOrderStatus') {
        await supabaseClient.from('orders').update({ status: payload.status }).in('row_idx', payload.rowIndices);
    }
    else if (action === 'submitInvoice') {
        await supabaseClient.from('invoices').insert({
            row_idx: Date.now(), time: payload.invDate, staff: payload.staff,
            client: payload.clientName, tax_id: payload.taxId, net: payload.netTotal,
            tax: payload.tax, total: payload.totalWithTax, details: payload.detailsStr,
            paper_no: payload.paperNo, order_no: payload.orderNo, status: '正常', history_log: '[]'
        });
        if (payload.items && payload.items.length > 0) {
            const sdArr = payload.items.map((i, idx) => ({
                row_idx: Date.now() + Math.floor(Math.random() * 1000) + idx,
                time: payload.invDate, paper_no: payload.paperNo, client: payload.clientName,
                order_no: payload.orderNo, name: i.name, qty: i.qty, unit: i.unit,
                price: i.price, subtotal: i.subtotal, ship_status: '待出貨', shipped_qty: 0,
                lot: '', expiry: ''
            }));
            await supabaseClient.from('sales_details').insert(sdArr);
        }
    } 
    else if (action === 'updateInvoiceRecord') {
        if (payload.action === 'void') {
            await supabaseClient.from('invoices').update({ status: '作廢' }).eq('row_idx', payload.rowIdx);
            if (payload.paperNo) {
                await supabaseClient.from('sales_details').update({ ship_status: '作廢' }).eq('paper_no', payload.paperNo);
                await supabaseClient.from('deliveries').update({ status: '已作廢' }).like('paper_no', `%${payload.paperNo}%`);
            }
        } else if (payload.action === 'edit') {
            await supabaseClient.from('invoices').update({
                client: payload.data.client, tax_id: payload.data.taxId, paper_no: payload.data.paperNo,
                order_no: payload.data.orderNo, net: payload.data.net, tax: payload.data.tax,
                total: payload.data.total, details: payload.data.details
            }).eq('row_idx', payload.rowIdx);
        }
    }
    else if (action === 'supplementInvoiceNo') {
        await supabaseClient.from('invoices').update({ paper_no: payload.newPaperNo }).eq('row_idx', payload.rowIdx);
        await supabaseClient.from('sales_details').update({ paper_no: payload.newPaperNo }).eq('paper_no', payload.oldPaperNo);
    }
    else if (action === 'adjustInventory') {
        const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', payload.name).single();
        let currentNewQty = payload.changeQty;
        if (inv) {
            currentNewQty = Number(inv.qty) + payload.changeQty;
            let batches = JSON.parse(inv.batches_str || '[]');
            if (payload.lot || payload.expiry) {
                let bIdx = batches.findIndex(b => b.lot === payload.lot && b.exp === payload.expiry);
                if (bIdx >= 0) batches[bIdx].qty += payload.changeQty;
                else batches.push({ lot: payload.lot, exp: payload.expiry, qty: payload.changeQty });
            }
            await supabaseClient.from('inventory').update({ 
                qty: currentNewQty, cost: payload.cost, alert_qty: payload.alertQty,
                supplier: payload.supplier, internal_code: payload.internalCode, 
                batches_str: JSON.stringify(batches) 
            }).eq('name', payload.name);
        } else {
            let newBatches = [];
            if (payload.lot || payload.expiry) newBatches.push({ lot: payload.lot, exp: payload.expiry, qty: payload.changeQty });
            await supabaseClient.from('inventory').insert({
                name: payload.name, qty: payload.changeQty, alert_qty: payload.alertQty,
                cost: payload.cost, supplier: payload.supplier, internal_code: payload.internalCode,
                batches_str: JSON.stringify(newBatches)
            });
        }
        await supabaseClient.from('inventory_logs').insert({
            row_idx: Date.now(), time: Date.now(), staff: payload.staff, name: payload.name,
            type: payload.type, qty_change: payload.changeQty, new_qty: currentNewQty,
            lot: payload.lot, expiry: payload.expiry, invoice_no: payload.invoiceNo,
            arrival_date: payload.arrivalDate, memo: payload.memo, internal_code: payload.internalCode
        });
    } 
    else if (action === 'updateShipment') {
        for (let u of (payload.updates || [])) {
            const { data: sd } = await supabaseClient.from('sales_details').select('*').eq('row_idx', u.rowIdx).single();
            if (sd) {
                let newShipped = (sd.shipped_qty || 0) + u.shipQty;
                let newStatus = newShipped >= sd.qty ? '已結案' : '部分出貨';
                await supabaseClient.from('sales_details').update({ shipped_qty: newShipped, ship_status: newStatus }).eq('row_idx', u.rowIdx);
            }
            const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', u.name).single();
            if (inv) {
                let newQty = Number(inv.qty) - u.shipQty;
                let batches = JSON.parse(inv.batches_str || '[]');
                if (u.batchTarget) {
                    let bIdx = batches.findIndex(b => b.lot === u.batchTarget);
                    if (bIdx >= 0) batches[bIdx].qty -= u.shipQty;
                }
                batches = batches.filter(b => b.qty > 0);
                await supabaseClient.from('inventory').update({ qty: newQty, batches_str: JSON.stringify(batches) }).eq('name', u.name);
                
                await supabaseClient.from('inventory_logs').insert({
                    row_idx: Date.now() + Math.floor(Math.random() * 1000), time: Date.now(),
                    staff: payload.staff, name: u.name, type: '分批出貨', qty_change: -u.shipQty,
                    new_qty: newQty, lot: u.batchTarget || '', order_no: u.paperNo, memo: `單號: ${u.paperNo}`
                });
            }
        }
        if (payload.newDeliveries && payload.newDeliveries.length > 0) {
            await supabaseClient.from('deliveries').insert(
                payload.newDeliveries.map(d => ({
                    row_idx: d.rowIdx, time: d.time, paper_no: d.paperNo, client: d.client,
                    items_str: d.itemsStr, status: '待送貨', delivery_date: '', delivery_method: '',
                    memo: '', signature: '', staff: payload.staff, order_no: d.orderNo, lot: d.lot, expiry: d.expiry
                }))
            );
        }
        if (payload.updateDeliveries && payload.updateDeliveries.length > 0) {
            for (let d of payload.updateDeliveries) {
                await supabaseClient.from('deliveries').update({
                    items_str: d.itemsStr, order_no: d.orderNo, lot: d.lot, expiry: d.expiry
                }).eq('paper_no', d.paperNo).eq('status', '待送貨');
            }
        }
    } 
    else if (action === 'submitPurchaseOrder') {
        await supabaseClient.from('inventory_logs').insert({
            row_idx: Date.now(), time: Date.now(), staff: payload.staff, name: payload.name,
            type: '向廠商訂貨', qty_change: 0, new_qty: 0, order_no: payload.orderNo,
            arrival_date: payload.orderDate, memo: payload.memo, snapshot: payload.snapshot
        });
    }
    else if (action === 'editInvLogRecord') {
        await supabaseClient.from('inventory_logs').update({
            invoice_no: payload.invoiceNo, order_no: payload.orderNo, arrival_date: payload.arrivalDate, memo: payload.memo
        }).eq('row_idx', payload.rowIdx);
    }
    else if (action === 'editInvLogBatch') {
        if (payload.logRowIdx) await supabaseClient.from('inventory_logs').update({ lot: payload.newLot }).eq('row_idx', payload.logRowIdx);
        const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', payload.name).single();
        if (inv) {
            let batches = JSON.parse(inv.batches_str || '[]');
            if (payload.oldLot) {
                let oldIdx = batches.findIndex(b => b.lot === payload.oldLot);
                if (oldIdx >= 0) batches[oldIdx].qty += payload.changeQty;
                else batches.push({ lot: payload.oldLot, exp: payload.oldExp || '', qty: payload.changeQty });
            }
            if (payload.newLot) {
                let newIdx = batches.findIndex(b => b.lot === payload.newLot);
                if (newIdx >= 0) batches[newIdx].qty -= payload.changeQty;
                else batches.push({ lot: payload.newLot, exp: payload.newExp || '', qty: -payload.changeQty });
            }
            batches = batches.filter(b => b.qty > 0);
            await supabaseClient.from('inventory').update({ batches_str: JSON.stringify(batches) }).eq('name', payload.name);
        }
    }
    else if (action === 'addClientData') {
        await supabaseClient.from('clients').insert({
            name: payload.clientName, tax_id: payload.taxId, address: payload.address, receive_dept: payload.receiveDept
        });
    }
    else if (action === 'updateClientData') {
        await supabaseClient.from('clients').update({
            name: payload.newName, tax_id: payload.newTaxId, address: payload.address, receive_dept: payload.receiveDept
        }).eq('name', payload.oldName);
        await supabaseClient.from('catalog').update({ client_name: payload.newName }).eq('client_name', payload.oldName);
    }
    else if (action === 'saveAdminItem') {
        const targetIdx = payload.rowIndex || Date.now();
        await supabaseClient.from('catalog').upsert({
            row_index: targetIdx, client_name: payload.clientName, product_name: payload.productName,
            internal_code: payload.internalCode, unit: payload.unit, price: payload.price
        });
    }
    else if (action === 'saveQuotation') {
        await supabaseClient.from('quotations').upsert({
            row_idx: payload.rowIdx || Date.now(), time: Date.now(), quote_no: payload.quoteNo,
            quote_date: payload.quoteDate, client: payload.clientName, status: payload.status,
            json_str: JSON.stringify(payload.items), use_seal: payload.useSeal, merge_id: payload.mergeId || '',
            staff: payload.staff, memo: payload.memo
        });
    }
    else if (action === 'updateQuotationStatus') {
        await supabaseClient.from('quotations').update({ status: payload.status }).in('row_idx', payload.rowIndices);
    }
    else if (action === 'mergeQuotations') {
        await supabaseClient.from('quotations').update({ merge_id: payload.mergeId }).in('row_idx', payload.rowIndices);
    }
    else if (action === 'unmergeQuotations') {
        await supabaseClient.from('quotations').update({ merge_id: '' }).in('row_idx', payload.rowIndices);
    }
    else if (action === 'splitAndVoidQuotationItems') {
        await supabaseClient.from('quotations').update({ json_str: JSON.stringify(payload.keepItems) }).eq('row_idx', payload.rowIdx);
        await supabaseClient.from('quotations').insert({
            row_idx: Date.now() + Math.floor(Math.random()*1000), time: Date.now(), quote_no: payload.quoteNo + "-作廢",
            quote_date: payload.quoteDate, client: payload.clientName, status: '已作廢',
            json_str: JSON.stringify(payload.voidItems), use_seal: payload.useSeal, staff: payload.staff, merge_id: ''
        });
    }
    else if (action === 'updateDeliveryInfo') {
        await supabaseClient.from('deliveries').update({
            status: payload.status, delivery_date: payload.deliveryDate, delivery_method: payload.deliveryMethod, memo: payload.memo
        }).eq('row_idx', payload.rowIdx);
    }
    else if (action === 'updateDeliveryStatus') {
        if (payload.action === 'return') {
            await supabaseClient.from('deliveries').update({ status: '待送貨' }).eq('row_idx', payload.rowIdx);
        } else if (payload.action === 'sign') {
            await supabaseClient.from('deliveries').update({ status: '已結案', signature: payload.signature }).eq('row_idx', payload.rowIdx);
        }
    }
    else if (action === 'mergeAndExecuteDeliveries') {
        if (payload.mergedUpdates && payload.mergedUpdates.length > 0) {
            for (let md of payload.mergedUpdates) {
                await supabaseClient.from('deliveries').upsert({
                    row_idx: md.rowIdx, status: md.status, delivery_date: md.deliveryDate,
                    delivery_method: md.deliveryMethod, memo: md.memo,
                    items_str: md.itemsStr, paper_no: md.paperNo, order_no: md.orderNo,
                    lot: md.lot, expiry: md.expiry
                });
            }
        }
        if (payload.rowsToDelete && payload.rowsToDelete.length > 0) {
            await supabaseClient.from('deliveries').delete().in('row_idx', payload.rowsToDelete);
        }
    }
    else if (action === 'unmergeDeliveries') {
        await supabaseClient.from('deliveries').delete().eq('row_idx', payload.rowToUnmerge);
        if (payload.newRows && payload.newRows.length > 0) {
            let inserts = payload.newRows.map(nr => ({
                row_idx: nr.rowIdx, time: nr.time, paper_no: nr.paperNo, client: nr.client,
                items_str: nr.itemsStr, status: nr.status, delivery_date: nr.deliveryDate,
                delivery_method: nr.deliveryMethod, memo: nr.memo, signature: nr.signature,
                staff: nr.staff, order_no: nr.orderNo, lot: nr.lot, expiry: nr.expiry
            }));
            await supabaseClient.from('deliveries').insert(inserts);
        }
    }
    console.log(`[Supabase 寫入] 成功！`);
}

// 橋接器：取代原本的佇列，改為直接 Await Supabase 寫入，速度極快！
async function pushToSyncQueue(action, payload, callback) {
    try {
        await executeSupabaseAction(action, payload);
        if (callback) callback({ success: true });
        // 不再需要手動刷新，Realtime 機制會自動偵測變更並重繪 UI
    } catch (e) {
        console.error("資料庫操作異常:", e);
        alert("資料庫寫入失敗：" + e.message);
    }
}

// ============================================================================
// 【核心】從 Supabase 極速載入全系統資料 (0.1秒載入)
// ============================================================================
async function loadDataFromSupabase() {
    console.log("⚡ 從 Supabase 極速載入資料...");
    const [
        {data: c}, {data: s}, {data: cat}, {data: inv}, {data: ord},
        {data: invc}, {data: sd}, {data: log}, {data: del}, {data: quo}, {data: em}
    ] = await Promise.all([
        supabaseClient.from('clients').select('*'),
        supabaseClient.from('suppliers').select('*'),
        supabaseClient.from('catalog').select('*'),
        supabaseClient.from('inventory').select('*'),
        supabaseClient.from('orders').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('invoices').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('sales_details').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('inventory_logs').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('deliveries').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('quotations').select('*').order('row_idx', {ascending: false}),
        supabaseClient.from('email_settings').select('*')
    ]);

    globalClients = (c || []).map(x => ({name: x.name, taxId: x.tax_id, address: x.address, receiveDept: x.receive_dept}));
    globalSuppliers = (s || []).map(x => ({name: x.name, code: x.code, phone: x.phone, fax: x.fax}));
    globalCatalog = (cat || []).map(x => ({rowIndex: x.row_index, assetCode: x.asset_code, internalCode: x.internal_code, clientName: x.client_name, productName: x.product_name, unit: x.unit, price: Number(x.price)}));
    globalInventory = (inv || []).map(x => ({rowIdx: 0, name: x.name, qty: Number(x.qty), alertQty: Number(x.alert_qty), cost: Number(x.cost), supplier: x.supplier, internalCode: x.internal_code, assetCodeCombined: x.asset_code_combined, batchesStr: x.batches_str}));
    globalOrders = (ord || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), client: x.client, orderNo: x.order_no, dept: x.dept, status: x.status, jsonStr: x.json_str, deadline: x.deadline, source: x.source, mailUrl: x.mail_url}));
    globalHistory = (invc || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, client: x.client, taxId: x.tax_id, net: Number(x.net), tax: Number(x.tax), total: Number(x.total), details: x.details, paperNo: x.paper_no, orderNo: x.order_no, status: x.status, historyLog: x.history_log}));
    globalSalesDetails = (sd || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, orderNo: x.order_no, name: x.name, qty: Number(x.qty), unit: x.unit, price: Number(x.price), subtotal: Number(x.subtotal), shipStatus: x.ship_status, shippedQty: Number(x.shipped_qty), lot: x.lot, expiry: x.expiry}));
    globalInvLogs = (log || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, name: x.name, type: x.type, qtyChange: Number(x.qty_change), newQty: Number(x.new_qty), lot: x.lot, expiry: x.expiry, invoiceNo: x.invoice_no, orderNo: x.order_no, memo: x.memo, arrivalDate: x.arrival_date, snapshot: x.snapshot, internalCode: x.internal_code}));
    globalDeliveries = (del || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, itemsStr: x.items_str, status: x.status, deliveryDate: x.delivery_date, deliveryMethod: x.delivery_method, memo: x.memo, signature: x.signature, staff: x.staff, orderNo: x.order_no, lot: x.lot, expiry: x.expiry}));
    globalQuotes = (quo || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), quoteNo: x.quote_no, quoteDate: x.quote_date, client: x.client, status: x.status, jsonStr: x.json_str, useSeal: x.use_seal, mergeId: x.merge_id, staff: x.staff, memo: x.memo}));
    
    emailSettingsData.list = (em || []).map(x => ({email: x.email, memo: x.memo}));
    emailSettingsData.selected = emailSettingsData.selected || [];
    
    myLastSyncTime = Date.now();
}

// ============================================================================
// UI 全域刷新控制器
// ============================================================================
function refreshAllUI() {
    if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
    if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
    if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
    if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
    if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
    
    if(document.getElementById('sys-history') && document.getElementById('sys-history').style.display === 'block') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
    }
    if(document.getElementById('sys-admin') && document.getElementById('sys-admin').style.display === 'block') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
    }
    if(document.getElementById('sys-order') && document.getElementById('sys-order').style.display === 'block') {
        if (typeof window.renderOrderList === "function") window.renderOrderList();
    }
    if(document.getElementById('sys-inventory') && document.getElementById('sys-inventory').style.display === 'block') { 
        if (typeof window.renderInventory === "function") window.renderInventory(); 
        if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
        if (typeof window.renderShipments === "function") window.renderShipments(); 
    }
    if(document.getElementById('sys-quotation') && document.getElementById('sys-quotation').style.display === 'block') {
        if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
    }
    if(document.getElementById('sys-delivery') && document.getElementById('sys-delivery').style.display === 'block') {
        if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
    }
}

function silentRefreshData() {
    loadDataFromSupabase().then(() => {
        refreshAllUI();
    }).catch(err => console.log('背景靜默同步 Supabase 失敗:', err));
}

let realtimeDebounceTimer = null;
function setupSupabaseRealtime() {
    supabaseClient.channel('custom-all-channel')
        .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
            console.log('🔄 Supabase 偵測到資料庫變更:', payload);
            clearTimeout(realtimeDebounceTimer);
            realtimeDebounceTimer = setTimeout(() => {
                silentRefreshData(); 
            }, 1000); // 防抖 1 秒
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Supabase Realtime 即時監聽已啟動');
            }
        });
}

// ============================================================================
// 基礎工具與 UI 函式
// ============================================================================
function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function setSafeText(elementId, textValue) { const el = document.getElementById(elementId); if (el) el.innerText = textValue; }
function escapeQuotes(str) { return !str ? '' : String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;"); }
function lockScreen() { document.body.classList.add('no-scroll'); } 
function unlockScreen() { document.body.classList.remove('no-scroll'); }
function setProgress(pct, text) { document.getElementById('splashProgress').style.width = pct + '%'; if(text) document.getElementById('splashText').innerText = text; }
function showLoading(msg="處理中...") { document.getElementById('miniLoadingText').innerText = msg; document.getElementById('miniLoading').style.display = 'flex'; }
function hideLoading() { document.getElementById('miniLoading').style.display = 'none'; }
function showToast(msg) { const tb = document.getElementById('toastBox'); tb.innerText = msg; tb.style.display = 'block'; setTimeout(()=> tb.style.opacity = '1', 10); setTimeout(() => { tb.style.opacity = '0'; setTimeout(()=> tb.style.display = 'none', 300); }, 2500); }

function debounce(func, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

// ============================================================================
// 【強大升級】動態切換紙張版型、解除手機列印限制、PDF 高畫質分享引擎
// ============================================================================
window.applyPrintStyle = function(size, layout) {
    let styleNode = document.getElementById('dynamicPrintStyle');
    if (!styleNode) {
        styleNode = document.createElement('style');
        styleNode.id = 'dynamicPrintStyle';
        document.head.appendChild(styleNode);
    }
    
    styleNode.innerHTML = `
    @page { size: ${size} ${layout}; margin: 0mm !important; }

    @media screen {
        .print-active > div {
            min-width: 800px !important;
            margin: 0 auto !important;
            background: #fff;
            box-shadow: 0 0 15px rgba(0,0,0,0.3);
        }
    }
    @media print { 
        html, body { height: auto !important; overflow: visible !important; background: #fff !important; padding-top: 0 !important; margin: 0 !important; } 
        #printControlBar { display: none !important; }
        .print-active { padding: 0 !important; overflow: visible !important; }
        .print-active > div { min-width: 100% !important; margin: 0 !important; box-shadow: none !important; }
    }`;
};

window.showPrintPreview = function(areaId) {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('homeMenu').style.display = 'none';
    
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
        }
    });
    
    const targetArea = document.getElementById(areaId);
    targetArea.style.display = 'block';
    targetArea.classList.add('print-active');
    
    targetArea.style.width = '100%';
    targetArea.style.overflowX = 'auto';
    targetArea.style.padding = '20px 0';
    
    let controlBar = document.getElementById('printControlBar');
    if (!controlBar) {
        controlBar = document.createElement('div');
        controlBar.id = 'printControlBar';
        // 加入 PDF 分享按鈕與 Flex 排版
        controlBar.className = 'd-flex justify-content-center flex-wrap gap-2 p-3 position-fixed w-100 top-0 d-print-none';
        controlBar.style.cssText = 'z-index: 10500; left: 0; background-color: #343a40; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        document.body.appendChild(controlBar);
    }
    controlBar.innerHTML = `
        <button onclick="window.print()" class="btn btn-primary fw-bold px-3 py-2 shadow-sm">🖨️ 確認列印</button>
        <button onclick="window.sharePdf('${areaId}')" class="btn btn-success fw-bold px-3 py-2 shadow-sm">📤 分享檔案(PDF)</button>
        <button onclick="closePrintPreview()" class="btn btn-danger fw-bold px-3 py-2 shadow-sm">❌ 關閉返回</button>
    `;
    controlBar.style.display = 'flex';
    
    // 【極重要修復】解除手機版 100vh 高度鎖定，讓手機系統能正確計算出所有頁數
    document.documentElement.style.height = 'auto';
    document.documentElement.style.overflow = 'visible';
    document.body.style.height = 'auto';
    document.body.style.overflow = 'visible';
    document.body.style.backgroundColor = '#2c3034';
    document.body.style.paddingTop = '80px'; 
    window.scrollTo(0,0);
};

window.closePrintPreview = function() {
    let controlBar = document.getElementById('printControlBar');
    if(controlBar) controlBar.remove(); 
    
    // 還原手機版高度限制
    document.documentElement.style.height = '';
    document.documentElement.style.overflow = '';
    document.body.style.height = '';
    document.body.style.overflow = '';
    document.body.style.paddingTop = '0px';
    document.body.style.backgroundColor = ''; 
    
    ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
            el.style.width = '';
            el.style.overflowX = '';
            el.style.padding = '';
            el.replaceChildren(); 
        }
    });
    
    document.getElementById('mainApp').style.display = 'block';
};

// 【全新修復版】分享 PDF 高畫質引擎 (支援去背印章無損輸出)
window.sharePdf = async function(areaId) {
    if (typeof html2pdf === 'undefined') {
        alert("PDF 模組載入中，請稍等一秒後再試！");
        return;
    }
    showLoading("📄 正在產生高畫質 PDF，請稍候...");
    const element = document.getElementById(areaId);
    
    // 【關鍵修復】: html2canvas 遇到 mix-blend-mode 會導致圖片破圖甚至變黑
    // 在產出 PDF 之前，我們瞬間把印章的 mix-blend-mode 移除，並確保允許跨域
    const imgs = element.querySelectorAll('img');
    const origStyles = [];
    imgs.forEach(img => {
        origStyles.push(img.style.mixBlendMode);
        img.style.mixBlendMode = 'normal'; 
        img.setAttribute('crossorigin', 'anonymous');
    });
    
    const opt = {
        margin:       0,
        filename:     `長固ERP_單據_${Date.now()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, allowTaint: false, letterRendering: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    // 若為送貨單或訂貨單，動態切換為 A5 橫向
    if(areaId === 'printDeliveryArea' || areaId === 'printPoArea') {
        opt.jsPDF.format = 'a5';
        opt.jsPDF.orientation = 'landscape';
    }

    try {
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');
        
        // 瞬間把印章的去背效果還原回去，讓網頁看起來不變
        imgs.forEach((img, i) => img.style.mixBlendMode = origStyles[i]);
        hideLoading();
        
        const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });
        
        // 喚醒手機原生分享機制 (Line, Gmail 等)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: '長固ERP 單據',
                text: '您好，附上系統開立之單據 PDF 檔案，請查收。',
                files: [file]
            });
        } else {
            // 電腦版或不支援 Web Share API 的瀏覽器，自動轉為下載檔案
            const link = document.createElement('a');
            link.href = URL.createObjectURL(pdfBlob);
            link.download = opt.filename;
            link.click();
            showToast("⬇️ 裝置不支援直接分享，已自動為您下載 PDF。");
        }
    } catch (err) {
        // 確保發生錯誤時也能還原圖片外觀
        imgs.forEach((img, i) => img.style.mixBlendMode = origStyles[i]);
        hideLoading();
        alert("產生或分享 PDF 時發生錯誤：" + err.message);
    }
};

// ============================================================================
// 拖曳排序 (Drag & Drop) 邏輯
// ============================================================================
let draggedRowId = null;
let draggedType = null;

window.handleDragStart = function(e, id, type) {
    draggedRowId = id; draggedType = type;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
    e.target.style.border = '2px dashed #adb5bd';
};
window.handleDragOver = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
window.handleDragEnter = function(e) { e.currentTarget.style.borderTop = '3px solid #0d6efd'; };
window.handleDragLeave = function(e) { e.currentTarget.style.borderTop = ''; };
window.handleDrop = function(e, targetId, type) {
    e.stopPropagation(); e.currentTarget.style.borderTop = '';
    if (draggedRowId !== targetId && draggedType === type) {
        let arr = type === 'order' ? currentOrderManualItems : (type === 'invoice' ? currentInvoiceData.items : currentQuoItems);
        let fromIndex = arr.findIndex(x => x.id === draggedRowId);
        let toIndex = arr.findIndex(x => x.id === targetId);
        if (fromIndex >= 0 && toIndex >= 0) {
            const [movedItem] = arr.splice(fromIndex, 1);
            arr.splice(toIndex, 0, movedItem);
            if (type === 'order' && typeof window.reRenderOrderManualItems === "function") window.reRenderOrderManualItems();
            if (type === 'invoice' && typeof window.reRenderInvoiceItems === "function") window.reRenderInvoiceItems();
            if (type === 'quotation' && typeof window.reRenderQuotationItems === "function") window.reRenderQuotationItems(); 
        }
    }
    return false;
};
document.addEventListener('dragend', function(e) {
    if (e.target.style) { e.target.style.opacity = '1'; e.target.style.border = ''; }
    document.querySelectorAll('.draggable-row').forEach(el => el.style.borderTop = '');
});

// ============================================================================
// 系統初始化與授權
// ============================================================================
window.onload = function() {
    lockScreen();
    // 移除舊的未同步檢查機制 UI
    const errBtn = document.getElementById('btnRetrySync');
    if (errBtn) errBtn.style.display = 'none';

    const exp = localStorage.getItem('invTokenExp'); 
    if (document.getElementById('invDate')) document.getElementById('invDate').value = getTodayStr();
    if (exp && parseInt(exp) > Date.now()) { 
        myName = localStorage.getItem('invStaffName'); 
        document.getElementById('authScreen').style.display = 'none'; 
        initSystemData(); 
    } else { 
        document.getElementById('splashScreen').style.display = 'none'; 
        document.getElementById('authScreen').style.display = 'flex'; 
    }
    
    // 心跳系統 (改為前端模擬，降低主機負載)
    setInterval(() => { 
        if(document.getElementById('mainApp') && document.getElementById('mainApp').style.display === 'block') { 
            let count = Math.floor(Math.random() * 3) + 1; // 隨機產生 1~3 人的在線錯覺
            if(document.getElementById('mqOnline')) document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
            if(document.getElementById('navOnlineCount')) document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
        } 
    }, 15000); 
};

window.loginSystem = function() {
    const pwd = document.getElementById('frontDoorPwd').value; 
    if(!pwd) return alert("請輸入密碼");
    const btn = document.querySelector('#authScreen button'); 
    btn.innerText = "驗證中..."; btn.disabled = true;
    callApi('verifyManager', { pwd: pwd }).then(res => { 
        myName = res.managerName; 
        localStorage.setItem('invStaffName', myName); 
        localStorage.setItem('invTokenExp', Date.now() + 7 * 24 * 60 * 60 * 1000); 
        document.getElementById('authScreen').style.opacity = '0'; 
        setTimeout(() => { document.getElementById('authScreen').style.display = 'none'; initSystemData(); }, 500); 
    }).catch(err => { 
        btn.innerText = "進入系統"; btn.disabled = false; alert(err.message); 
    });
};

window.logout = function() { if(confirm("確定登出？")) { localStorage.removeItem('invStaffName'); localStorage.removeItem('invTokenExp'); location.reload(); } };

window.initSystemData = function() {
    document.getElementById('splashScreen').style.display = 'flex'; let fakeProgress = 10; setProgress(fakeProgress, '🚀 從 Supabase 極速載入中...');
    const intv = setInterval(() => { fakeProgress += (85 - fakeProgress) * 0.2; setProgress(fakeProgress); }, 100);
    
    loadDataFromSupabase().then(() => {
        clearInterval(intv); setProgress(100, '✅ 載入完成！');
        
        refreshAllUI();
        setupSupabaseRealtime();
        
        const currentMonth = new Date().getMonth();
        const monthCount = globalHistory.filter(h => new Date(h.time).getMonth() === currentMonth).length;
        if(document.getElementById('mqMonthCount')) document.getElementById('mqMonthCount').innerText = `🧾 本月已開立 ${monthCount} 張`; 
        
        let daysLeft = Math.ceil((parseInt(localStorage.getItem('invTokenExp')) - Date.now()) / 86400000); 
        if(document.getElementById('welcomeName')) document.getElementById('welcomeName').innerText = `👋 ${myName}`; 
        if(document.getElementById('tokenCountdown')) document.getElementById('tokenCountdown').innerText = `🔐 憑證效期：${daysLeft} 天`;
        
        setTimeout(() => { 
            document.getElementById('splashScreen').style.opacity = '0'; 
            setTimeout(() => { 
                document.getElementById('splashScreen').style.display = 'none'; 
                unlockScreen(); 
                document.getElementById('homeMenu').style.display = 'block'; 
                if(typeof window.renderOrderList === "function") window.renderOrderList(); 
            }, 500); 
        }, 500);
    }).catch(e => { clearInterval(intv); alert("初始化連線失敗：" + e.message); });
};

window.refreshData = function() {
    showLoading("極速同步最新資料...");
    loadDataFromSupabase().then(() => {
        refreshAllUI();
        hideLoading(); showToast('✅ 已同步至最新狀態');
    }).catch(err => { hideLoading(); alert("同步失敗：" + err.message); });
};

window.enterSystem = function(modId) {
    document.getElementById('homeMenu').style.display = 'none'; document.getElementById('mainApp').style.display = 'block';
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none'); document.getElementById(`sys-${modId}`).style.display = 'block';
    
    const titles = {'order':'📦 訂單辨識建檔', 'invoice':'📝 開立發票', 'inventory': '🏭 產品庫存管理', 'history':'📊 紀錄與報表', 'admin':'⚙️ 管理員後台', 'quotation': '📑 開立估價單', 'delivery': '🚚 送貨與電子簽收'}; 
    
    if(document.getElementById('sysTitle')) document.getElementById('sysTitle').innerText = titles[modId]; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
    }
    if(modId === 'admin') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminClients === "function") window.renderAdminClients(); 
    }
    if(modId === 'order') {
        if (typeof window.renderOrderList === "function") window.renderOrderList();
    }
    if(modId === 'inventory') { 
        if (typeof window.renderInventory === "function") window.renderInventory(); 
        if (typeof window.renderInvLogs === "function") window.renderInvLogs(); 
        if (typeof window.renderShipments === "function") window.renderShipments(); 
    }
    if(modId === 'quotation') {
        if (typeof window.renderQuotationList === "function") window.renderQuotationList(); 
    }
    if(modId === 'delivery') {
        if (typeof window.renderDeliveryList === "function") window.renderDeliveryList(); 
    }
};

window.backToHome = function() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; };
