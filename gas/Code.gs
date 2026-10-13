/**
 * ============================================================================
 * 長固 ERP - 後台總控中心 (部署於 fcw031@gmail.com)
 * 負責：建立試算表同步選單、雙向更新 Supabase 營運資料與基礎設定
 * ============================================================================
 */

const CONFIG = {
  SUPABASE_URL: "https://dojhiznffztiyofkfdiu.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvamhpem5mZnp0aXlvZmtmZGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzk3MzYsImV4cCI6MjEwNTMxNTczNn0.reT6i25kO1d1V8p2fDMHOOPVxaUJfp9SxOFeg-_xFqI",
};

// ============================================================================
// 1. 試算表客製化 UI 選單 (同步中心)
// ============================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 ERP 同步中心')
    .addItem('⬇️ 匯入最新營運資料 (Supabase ➔ 試算表)', 'pullOperationalDataFromSupabase')
    .addItem('⬆️ 上傳基礎設定 (試算表 ➔ Supabase)', 'pushBaseDataToSupabase')
    .addToUi();
}

// ============================================================================
// 2. Supabase REST API 核心通訊模組
// ============================================================================
function supabaseFetchAll(table) {
  let allData = [];
  let offset = 0;
  const limit = 1000;
  
  // 針對沒有 row_idx 的資料表，取消強制排序
  let orderQuery = "";
  const tablesWithRowIdx = ['orders', 'invoices', 'sales_details', 'inventory_logs', 'deliveries', 'quotations'];
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
    if (response.getResponseCode() >= 400) throw new Error(`讀取 ${table} 失敗: ${response.getContentText()}`);
    const json = JSON.parse(response.getContentText());
    if (!json || json.length === 0) break;
    allData = allData.concat(json);
    if (json.length < limit) break;
    offset += limit;
  }
  return allData;
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
  ui.alert("開始同步", "正在從 Supabase 下載最新營運資料，請稍候...", ui.ButtonSet.OK);

  try {
    const tablesToPull = [
      { name: 'orders', sheet: '訂單總表', map: d => [new Date(d.time), d.client, d.order_no, d.dept, d.status, d.json_str, d.deadline, d.source, d.mail_url] },
      { name: 'invoices', sheet: '開立發票紀錄', map: d => [new Date(d.time), d.staff, d.client, d.tax_id, d.net, d.tax, d.total, d.details, d.paper_no, d.order_no, d.status, d.history_log] },
      { name: 'sales_details', sheet: '銷售明細總表', map: d => [new Date(d.time), d.paper_no, d.client, d.order_no, d.name, d.qty, d.unit, d.price, d.subtotal, d.ship_status, d.shipped_qty, d.lot, d.expiry] },
      { name: 'inventory', sheet: '庫存管理', map: d => [d.name, d.qty, d.alert_qty, d.cost, d.supplier, d.internal_code, d.asset_code_combined, d.batches_str, ""] },
      { name: 'inventory_logs', sheet: '庫存異動紀錄', map: d => [new Date(d.time), d.staff, d.name, d.type, d.qty_change, d.new_qty, d.lot, d.expiry, d.invoice_no, d.order_no, d.memo, d.arrival_date, d.snapshot, d.internal_code] },
      { name: 'deliveries', sheet: '送貨追蹤總表', map: d => [new Date(d.time), d.paper_no, d.client, d.items_str, d.status, d.delivery_date, d.delivery_method, d.memo, d.signature, d.staff, d.order_no, d.lot, d.expiry] },
      { name: 'quotations', sheet: '估價單總表', map: d => [new Date(d.time), d.quote_no, d.quote_date, d.client, d.status, d.json_str, d.use_seal ? true : false, d.merge_id, d.staff, d.memo] }
    ];

    tablesToPull.forEach(target => {
      const data = supabaseFetchAll(target.name);
      let sheet = ss.getSheetByName(target.sheet);
      if (sheet && data.length > 0) {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        
        const mappedData = data.map(target.map);
        sheet.getRange(2, 1, mappedData.length, mappedData[0].length).setValues(mappedData);
      }
    });

    ui.alert("✅ 同步完成", "所有營運資料已成功匯入試算表！", ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("❌ 同步失敗", err.message, ui.ButtonSet.OK);
  }
}

function pushBaseDataToSupabase() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const response = ui.alert("確認上傳", "確定要將目前的「員工憑證、客戶、供應商、產品價格、信箱」覆蓋至 Supabase 嗎？\n(以試算表資料為主)", ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;

  try {
    // 【新增】同步員工憑證 (A欄: 員工名稱, B欄: 密碼)
    let sEmp = ss.getSheetByName('員工憑證');
    if (sEmp && sEmp.getLastRow() > 1) {
      let d = sEmp.getRange(2, 1, sEmp.getLastRow() - 1, 2).getValues();
      let arr = d.filter(r => r[0] && r[1]).map(r => ({ name: String(r[0]).trim(), pwd: String(r[1]).trim() }));
      supabaseUpsertBulk('employees', arr);
    }

    let sClient = ss.getSheetByName('客戶管理');
    if (sClient && sClient.getLastRow() > 1) {
      let d = sClient.getRange(2, 1, sClient.getLastRow() - 1, 5).getValues();
      let arr = d.filter(r => r[0]).map(r => ({ name: String(r[0]).trim(), tax_id: String(r[1]).trim(), address: String(r[3]).trim(), receive_dept: String(r[4]).trim() }));
      supabaseUpsertBulk('clients', arr);
    }

    let sSup = ss.getSheetByName('供應商');
    if (sSup && sSup.getLastRow() > 1) {
      let d = sSup.getRange(2, 1, sSup.getLastRow() - 1, 7).getValues();
      let arr = d.filter(r => r[0]).map(r => ({ name: String(r[0]).trim(), code: String(r[6]).trim(), phone: String(r[3]).trim(), fax: String(r[4]).trim() }));
      supabaseUpsertBulk('suppliers', arr);
    }

    let sCat = ss.getSheetByName('產品價格表');
    if (sCat && sCat.getLastRow() > 1) {
      let d = sCat.getRange(2, 1, sCat.getLastRow() - 1, 7).getValues();
      let arr = d.filter(r => r[4] && r[2]).map((r, i) => ({
        row_index: i + 2, asset_code: String(r[0]).trim(), internal_code: String(r[3]).trim(),
        client_name: String(r[2]).trim(), product_name: String(r[4]).trim(),
        unit: String(r[5] || '式').trim(), price: Number(r[6]) || 0
      }));
      supabaseUpsertBulk('catalog', arr);
    }

    let sEmail = ss.getSheetByName('收件信箱管理');
    if (sEmail && sEmail.getLastRow() > 1) {
      let d = sEmail.getRange(2, 1, sEmail.getLastRow() - 1, 2).getValues();
      let arr = d.filter(r => r[0] && r[0].includes('@')).map(r => ({ email: String(r[0]).trim(), memo: String(r[1]).trim() }));
      supabaseUpsertBulk('email_settings', arr);
    }

    ui.alert("✅ 上傳完成", "包含「員工憑證」在內的基礎設定已成功推播至 Supabase 資料庫！", ui.ButtonSet.OK);
  } catch (err) {
    ui.alert("❌ 上傳失敗", err.message, ui.ButtonSet.OK);
  }
}