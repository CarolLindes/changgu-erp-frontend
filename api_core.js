/**
 * ============================================================================
 * 模組 1：API 核心、全域狀態與雙軌並行架構 (api_core.js) 
 * 【極速登入 ＆ 報表直出 ＆ 外部系統客戶代號對照 ＆ 沖帳中樞 ＆ 進貨品項管理升級版】
 * 1. 直連 Supabase 實現 0.1 秒極速登入
 * 2. 整合 SheetJS 於前端瞬間生成 Excel 報表，交由 GAS 遙控器寄信
 * 3. 內建 customer1.xlsx 客戶代號 (CUSTID) 智慧雙向對照引擎
 * 4. 支援跨系統明細補登、5月前歷史帳移轉、收款沖帳、進貨品項管理與三聯式發票明細表列印
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
let globalPayments = []; 
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
// 【跨系統勾稽核心】外部系統 (customer1.xlsx) CUSTID 與客戶名稱對照字典
// ============================================================================
window.EXTERNAL_CUSTID_DICT = [
    { custId: "200001", name: "中國醫藥大學附設醫院", taxId: "52600770" },
    { custId: "300001", name: "中國醫藥大學附設醫院", taxId: "52600770" },
    { custId: "中國-C恢", name: "中國醫藥大學附設醫院", taxId: "52600770" },
    { custId: "中國-H恢", name: "中國醫藥大學附設醫院", taxId: "52600770" },
    { custId: "200002", name: "中國醫藥大學兒童醫院", taxId: "" },
    { custId: "200003", name: "衛生福利部豐原醫院", taxId: "" },
    { custId: "200004", name: "光田醫療社團法人光田綜合醫院", taxId: "27413378" },
    { custId: "300004", name: "光田醫療社團法人光田綜合醫院", taxId: "27413378" },
    { custId: "光田睡", name: "光田醫療社團法人光田綜合醫院", taxId: "27413378" },
    { custId: "200005", name: "秀傳醫療社團法人秀傳紀念醫院", taxId: "59274027" },
    { custId: "200006", name: "國軍臺中總醫院", taxId: "" },
    { custId: "803-同", name: "國軍臺中總醫院", taxId: "" },
    { custId: "803-固", name: "國軍臺中總醫院", taxId: "" },
    { custId: "200036", name: "國軍台中總醫院中清院區", taxId: "" },
    { custId: "200007", name: "竹山秀傳醫院", taxId: "77393377" },
    { custId: "300005", name: "竹山秀傳醫院", taxId: "77393377" },
    { custId: "200008", name: "中國醫藥大學北港附設醫院", taxId: "" },
    { custId: "北港藥", name: "中國醫藥大學北港附設醫院", taxId: "" },
    { custId: "200009", name: "中山醫學大學附設醫院", taxId: "" },
    { custId: "300009", name: "中山醫學大學", taxId: "" },
    { custId: "中山醫", name: "中山醫學大學", taxId: "52000403" },
    { custId: "200117", name: "中山醫學大學附設復健醫院", taxId: "02972894" },
    { custId: "200010", name: "秀傳醫療財團法人彰濱秀傳紀念醫院", taxId: "" },
    { custId: "200011", name: "衛生福利部台中醫院", taxId: "" },
    { custId: "200012", name: "童綜合醫療社團法人童綜合醫院", taxId: "" },
    { custId: "300012", name: "童綜合醫療社團法人附設護理之家", taxId: "45485710" },
    { custId: "200013", name: "仁愛醫療財團法人", taxId: "" },
    { custId: "200014", name: "衛生福利部苗栗醫院", taxId: "" },
    { custId: "200015", name: "彰化基督教醫院", taxId: "" },
    { custId: "300015", name: "財團法人彰化基督教醫院", taxId: "" },
    { custId: "400015", name: "財團法人彰化基督教醫院", taxId: "" },
    { custId: "200016", name: "澄清綜合醫院", taxId: "" },
    { custId: "300016", name: "澄清綜合醫院", taxId: "" },
    { custId: "200017", name: "衛生福利部嘉義醫院", taxId: "" },
    { custId: "200018", name: "財團法人嘉義基督教醫院", taxId: "" },
    { custId: "200019", name: "衛生福利部南投醫院", taxId: "" },
    { custId: "200020", name: "埔基醫療財團法人埔里基督教醫院", taxId: "" },
    { custId: "200021", name: "亞洲大學附設醫院", taxId: "47456418" },
    { custId: "200021", name: "亞洲大學附屬醫院", taxId: "47456418" },
    { custId: "200022", name: "台中市立老人復健綜合醫院", taxId: "92232549" },
    { custId: "200022", name: "臺中市立老人復健綜合醫院(委託財團法人中國醫藥大學興建經營)", taxId: "92232549" },
    { custId: "200023", name: "南基醫院", taxId: "06098677" },
    { custId: "200024", name: "伍倫綜合醫院", taxId: "" },
    { custId: "200027", name: "台中榮民總醫院", taxId: "" },
    { custId: "中榮胸", name: "台中榮民總醫院", taxId: "" },
    { custId: "200043", name: "佑民醫療社團法人佑民醫院", taxId: "45673380" },
    { custId: "200046", name: "長洲醫療儀器有限公司", taxId: "52934164" },
    { custId: "200048", name: "惠全醫療器材有限公司", taxId: "22239267" },
    { custId: "200051", name: "瑞友儀器行", taxId: "52577074" },
    { custId: "200055", name: "立倫醫療器材有限公司", taxId: "22239560" },
    { custId: "200067", name: "大惟醫療儀器有限公司", taxId: "22282691" },
    { custId: "200078", name: "春菖貿易有限公司", taxId: "20833614" },
    { custId: "200079", name: "財團法人天主教聖馬爾定醫院", taxId: "66009707" },
    { custId: "300079", name: "天主教聖馬爾定醫院", taxId: "66009707" },
    { custId: "200087", name: "林新醫療社團法人林新醫院", taxId: "52697438" },
    { custId: "200088", name: "中國醫藥大學新竹附設醫院", taxId: "" },
    { custId: "200104", name: "臺中其他同行", taxId: "" },
    { custId: "200105", name: "臺中個人", taxId: "" },
    { custId: "200113", name: "茂吉儀器行", taxId: "52413621" },
    { custId: "200115", name: "東昇化工原料儀器行", taxId: "52488869" },
    { custId: "200116", name: "臺中其他醫院", taxId: "" },
    { custId: "200127", name: "宏陽醫療儀器有限公司", taxId: "23539592" },
    { custId: "200128", name: "常發醫療器材有限公司", taxId: "23186470" },
    { custId: "200129", name: "長威儀器有限公司", taxId: "86356789" },
    { custId: "200131", name: "嘉義榮民醫院", taxId: "" },
    { custId: "200132", name: "天主教若瑟醫療財團法人若瑟醫院", taxId: "" },
    { custId: "200139", name: "行政院衛生署彰化醫院", taxId: "" },
    { custId: "200140", name: "信昌醫療儀器有限公司", taxId: "59300643" },
    { custId: "200146", name: "衛儀醫療儀器有限公司", taxId: "23836805" },
    { custId: "200148", name: "維明醫療儀器有限公司", taxId: "05912147" },
    { custId: "200152", name: "台中榮民醫院埔里分院", taxId: "" },
    { custId: "200158", name: "大千醫院", taxId: "" },
    { custId: "大千", name: "大千綜合醫院", taxId: "" },
    { custId: "200160", name: "鼎聖儀器有限公司", taxId: "23975073" },
    { custId: "200161", name: "長立儀器有限公司", taxId: "86953239" },
    { custId: "200162", name: "廣年實業股份有限公司", taxId: "23861281" },
    { custId: "200163", name: "衛林有限公司", taxId: "86566130" },
    { custId: "200164", name: "衛康醫療儀器股份有限公司", taxId: "" },
    { custId: "200165", name: "行政院衛生署竹東醫院", taxId: "" },
    { custId: "200166", name: "達健儀器有限公司", taxId: "86601087" },
    { custId: "200167", name: "財團法人為恭紀念醫院", taxId: "" },
    { custId: "200167", name: "為恭醫療財團法人為恭紀念醫院", taxId: "" },
    { custId: "200176", name: "台安醫院", taxId: "77974986" },
    { custId: "200179", name: "保健安股份有限公司", taxId: "70442438" },
    { custId: "200180", name: "中國醫藥大學附設醫院臺北分院", taxId: "" },
    { custId: "中北藥", name: "中國醫藥大學附設醫院臺北分院", taxId: "" },
    { custId: "200187", name: "鴻海醫療器材股份有限公司", taxId: "" },
    { custId: "200188", name: "惠來醫療社團法人宏仁醫院", taxId: "" },
    { custId: "200189", name: "財團法人佛教慈濟綜合醫院台中分院", taxId: "" },
    { custId: "200189", name: "佛教慈濟醫療財團法人台中慈濟醫院", taxId: "" },
    { custId: "200190", name: "臺南市立安南醫院-委託中國", taxId: "37623985" },
    { custId: "200190", name: "臺南市立安南醫院-委託中國醫藥大學興建經營", taxId: "37623985" },
    { custId: "中安藥", name: "臺南市立安南醫院-委託中國醫藥大學興建經營", taxId: "37623985" }
];

window.normalizeClientName = function(name) {
    if (!name) return "";
    return String(name)
        .replace(/\s+/g, "")
        .replace(/臺/g, "台")
        .replace(/附屬/g, "附設")
        .replace(/[\(（\-]委託.*$/g, "")
        .replace(/醫療財團法人|醫療社團法人|財團法人/g, "")
        .toLowerCase();
};

// 根據客戶名稱與統編自動取得對應的外部 CUSTID 字串
window.resolveClientCustIds = function(clientName, taxId, existingCustId) {
    let ids = [];
    if (existingCustId) {
        String(existingCustId).split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
            if (!ids.includes(id)) ids.push(id);
        });
    }
    const normTarget = window.normalizeClientName(clientName);
    const cleanTax = String(taxId || '').trim();

    (window.EXTERNAL_CUSTID_DICT || []).forEach(entry => {
        const normEntry = window.normalizeClientName(entry.name);
        const nameMatch = (clientName === entry.name) || (normTarget && normTarget === normEntry);
        const taxMatch = (cleanTax && entry.taxId && cleanTax === entry.taxId);
        if (nameMatch || taxMatch) {
            if (!ids.includes(entry.custId)) ids.push(entry.custId);
        }
    });
    return ids.join(', ');
};

// 根據外部系統的 CUSTID 反查本系統標準客戶名稱
window.getErpClientNameByCustId = function(extCustId) {
    const cleanExtId = String(extCustId || '').trim();
    if (!cleanExtId) return '';

    const matchedClient = (globalClients || []).find(c => {
        const cIds = String(c.custId || '').split(',').map(s => s.trim()).filter(Boolean);
        return cIds.includes(cleanExtId);
    });
    if (matchedClient) return matchedClient.name;

    const dictMatches = (window.EXTERNAL_CUSTID_DICT || []).filter(d => d.custId === cleanExtId);
    if (dictMatches.length > 0) {
        for (const dm of dictMatches) {
            const normDm = window.normalizeClientName(dm.name);
            const inGlobal = (globalClients || []).find(c => window.normalizeClientName(c.name) === normDm);
            if (inGlobal) return inGlobal.name;
        }
        return dictMatches[0].name;
    }
    return `未知客戶(${cleanExtId})`;
};

// 根據外部系統的 CUSTID 反查客戶名稱與比對是否與本系統客戶相符
window.matchClientWithCustId = function(erpClientName, extCustId) {
    const cleanExtId = String(extCustId || '').trim();
    const cleanErpName = String(erpClientName || '').trim();
    if (!cleanExtId || !cleanErpName) return { isMatch: false, extClientName: window.getErpClientNameByCustId(cleanExtId) || cleanExtId || '未填代號' };

    const normErp = window.normalizeClientName(cleanErpName);

    const matchedClientsInDb = (globalClients || []).filter(c => {
        const cIds = String(c.custId || '').split(',').map(s => s.trim()).filter(Boolean);
        return cIds.includes(cleanExtId);
    });

    for (const c of matchedClientsInDb) {
        if (c.name === cleanErpName || window.normalizeClientName(c.name) === normErp) {
            return { isMatch: true, extClientName: c.name };
        }
    }

    const dictMatches = (window.EXTERNAL_CUSTID_DICT || []).filter(d => d.custId === cleanExtId);
    for (const d of dictMatches) {
        if (d.name === cleanErpName || window.normalizeClientName(d.name) === normErp) {
            return { isMatch: true, extClientName: d.name };
        }
    }

    if (cleanExtId === '200104' && /生技|醫技|儀器|器材|實業|企業|有限公司|股份|行$/.test(cleanErpName)) {
        return { isMatch: true, extClientName: `臺中其他同行 (${cleanErpName})` };
    }
    if (cleanExtId === '200116' && /醫院|診所|分院|衛生|醫務/.test(cleanErpName)) {
        return { isMatch: true, extClientName: `臺中其他醫院 (${cleanErpName})` };
    }

    const fallbackName = matchedClientsInDb.length > 0
        ? matchedClientsInDb.map(c => c.name).join('/')
        : (dictMatches.length > 0 ? dictMatches[0].name : `未知代號(${cleanExtId})`);

    return { isMatch: false, extClientName: fallbackName };
};

// 透過長固代號 (ISPN) 與客戶名稱，自動反查產品品名與單位
window.findProductNameByCode = function(ispnCode, clientName) {
    const cleanCode = String(ispnCode || '').trim().toUpperCase();
    if (!cleanCode) return { name: '', unit: '式', price: 0 };

    if (clientName) {
        const normClient = window.normalizeClientName(clientName);
        const exactCat = (globalCatalog || []).find(c =>
            (c.clientName === clientName || window.normalizeClientName(c.clientName) === normClient) &&
            (String(c.internalCode || '').trim().toUpperCase() === cleanCode || String(c.assetCode || '').trim().toUpperCase() === cleanCode)
        );
        if (exactCat) return { name: exactCat.productName, unit: exactCat.unit || '式', price: exactCat.price || 0 };
    }

    const anyCat = (globalCatalog || []).find(c =>
        String(c.internalCode || '').trim().toUpperCase() === cleanCode ||
        String(c.assetCode || '').trim().toUpperCase() === cleanCode
    );
    if (anyCat) return { name: anyCat.productName, unit: anyCat.unit || '式', price: anyCat.price || 0 };

    const invItem = (globalInventory || []).find(i =>
        String(i.internalCode || '').trim().toUpperCase() === cleanCode
    );
    if (invItem) return { name: invItem.name, unit: '式', price: 0 };

    return { name: cleanCode, unit: '式', price: 0 };
};

// 產品目錄去重輔助工具
function deduplicateCatalogRows(rawRows) {
    const map = new Map();
    (rawRows || []).forEach(x => {
        const item = {
            rowIndex: Number(x.row_index) || 0,
            assetCode: x.asset_code || '',
            internalCode: x.internal_code || '',
            clientName: x.client_name || '',
            productName: x.product_name || '',
            unit: x.unit || '式',
            price: Number(x.price) || 0
        };
        const key = `${item.clientName.trim()}|${item.productName.trim()}|${item.assetCode.trim()}|${item.internalCode.trim()}|${item.price}`;
        map.set(key, item);
    });
    return Array.from(map.values());
}

window.getNextCatalogRowIndex = function() {
    let maxIdx = 1;
    (globalCatalog || []).forEach(item => {
        const rIdx = Number(item.rowIndex) || 0;
        if (rIdx > 0 && rIdx < 2000000000 && rIdx > maxIdx) {
            maxIdx = rIdx;
        }
    });
    return maxIdx + 1;
};

// ============================================================================
// API 通訊模組 (攔截前端邏輯 或 發送至機器人)
// ============================================================================
async function callApi(action, payload = {}) {
    if (action === 'heartbeat') return { count: Math.floor(Math.random() * 3) + 1 };
    
    if (action === 'saveReportEmails') {
        localStorage.setItem('reportSelectedEmails', JSON.stringify(payload.selectedEmails));
        return { success: true };
    }
    
    // 攔截報表發送請求，生成 4 個工作表
    if (action === 'exportExcelReport' || action === 'sendPendingOrdersReport') {
        if (typeof XLSX === 'undefined') throw new Error("Excel 模組仍在載入中，請稍後再試！");
        
        let emails = [];
        if (payload.emails && Array.isArray(payload.emails)) {
            emails = payload.emails;
        } else if (payload.email && typeof payload.email === 'string') {
            emails = payload.email.split(',').map(e => e.trim()).filter(e => e !== '');
        }

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
        
        // 工作表 1: 發票總表
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

        // 工作表 2: 出貨明細
        const lineItemRows = [
            ["開立日期", "發票號碼", "客戶名稱", "訂單編號", "長固代號", "品名", "開立數量", "單價(含稅)", "總價(含稅)", "出貨狀態", "已出貨數量"]
        ];
        (payload.lineItems || []).forEach(l => {
            const sd = (l.rowIdx !== undefined && l.rowIdx !== null)
                ? globalSalesDetails.find(s => s.rowIdx === l.rowIdx)
                : globalSalesDetails.find(s => s.paperNo === l.paperNo && s.name === l.name && Number(s.qty) === Number(l.qty));
            const fallbackSd = sd || globalSalesDetails.find(s => s.paperNo === l.paperNo && s.name === l.name);
            const price = (l.price && Number(l.price) > 0) ? Number(l.price) : (fallbackSd ? Number(fallbackSd.price) : 0);
            const subtotal = (l.subtotal && Number(l.subtotal) > 0) ? Number(l.subtotal) : Math.round(price * (Number(l.qty) || 0));
            const cat = (typeof window.findProductRobust === 'function')
                ? window.findProductRobust(l.client, null, l.name)
                : globalCatalog.find(c => c.productName === l.name && c.clientName === l.client);
            const internalCode = cat ? (cat.internalCode || cat.assetCode || '') : '';
            
            lineItemRows.push([
                l.time, l.paperNo, l.client, l.orderNo, internalCode, l.name, l.qty, price, subtotal, l.shipStatus, l.shippedQty
            ]);
        });
        const wsDelivery = XLSX.utils.aoa_to_sheet(lineItemRows);

        // 工作表 3: 目前庫存表
        const invRows = [
            ["品名", "長固代號", "目前庫存數量"]
        ];
        globalInventory.forEach(inv => {
            invRows.push([
                inv.name, inv.internalCode || inv.assetCodeCombined || '', inv.qty
            ]);
        });
        const wsInventory = XLSX.utils.aoa_to_sheet(invRows);

        // 工作表 4: 客戶營收分析表
        const clientRows = [
            ["客戶/醫院名稱", "總銷售額(含稅)"]
        ];
        (payload.clientStats || []).forEach(c => {
            clientRows.push([
                c.name, c.total
            ]);
        });
        const wsClient = XLSX.utils.aoa_to_sheet(clientRows);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsHistory, "發票總表");
        XLSX.utils.book_append_sheet(wb, wsDelivery, "出貨明細");
        XLSX.utils.book_append_sheet(wb, wsInventory, "目前庫存表");
        XLSX.utils.book_append_sheet(wb, wsClient, "客戶營收分析表");

        const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
        
        let cleanDateRange = "未定期間";
        if (payload.dateRange) {
            cleanDateRange = payload.dateRange.replace(/\//g, '-').trim();
        }
        const fileName = `長固ERP_發票報表_${cleanDateRange}.xlsx`;

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
        const { error } = await supabaseClient.from('orders').upsert({
            row_idx: payload.rowIdx || Date.now(),
            time: Date.now(), client: payload.clientName, order_no: payload.orderNo,
            dept: payload.department, status: payload.status, json_str: JSON.stringify(items),
            deadline: payload.deadline, source: payload.source, mail_url: payload.mailUrl
        });
        if (error) throw error;
    } 
    else if (action === 'updateOrderStatus') {
        const { error } = await supabaseClient.from('orders').update({ status: payload.status }).in('row_idx', payload.rowIndices);
        if (error) throw error;
    }
    else if (action === 'submitInvoice') {
        const { error: invErr } = await supabaseClient.from('invoices').insert({
            row_idx: Date.now(), time: payload.invDate, staff: payload.staff,
            client: payload.clientName, tax_id: payload.taxId, net: payload.netTotal,
            tax: payload.tax, total: payload.totalWithTax, details: payload.detailsStr,
            paper_no: payload.paperNo, order_no: payload.orderNo, status: '正常', history_log: '[]'
        });
        if (invErr) throw invErr;

        if (payload.items && payload.items.length > 0) {
            const sdArr = payload.items.map((i, idx) => ({
                row_idx: Date.now() + Math.floor(Math.random() * 1000) + idx,
                time: payload.invDate, paper_no: payload.paperNo, client: payload.clientName,
                order_no: payload.orderNo, name: i.name, qty: i.qty, unit: i.unit,
                price: i.price, subtotal: i.subtotal, ship_status: '待出貨', shipped_qty: 0,
                lot: '', expiry: '', pay_status: '未收款', paid_amount: 0, pay_date: '', payment_no: ''
            }));
            const { error: sdErr } = await supabaseClient.from('sales_details').insert(sdArr);
            if (sdErr) {
                const fallbackArr = payload.items.map((i, idx) => ({
                    row_idx: Date.now() + Math.floor(Math.random() * 1000) + idx,
                    time: payload.invDate, paper_no: payload.paperNo, client: payload.clientName,
                    order_no: payload.orderNo, name: i.name, qty: i.qty, unit: i.unit,
                    price: i.price, subtotal: i.subtotal, ship_status: '待出貨', shipped_qty: 0,
                    lot: '', expiry: ''
                }));
                const { error: fbErr } = await supabaseClient.from('sales_details').insert(fallbackArr);
                if (fbErr) throw fbErr;
            }
        }
    } 
    else if (action === 'supplementSalesDetail') {
        const record = {
            row_idx: payload.rowIdx || (Date.now() + Math.floor(Math.random() * 1000)),
            time: payload.time || Date.now(),
            paper_no: payload.paperNo,
            client: payload.client,
            order_no: payload.orderNo || '',
            name: payload.name,
            qty: Number(payload.qty) || 0,
            unit: payload.unit || '式',
            price: Number(payload.price) || 0,
            subtotal: Number(payload.subtotal) || Math.round((Number(payload.qty) || 0) * (Number(payload.price) || 0)),
            ship_status: payload.shipStatus || '已結案',
            shipped_qty: payload.shippedQty !== undefined ? Number(payload.shippedQty) : (Number(payload.qty) || 0),
            lot: payload.lot || '',
            expiry: payload.expiry || '',
            pay_status: payload.payStatus || '未收款',
            paid_amount: 0,
            pay_date: '',
            payment_no: ''
        };
        const { error: sdErr } = await supabaseClient.from('sales_details').insert(record);
        if (sdErr) {
            delete record.pay_status; delete record.paid_amount; delete record.pay_date; delete record.payment_no;
            const { error: fbErr } = await supabaseClient.from('sales_details').insert(record);
            if (fbErr) throw fbErr;
        }

        if (payload.alsoCreateInvoiceRecord) {
            const total = record.subtotal;
            const net = Math.round(total / 1.05);
            const tax = total - net;
            const detailLine = `${record.name} x${record.qty} (單價: $${record.price.toFixed(3)}) ${record.order_no ? '[' + record.order_no + ']' : ''}`.trim();
            await supabaseClient.from('invoices').insert({
                row_idx: Date.now() + Math.floor(Math.random() * 1000),
                time: record.time,
                staff: payload.staff || myName,
                client: record.client,
                tax_id: payload.taxId || '',
                net: net,
                tax: tax,
                total: total,
                details: detailLine,
                paper_no: record.paper_no,
                order_no: record.order_no,
                status: '正常',
                history_log: '["跨系統勾稽補登"]'
            });
        }
    }
    else if (action === 'executePaymentReconcile') {
        const pRec = payload.paymentRecord;
        const { error: payErr } = await supabaseClient.from('payment_records').upsert({
            row_idx: pRec.rowIdx,
            payment_no: pRec.paymentNo,
            time: pRec.time,
            pay_date: pRec.payDate,
            client: pRec.client,
            pay_method: pRec.payMethod,
            paper_nos: pRec.paperNos,
            receivable_total: pRec.receivableTotal,
            received_amount: pRec.receivedAmount,
            diff_amount: pRec.diffAmount,
            status: pRec.status,
            items_json: pRec.itemsJson,
            source_type: pRec.sourceType,
            staff: pRec.staff,
            memo: pRec.memo
        });
        if (payErr) throw payErr;

        for (const upd of (payload.salesUpdates || [])) {
            const { error: uErr } = await supabaseClient.from('sales_details').update({
                pay_status: upd.payStatus,
                paid_amount: upd.paidAmount,
                pay_date: upd.payDate,
                payment_no: upd.paymentNo
            }).eq('row_idx', upd.rowIdx);
            if (uErr) console.error("更新 sales_details 沖帳狀態失敗:", uErr);
        }
    }
    else if (action === 'voidPaymentRecord') {
        const { error: vErr } = await supabaseClient.from('payment_records').update({
            status: '已作廢'
        }).eq('row_idx', payload.rowIdx);
        if (vErr) throw vErr;

        if (payload.salesRowIndices && payload.salesRowIndices.length > 0) {
            await supabaseClient.from('sales_details').update({
                pay_status: '未收款',
                paid_amount: 0,
                pay_date: '',
                payment_no: ''
            }).in('row_idx', payload.salesRowIndices);
        }
        if (payload.paymentNo) {
            await supabaseClient.from('sales_details').update({
                pay_status: '未收款',
                paid_amount: 0,
                pay_date: '',
                payment_no: ''
            }).eq('payment_no', payload.paymentNo);
        }
    }
    else if (action === 'importHistoricalUnpaid') {
        const rows = (payload.items || []).map(x => ({
            row_idx: x.rowIdx,
            time: x.time,
            paper_no: x.paperNo,
            client: x.client,
            order_no: x.orderNo,
            name: x.name,
            qty: x.qty,
            unit: x.unit || '式',
            price: x.price,
            subtotal: x.subtotal,
            ship_status: '歷史已結案',
            shipped_qty: x.qty,
            lot: x.lot || '[5月前歷史應收]',
            expiry: x.expiry || '',
            pay_status: '未收款',
            paid_amount: 0,
            pay_date: '',
            payment_no: ''
        }));

        const chunkSize = 150;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await supabaseClient.from('sales_details').upsert(chunk);
            if (error) throw error;
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
        const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', payload.name).maybeSingle();
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
    else if (action === 'saveAdminPurchaseItem') {
        // 【項目 1 核心】管理員後台「🏭 進貨品項」直接管理 Supabase inventory 資料表
        const record = {
            name: payload.name,
            qty: Number(payload.qty) || 0,
            alert_qty: Number(payload.alertQty) || 0,
            cost: Number(payload.cost) || 0,
            supplier: payload.supplier || '',
            internal_code: payload.internalCode || '',
            asset_code_combined: payload.assetCodeCombined || '',
            batches_str: payload.batchesStr || '[]'
        };

        if (payload.oldName) {
            const { data: updated, error: updErr } = await supabaseClient
                .from('inventory')
                .update(record)
                .eq('name', payload.oldName)
                .select();

            if (updErr || !updated || updated.length === 0) {
                if (payload.oldName !== payload.name) {
                    await supabaseClient.from('inventory').delete().eq('name', payload.oldName);
                }
                const { error: upsErr } = await supabaseClient.from('inventory').upsert(record);
                if (upsErr) throw upsErr;
            }
        } else {
            const { data: exist } = await supabaseClient.from('inventory').select('name').eq('name', payload.name).maybeSingle();
            if (exist) {
                const { error: updErr } = await supabaseClient.from('inventory').update(record).eq('name', payload.name);
                if (updErr) throw updErr;
            } else {
                const { error: insErr } = await supabaseClient.from('inventory').insert(record);
                if (insErr) {
                    const { error: upsErr } = await supabaseClient.from('inventory').upsert(record);
                    if (upsErr) throw upsErr;
                }
            }
        }
    }
    else if (action === 'deleteAdminPurchaseItem') {
        const { error } = await supabaseClient.from('inventory').delete().eq('name', payload.name);
        if (error) throw error;
    }
    else if (action === 'updateShipment') {
        for (let u of (payload.updates || [])) {
            const { data: sd } = await supabaseClient.from('sales_details').select('*').eq('row_idx', u.rowIdx).maybeSingle();
            if (sd) {
                let newShipped = (sd.shipped_qty || 0) + u.shipQty;
                let newStatus = newShipped >= sd.qty ? '已結案' : '部分出貨';
                await supabaseClient.from('sales_details').update({ shipped_qty: newShipped, ship_status: newStatus }).eq('row_idx', u.rowIdx);
            }
            const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', u.name).maybeSingle();
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
        const { data: inv } = await supabaseClient.from('inventory').select('*').eq('name', payload.name).maybeSingle();
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
        const custIdVal = payload.custId || window.resolveClientCustIds(payload.clientName, payload.taxId, '');
        const { error } = await supabaseClient.from('clients').insert({
            name: payload.clientName, tax_id: payload.taxId, address: payload.address, receive_dept: payload.receiveDept, cust_id: custIdVal
        });
        if (error) {
            const { error: fallbackErr } = await supabaseClient.from('clients').insert({
                name: payload.clientName, tax_id: payload.taxId, address: payload.address, receive_dept: payload.receiveDept
            });
            if (fallbackErr) throw fallbackErr;
        }
    }
    else if (action === 'updateClientData') {
        const updateObj = {
            name: payload.newName, tax_id: payload.newTaxId, address: payload.address, receive_dept: payload.receiveDept
        };
        if (payload.custId !== undefined) updateObj.cust_id = payload.custId;
        const { error } = await supabaseClient.from('clients').update(updateObj).eq('name', payload.oldName);
        if (error && updateObj.cust_id !== undefined) {
            delete updateObj.cust_id;
            await supabaseClient.from('clients').update(updateObj).eq('name', payload.oldName);
        }
        await supabaseClient.from('catalog').update({ client_name: payload.newName }).eq('client_name', payload.oldName);
    }
    else if (action === 'saveAdminItem') {
        const isEdit = !!(payload.isEdit && payload.rowIndex && Number(payload.rowIndex) < 2000000000);
        const targetIdx = (payload.rowIndex && Number(payload.rowIndex) < 2000000000)
            ? Number(payload.rowIndex)
            : window.getNextCatalogRowIndex();

        const record = {
            row_index: targetIdx,
            asset_code: payload.assetCode || '',
            internal_code: payload.internalCode || '',
            client_name: payload.clientName,
            product_name: payload.productName,
            unit: payload.unit || '式',
            price: Number(payload.price) || 0
        };

        if (isEdit) {
            const { data: updated, error: updErr } = await supabaseClient
                .from('catalog')
                .update(record)
                .eq('row_index', targetIdx)
                .select();

            if (updErr || !updated || updated.length === 0) {
                const { error: upsErr } = await supabaseClient.from('catalog').upsert(record);
                if (upsErr) throw upsErr;
            }
        } else {
            const { error: insErr } = await supabaseClient.from('catalog').insert(record);
            if (insErr) {
                const { error: upsErr } = await supabaseClient.from('catalog').upsert(record);
                if (upsErr) throw upsErr;
            }
        }
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
        alert("資料庫寫入失敗：" + (e.message || JSON.stringify(e)));
    }
}

// ============================================================================
// 分頁抓取引擎 (支援容錯讀取)
// ============================================================================
async function fetchAllSupabaseTable(table, orderByCol = null, ascending = false, ignoreError = false) {
    let allData = [];
    let rangeStart = 0;
    const limit = 1000;
    while(true) {
        let query = supabaseClient.from(table).select('*');
        if (orderByCol) query = query.order(orderByCol, {ascending: ascending});
        const { data, error } = await query.range(rangeStart, rangeStart + limit - 1);
        if (error) {
            if (ignoreError) {
                console.warn(`讀取資料表 ${table} 略過:`, error.message);
                return { data: [] };
            }
            throw error;
        }
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < limit) break;
        rangeStart += limit;
    }
    return { data: allData };
}

function mapSalesDetailRow(x) {
    return {
        rowIdx: x.row_idx,
        time: Number(x.time),
        paperNo: x.paper_no,
        client: x.client,
        orderNo: x.order_no,
        name: x.name,
        qty: Number(x.qty),
        unit: x.unit,
        price: Number(x.price),
        subtotal: Number(x.subtotal),
        shipStatus: x.ship_status,
        shippedQty: Number(x.shipped_qty),
        lot: x.lot,
        expiry: x.expiry,
        payStatus: x.pay_status || '未收款',
        paidAmount: Number(x.paid_amount) || 0,
        payDate: x.pay_date || '',
        paymentNo: x.payment_no || ''
    };
}

function mapPaymentRecordRow(x) {
    return {
        rowIdx: x.row_idx,
        paymentNo: x.payment_no || '',
        time: Number(x.time) || Date.now(),
        payDate: x.pay_date || '',
        client: x.client || '',
        payMethod: x.pay_method || '匯款',
        paperNos: x.paper_nos || '',
        receivableTotal: Number(x.receivable_total) || 0,
        receivedAmount: Number(x.received_amount) || 0,
        diffAmount: Number(x.diff_amount) || 0,
        status: x.status || '已沖帳結清',
        itemsJson: x.items_json || '[]',
        sourceType: x.source_type || 'ERP原生帳款',
        staff: x.staff || '',
        memo: x.memo || ''
    };
}

// ============================================================================
// 從 Supabase 載入全系統資料
// ============================================================================
async function loadDataFromSupabase() {
    console.log("⚡ 從 Supabase 極速載入全系統資料...");
    const [
        {data: c}, {data: s}, {data: cat}, {data: inv}, {data: ord},
        {data: invc}, {data: sd}, {data: log}, {data: del}, {data: quo}, {data: em}, {data: pay}
    ] = await Promise.all([
        fetchAllSupabaseTable('clients'),
        fetchAllSupabaseTable('suppliers'),
        fetchAllSupabaseTable('catalog', 'row_index', true),
        fetchAllSupabaseTable('inventory'),
        fetchAllSupabaseTable('orders', 'row_idx', false),
        fetchAllSupabaseTable('invoices', 'row_idx', false),
        fetchAllSupabaseTable('sales_details', 'row_idx', false),
        fetchAllSupabaseTable('inventory_logs', 'row_idx', false),
        fetchAllSupabaseTable('deliveries', 'row_idx', false),
        fetchAllSupabaseTable('quotations', 'row_idx', false),
        fetchAllSupabaseTable('email_settings'),
        fetchAllSupabaseTable('payment_records', 'row_idx', false, true)
    ]);

    globalClients = (c || []).map(x => ({
        name: x.name,
        taxId: x.tax_id,
        address: x.address,
        receiveDept: x.receive_dept,
        custId: window.resolveClientCustIds(x.name, x.tax_id, x.cust_id)
    }));
    globalSuppliers = (s || []).map(x => ({name: x.name, code: x.code, phone: x.phone, fax: x.fax}));
    globalCatalog = deduplicateCatalogRows(cat);
    globalInventory = (inv || []).map((x, idx) => ({
        rowIdx: idx + 1,
        name: x.name,
        qty: Number(x.qty),
        alertQty: Number(x.alert_qty),
        cost: Number(x.cost),
        supplier: x.supplier,
        internalCode: x.internal_code,
        assetCodeCombined: x.asset_code_combined,
        batchesStr: x.batches_str
    }));
    globalOrders = (ord || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), client: x.client, orderNo: x.order_no, dept: x.dept, status: x.status, jsonStr: x.json_str, deadline: x.deadline, source: x.source, mailUrl: x.mail_url}));
    globalHistory = (invc || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, client: x.client, taxId: x.tax_id, net: Number(x.net), tax: Number(x.tax), total: Number(x.total), details: x.details, paperNo: x.paper_no, orderNo: x.order_no, status: x.status, historyLog: x.history_log}));
    globalSalesDetails = (sd || []).map(mapSalesDetailRow);
    globalInvLogs = (log || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, name: x.name, type: x.type, qtyChange: Number(x.qty_change), newQty: Number(x.new_qty), lot: x.lot, expiry: x.expiry, invoiceNo: x.invoice_no, orderNo: x.order_no, memo: x.memo, arrivalDate: x.arrival_date, snapshot: x.snapshot, internalCode: x.internal_code}));
    globalDeliveries = (del || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, itemsStr: x.items_str, status: x.status, deliveryDate: x.delivery_date, deliveryMethod: x.delivery_method, memo: x.memo, signature: x.signature, staff: x.staff, orderNo: x.order_no, lot: x.lot, expiry: x.expiry}));
    globalQuotes = (quo || []).map(x => ({rowIdx: x.row_idx, time: Number(x.time), quoteNo: x.quote_no, quoteDate: x.quote_date, client: x.client, status: x.status, jsonStr: x.json_str, useSeal: x.use_seal, mergeId: x.merge_id, staff: x.staff, memo: x.memo}));
    globalPayments = (pay || []).map(mapPaymentRecordRow);
    
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
        if (['orders', 'invoices', 'sales_details', 'inventory_logs', 'deliveries', 'quotations', 'payment_records'].includes(table)) {
            orderByCol = 'row_idx';
        } else if (table === 'catalog') {
            orderByCol = 'row_index';
            ascending = true;
        }
        
        const { data: allData } = await fetchAllSupabaseTable(table, orderByCol, ascending, true);

        if (table === 'clients') globalClients = allData.map(x => ({
            name: x.name,
            taxId: x.tax_id,
            address: x.address,
            receiveDept: x.receive_dept,
            custId: window.resolveClientCustIds(x.name, x.tax_id, x.cust_id)
        }));
        else if (table === 'suppliers') globalSuppliers = allData.map(x => ({name: x.name, code: x.code, phone: x.phone, fax: x.fax}));
        else if (table === 'catalog') globalCatalog = deduplicateCatalogRows(allData);
        else if (table === 'inventory') globalInventory = allData.map((x, idx) => ({
            rowIdx: idx + 1,
            name: x.name,
            qty: Number(x.qty),
            alertQty: Number(x.alert_qty),
            cost: Number(x.cost),
            supplier: x.supplier,
            internalCode: x.internal_code,
            assetCodeCombined: x.asset_code_combined,
            batchesStr: x.batches_str
        }));
        else if (table === 'orders') globalOrders = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), client: x.client, orderNo: x.order_no, dept: x.dept, status: x.status, jsonStr: x.json_str, deadline: x.deadline, source: x.source, mailUrl: x.mail_url}));
        else if (table === 'invoices') globalHistory = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, client: x.client, taxId: x.tax_id, net: Number(x.net), tax: Number(x.tax), total: Number(x.total), details: x.details, paperNo: x.paper_no, orderNo: x.order_no, status: x.status, historyLog: x.history_log}));
        else if (table === 'sales_details') globalSalesDetails = allData.map(mapSalesDetailRow);
        else if (table === 'inventory_logs') globalInvLogs = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), staff: x.staff, name: x.name, type: x.type, qtyChange: Number(x.qty_change), newQty: Number(x.new_qty), lot: x.lot, expiry: x.expiry, invoiceNo: x.invoice_no, orderNo: x.order_no, memo: x.memo, arrivalDate: x.arrival_date, snapshot: x.snapshot, internalCode: x.internal_code}));
        else if (table === 'deliveries') globalDeliveries = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), paperNo: x.paper_no, client: x.client, itemsStr: x.items_str, status: x.status, deliveryDate: x.delivery_date, deliveryMethod: x.delivery_method, memo: x.memo, signature: x.signature, staff: x.staff, orderNo: x.order_no, lot: x.lot, expiry: x.expiry}));
        else if (table === 'quotations') globalQuotes = allData.map(x => ({rowIdx: x.row_idx, time: Number(x.time), quoteNo: x.quote_no, quoteDate: x.quote_date, client: x.client, status: x.status, jsonStr: x.json_str, useSeal: x.use_seal, mergeId: x.merge_id, staff: x.staff, memo: x.memo}));
        else if (table === 'payment_records') globalPayments = allData.map(mapPaymentRecordRow);
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
    if (typeof window.populateAdminPurchaseSupplierFilter === "function") window.populateAdminPurchaseSupplierFilter();
    if (typeof window.updateHistoryDropdowns === "function") window.updateHistoryDropdowns();
    if (typeof window.populateLogDropdowns === "function") window.populateLogDropdowns();
    if (typeof window.updateOrderClientDropdown === "function") window.updateOrderClientDropdown();
    if (typeof window.renderEmailSettings === "function") window.renderEmailSettings();
    
    if(document.getElementById('sys-history') && document.getElementById('sys-history').style.display === 'block') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
        if (typeof window.initReconcileCenterUI === "function") window.initReconcileCenterUI();
        if (typeof window.initTaxDetailTab === "function") window.initTaxDetailTab();
    }
    if(document.getElementById('sys-admin') && document.getElementById('sys-admin').style.display === 'block') { 
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminPurchaseItems === "function") window.renderAdminPurchaseItems(); 
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
    if(document.getElementById('sys-payment') && document.getElementById('sys-payment').style.display === 'block') {
        if (typeof window.renderPaymentModule === "function") window.renderPaymentModule(); 
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
// 列印與 PDF 分享引擎 (含 A5 橫式防跨頁裁切保護 ＆ A4 直式三聯明細表支援)
// ============================================================================
const ALL_PRINT_AREA_IDS = ['printArea', 'printPoArea', 'printQuoteArea', 'printDeliveryArea', 'printTaxDetailArea'];

window.applyPrintStyle = function(size, layout) {
    let styleNode = document.getElementById('dynamicPrintStyle');
    if (!styleNode) {
        styleNode = document.createElement('style');
        styleNode.id = 'dynamicPrintStyle';
        document.head.appendChild(styleNode);
    }
    
    const isA5Landscape = (String(size).toUpperCase() === 'A5' && String(layout).toLowerCase() === 'landscape');
    
    styleNode.innerHTML = `
    @page { size: ${size} ${layout}; margin: 0mm !important; }

    @media screen {
        .print-active > div {
            min-width: 780px !important;
            margin: 0 auto !important;
            background: #fff;
            box-shadow: 0 0 15px rgba(0,0,0,0.3);
        }
    }
    @media print { 
        html, body {
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
            padding: 0 !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        } 
        #printControlBar { display: none !important; }
        .print-active { padding: 0 !important; margin: 0 !important; overflow: visible !important; }
        .print-active > div {
            min-width: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            box-shadow: none !important;
        }
        ${isA5Landscape ? `
        #printPoArea.print-active > div {
            max-height: 144mm !important;
            height: 144mm !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
        }
        ` : ''}
    }`;
};

window.showPrintPreview = function(areaId) {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('homeMenu').style.display = 'none';
    
    ALL_PRINT_AREA_IDS.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';
            el.classList.remove('print-active');
        }
    });
    
    const targetArea = document.getElementById(areaId);
    if (!targetArea) return;
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
    
    ALL_PRINT_AREA_IDS.forEach(id => {
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
    
    if(areaId === 'printDeliveryArea' || areaId === 'printPoArea' || areaId === 'printArea') {
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
    
    if(type === 'client' || type === 'admin_client' || type === 'client_ord' || type === 'client_quo' || type === 'client_pay') { 
        document.getElementById('searchModalTitle').innerText = '選擇客戶'; 
        const uniqueClients = [...new Map(globalClients.map(c => [(c.name || '').trim(), c])).values()];
        currentSearchSource = uniqueClients.map(c => ({
            text: c.name,
            sub: `統編: ${c.taxId||'無'}${c.custId ? ' | 代號: ' + c.custId : ''}`,
            val: c.name,
            ref: c
        })); 
    }
    else if(type === 'item_adj') { 
        document.getElementById('searchModalTitle').innerText = '選擇盤點品項'; 
        const uniqueProds = [...new Map(globalCatalog.map(item => [(item.productName || '').trim(), item])).values()]; 
        currentSearchSource = uniqueProds.map(p => ({ text: p.productName, sub: `長固代號: ${p.internalCode||p.assetCode||'無'}`, val: p.productName, ref: p })); 
    }
    else if(type.startsWith('item_')) { 
        document.getElementById('searchModalTitle').innerText = '選擇品項'; 
        let clientName = ''; 
        if(type.startsWith('item_ord_')) clientName = document.getElementById('e_ordClient').value; 
        else if(type.startsWith('item_quo_')) clientName = document.getElementById('e_quoClient').value; 
        else if(type.startsWith('item_recfix')) clientName = document.getElementById('rf_client') ? document.getElementById('rf_client').value : '';
        else clientName = document.getElementById('invClientInput').value; 
        
        if(!clientName) { alert('請先選擇客戶！'); return; } 
        
        const clientProds = globalCatalog.filter(p => p.clientName === clientName);
        const uniqueMap = new Map();
        clientProds.forEach(p => {
            const key = `${(p.productName || '').trim()}|${(p.assetCode || '').trim()}|${(p.internalCode || '').trim()}|${p.price}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, p);
            }
        });

        currentSearchSource = Array.from(uniqueMap.values()).map(p => {
            let detailStr = `單價: $${p.price} / ${p.unit}`;
            if(p.assetCode) detailStr += ` | 資材碼: ${p.assetCode}`;
            if(p.internalCode) detailStr += ` | 長固: ${p.internalCode}`;
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
    if(currentSearchCallback) currentSearchCallback(itemObj.val, itemObj.ref); 
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
    document.querySelectorAll('.sys-module').forEach(el => el.style.display = 'none');
    const modEl = document.getElementById(`sys-${modId}`);
    if (modEl) modEl.style.display = 'block';
    
    const titles = {
        'order':'📦 訂單辨識建檔',
        'invoice':'📝 開立發票',
        'inventory': '🏭 產品庫存管理',
        'history':'📊 紀錄與報表',
        'admin':'⚙️ 管理員後台',
        'quotation': '📑 開立估價單',
        'delivery': '🚚 送貨與電子簽收',
        'payment': '💰 收款明細與沖帳'
    }; 
    
    if(document.getElementById('sysTitle')) document.getElementById('sysTitle').innerText = titles[modId] || '長固 ERP'; 
    document.getElementById('mainApp').scrollTo(0,0);
    
    if(modId === 'history') { 
        if (typeof window.renderHistory === "function") window.renderHistory(); 
        if (typeof window.generateReport === "function") window.generateReport(); 
        if (typeof window.initReconcileCenterUI === "function") window.initReconcileCenterUI();
        if (typeof window.initTaxDetailTab === "function") window.initTaxDetailTab();
    }
    if(modId === 'admin') { 
        if (typeof window.populateAdminClientFilter === "function") window.populateAdminClientFilter();
        if (typeof window.populateAdminPurchaseSupplierFilter === "function") window.populateAdminPurchaseSupplierFilter();
        if (typeof window.renderAdminItems === "function") window.renderAdminItems(); 
        if (typeof window.renderAdminPurchaseItems === "function") window.renderAdminPurchaseItems(); 
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
    if(modId === 'payment') {
        if (typeof window.initPaymentModule === "function") window.initPaymentModule();
        if (typeof window.renderPaymentModule === "function") window.renderPaymentModule(); 
    }
};

window.backToHome = function() { document.getElementById('mainApp').style.display = 'none'; document.getElementById('homeMenu').style.display = 'block'; };
