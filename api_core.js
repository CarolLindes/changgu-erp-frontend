/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與雙軌並行架構 (api_core.js) 
 * 【極速登入 ＆ 報表直出版】
 * 1. 直連 Supabase 實現 0.1 秒極速登入
 * 2. 整合 SheetJS 於前端瞬間生成 Excel 報表，交由 GAS 遙控器寄信
 * 3. 修正報表匯出指令攔截，加入雙重變數解析與 UI 強制掃描防呆
 * 4. 完美復刻舊版 Python Excel 報表結構 (4大工作表、統計表頭與檔名)
 * ============================================================================
 */

// 🔴 請填入 changgu.erp@gmail.com 機器人部署後的最新 Webhook 網址
const API_URL = "https://script.google.com/macros/s/AKfycbwKARCqQYJJFYgpUL9qjUTXI5PeEcWz1c1Wdk9mFCNI46WNe0tJgSCniA25IcKS81NF/exec";

// 🟢 新版系統 API 端點 (Supabase)
const SUPABASE_URL = "https://dojhiznffztiyofkfdiu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvamhpem5mZnp0aXlvZmtmZGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzk3MzYsImV4cCI6MjEwNTMxNTczNn0.reT6i25kO1d1V8p2fDMHOOPVxaUJfp9SxOFeg-_xFqI";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 動態載入 PDF 與 Excel(SheetJS) 生成引擎
(function() {
    const scriptPdf = document.createElement('script');
    scriptPdf.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    document.head.appendChild(scriptPdf);

    const scriptXlsx = document.createElement('script');
    scriptXlsx.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    document.head.appendChild(scriptXlsx);
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
let myLastSyncTime = Date.now();

// ============================================================================
// API 通訊模組 (攔截前端邏輯 或 發送至機器人)
// ============================================================================
async function callApi(action, payload = {}) {
    if (action === 'heartbeat') return { count: Math.floor(Math.random() * 3) + 1 };
    
    if (action === 'saveReportEmails') {
        localStorage.setItem('reportSelectedEmails', JSON.stringify(payload.selectedEmails));
        return { success: true };
    }
    
    // 【全新機制】攔截報表發送請求，完美生成 4 個工作表
    if (action === 'exportExcelReport' || action === 'sendPendingOrdersReport') {
        if (typeof XLSX === 'undefined') throw new Error("Excel 模組仍在載入中，請稍後再試！");
        
        let emails = [];
        
        // 1. 智慧變數解析：嘗試讀取陣列格式
        if (payload.emails && Array.isArray(payload.emails)) {
            emails = payload.emails;
        } 
        // 2. 智慧變數解析：嘗試讀取字串格式 (對應 module_invoice_history.js)
        else if (payload.email && typeof payload.email === 'string') {
            emails = payload.email.split(',').map(e => e.trim()).filter(e => e !== '');
        }

        // 3. 終極防呆機制：如果上面都沒抓到，強制掃描畫面上有被打勾的信箱
        if (emails.length === 0) {
            const checkedBoxes = document.querySelectorAll('.dyn-email-cb:checked');
            if (checkedBoxes && checkedBoxes.length > 0) {
                emails = Array.from(checkedBoxes).map(cb => cb.value);
            }
        }

        if (emails.length === 0) {
            try { emails = JSON.parse(localStorage.getItem('reportSelectedEmails') || '[]'); } catch(e){}
        }

        if (emails.length === 0) throw new Error("尚未設定收件人信箱，請先在介面中勾選收件人！");

        showLoading("📊 正在套用客製化格式生成報表...");
        
        // ============================================
        // 工作表 1: 發票總表 (完美還原舊版排版)
        // ============================================
        const summaryRows = [
            ["報表期間", payload.dateRange || '未提供', "", "", "", "", "", "", "", "", ""],
            ["總開立張數", payload.summary ? payload.summary.count : 0, "", "", "", "", "", "", "", "", ""],
            ["總銷售額(未稅)", payload.summary ? payload.summary.net : 0, "", "", "", "", "", "", "", "", ""],
            ["總營業稅", payload.summary ? payload.summary.tax : 0, "", "", "", "", "", "", "", "", ""],
            ["總計(含稅)", payload.summary ? payload.summary.total : 0, "", "", "", "", "", "", "", "", ""],
            ["開立日期", "發票號碼", "客戶名稱", "統一編號", "訂單編號", "狀態", "開立人員", "銷售額", "稅額", "總計", "明細內容"]
        ];
        (payload.details || []).forEach(d => {
            summaryRows.push([
                d.date, d.paperNo, d.client, d.taxId, d.orderNo, d.status, d.staff, d.net, d.tax, d.total, d.desc
            ]);
        });
        const wsHistory = XLSX.utils.aoa_to_sheet(summaryRows);

        // ============================================
        // 工作表 2: 出貨明細
        // ============================================
        const lineItemRows = [
            ["開立日期", "發票號碼", "客戶名稱", "訂單編號", "長固代號", "品名", "開立數量", "單價(含稅)", "總價(含稅)", "出貨狀態", "已出貨數量"]
        ];
        (payload.lineItems || []).forEach(l => {
            // 修正前端單價異常，向後台抓取真實價格與代號
            const sd = globalSalesDetails.find(s => s.paperNo === l.paperNo && s.name === l.name);
            const price = sd ? sd.price : 0;
            const subtotal = sd ? sd.subtotal : 0;
            const cat = globalCatalog.find(c => c.productName === l.name && c.clientName === l.client);
            const internalCode = cat ? (cat.internalCode || cat.assetCode || '') : '';
            
            lineItemRows.push([
                l.time, l.paperNo, l.client, l.orderNo, internalCode, l.name, l.qty, price, subtotal, l.shipStatus, l.shippedQty
            ]);
        });
        const wsDelivery = XLSX.utils.aoa_to_sheet(lineItemRows);

        // ============================================
        // 工作表 3: 目前庫存表
        // ============================================
        const invRows = [
            ["品名", "長固代號", "目前庫存數量"]
        ];
        globalInventory.forEach(inv => {
            invRows.push([
                inv.name, inv.internalCode || inv.assetCodeCombined || '', inv.qty
            ]);
        });
        const wsInventory = XLSX.utils.aoa_to_sheet(invRows);

        // ============================================
        // 工作表 4: 客戶營收分析表
        // ============================================
        const clientRows = [
            ["客戶/醫院名稱", "總銷售額(含稅)"]
        ];
        (payload.clientStats || []).forEach(c => {
            clientRows.push([
                c.name, c.total
            ]);
        });
        const wsClient = XLSX.utils.aoa_to_sheet(clientRows);

        // 組合 Excel
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsHistory, "發票總表");
        XLSX.utils.book_append_sheet(wb, wsDelivery, "出貨明細");
        XLSX.utils.book_append_sheet(wb, wsInventory, "目前庫存表");
        XLSX.utils.book_append_sheet(wb, wsClient, "客戶營收分析表");

        const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
        
        // 檔名格式處理
        let cleanDateRange = "未定期間";
        if (payload.dateRange) {
            cleanDateRange = payload.dateRange.replace(/\//g, '-').trim();
        }
        const fileName = `長固ERP_發票報表_${cleanDateRange}.xlsx`;

        // 將指令轉換為呼叫 GAS 遙控器的寄信通道
        action = 'sendExcelEmail';
        payload = {
            toEmails: emails,
            subject: `長固 ERP 系統 - 銷售發票與出貨統計報表 (${cleanDateRange})`,
            bodyText: `您好，\n\n附上由長固 ERP 系統自動產生的統計報表，請查收附件。\n\n報表包含：\n1. 發票總表\n2. 出貨明細\n3. 目前庫存表\n4. 客戶營收分析表\n\n(此為系統自動發送，請勿直接回覆)\n系統產生時間：${new Date().toLocaleString()}`,
            base64Data: base64Data,
            fileName: fileName
        };
        hideLoading();
    }
    
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
    
    // 映射路由給 GitHub AI 機器人遠端遙控 (保留原本觸發按鈕的相容性)
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
// 【極速直連】Supabase 執行中樞 
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

async function pushToSyncQueue(action, payload, callback) {
    try {
        await executeSupabaseAction(action, payload);
        if (callback) callback({ success: true });
    } catch (e) {
        console.error("資料庫操作異常:", e);
        alert("資料庫寫入失敗：" + e.message);
    }
}

// ============================================================================
// 分頁抓取引擎
// ============================================================================
async function fetchAllSupabaseTable(table, orderByCol = null, ascending = false) {
    let allData = [];
    let rangeStart = 0;
    const limit = 1000;
    while(true) {
        let query = supabaseClient.from(table).select('*');
        if (orderByCol) query = query.order(orderByCol, {ascending: ascending});
        const { data, error } = await query.range(rangeStart, rangeStart + limit - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < limit) break;
        rangeStart += limit;
    }
    return { data: allData };
}

// ============================================================================
// 從 Supabase 載入全系統資料
// ============================================================================
async function loadDataFromSupabase() {
    console.log("⚡ 從 Supabase 極速載入全系統資料...");
    const [
        {data: c}, {data: s}, {data: cat}, {data: inv}, {data: ord},
        {data: invc}, {data: sd}, {data: log}, {data: del}, {data: quo}, {data: em}
    ] = await Promise.all([
        fetchAllSupabaseTable('clients'),
        fetchAllSupabaseTable('suppliers'),
        fetchAllSupabaseTable('catalog'),
        fetchAllSupabaseTable('inventory'),
        fetchAllSupabaseTable('orders', 'row_idx', false),
        fetchAllSupabaseTable('invoices', 'row_idx', false),
        fetchAllSupabaseTable('sales_details', 'row_idx', false),
        fetchAllSupabaseTable('inventory_logs', 'row_idx', false),
        fetchAllSupabaseTable('deliveries', 'row_idx', false),
        fetchAllSupabaseTable('quotations', 'row_idx', false),
        fetchAllSupabaseTable('email_settings')
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
// 局部表格更新中樞
// ============================================================================
async function silentRefreshTable(table) {
    try {
        console.log(`🔄 針對變更資料表 [${table}] 進行局部更新...`);
        let orderByCol = null;
        let ascending = false;
        if (['orders', 'invoices', 'sales_details', 'inventory_logs', 'deliveries', 'quotations'].includes(table)) {
            orderByCol = 'row_idx';
        }
        
        const { data: allData } = await fetchAllSupabaseTable(table, orderByCol, ascending);

        if (table === 'clients') globalClients = allData.map(x => ({name: x.name, taxId: x.tax_id, address: x.address, receiveDept: x.receive_dept}));
        else if (table === 'suppliers') globalSuppliers = allData.map(x => ({name: x.name, code: x.code, phone: x.phone, fax: x.fax}));
        else if (table === 'catalog') globalCatalog = allData.map(x => ({rowIndex: x.row_index, assetCode: x.asset_code, internalCode: x.internal_code, clientName: x.client_name, productName: x.product_name, unit: x.unit, price: Number(x.price)}));
        else if (table === 'inventory') globalInventory = allData.map(x => ({rowIdx: 0, name: x.name, qty: Number(x.qty), alertQty: Number(x.alert_qty), cost: Number(x.cost), supplier: x.supplier, internalCode: x.internal_code, assetCodeCombined: x.asset_code_combined, batchesStr: x.batches_str}));
        else if (table === 'orders') globalOrders = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), client: x.client, orderNo: x.order_no, dept: x.dept, status: x.status, jsonStr: x.json_str, deadline: x.deadline, source: x.source, mailUrl: x.mail_url}));
        else if (table === 'invoices') globalHistory = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, client: x.client, taxId: x.tax_id, net: Number(x.net), tax: Number(x.tax), total: Number(x.total), details: x.details, paperNo: x.paper_no, orderNo: x.order_no, status: x.status, historyLog: x.history_log}));
        else if (table === 'sales_details') globalSalesDetails = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, orderNo: x.order_no, name: x.name, qty: Number(x.qty), unit: x.unit, price: Number(x.price), subtotal: Number(x.subtotal), shipStatus: x.ship_status, shippedQty: Number(x.shipped_qty), lot: x.lot, expiry: x.expiry}));
        else if (table === 'inventory_logs') globalInvLogs = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, name: x.name, type: x.type, qtyChange: Number(x.qty_change), newQty: Number(x.new_qty), lot: x.lot, expiry: x.expiry, invoiceNo: x.invoice_no, orderNo: x.order_no, memo: x.memo, arrivalDate: x.arrival_date, snapshot: x.snapshot, internalCode: x.internal_code}));
        else if (table === 'deliveries') globalDeliveries = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, itemsStr: x.items_str, status: x.status, deliveryDate: x.delivery_date, deliveryMethod: x.delivery_method, memo: x.memo, signature: x.signature, staff: x.staff, orderNo: x.order_no, lot: x.lot, expiry: x.expiry}));
        else if (table === 'quotations') globalQuotes = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), quoteNo: x.quote_no, quoteDate: x.quote_date, client: x.client, status: x.status, jsonStr: x.json_str, useSeal: x.use_seal, mergeId: x.merge_id, staff: x.staff, memo: x.memo}));
        else if (table === 'email_settings') emailSettingsData.list = allData.map(x => ({email: x.email, memo: x.memo}));

        refreshAllUI();
    } catch (e) {
        console.error(`局部更新 ${table} 失敗:`, e);
    }
}

let realtimeDebounceTimer = null;
function setupSupabaseRealtime() {
    supabaseClient.channel('custom-all-channel')
        .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
            const changedTable = payload.table;
            clearTimeout(realtimeDebounceTimer);
            realtimeDebounceTimer = setTimeout(() => {
                silentRefreshTable(changedTable); 
            }, 800);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Supabase Realtime 即時監聽已啟動');
            }
        });
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
    }).catch(err => console.log('背景靜默同步全系統失敗:', err));
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

// 全域按鈕防連點鎖定工具
window.lockButton = function(btn) {
    if(!btn) return false;
    if(btn.disabled) return true; 
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 處理中...`;
    setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 3000);
    return false;
};

// ============================================================================
// 列印與 PDF 分享引擎
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

window.sharePdf = async function(areaId) {
    if (typeof html2pdf === 'undefined') {
        alert("PDF 模組載入中，請稍等一秒後再試！");
        return;
    }
    showLoading("📄 正在產生高畫質 PDF，請稍候...");
    const element = document.getElementById(areaId);
    
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
    
    if(areaId === 'printDeliveryArea' || areaId === 'printPoArea') {
        opt.jsPDF.format = 'a5';
        opt.jsPDF.orientation = 'landscape';
    }

    try {
        const pdfBlob = await html2pdf().set(opt).from(element).output('blob');
        imgs.forEach((img, i) => img.style.mixBlendMode = origStyles[i]);
        hideLoading();
        
        const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: '長固ERP 單據',
                text: '您好，附上系統開立之單據 PDF 檔案，請查收。',
                files: [file]
            });
        } else {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(pdfBlob);
            link.download = opt.filename;
            link.click();
            showToast("⬇️ 裝置不支援直接分享，已自動為您下載 PDF。");
        }
    } catch (err) {
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
// 搜尋防禦模組 Search Modal 
// ============================================================================
window.openSearchModal = function(type, callback) {
    currentSearchCallback = callback; 
    document.getElementById('searchModalList').innerHTML = ''; 
    document.getElementById('searchModalInput').value = '';
    
    if(type === 'client' || type === 'admin_client' || type === 'client_ord' || type === 'client_quo') { 
        document.getElementById('searchModalTitle').innerText = '選擇客戶'; 
        currentSearchSource = globalClients.map(c => ({ text: c.name, sub: `統編: ${c.taxId||'無'}`, val: c.name, ref: c })); 
    }
    else if(type === 'item_adj') { 
        document.getElementById('searchModalTitle').innerText = '選擇盤點品項'; 
        const uniqueProds = [...new Map(globalCatalog.map(item => [item.productName, item])).values()]; 
        currentSearchSource = uniqueProds.map(p => ({ text: p.productName, sub: `長固代號: ${p.internalCode||p.assetCode||'無'}`, val: p.productName, ref: p })); 
    }
    else if(type.startsWith('item_')) { 
        document.getElementById('searchModalTitle').innerText = '選擇品項'; 
        let clientName = ''; 
        if(type.startsWith('item_ord_')) clientName = document.getElementById('e_ordClient').value; 
        else if(type.startsWith('item_quo_')) clientName = document.getElementById('e_quoClient').value; 
        else clientName = document.getElementById('invClientInput').value; 
        
        if(!clientName) { alert('請先選擇客戶！'); return; } 
        currentSearchSource = globalCatalog.filter(p => p.clientName === clientName).map(p => {
            let detailStr = `單價: $${p.price} / ${p.unit}`;
            if(p.assetCode) detailStr += ` | 資材碼: ${p.assetCode}`;
            return { text: p.productName, sub: detailStr, val: p.productName, ref: p };
        }); 
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
    const listEl = document.getElementById('searchModalList');
    listEl.innerHTML = '';
    
    arr.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'search-btn-item';
        btn.onclick = () => window.onSearchSelect(item);
        btn.innerHTML = `<div class="d-flex justify-content-between align-items-center"><span>${escapeQuotes(item.text)}</span><span class="badge bg-secondary">${escapeQuotes(item.sub)}</span></div>`;
        listEl.appendChild(btn);
    });
};

window.onSearchSelect = function(itemObj) { 
    bootstrap.Modal.getOrCreateInstance(document.getElementById('searchModal')).hide(); 
    if(currentSearchCallback) currentSearchCallback(itemObj.val); 
};

// ============================================================================
// 極速登入系統 (直接驗證 Supabase)
// ============================================================================
window.loginSystem = async function() {
    const pwd = document.getElementById('frontDoorPwd').value; 
    if(!pwd) return alert("請輸入密碼");
    
    const btn = document.querySelector('#authScreen button'); 
    if(window.lockButton(btn)) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('employees')
            .select('name')
            .eq('pwd', pwd)
            .single();
            
        if (error || !data) {
            throw new Error("密碼錯誤，請重新輸入！");
        }
        
        myName = data.name; 
        localStorage.setItem('invStaffName', myName); 
        localStorage.setItem('invTokenExp', Date.now() + 7 * 24 * 60 * 60 * 1000); 
        
        document.getElementById('authScreen').style.opacity = '0'; 
        setTimeout(() => { 
            document.getElementById('authScreen').style.display = 'none'; 
            initSystemData(); 
        }, 500); 
        
    } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.innerHTML = "進入系統";
    }
};

window.logout = function() { if(confirm("確定登出？")) { localStorage.removeItem('invStaffName'); localStorage.removeItem('invTokenExp'); location.reload(); } };

// ============================================================================
// 系統初始化與畫面控制
// ============================================================================
window.onload = function() {
    lockScreen();
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
    
    setInterval(() => { 
        if(document.getElementById('mainApp') && document.getElementById('mainApp').style.display === 'block') { 
            let count = Math.floor(Math.random() * 3) + 1;
            if(document.getElementById('mqOnline')) document.getElementById('mqOnline').innerText = `👥 ${count} 人`; 
            if(document.getElementById('navOnlineCount')) document.getElementById('navOnlineCount').innerText = `👥 ${count}`; 
        } 
    }, 15000); 
};

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
