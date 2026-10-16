/**
 * ============================================================================
 * 長固 ERP - 後台總控中心 (部署於 fcw031@gmail.com)
 * 負責：建立試算表同步選單、雙向更新 Supabase 營運資料、基礎設定與收款沖帳記錄表
 * ============================================================================
 */

const CONFIG = {
  SUPABASE_URL: "https://dojhiznffztiyofkfdiu.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvamhpem5mZnp0aXlvZmtmZGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzk3MzYsImV4cCI6MjEwNTMxNTczNn0.reT6i25kO1d1V8p2fDMHOOPVxaUJfp9SxOFeg-_xFqI",
};

// 內建外部系統 (customer1.xlsx & 未收款明細.xlsx) 客戶代號對照表
const BUILTIN_CUSTOMER1_LIST = [
  { name: "中國醫藥大學附設醫院", custId: "200001", taxId: "52600770" },
  { name: "中國醫藥大學兒童醫院", custId: "200002", taxId: "" },
  { name: "衛生福利部豐原醫院", custId: "200003", taxId: "" },
  { name: "光田醫療社團法人光田綜合醫院", custId: "200004", taxId: "27413378" },
  { name: "秀傳醫療社團法人秀傳紀念醫院", custId: "200005", taxId: "59274027" },
  { name: "國軍臺中總醫院", custId: "200006", taxId: "" },
  { name: "竹山秀傳醫院", custId: "200007", taxId: "77393377" },
  { name: "中國醫藥大學北港附設醫院", custId: "200008", taxId: "" },
  { name: "中山醫學大學附設醫院", custId: "200009", taxId: "" },
  { name: "秀傳醫療財團法人彰濱秀傳紀念醫院", custId: "200010", taxId: "" },
  { name: "衛生福利部台中醫院", custId: "200011", taxId: "" },
  { name: "童綜合醫療社團法人童綜合醫院", custId: "200012", taxId: "" },
  { name: "仁愛醫療財團法人", custId: "200013", taxId: "" },
  { name: "衛生福利部苗栗醫院", custId: "200014", taxId: "" },
  { name: "彰化基督教醫院", custId: "200015", taxId: "" },
  { name: "澄清綜合醫院", custId: "200016", taxId: "" },
  { name: "衛生福利部嘉義醫院", custId: "200017", taxId: "" },
  { name: "財團法人嘉義基督教醫院", custId: "200018", taxId: "" },
  { name: "衛生福利部南投醫院", custId: "200019", taxId: "" },
  { name: "埔基醫療財團法人埔里基督教醫院", custId: "200020", taxId: "" },
  { name: "亞洲大學附設醫院", custId: "200021", taxId: "47456418" },
  { name: "亞洲大學附屬醫院", custId: "200021", taxId: "47456418" },
  { name: "台中市立老人復健綜合醫院", custId: "200022", taxId: "92232549" },
  { name: "臺中市立老人復健綜合醫院(委託財團法人中國醫藥大學興建經營)", custId: "200022", taxId: "92232549" },
  { name: "台中榮民總醫院", custId: "200027", taxId: "" },
  { name: "臺中榮民總醫院", custId: "200027", taxId: "" },
  { name: "瑞友儀器行", custId: "200051", taxId: "52577074" },
  { name: "林新醫療社團法人林新醫院", custId: "200087", taxId: "52697438" },
  { name: "中國醫藥大學新竹附設醫院", custId: "200088", taxId: "" },
  { name: "臺中其他同行", custId: "200104", taxId: "" },
  { name: "臺中個人", custId: "200105", taxId: "" },
  { name: "臺中其他醫院", custId: "200116", taxId: "" },
  { name: "台中榮民醫院埔里分院", custId: "200152", taxId: "" },
  { name: "衛康醫療儀器股份有限公司", custId: "200164", taxId: "" },
  { name: "財團法人為恭紀念醫院", custId: "200167", taxId: "" },
  { name: "為恭醫療財團法人為恭紀念醫院", custId: "200167", taxId: "" },
  { name: "台安醫院", custId: "200176", taxId: "77974986" },
  { name: "保健安股份有限公司", custId: "200179", taxId: "70442438" },
  { name: "中國醫藥大學附設醫院臺北分院", custId: "200180", taxId: "" },
  { name: "財團法人佛教慈濟綜合醫院台中分院", custId: "200189", taxId: "" },
  { name: "佛教慈濟醫療財團法人台中慈濟醫院", custId: "200189", taxId: "" },
  { name: "臺南市立安南醫院-委託中國醫藥大學興建經營", custId: "200190", taxId: "37623985" },
  { name: "臺南市立安南醫院", custId: "200190", taxId: "37623985" }
];

// ============================================================================
// 1. 試算表客製化 UI 選單 (同步中心)
// ============================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 ERP 同步中心')
    .addItem('⬇️ 匯入最新營運資料 (Supabase ➔ 試算表)', 'pullOperationalDataFromSupabase')
    .addItem('⬆️ 上傳基礎設定 (試算表 ➔ Supabase)', 'pushBaseDataToSupabase')
    .addItem('💰 同步沖帳與收款狀態 (試算表 ➔ Supabase)', 'pushPaymentAndSalesStatusToSupabase')
    .addSeparator()
    .addItem('🔄 自動比對填入外部客戶代號 (客戶管理 F欄)', 'autoFillClientCustIds')
    .addItem('🛠️ 初始化/檢查「沖帳記錄表」與銷售明細欄位', 'initPaymentSheetsManual')
    .addToUi();
}

// ============================================================================
// 自動建立與檢查「沖帳記錄表」及「銷售明細總表」沖帳連動欄位 (N~Q欄)
// ============================================================================
function ensurePaymentSheetAndColumns(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 確保「沖帳記錄表」存在且具備完整 14 欄結構
  let sPay = ss.getSheetByName('沖帳記錄表');
  const payHeaders = [
    '沖帳單號', '建立時間', '實際收款日', '客戶名稱', '收款方式',
    '沖銷發票清單', '應收帳款總額', '實收金額', '匯費/折讓/差額', '沖帳狀態',
    '沖銷明細JSON', '帳款來源', '經辦人員', '備註說明'
  ];
  if (!sPay) {
    sPay = ss.insertSheet('沖帳記錄表');
    sPay.getRange(1, 1, 1, payHeaders.length).setValues([payHeaders]);
    sPay.getRange(1, 1, 1, payHeaders.length)
      .setFontWeight('bold')
      .setBackground('#d1e7dd')
      .setHorizontalAlignment('center');
    sPay.setFrozenRows(1);
  } else {
    const firstRow = sPay.getRange(1, 1, 1, payHeaders.length).getValues()[0];
    if (!firstRow[0]) {
      sPay.getRange(1, 1, 1, payHeaders.length).setValues([payHeaders]);
      sPay.getRange(1, 1, 1, payHeaders.length)
        .setFontWeight('bold')
        .setBackground('#d1e7dd');
      sPay.setFrozenRows(1);
    }
  }

  // 2. 確保「銷售明細總表」具備 N~Q 欄 (第 14~17 欄) 沖帳連動表頭
  let sSales = ss.getSheetByName('銷售明細總表');
  if (sSales) {
    const extHeaders = ['沖帳狀態', '已沖帳金額', '收款日期', '沖帳單號'];
    const currentN = String(sSales.getRange(1, 14).getValue() || '').trim();
    if (!currentN) {
      sSales.getRange(1, 14, 1, 4).setValues([extHeaders]);
      sSales.getRange(1, 14, 1, 4).setFontWeight('bold').setBackground('#cfe2ff');
    }
  }
}

function initPaymentSheetsManual() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensurePaymentSheetAndColumns(ss);
  ui.alert(
    "✅ 結構檢查與建立完成",
    "1. 已確認/建立「沖帳記錄表」(A~N欄 共14欄)。\n2. 已於「銷售明細總表」擴充 N~Q欄（沖帳狀態、已沖帳金額、收款日期、沖帳單號）。",
    ui.ButtonSet.OK
  );
}

// ============================================================================
// 客戶名稱正規化與外部代號 (CUSTID) 自動填入工具
// ============================================================================
function normalizeClientNameForMatch(name) {
  if (!name) return "";
  return String(name)
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/附屬/g, "附設")
    .replace(/[\(（\-]委託.*$/g, "")
    .replace(/醫療財團法人|醫療社團法人|財團法人/g, "")
    .toLowerCase();
}

function autoFillClientCustIds() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sClient = ss.getSheetByName('客戶管理');
  if (!sClient) {
    ui.alert("❌ 找不到工作表", "找不到「客戶管理」工作表！", ui.ButtonSet.OK);
    return;
  }

  const headerF = String(sClient.getRange(1, 6).getValue() || '').trim();
  if (!headerF) {
    sClient.getRange(1, 6).setValue('客戶代號');
  }

  let refList = BUILTIN_CUSTOMER1_LIST.slice();
  const sCust1 = ss.getSheetByName('customer1');
  if (sCust1 && sCust1.getLastRow() > 1) {
    const c1Data = sCust1.getRange(2, 1, sCust1.getLastRow() - 1, Math.max(11, sCust1.getLastColumn())).getValues();
    c1Data.forEach(r => {
      const cName = String(r[0] || '').trim();
      const cState = String(r[5] || '').trim();
      const cId = String(r[10] || '').trim();
      if (cName && cId) {
        const taxMatch = cState.match(/\b(\d{8})\b/);
        refList.push({
          name: cName,
          custId: cId,
          taxId: taxMatch ? taxMatch[1] : ""
        });
      }
    });
  }

  const lastRow = sClient.getLastRow();
  if (lastRow <= 1) {
    ui.alert("提示", "「客戶管理」工作表目前沒有客戶資料。", ui.ButtonSet.OK);
    return;
  }

  const clientRange = sClient.getRange(2, 1, lastRow - 1, 6);
  const clientValues = clientRange.getValues();
  let updatedCount = 0;

  for (let i = 0; i < clientValues.length; i++) {
    const erpName = String(clientValues[i][0] || '').trim();
    const erpTaxId = String(clientValues[i][1] || '').trim();
    const currentCustId = String(clientValues[i][5] || '').trim();
    if (!erpName) continue;

    const normErpName = normalizeClientNameForMatch(erpName);
    let matchedCustIds = [];

    if (currentCustId) {
      currentCustId.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
        if (matchedCustIds.indexOf(id) === -1) matchedCustIds.push(id);
      });
    }

    refList.forEach(ref => {
      if (!ref.custId) return;
      const normRefName = normalizeClientNameForMatch(ref.name);
      const isNameExact = (erpName === ref.name) || (normErpName && normErpName === normRefName);
      const isTaxMatch = (erpTaxId && ref.taxId && erpTaxId === ref.taxId);

      if (isNameExact || isTaxMatch) {
        if (matchedCustIds.indexOf(ref.custId) === -1) {
          matchedCustIds.push(ref.custId);
        }
      }
    });

    const finalCustIdStr = matchedCustIds.join(', ');
    if (finalCustIdStr && finalCustIdStr !== currentCustId) {
      clientValues[i][5] = finalCustIdStr;
      updatedCount++;
    }
  }

  clientRange.setValues(clientValues);
  ui.alert(
    "✅ 客戶代號自動對照完成",
    `已針對「客戶管理」現有客戶完成比對，共更新了 ${updatedCount} 筆客戶的 F 欄（客戶代號）！\n（不在「客戶管理」工作表內的舊客戶已自動忽略）\n\n請接著點擊「⬆️ 上傳基礎設定 (試算表 ➔ Supabase)」將代號同步至雲端資料庫。`,
    ui.ButtonSet.OK
  );
}

// ============================================================================
// 2. Supabase REST API 核心通訊模組
// ============================================================================
function supabaseFetchAll(table, ignoreMissingTable) {
  let allData = [];
  let offset = 0;
  const limit = 1000;
  
  let orderQuery = "";
  const tablesWithRowIdx = ['orders', 'invoices', 'sales_details', 'inventory_logs', 'deliveries', 'quotations', 'payment_records'];
  if (tablesWithRowIdx.includes(table)) {
    orderQuery = "&order=row_idx.asc";
  } else if (table === 'catalog') {
    orderQuery = "&order=row_index.asc";
  }

  while (true) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?select=*${orderQuery}&limit=${limit}&offset=${offset}`;
    const options = {
      method: "get",
      headers: { "apikey": CONFIG.SUPABASE_KEY, "Authorization": "Bearer " + CONFIG.SUPABASE_KEY },
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() >= 400) {
      if (ignoreMissingTable) return [];
      throw new Error(`讀取 ${table} 失敗: ${response.getContentText()}`);
    }
    const json = JSON.parse(response.getContentText());
    if (!json || json.length === 0) break;
    allData = allData.concat(json);
    if (json.length < limit) break;
    offset += limit;
  }
  return allData;
}

function supabaseClearTable(table, notNullColumn) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?${notNullColumn}=not.is.null`;
  const options = {
    method: "delete",
    headers: {
      "apikey": CONFIG.SUPABASE_KEY,
      "Authorization": "Bearer " + CONFIG.SUPABASE_KEY
    },
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() >= 400) {
    throw new Error(`清理 ${table} 舊資料失敗: ${response.getContentText()}`);
  }
}

function supabaseUpsertBulk(table, dataArray) {
  if (!dataArray || dataArray.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < dataArray.length; i += chunkSize) {
    const chunk = dataArray.slice(i, i + chunkSize);
    const options = {
      method: "post",
      headers: {
        "apikey": CONFIG.SUPABASE_KEY,
        "Authorization": "Bearer " + CONFIG.SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, options);
    if (response.getResponseCode() >= 400) throw new Error(`寫入 ${table} 失敗: ${response.getContentText()}`);
  }
}

// ============================================================================
// 3. 雙向同步邏輯 (手動按鈕觸發)
// ============================================================================

function pullOperationalDataFromSupabase() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ui.alert("開始同步", "正在從 Supabase 下載最新營運資料（含沖帳記錄表與銷售明細沖帳狀態），請稍候...", ui.ButtonSet.OK);

  try {
    // 確保「沖帳記錄表」與「銷售明細總表」N~Q欄已準備好
    ensurePaymentSheetAndColumns(ss);

    const tablesToPull = [
      {
        name: 'orders',
        sheet: '訂單總表',
        map: d => [new Date(d.time), d.client, d.order_no, d.dept, d.status, d.json_str, d.deadline, d.source, d.mail_url]
      },
      {
        name: 'invoices',
        sheet: '開立發票紀錄',
        map: d => [new Date(d.time), d.staff, d.client, d.tax_id, d.net, d.tax, d.total, d.details, d.paper_no, d.order_no, d.status, d.history_log]
      },
      {
        name: 'sales_details',
        sheet: '銷售明細總表',
        map: d => [
          new Date(d.time), d.paper_no, d.client, d.order_no, d.name, d.qty, d.unit, d.price, d.subtotal,
          d.ship_status, d.shipped_qty, d.lot, d.expiry,
          d.pay_status || '未收款', Number(d.paid_amount) || 0, d.pay_date || '', d.payment_no || ''
        ]
      },
      {
        name: 'inventory',
        sheet: '庫存管理',
        map: d => [d.name, d.qty, d.alert_qty, d.cost, d.supplier, d.internal_code, d.asset_code_combined, d.batches_str, ""]
      },
      {
        name: 'inventory_logs',
        sheet: '庫存異動紀錄',
        map: d => [new Date(d.time), d.staff, d.name, d.type, d.qty_change, d.new_qty, d.lot, d.expiry, d.invoice_no, d.order_no, d.memo, d.arrival_date, d.snapshot, d.internal_code]
      },
      {
        name: 'deliveries',
        sheet: '送貨追蹤總表',
        map: d => [new Date(d.time), d.paper_no, d.client, d.items_str, d.status, d.delivery_date, d.delivery_method, d.memo, d.signature, d.staff, d.order_no, d.lot, d.expiry]
      },
      {
        name: 'quotations',
        sheet: '估價單總表',
        map: d => [new Date(d.time), d.quote_no, d.quote_date, d.client, d.status, d.json_str, d.use_seal ? true : false, d.merge_id, d.staff, d.memo]
      },
      {
        name: 'payment_records',
        sheet: '沖帳記錄表',
        optional: true,
        map: d => [
          d.payment_no || '', new Date(Number(d.time) || Date.now()), d.pay_date || '', d.client || '',
          d.pay_method || '', d.paper_nos || '', Number(d.receivable_total) || 0, Number(d.received_amount) || 0,
          Number(d.diff_amount) || 0, d.status || '已沖帳結清', d.items_json || '[]',
          d.source_type || 'ERP原生帳款', d.staff || '', d.memo || ''
        ]
      }
    ];

    tablesToPull.forEach(target => {
      const data = supabaseFetchAll(target.name, !!target.optional);
      let sheet = ss.getSheetByName(target.sheet);
      if (sheet) {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        if (data.length > 0) {
          const mappedData = data.map(target.map);
          sheet.getRange(2, 1, mappedData.length, mappedData[0].length).setValues(mappedData);
        }
      }
    });

    ui.alert("✅ 同步完成", "所有營運資料（含「沖帳記錄表」與「銷售明細總表」沖帳狀態）已成功匯入試算表！", ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("❌ 同步失敗", err.message, ui.ButtonSet.OK);
  }
}

function pushBaseDataToSupabase() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const response = ui.alert(
    "確認上傳",
    "確定要將目前的「員工憑證、客戶管理(含F欄代號)、供應商、產品價格表、庫存管理、收件信箱」覆蓋至 Supabase 嗎？\n(以試算表資料為主)",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    ensurePaymentSheetAndColumns(ss);

    // 1. 同步員工憑證
    let sEmp = ss.getSheetByName('員工憑證');
    if (sEmp && sEmp.getLastRow() > 1) {
      let d = sEmp.getRange(2, 1, sEmp.getLastRow() - 1, 2).getValues();
      let empMap = new Map();
      d.filter(r => r[0] && r[1]).forEach(r => {
        let name = String(r[0]).trim();
        empMap.set(name, { name: name, pwd: String(r[1]).trim() });
      });
      let arr = Array.from(empMap.values());
      supabaseClearTable('employees', 'name');
      supabaseUpsertBulk('employees', arr);
    }

    // 2. 同步客戶管理 (含 F 欄外部系統 CUSTID 代號)
    let sClient = ss.getSheetByName('客戶管理');
    if (sClient && sClient.getLastRow() > 1) {
      let maxClientCols = Math.max(6, sClient.getLastColumn());
      let d = sClient.getRange(2, 1, sClient.getLastRow() - 1, maxClientCols).getValues();
      let clientMap = new Map();
      d.filter(r => r[0]).forEach(r => {
        let name = String(r[0]).trim();
        clientMap.set(name, {
          name: name,
          tax_id: String(r[1] || '').trim(),
          address: String(r[3] || '').trim(),
          receive_dept: String(r[4] || '').trim(),
          cust_id: String(r[5] || '').trim()
        });
      });
      let arr = Array.from(clientMap.values());
      supabaseClearTable('clients', 'name');
      try {
        supabaseUpsertBulk('clients', arr);
      } catch (clientErr) {
        if (String(clientErr.message).includes('cust_id')) {
          let fallbackArr = arr.map(c => ({
            name: c.name,
            tax_id: c.tax_id,
            address: c.address,
            receive_dept: c.receive_dept
          }));
          supabaseUpsertBulk('clients', fallbackArr);
        } else {
          throw clientErr;
        }
      }
    }

    // 3. 同步供應商
    let sSup = ss.getSheetByName('供應商');
    if (sSup && sSup.getLastRow() > 1) {
      let d = sSup.getRange(2, 1, sSup.getLastRow() - 1, 7).getValues();
      let supMap = new Map();
      d.filter(r => r[0]).forEach(r => {
        let name = String(r[0]).trim();
        supMap.set(name, {
          name: name,
          code: String(r[6] || '').trim(),
          phone: String(r[3] || '').trim(),
          fax: String(r[4] || '').trim()
        });
      });
      let arr = Array.from(supMap.values());
      supabaseClearTable('suppliers', 'name');
      supabaseUpsertBulk('suppliers', arr);
    }

    // 4. 同步產品價格表
    let assetMap = {};
    let sCat = ss.getSheetByName('產品價格表');
    if (sCat && sCat.getLastRow() > 1) {
      let d = sCat.getRange(2, 1, sCat.getLastRow() - 1, 7).getValues();
      let catMap = new Map();
      d.filter(r => r[4] && r[2]).forEach((r, i) => {
        let assetCode = String(r[0] || '').trim();
        let internalCode = String(r[3] || '').trim();
        let clientName = String(r[2] || '').trim();
        let productName = String(r[4] || '').trim();
        let unit = String(r[5] || '式').trim();
        let price = Number(r[6]) || 0;

        if (productName && assetCode) {
          if (!assetMap[productName]) assetMap[productName] = [];
          if (assetMap[productName].indexOf(assetCode) === -1) {
            assetMap[productName].push(assetCode);
          }
        }

        let uniqueKey = `${clientName}|${productName}|${assetCode}|${internalCode}|${price}`;
        catMap.set(uniqueKey, {
          row_index: i + 2,
          asset_code: assetCode,
          internal_code: internalCode,
          client_name: clientName,
          product_name: productName,
          unit: unit,
          price: price
        });
      });
      let arr = Array.from(catMap.values());
      supabaseClearTable('catalog', 'row_index');
      supabaseUpsertBulk('catalog', arr);
    }

    // 5. 同步庫存管理
    let sInv = ss.getSheetByName('庫存管理');
    if (sInv && sInv.getLastRow() > 1) {
      let maxCols = Math.max(8, sInv.getLastColumn());
      let d = sInv.getRange(2, 1, sInv.getLastRow() - 1, maxCols).getValues();
      let invMap = new Map();
      d.filter(r => r[0]).forEach(r => {
        let name = String(r[0]).trim();
        let qty = Number(r[1]) || 0;
        let alertQty = Number(r[2]) || 0;
        let cost = Number(r[3]) || 0;
        let supplier = String(r[4] || '').trim();
        let internalCode = String(r[5] || '').trim();
        let sheetAssetCombined = String(r[6] || '').trim();
        let autoAssetCombined = assetMap[name] ? assetMap[name].join(', ') : '';
        let assetCodeCombined = sheetAssetCombined || autoAssetCombined;
        let batchesStr = String(r[7] || '').trim() || '[]';

        invMap.set(name, {
          name: name,
          qty: qty,
          alert_qty: alertQty,
          cost: cost,
          supplier: supplier,
          internal_code: internalCode,
          asset_code_combined: assetCodeCombined,
          batches_str: batchesStr
        });
      });
      let arr = Array.from(invMap.values());
      supabaseClearTable('inventory', 'name');
      supabaseUpsertBulk('inventory', arr);
    }

    // 6. 同步收件信箱管理
    let sEmail = ss.getSheetByName('收件信箱管理');
    if (sEmail && sEmail.getLastRow() > 1) {
      let d = sEmail.getRange(2, 1, sEmail.getLastRow() - 1, 2).getValues();
      let emailMap = new Map();
      d.filter(r => r[0] && String(r[0]).includes('@')).forEach(r => {
        let email = String(r[0]).trim();
        emailMap.set(email, { email: email, memo: String(r[1] || '').trim() });
      });
      let arr = Array.from(emailMap.values());
      supabaseClearTable('email_settings', 'email');
      supabaseUpsertBulk('email_settings', arr);
    }

    ui.alert("✅ 上傳完成", "包含「客戶管理(含F欄代號)、產品價格表、庫存管理」在內的所有基礎設定已成功覆蓋至 Supabase 資料庫！", ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("❌ 上傳失敗", err.message, ui.ButtonSet.OK);
  }
}

// 將試算表中的「沖帳記錄表」與「銷售明細總表 (N~Q欄沖帳狀態)」同步推播回 Supabase
function pushPaymentAndSalesStatusToSupabase() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const res = ui.alert(
    "確認同步沖帳資料",
    "確定要將試算表中的「沖帳記錄表」以及「銷售明細總表」的沖帳狀態 (N~Q欄) 同步上傳至 Supabase 嗎？",
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  try {
    ensurePaymentSheetAndColumns(ss);

    // 1. 同步「沖帳記錄表」至 Supabase payment_records
    const sPay = ss.getSheetByName('沖帳記錄表');
    if (sPay && sPay.getLastRow() > 1) {
      const payValues = sPay.getRange(2, 1, sPay.getLastRow() - 1, 14).getValues();
      const existingPay = supabaseFetchAll('payment_records', true);
      const payNoToRowIdx = {};
      existingPay.forEach(p => {
        if (p.payment_no) payNoToRowIdx[String(p.payment_no).trim()] = p.row_idx;
      });

      const payArr = [];
      payValues.forEach((r, idx) => {
        const payNo = String(r[0] || '').trim();
        if (!payNo) return;
        const dt = r[1] instanceof Date ? r[1].getTime() : (Number(r[1]) || Date.now());
        const payDateStr = r[2] instanceof Date
          ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[2] || '').trim();

        payArr.push({
          row_idx: payNoToRowIdx[payNo] || (Date.now() + idx),
          payment_no: payNo,
          time: dt,
          pay_date: payDateStr,
          client: String(r[3] || '').trim(),
          pay_method: String(r[4] || '').trim(),
          paper_nos: String(r[5] || '').trim(),
          receivable_total: Number(r[6]) || 0,
          received_amount: Number(r[7]) || 0,
          diff_amount: Number(r[8]) || 0,
          status: String(r[9] || '已沖帳結清').trim(),
          items_json: String(r[10] || '[]').trim(),
          source_type: String(r[11] || 'ERP原生帳款').trim(),
          staff: String(r[12] || '').trim(),
          memo: String(r[13] || '').trim()
        });
      });

      if (payArr.length > 0) {
        supabaseClearTable('payment_records', 'row_idx');
        supabaseUpsertBulk('payment_records', payArr);
      }
    }

    // 2. 同步「銷售明細總表」的沖帳狀態 (N~Q欄) 回 Supabase sales_details
    const sSales = ss.getSheetByName('銷售明細總表');
    if (sSales && sSales.getLastRow() > 1) {
      const salesValues = sSales.getRange(2, 1, sSales.getLastRow() - 1, 17).getValues();
      const remoteSales = supabaseFetchAll('sales_details', true);

      // 以 發票號碼 + 品名 + 數量 建立對應索引
      const updates = [];
      salesValues.forEach(r => {
        const paperNo = String(r[1] || '').trim();
        const name = String(r[4] || '').trim();
        const qty = Number(r[5]) || 0;
        const payStatus = String(r[13] || '未收款').trim();
        const paidAmount = Number(r[14]) || 0;
        const payDate = r[15] instanceof Date
          ? Utilities.formatDate(r[15], Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(r[15] || '').trim();
        const paymentNo = String(r[16] || '').trim();

        const matchedRemote = remoteSales.find(rs =>
          String(rs.paper_no || '').trim() === paperNo &&
          String(rs.name || '').trim() === name &&
          Number(rs.qty) === qty
        );

        if (matchedRemote && (
          (matchedRemote.pay_status || '未收款') !== payStatus ||
          Number(matchedRemote.paid_amount || 0) !== paidAmount ||
          (matchedRemote.pay_date || '') !== payDate ||
          (matchedRemote.payment_no || '') !== paymentNo
        )) {
          matchedRemote.pay_status = payStatus;
          matchedRemote.paid_amount = paidAmount;
          matchedRemote.pay_date = payDate;
          matchedRemote.payment_no = paymentNo;
          updates.push(matchedRemote);
        }
      });

      if (updates.length > 0) {
        supabaseUpsertBulk('sales_details', updates);
      }
    }

    ui.alert("✅ 沖帳同步完成", "試算表的「沖帳記錄表」與「銷售明細總表」沖帳狀態已成功同步至 Supabase！", ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("❌ 沖帳同步失敗", err.message, ui.ButtonSet.OK);
  }
}