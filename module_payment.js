/**
 * ============================================================================
 * 模組 7：收款明細與沖帳 + 跨系統未收款智慧勾稽中心 + 未收/已沖帳三表樞紐分析中心 (module_payment.js)
 * 【PDF/Excel 智慧上傳 ＆ ⚡無誤快沖彈窗 ＆ ⏪防呆撤銷 ＆ ⚠️三階段覆核 ＆ 📊未收/已沖帳雙樞紐列印升級版】
 * 1. 待收款管理與收款沖帳 (雙向連動「沖帳記錄表」與「銷售明細總表」N~Q欄)
 * 2. 點擊頂部「🔴 總待收款金額 (含稅)」彈出完美復刻「未收款-11511.xlsx」三工作表連動分析視窗
 * 3. 點擊頂部「🟢 累計已完成沖帳」彈出「已完成沖帳區間查詢與三表匯出/多選列印中心」
 *    - 支援時間區間搜尋、快捷期間按鈕、客戶/收款方式篩選、僅顯示差額快篩、下鑽查明細、單張傳票憑證列印
 * 4. 支援上傳 PDF / Excel 付款單對帳，內建 Gemini AI / PDF.js 轉 Excel 檔案下載功能
 * 5. 第一階段：自動彈出「⚡ 比對無誤一鍵快速確認沖帳」視窗，完成後自動消失
 * 6. 第二階段：內建「⏪ 撤銷返回上一步」防呆快照還原機制 (同步還原 Supabase 與前端狀態)
 * 7. 第三階段：自動展開「⚠️ 付款單據待確認 / 金額相異人工覆核區」(差額帶入沖帳 / 已沖忽略 / 補建舊帳沖帳)
 * ============================================================================
 */

const PAYMENT_RECONCILE_STORAGE_KEY = 'changgu_erp_unpaid_reconcile_v1';
const PAYMENT_DOC_UPLOAD_STORAGE_KEY = 'changgu_erp_payment_doc_upload_v1';
const PAYMENT_UNDO_STORAGE_KEY = 'changgu_erp_payment_undo_stack_v1';
const GEMINI_API_KEY_STORAGE = 'changgu_erp_gemini_api_key';
const ERP_START_CUTOFF_DATE = '2026-05-01';

window.paymentModuleState = {
    viewMode: 'invoice', // 'invoice' (依發票歸戶) | 'item' (依單一品項)
    selectedRowIndices: new Set(),
    legacyStagedItems: [],
    undoStack: [], // 儲存「⏪ 撤銷返回上一步」的快照堆疊
    activeStage3Key: null, // 記錄目前正在從第三階段執行人工沖帳的項目 key
    docReconcile: {
        fileName: '',
        fileType: '', // 'PDF' | 'EXCEL'
        uploadedAt: '',
        convertedExcelRows: [], // 供下載轉檔後 Excel 使用之標準列資料
        exactMatches: [],       // 🟢 第一階段：100% 比對無誤項目
        pendingReviews: [],     // ⚠️ 第三階段：待人工確認項目 (AMOUNT_DIFF, ALREADY_PAID, NOT_FOUND)
        resolvedKeys: {},       // 已完成沖帳或已忽略的項目 key
        stage3Filter: 'ALL'     // 'ALL' | 'AMOUNT_DIFF' | 'ALREADY_PAID' | 'NOT_FOUND'
    },
    unpaidReconcile: {
        fileName: '',
        uploadedAt: '',
        extRows: [],
        results: [],
        reviewedMap: {},
        currentFilter: 'ALL_DIFF',
        searchTerm: ''
    },
    // 📊 復刻「未收款-11511.xlsx」三工作表分析視窗狀態
    workbookView: {
        dataSource: 'ERP_LIVE',             // 'ERP_LIVE' (本系統即時未收) | 'EXT_EXCEL' (外部上傳之未收款Excel)
        clientDisplayMode: 'CODE_AND_NAME', // 'CODE_ONLY' (純代號如200001) | 'CODE_AND_NAME' (代號+醫院名稱)
        agingHighlight: true,               // 是否啟用 2026/05 前舊帳帳齡粉紅警戒色標
        activeSheet: 'SHEET_3',             // 'SHEET_1' (收款總表) | 'SHEET_2' (未付款-OLD) | 'SHEET_3' (分析表1)
        drillFilter: null,                  // { title: '', custId: '', year: '', yearMonth: '', reconcileDate: '' }
        sheet2Search: ''                    // 未付款-OLD 關鍵字搜尋
    },
    // 🟢 「累計已完成沖帳」時間區間查詢與三表匯出列印視窗狀態
    paidReportView: {
        dateBasis: 'PAY_DATE',              // 'PAY_DATE' (依實際收款日) | 'CREATE_TIME' (依系統建立日)
        startDate: '',                      // YYYY-MM-DD
        endDate: '',                        // YYYY-MM-DD
        clientFilter: '',                   // 篩選特定客戶
        methodFilter: '',                   // 篩選收款方式
        sourceFilter: '',                   // 篩選帳款來源
        searchTerm: '',                     // 關鍵字模糊搜尋
        onlyDiff: false,                    // 進階優化 1：僅顯示有匯費/折讓差額之沖帳單
        activeSheet: 'PAID_S1',             // 'PAID_S1' (已沖帳收款總表) | 'PAID_S2' (發票品項展開明細表) | 'PAID_S3' (客戶別收款統計表)
        drillClient: null                   // 進階優化 2：從客戶別統計表點擊下鑽之客戶名稱
    }
};

// ============================================================================
// 1. 初始化模組介面與所有彈跳視窗
// ============================================================================
window.initPaymentModule = function() {
    const root = document.getElementById('paymentModuleRoot');
    if (!root) return;
    if (root.innerHTML.trim() !== '' && document.getElementById('payMainTabs')) return;

    root.innerHTML = `
        <!-- 頂部應收與沖帳總覽 KPI (第1張「🔴 總待收款金額」與第4張「🟢 累計已完成沖帳」皆支援點擊互動分析與列印) -->
        <div class="row g-2 mb-3">
            <div class="col-6 col-md-3">
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100 position-relative"
                     style="border-left: 5px solid #dc3545 !important; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;"
                     onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(220,53,69,0.18)';"
                     onmouseout="this.style.transform=''; this.style.boxShadow='';"
                     onclick="window.openUnpaidWorkbookModal()"
                     title="點擊開啟「未收款三表連動分析與列印中心（收款總表 / 未付款-OLD / 分析表1）」">
                    <div class="small fw-bold text-muted">🔴 總待收款金額 (含稅)</div>
                    <div class="fs-4 fw-bold text-danger mt-1" id="payKpiTotalUnpaid">$0</div>
                    <div class="small text-secondary" id="payKpiTotalUnpaidCount">共 0 筆未收明細</div>
                    <div class="mt-1">
                        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger" style="font-size: 0.72rem;">
                            📊 點擊檢視三表分析與列印
                        </span>
                    </div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100" style="border-left: 4px solid #0d6efd !important;">
                    <div class="small fw-bold text-muted">📅 5月後 ERP 原生未收</div>
                    <div class="fs-4 fw-bold text-primary mt-1" id="payKpiErpUnpaid">$0</div>
                    <div class="small text-secondary" id="payKpiErpUnpaidCount">0 筆明細</div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100" style="border-left: 4px solid #fd7e14 !important;">
                    <div class="small fw-bold text-muted">🕰️ 5月前歷史未收餘額</div>
                    <div class="fs-4 fw-bold" style="color:#fd7e14;" id="payKpiLegacyUnpaid">$0</div>
                    <div class="small text-secondary" id="payKpiLegacyUnpaidCount">0 筆歷史明細</div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100 position-relative"
                     style="border-left: 5px solid #198754 !important; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;"
                     onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(25,135,84,0.22)';"
                     onmouseout="this.style.transform=''; this.style.boxShadow='';"
                     onclick="window.openPaidReportModal()"
                     title="點擊開啟「已完成沖帳區間查詢、Excel 下載與多選列印中心」">
                    <div class="small fw-bold text-muted">🟢 累計已完成沖帳</div>
                    <div class="fs-4 fw-bold text-success mt-1" id="payKpiTotalPaid">$0</div>
                    <div class="small text-secondary" id="payKpiTotalPaidCount">共 0 筆沖帳單</div>
                    <div class="mt-1">
                        <span class="badge bg-success bg-opacity-10 text-success border border-success" style="font-size: 0.72rem;">
                            🔎 點擊依區間查詢與匯出列印
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 四大核心頁籤導覽 -->
        <ul class="nav nav-pills nav-fill mb-3 bg-light p-1 rounded border" id="payMainTabs">
            <li class="nav-item">
                <button class="nav-link active fw-bold py-2" data-bs-toggle="pill" data-bs-target="#tabPayPending" onclick="window.renderPendingReceivables()">
                    💵 1. 待收款與執行沖帳
                </button>
            </li>
            <li class="nav-item">
                <button class="nav-link fw-bold py-2" data-bs-toggle="pill" data-bs-target="#tabPayRecords" onclick="window.renderPaymentHistory()">
                    🧾 2. 沖帳記錄總表
                </button>
            </li>
            <li class="nav-item">
                <button class="nav-link fw-bold py-2" data-bs-toggle="pill" data-bs-target="#tabPayLegacy" onclick="window.renderLegacyUnpaidManager()">
                    🕰️ 3. 5月前歷史未收帳管理
                </button>
            </li>
            <li class="nav-item">
                <button class="nav-link fw-bold py-2" data-bs-toggle="pill" data-bs-target="#tabPayReconcile" onclick="window.renderUnpaidReconcileCenter()">
                    🤖 4. 跨系統未收/沖帳比對中心
                </button>
            </li>
        </ul>

        <div class="tab-content">
            <!-- ==================== 頁籤 1：待收款與執行沖帳 ==================== -->
            <div class="tab-pane fade show active" id="tabPayPending">
                
                <!-- 📂 外部付款單/對帳單智慧匯入與快速沖帳中心 (支援 PDF / Excel + AI 轉 Excel 下載) -->
                <div class="p-3 rounded border shadow-sm mb-3" style="background: linear-gradient(135deg, #f0fdf4 0%, #e6fcf5 100%); border-color: #20c997 !important;">
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <div>
                            <div class="d-flex align-items-center gap-2 flex-wrap">
                                <h6 class="fw-bold mb-0" style="color: #0ca678;">⚡ 外部付款單 / 對帳單智慧上傳與一鍵快速沖帳中心</h6>
                                <span id="payDocStatusBadge" class="badge bg-success" style="display:none;">已載入單據</span>
                            </div>
                            <div class="small text-secondary mt-1">
                                支援直接上傳 <strong>PDF (.pdf)</strong> 或 <strong>Excel (.xlsx / .xls / .csv)</strong> 對帳單！系統會自動彈出「<strong>⚡ 比對無誤一鍵快速確認沖帳</strong>」視窗，完成後自動展開待確認人工覆核區。
                            </div>
                        </div>
                        <div class="d-flex flex-wrap align-items-center gap-2">
                            <label class="btn btn-success fw-bold shadow-sm mb-0 px-3 py-2" style="cursor:pointer;">
                                📤 上傳付款單比對 (PDF / Excel)
                                <input type="file" id="payStatementFileInput" accept=".pdf,.xlsx,.xls,.csv" style="display:none;" onchange="window.handlePaymentStatementUpload(this)">
                            </label>
                            <button type="button" id="btnReopenQuickMatchModal" class="btn btn-warning fw-bold shadow-sm py-2" style="display:none;" onclick="window.openQuickMatchModal()">
                                ⚡ 開啟無誤快沖視窗 (<span id="btnReopenQuickMatchCount">0</span>)
                            </button>
                            <button type="button" id="btnDownloadConvertedExcel" class="btn btn-outline-primary bg-white fw-bold shadow-sm py-2" style="display:none;" onclick="window.downloadConvertedPaymentExcel()">
                                📥 下載 AI 轉檔之 Excel (.xlsx)
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-secondary bg-white fw-bold py-2" onclick="window.openGeminiKeyModal()" title="設定 Gemini AI 金鑰以啟用深度 PDF 視覺轉檔">
                                🤖 AI 轉檔設定
                            </button>
                            <button type="button" id="btnClearUploadedPayDoc" class="btn btn-sm btn-outline-danger bg-white fw-bold py-2" style="display:none;" onclick="window.clearUploadedPaymentDoc()">
                                🗑️ 清除單據
                            </button>
                        </div>
                    </div>
                </div>

                <!-- ⏪ 第二階段：防呆「撤銷返回上一步」橫幅 -->
                <div id="payUndoBanner" class="alert alert-warning border-warning shadow-sm mb-3 py-2 px-3" style="display:none;">
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <div class="d-flex align-items-center gap-2">
                            <span class="fs-5">🛡️</span>
                            <div>
                                <div class="fw-bold text-dark" id="payUndoBannerTitle">已完成快速沖帳作業</div>
                                <div class="small text-secondary" id="payUndoBannerSub">若發現操作有誤或選錯單據，可立即撤銷並完整還原至沖帳前狀態（共可撤銷 <span id="payUndoStackCount">1</span> 步）。</div>
                            </div>
                        </div>
                        <button type="button" class="btn btn-danger fw-bold shadow-sm px-3" onclick="window.undoLastPaymentAction()">
                            ⏪ 撤銷返回上一步 (還原沖帳)
                        </button>
                    </div>
                </div>

                <!-- ⚠️ 第三階段：付款單據待確認 / 金額相異人工覆核區 -->
                <div id="payDocPendingReviewZone" class="card border-warning shadow-sm mb-3" style="display:none; border-top: 4px solid #fd7e14 !important;">
                    <div class="card-header bg-warning bg-opacity-10 d-flex flex-wrap justify-content-between align-items-center gap-2 py-2">
                        <div>
                            <h6 class="fw-bold text-dark mb-0">⚠️ 上傳單據待確認與人工沖帳清單 <span class="badge bg-danger ms-1" id="stage3TotalPendingBadge">0 筆待處理</span></h6>
                            <div class="small text-muted">以下為上傳單據中「金額有匯費/折讓差額」、「本系統已沖帳」或「查無對應未收明細」之項目，請依分類快速覆核：</div>
                        </div>
                        <div class="d-flex flex-wrap gap-1">
                            <button type="button" class="btn btn-sm btn-outline-dark fw-bold" id="s3Filter_ALL" onclick="window.setStage3Filter('ALL')">
                                全部待確認 (<span id="s3Cnt_ALL">0</span>)
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" id="s3Filter_AMOUNT_DIFF" onclick="window.setStage3Filter('AMOUNT_DIFF')">
                                🟡 金額有差額 (<span id="s3Cnt_AMOUNT_DIFF">0</span>)
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-primary fw-bold" id="s3Filter_ALREADY_PAID" onclick="window.setStage3Filter('ALREADY_PAID')">
                                🔵 先前已沖帳 (<span id="s3Cnt_ALREADY_PAID">0</span>)
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-danger fw-bold" id="s3Filter_NOT_FOUND" onclick="window.setStage3Filter('NOT_FOUND')">
                                🔴 查無未收明細 (<span id="s3Cnt_NOT_FOUND">0</span>)
                            </button>
                            <button type="button" class="btn btn-sm btn-secondary fw-bold ms-1" id="btnBatchDismissAlreadyPaid" style="display:none;" onclick="window.batchDismissAlreadyPaidDocItems()">
                                ✅ 批次忽略全部已沖帳
                            </button>
                        </div>
                    </div>
                    <div class="card-body p-2 bg-white" id="payDocPendingReviewList" style="max-height: 420px; overflow-y: auto;"></div>
                </div>

                <!-- 原有待收款篩選與控制列 -->
                <div class="p-3 bg-light border rounded mb-3" id="payPendingFilterBox">
                    <div class="row g-2 mb-2">
                        <div class="col-12 col-md-4">
                            <input type="search" id="payPendingSearch" class="form-control form-control-sm fw-bold" placeholder="🔍 搜尋：發票號碼、單號、品名、客戶..." oninput="window.renderPendingReceivables()">
                        </div>
                        <div class="col-6 col-md-3">
                            <select id="payPendingClient" class="form-select form-select-sm fw-bold text-secondary" onchange="window.renderPendingReceivables()">
                                <option value="">🏢 所有客戶 (全部)</option>
                            </select>
                        </div>
                        <div class="col-6 col-md-2">
                            <select id="payPendingPeriod" class="form-select form-select-sm fw-bold text-secondary" onchange="window.renderPendingReceivables()">
                                <option value="ALL">📅 全部未收期間</option>
                                <option value="ERP">🟢 2026/05後 ERP帳款</option>
                                <option value="LEGACY">🕰️ 2026/05前 歷史帳款</option>
                            </select>
                        </div>
                        <div class="col-6 col-md-3 d-flex gap-1">
                            <input type="date" id="payPendingStart" class="form-control form-control-sm" onchange="window.renderPendingReceivables()" title="開始日期">
                            <input type="date" id="payPendingEnd" class="form-control form-control-sm" onchange="window.renderPendingReceivables()" title="結束日期">
                        </div>
                    </div>

                    <div class="d-flex flex-wrap justify-content-between align-items-center pt-2 border-top mt-2 gap-2">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" id="btnPayViewInvoice" class="btn btn-outline-primary active fw-bold" onclick="window.setPaymentViewMode('invoice')">📄 依發票整張檢視</button>
                                <button type="button" id="btnPayViewItem" class="btn btn-outline-primary fw-bold" onclick="window.setPaymentViewMode('item')">📦 依品項明細檢視</button>
                            </div>
                            <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleSelectAllVisibleReceivables(true)">☑️ 全選本頁</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleSelectAllVisibleReceivables(false)">⬜ 取消全選</button>
                        </div>

                        <div class="d-flex align-items-center gap-2">
                            <span class="small fw-bold text-dark">
                                已勾選：<span class="text-danger fs-6" id="paySelectedCount">0</span> 筆明細 ｜ 應收合計：<span class="text-danger fs-5" id="paySelectedSum">$0</span>
                            </span>
                            <button class="btn btn-success fw-bold px-3 shadow-sm" onclick="window.openExecutePaymentModal()">
                                💰 執行收款沖帳
                            </button>
                        </div>
                    </div>
                </div>

                <div id="payPendingContainer"></div>
            </div>

            <!-- ==================== 頁籤 2：沖帳記錄總表 ==================== -->
            <div class="tab-pane fade" id="tabPayRecords">
                <div class="p-3 bg-light border rounded mb-3">
                    <div class="row g-2 align-items-center">
                        <div class="col-12 col-md-4">
                            <input type="search" id="payHistSearch" class="form-control form-control-sm fw-bold" placeholder="🔍 搜尋：沖帳單號、發票號碼、客戶、備註..." oninput="window.renderPaymentHistory()">
                        </div>
                        <div class="col-6 col-md-3">
                            <select id="payHistClient" class="form-select form-select-sm fw-bold text-secondary" onchange="window.renderPaymentHistory()">
                                <option value="">🏢 所有客戶</option>
                            </select>
                        </div>
                        <div class="col-6 col-md-2">
                            <select id="payHistStatus" class="form-select form-select-sm fw-bold text-secondary" onchange="window.renderPaymentHistory()">
                                <option value="">所有狀態</option>
                                <option value="已沖帳結清">🟢 已沖帳結清</option>
                                <option value="部分沖帳">🟡 部分沖帳</option>
                                <option value="已作廢">🔴 已作廢</option>
                            </select>
                        </div>
                        <div class="col-12 col-md-3 text-end">
                            <button class="btn btn-sm btn-success fw-bold w-100 shadow-sm" onclick="window.exportPaymentRecordsExcel()">
                                📥 匯出「沖帳記錄表」Excel
                            </button>
                        </div>
                    </div>
                </div>
                <div id="payHistoryContainer"></div>
            </div>

            <!-- ==================== 頁籤 3：5月前歷史未收帳管理 ==================== -->
            <div class="tab-pane fade" id="tabPayLegacy">
                <div class="alert alert-warning border-warning shadow-sm mb-3">
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <div>
                            <h6 class="fw-bold text-dark mb-1">🕰️ 2026年5月前「歷史未收帳款（期初應收）」安全移轉中心</h6>
                            <div class="small text-dark">
                                由於本 ERP 系統自今年 5 月正式啟用，您可以直接上傳外部系統的 <code>未收款明細.xlsx</code>，系統會自動篩選出 <strong>2026/05/01 以前</strong>尚未收款的歷史發票明細，一鍵安全匯入本系統「待沖帳池」（<strong>僅供收款沖帳核銷，絕不影響現有倉庫庫存與出貨作業</strong>）。
                            </div>
                        </div>
                        <div class="d-flex gap-2">
                            <label class="btn btn-warning fw-bold shadow-sm mb-0" style="cursor:pointer;">
                                📂 上傳「未收款明細.xlsx」掃描 5月前舊帳
                                <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="window.handleUnpaidExcelUpload(this, 'LEGACY_TAB')">
                            </label>
                            <button id="btnImportLegacyBatch" class="btn btn-primary fw-bold shadow-sm" style="display:none;" onclick="window.confirmImportLegacyUnpaid()">
                                📥 一鍵匯入勾選之歷史未收帳
                            </button>
                        </div>
                    </div>
                </div>

                <div id="payLegacyStagingBox" style="display:none;" class="mb-4"></div>
                <h6 class="fw-bold text-dark border-bottom pb-2 mb-2">📋 目前已存在於本系統中之「2026/05/01 前歷史應收明細」清單：</h6>
                <div id="payLegacyExistingContainer"></div>
            </div>

            <!-- ==================== 頁籤 4：跨系統未收/沖帳比對中心 ==================== -->
            <div class="tab-pane fade" id="tabPayReconcile">
                <div class="card border-0 shadow-sm mb-3" style="border-top: 4px solid #0ca678 !important;">
                    <div class="card-body p-3">
                        <div class="d-flex flex-wrap justify-content-between align-items-center border-bottom pb-3 mb-3 gap-2">
                            <div>
                                <div class="d-flex align-items-center gap-2 flex-wrap">
                                    <h5 class="fw-bold text-dark mb-0">🤖 跨系統「未收款明細 vs 本系統沖帳狀態」智慧勾稽中心</h5>
                                    <span id="unpaidRecSaveBadge" class="badge bg-info text-dark" style="display:none;">💾 進度自動記憶中</span>
                                </div>
                                <div class="small text-muted mt-1">
                                    上傳外部系統產出的 <code>未收款明細.xlsx</code>（<code>未付款-OLD</code> 工作表），AI 自動比對兩邊系統「<strong>哪邊已沖帳、哪邊未沖帳、未收金額是否一致</strong>」，支援「<strong>✅ 已覆核專區</strong>」與「<strong>⚡ 一鍵同步沖帳/補登</strong>」。
                                </div>
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <label class="btn btn-primary fw-bold shadow-sm mb-0" style="cursor:pointer;">
                                    📂 上傳外部「未收款明細.xlsx」
                                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="window.handleUnpaidExcelUpload(this, 'RECONCILE_TAB')">
                                </label>
                                <button id="btnExportUnpaidRecExcel" class="btn btn-success fw-bold shadow-sm" style="display:none;" onclick="window.exportUnpaidReconcileExcel()">
                                    📥 下載未收比對差異報告 (.xlsx)
                                </button>
                                <button id="btnClearUnpaidRecCache" class="btn btn-outline-secondary fw-bold" style="display:none;" onclick="window.clearUnpaidReconcileWorkspace()">
                                    🗑️ 清除暫存
                                </button>
                            </div>
                        </div>

                        <!-- 比對統計 KPI 卡片 -->
                        <div id="unpaidRecKpiRow" class="row g-2 mb-3" style="display:none;">
                            <div class="col-6 col-md-2">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_ALL_DIFF" style="cursor:pointer; background:#fff8f6; border-color:#dc3545 !important;" onclick="window.setUnpaidReconcileFilter('ALL_DIFF')">
                                    <div class="small fw-bold text-danger">⚠️ 待處理差異</div>
                                    <div class="fs-4 fw-bold text-danger" id="uCountAllDiff">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">需人工複查或同步</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-2">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_ERP_PAID_EXT_UNPAID" style="cursor:pointer; background:#f0f7ff;" onclick="window.setUnpaidReconcileFilter('ERP_PAID_EXT_UNPAID')">
                                    <div class="small fw-bold text-primary">🔵 本系統已沖/外部未沖</div>
                                    <div class="fs-4 fw-bold text-primary" id="uCountErpPaid">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">提醒外部系統補沖帳</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-2">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_ONLY_ERP_UNPAID" style="cursor:pointer; background:#f8f0fc;" onclick="window.setUnpaidReconcileFilter('ONLY_ERP_UNPAID')">
                                    <div class="small fw-bold" style="color:#862e9c;">🟣 外部已無未收/本系統未沖</div>
                                    <div class="fs-4 fw-bold" style="color:#862e9c;" id="uCountOnlyErp">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">可一鍵同步標記已沖帳</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-2">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_ONLY_EXT_UNPAID" style="cursor:pointer; background:#fff5f5;" onclick="window.setUnpaidReconcileFilter('ONLY_EXT_UNPAID')">
                                    <div class="small fw-bold text-danger">🔴 僅外部列未收</div>
                                    <div class="fs-4 fw-bold text-danger" id="uCountOnlyExt">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">5月前舊帳或本系統缺漏</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-2">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_VALUE_DIFF" style="cursor:pointer; background:#fffdf5;" onclick="window.setUnpaidReconcileFilter('VALUE_DIFF')">
                                    <div class="small fw-bold text-warning text-dark">🟡 兩邊未收但金額相異</div>
                                    <div class="fs-4 fw-bold text-dark" id="uCountValDiff">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">數量/單價/總價/客戶差</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-1">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_REVIEWED" style="cursor:pointer; background:#eef2ff;" onclick="window.setUnpaidReconcileFilter('REVIEWED')">
                                    <div class="small fw-bold" style="color:#6610f2;">☑️ 已覆核</div>
                                    <div class="fs-4 fw-bold" style="color:#6610f2;" id="uCountReviewed">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">可還原</div>
                                </div>
                            </div>
                            <div class="col-12 col-md-1">
                                <div class="p-2 border rounded text-center shadow-sm" id="uKpi_MATCH" style="cursor:pointer; background:#f3fbf6;" onclick="window.setUnpaidReconcileFilter('MATCH')">
                                    <div class="small fw-bold text-success">🟢 吻合</div>
                                    <div class="fs-4 fw-bold text-success" id="uCountMatch">0</div>
                                    <div class="text-muted" style="font-size:0.72rem;">未收一致</div>
                                </div>
                            </div>
                        </div>

                        <!-- 篩選按鈕與搜尋工具列 -->
                        <div id="unpaidRecToolbar" class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3" style="display:none !important;">
                            <div class="d-flex flex-wrap gap-1 align-items-center">
                                <button class="btn btn-sm btn-outline-success fw-bold" onclick="window.batchToggleUnpaidReview(true)">✅ 批次標記已覆核</button>
                                <button class="btn btn-sm btn-outline-warning text-dark fw-bold" onclick="window.batchToggleUnpaidReview(false)">↩️ 批次還原</button>
                                <button class="btn btn-sm btn-primary fw-bold" onclick="window.openBatchImportLegacyFromReconcile()">📥 一鍵匯入所有「5月前歷史未收帳」</button>
                            </div>
                            <div style="min-width: 240px; flex-grow: 1; max-width: 340px;">
                                <input type="text" id="unpaidRecSearchInput" class="form-control form-control-sm" placeholder="🔍 搜尋發票、客戶、CUSTID、產品代號..." oninput="window.onUnpaidReconcileSearch(this.value)">
                            </div>
                        </div>

                        <div id="unpaidRecResultContainer">
                            <div class="text-center text-muted py-4 border rounded bg-light">
                                請點擊右上角「<strong>📂 上傳外部『未收款明細.xlsx』</strong>」開始進行跨系統未收與沖帳勾稽比對
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 建立「💰 執行收款沖帳 (單筆/人工微調)」彈跳視窗
    if (!document.getElementById('paymentExecuteModal')) {
        const modalHtml = `
        <div class="modal fade" id="paymentExecuteModal" tabindex="-1" style="z-index: 1065;">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white" style="background-color: #0ca678;">
                        <h5 class="modal-title fw-bold">💰 執行收款沖帳作業（同步寫入沖帳記錄表 ＆ 銷售明細總表）</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="p-3 bg-white border rounded shadow-sm mb-3">
                            <div class="row g-2 mb-3">
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">沖帳單號 (系統自動編號)</label>
                                    <input type="text" id="pe_paymentNo" class="form-control fw-bold bg-light text-primary" readonly>
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">實際收款日 <span class="text-danger">*</span></label>
                                    <input type="date" id="pe_payDate" class="form-control fw-bold text-dark">
                                </div>
                                <div class="col-md-4">
                                    <label class="small fw-bold text-muted">收款方式 <span class="text-danger">*</span></label>
                                    <select id="pe_payMethod" class="form-select fw-bold">
                                        <option value="銀行匯款">🏦 銀行匯款 / 電匯</option>
                                        <option value="支票收款">🎫 支票收款</option>
                                        <option value="現金收款">💵 現金收款</option>
                                        <option value="折讓/抵扣">📉 銷貨折讓 / 抵扣</option>
                                        <option value="外部系統同步沖帳">🔄 外部系統同步沖帳</option>
                                    </select>
                                </div>
                            </div>

                            <div class="row g-2 mb-3">
                                <div class="col-md-6">
                                    <label class="small fw-bold text-muted">付款客戶名稱</label>
                                    <input type="text" id="pe_client" class="form-control fw-bold bg-light" readonly>
                                </div>
                                <div class="col-md-6">
                                    <label class="small fw-bold text-muted">本次沖銷發票號碼清單</label>
                                    <input type="text" id="pe_paperNos" class="form-control bg-light text-secondary" readonly>
                                </div>
                            </div>

                            <div class="row g-2 p-3 rounded border bg-light mb-3 text-center">
                                <div class="col-md-4 border-end">
                                    <div class="small fw-bold text-muted">帳面應收總額 (G欄)</div>
                                    <input type="number" id="pe_receivableTotal" class="form-control form-control-lg fw-bold text-center bg-white mt-1" readonly>
                                </div>
                                <div class="col-md-4 border-end">
                                    <div class="small fw-bold text-success">本次實收金額 (H欄) <span class="text-danger">*</span></div>
                                    <input type="number" id="pe_receivedAmount" class="form-control form-control-lg fw-bold text-success text-center border-success mt-1" step="any" oninput="window.recalcPaymentDiff()">
                                </div>
                                <div class="col-md-4">
                                    <div class="small fw-bold text-secondary">匯費 / 折讓 / 差額 (I欄)</div>
                                    <input type="number" id="pe_diffAmount" class="form-control form-control-lg fw-bold text-danger text-center bg-white mt-1" readonly>
                                </div>
                            </div>

                            <div class="mb-2">
                                <label class="small fw-bold text-muted">沖帳備註說明 (如：支票號碼、匯款帳號後5碼、扣30元匯費等)</label>
                                <input type="text" id="pe_memo" class="form-control" placeholder="選填...">
                            </div>
                        </div>

                        <div class="p-2 bg-white border rounded">
                            <div class="small fw-bold text-secondary mb-2">📦 本次勾選沖銷之銷售明細清單：</div>
                            <div id="pe_itemsPreview" style="max-height: 200px; overflow-y: auto; font-size: 0.85rem;"></div>
                        </div>
                    </div>
                    <div class="modal-footer bg-white border-0">
                        <button type="button" class="btn btn-secondary fw-bold" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-success fw-bold px-4 py-2 fs-6 shadow-sm" onclick="window.confirmExecutePayment()">
                            ✅ 確認完成收款沖帳
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 建立第一階段：「⚡ 比對無誤一鍵快速確認沖帳」專屬彈跳視窗
    if (!document.getElementById('quickMatchPaymentModal')) {
        const qmModalHtml = `
        <div class="modal fade" id="quickMatchPaymentModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-xl">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white" style="background: linear-gradient(90deg, #0ca678 0%, #198754 100%);">
                        <div>
                            <h5 class="modal-title fw-bold mb-0">⚡ 比對無誤一鍵快速確認沖帳</h5>
                            <div class="small opacity-75">以下發票經系統比對「發票號碼、未收狀態與應收金額」100% 完全相符無差額，確認完畢後視窗將自動消失！</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light">
                        <div class="p-3 bg-white border rounded shadow-sm mb-3">
                            <div class="row g-2 align-items-end">
                                <div class="col-12 col-md-3">
                                    <label class="small fw-bold text-muted">統一設定實際收款日 <span class="text-danger">*</span></label>
                                    <input type="date" id="qm_payDate" class="form-control fw-bold text-primary">
                                </div>
                                <div class="col-12 col-md-3">
                                    <label class="small fw-bold text-muted">統一設定收款方式 <span class="text-danger">*</span></label>
                                    <select id="qm_payMethod" class="form-select fw-bold">
                                        <option value="銀行匯款">🏦 銀行匯款 / 電匯</option>
                                        <option value="支票收款">🎫 支票收款</option>
                                        <option value="現金收款">💵 現金收款</option>
                                        <option value="外部系統同步沖帳">🔄 對帳單快速沖帳</option>
                                    </select>
                                </div>
                                <div class="col-12 col-md-4">
                                    <label class="small fw-bold text-muted">批次沖帳備註 (選填)</label>
                                    <input type="text" id="qm_memo" class="form-control" placeholder="例如：對帳單比對無誤快速沖帳">
                                </div>
                                <div class="col-12 col-md-2 text-end">
                                    <button type="button" id="btnQmModalUndo" class="btn btn-outline-danger fw-bold w-100" style="display:none;" onclick="window.undoLastPaymentAction(true)">
                                        ⏪ 撤銷上一步
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white d-flex justify-content-between align-items-center py-2">
                                <div class="fw-bold text-success">
                                    🟢 100% 比對無誤待沖帳清單（共 <span id="qmTotalCount">0</span> 張發票 ｜ 應收實收總計：<span class="text-danger fs-5" id="qmTotalAmount">$0</span>）
                                </div>
                                <div class="d-flex gap-2">
                                    <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleAllQuickMatchCheckboxes(true)">☑️ 全選</button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.toggleAllQuickMatchCheckboxes(false)">⬜ 取消全選</button>
                                </div>
                            </div>
                            <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
                                <table class="table table-hover table-bordered align-middle mb-0 bg-white" style="font-size: 0.88rem;">
                                    <thead class="table-light position-sticky top-0">
                                        <tr>
                                            <th class="text-center" style="width: 44px;">
                                                <input type="checkbox" class="form-check-input" id="qmMasterCheckbox" checked onchange="window.toggleAllQuickMatchCheckboxes(this.checked)">
                                            </th>
                                            <th class="text-center" style="width: 46px;">#</th>
                                            <th>發票號碼</th>
                                            <th>開立/單據日期</th>
                                            <th>客戶名稱</th>
                                            <th>品項明細摘要</th>
                                            <th class="text-end">本系統應收</th>
                                            <th class="text-end">單據實收金額</th>
                                            <th class="text-center" style="width: 140px;">單筆操作</th>
                                        </tr>
                                    </thead>
                                    <tbody id="qmTableBody"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer bg-white border-0 d-flex justify-content-between align-items-center">
                        <div class="small text-muted">
                            💡 提示：點擊右側按鈕可一鍵完成所有勾選項目之沖帳，完成後本視窗將自動消失並進入待確認覆核區。
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-secondary fw-bold px-3" data-bs-dismiss="modal">稍後處理 (先看主畫面)</button>
                            <button type="button" class="btn btn-success fw-bold px-4 py-2 fs-5 shadow" id="btnConfirmBatchQuickMatch" onclick="window.confirmBatchQuickMatchPayment()">
                                ⚡ 一鍵確認沖帳全部勾選資料
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', qmModalHtml);
    }

    // 建立「🤖 Gemini AI 視覺轉檔金鑰設定」彈跳視窗
    if (!document.getElementById('geminiKeySettingModal')) {
        const aiKeyModalHtml = `
        <div class="modal fade" id="geminiKeySettingModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-dark text-white">
                        <h5 class="modal-title fw-bold">🤖 Gemini AI 視覺解析與 PDF 轉 Excel 設定</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info small mb-3">
                            <strong>💡 雙核心解析說明：</strong><br>
                            1. <strong>內建本地 PDF.js 引擎（免設定金鑰）</strong>：可直接解析一般數位文字型 PDF 對帳單並轉為 Excel。<br>
                            2. <strong>Gemini 2.5 Flash AI 深度視覺引擎（推薦）</strong>：設定您的 Gemini API Key 後，即使是複雜排版、掃描圖片型 PDF 付款單，AI 也能精準識別表格並自動轉成標準 Excel 供您下載與比對！
                        </div>
                        <div class="mb-3">
                            <label class="form-label small fw-bold text-muted">Google Gemini API Key (安全儲存於您的瀏覽器本機)</label>
                            <input type="password" id="inputGeminiApiKey" class="form-control fw-bold" placeholder="請貼上 AIzaSy 開頭的 Gemini API Key...">
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-danger w-50 fw-bold" onclick="window.saveGeminiApiKey(true)">🗑️ 清除金鑰</button>
                            <button type="button" class="btn btn-primary w-50 fw-bold" onclick="window.saveGeminiApiKey(false)">💾 儲存設定</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', aiKeyModalHtml);
    }

    // 建立「📊 未收款三表連動分析與列印中心（完美復刻『未收款-11511.xlsx』三工作表）」全螢幕彈跳視窗
    if (!document.getElementById('unpaidWorkbookModal')) {
        const wbModalHtml = `
        <div class="modal fade" id="unpaidWorkbookModal" tabindex="-1">
            <div class="modal-dialog modal-fullscreen-lg-down modal-xl" style="max-width: 96vw;">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white py-2" style="background: linear-gradient(90deg, #b02a37 0%, #dc3545 100%);">
                        <div>
                            <h5 class="modal-title fw-bold mb-0">📊 未收款三表連動分析與列印中心（復刻『未收款-11511』格式）</h5>
                            <div class="small opacity-75">即時連動【1. 收款總表】、【2. 未付款-OLD】與【3. 分析表1 (客戶×年月帳齡矩陣)】，點擊表中金額可直接下鑽查明細！</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light p-3">
                        <div class="row g-2 mb-3">
                            <div class="col-12 col-lg-7">
                                <div class="p-2 bg-white border rounded shadow-sm h-100 d-flex flex-wrap align-items-center justify-content-between gap-2">
                                    <div class="d-flex flex-wrap align-items-center gap-2">
                                        <div class="input-group input-group-sm" style="width: auto;">
                                            <span class="input-group-text fw-bold bg-light">資料來源</span>
                                            <select id="wbDataSourceSelect" class="form-select fw-bold text-primary" onchange="window.onChangeWorkbookOptions()">
                                                <option value="ERP_LIVE">🟢 本系統即時待收款資料</option>
                                                <option value="EXT_EXCEL">📂 外部上傳之未收款明細 Excel</option>
                                            </select>
                                        </div>

                                        <label class="btn btn-sm btn-outline-secondary fw-bold mb-0" style="cursor:pointer;" title="直接上傳如『未收款-11511.xlsx』進行三表檢視與列印">
                                            📤 載入外部Excel
                                            <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="window.handleWorkbookDirectExcelUpload(this)">
                                        </label>

                                        <div class="btn-group btn-group-sm" role="group">
                                            <button type="button" id="btnWbModeCodeOnly" class="btn btn-outline-dark fw-bold" onclick="window.setWorkbookClientDisplayMode('CODE_ONLY')">
                                                🔢 純代號 (200001)
                                            </button>
                                            <button type="button" id="btnWbModeCodeName" class="btn btn-outline-dark active fw-bold" onclick="window.setWorkbookClientDisplayMode('CODE_AND_NAME')">
                                                🏥 代號＋客戶名稱
                                            </button>
                                        </div>

                                        <div class="form-check form-switch ms-1 mb-0">
                                            <input class="form-check-input" type="checkbox" id="wbAgingHighlightSwitch" checked onchange="window.onChangeWorkbookOptions()" style="cursor:pointer;">
                                            <label class="form-check-label small fw-bold text-danger" for="wbAgingHighlightSwitch" style="cursor:pointer;">🕰️ 5月前舊帳警戒色標</label>
                                        </div>
                                    </div>

                                    <button type="button" class="btn btn-sm btn-success fw-bold shadow-sm px-3" onclick="window.exportUnpaidWorkbookExcel()">
                                        📥 下載三表 Excel (.xlsx)
                                    </button>
                                </div>
                            </div>

                            <div class="col-12 col-lg-5">
                                <div class="p-2 bg-white border border-primary rounded shadow-sm h-100 d-flex flex-wrap align-items-center justify-content-between gap-2">
                                    <div>
                                        <div class="small fw-bold text-primary mb-1">
                                            🖨️ 列印前勾選要列印的工作表（可單選或多選）：
                                            <a href="javascript:void(0)" class="ms-2 text-decoration-none" onclick="window.quickSelectWorkbookPrintSheets('ALL')">[全選三表]</a>
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectWorkbookPrintSheets('PIVOTS')">[僅印表1+表3]</a>
                                        </div>
                                        <div class="d-flex flex-wrap gap-3">
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintWb_s1" checked>1. 收款總表
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintWb_s2">2. 未付款-OLD
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintWb_s3" checked>3. 分析表1
                                            </label>
                                        </div>
                                    </div>
                                    <button type="button" class="btn btn-primary fw-bold shadow-sm px-3 py-2" onclick="window.printSelectedUnpaidWorkbookSheets()">
                                        🖨️ 預覽並執行列印
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="d-flex flex-wrap justify-content-between align-items-center bg-white border rounded-top px-3 pt-2 border-bottom-0">
                            <ul class="nav nav-tabs border-bottom-0" id="wbSheetTabs">
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="wbTabBtn_SHEET_1" onclick="window.switchWorkbookSheet('SHEET_1')">
                                        📑 工作表 1：收款總表 <span class="badge bg-secondary ms-1" id="wbBadge_s1">樞紐</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="wbTabBtn_SHEET_2" onclick="window.switchWorkbookSheet('SHEET_2')">
                                        📑 工作表 2：未付款-OLD <span class="badge bg-danger ms-1" id="wbBadge_s2">0 筆</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link active fw-bold" id="wbTabBtn_SHEET_3" onclick="window.switchWorkbookSheet('SHEET_3')">
                                        📑 工作表 3：分析表1 (客戶×年月矩陣) <span class="badge bg-primary ms-1" id="wbBadge_s3">0 客戶</span>
                                    </button>
                                </li>
                            </ul>
                            <div class="pb-2 d-flex align-items-center gap-3">
                                <span class="small text-muted" id="wbSourceStatusText">目前資料源：本系統即時待收款</span>
                                <span class="badge bg-danger fs-6 px-3 py-2 shadow-sm">
                                    三表勾稽未收總計：<span id="wbGrandTotalBadge">$0</span>
                                </span>
                            </div>
                        </div>

                        <div class="bg-white border rounded-bottom shadow-sm p-3" id="wbSheetContentContainer" style="min-height: 480px; max-height: 68vh; overflow: auto;">
                        </div>
                    </div>
                    <div class="modal-footer bg-white py-2 d-flex justify-content-between">
                        <div class="small text-secondary">
                            💡 <strong>互動秘訣</strong>：在「<strong>分析表1</strong>」或「<strong>收款總表</strong>」點擊任一金額數字，即可自動下鑽（Drill-Down）跳轉至「<strong>未付款-OLD</strong>」檢視該筆明細！
                        </div>
                        <button type="button" class="btn btn-secondary fw-bold px-4" data-bs-dismiss="modal">關閉視窗</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', wbModalHtml);
    }

    // 建立「🟢 已完成沖帳區間查詢、三工作表 Excel 下載與多選列印中心」全螢幕彈跳視窗
    if (!document.getElementById('paidReportModal')) {
        const paidModalHtml = `
        <div class="modal fade" id="paidReportModal" tabindex="-1">
            <div class="modal-dialog modal-fullscreen-lg-down modal-xl" style="max-width: 96vw;">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white py-2" style="background: linear-gradient(90deg, #0ca678 0%, #198754 100%);">
                        <div>
                            <h5 class="modal-title fw-bold mb-0">🟢 已完成沖帳區間查詢與報表匯出列印中心</h5>
                            <div class="small opacity-75">依所選時間區間查詢已完成沖帳之收款總表、發票品項展開明細與客戶別統計，支援三工作表 Excel 下載與自由勾選列印！</div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light p-3">
                        <!-- 頂部：時間區間搜尋框 ＋ 快捷期間按鈕 ＋ 複合篩選與列印控制 -->
                        <div class="row g-2 mb-3">
                            <div class="col-12 col-lg-8">
                                <div class="p-3 bg-white border rounded shadow-sm h-100">
                                    <!-- 第一排：日期基準 ＋ 起訖日期區間 ＋ 月份快選 ＋ 快捷期間按鈕 -->
                                    <div class="d-flex flex-wrap align-items-center gap-2 mb-2 pb-2 border-bottom">
                                        <select id="prDateBasis" class="form-select form-select-sm fw-bold text-success border-success" style="width: auto;" onchange="window.onChangePaidReportFilter()">
                                            <option value="PAY_DATE">📅 依實際收款日查詢</option>
                                            <option value="CREATE_TIME">🕒 依系統沖帳建立日查詢</option>
                                        </select>

                                        <div class="d-flex align-items-center gap-1">
                                            <input type="date" id="prStartDate" class="form-control form-control-sm fw-bold border-success" onchange="window.onChangePaidReportFilter()" title="區間開始日期">
                                            <span class="fw-bold text-muted">～</span>
                                            <input type="date" id="prEndDate" class="form-control form-control-sm fw-bold border-success" onchange="window.onChangePaidReportFilter()" title="區間結束日期">
                                        </div>

                                        <input type="month" id="prMonthPicker" class="form-control form-control-sm fw-bold text-primary" style="width: 145px;" onchange="window.setPaidReportMonthPicker(this.value)" title="快速指定特定月份">

                                        <div class="btn-group btn-group-sm flex-wrap" role="group">
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('TODAY')">今日</button>
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('THIS_WEEK')">本週</button>
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('THIS_MONTH')">本月</button>
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('LAST_MONTH')">上月</button>
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('LAST_3_MONTHS')">近3月</button>
                                            <button type="button" class="btn btn-outline-success fw-bold" onclick="window.setPaidReportQuickDate('THIS_YEAR')">今年</button>
                                            <button type="button" class="btn btn-outline-secondary fw-bold" onclick="window.setPaidReportQuickDate('ALL')">全部期間</button>
                                        </div>
                                    </div>

                                    <!-- 第二排：客戶、收款方式、帳款來源、關鍵字、僅顯示有差額快篩、Excel下載 -->
                                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                                        <div class="d-flex flex-wrap align-items-center gap-2 flex-grow-1">
                                            <select id="prClientFilter" class="form-select form-select-sm fw-bold text-dark" style="max-width: 190px;" onchange="window.onChangePaidReportFilter()">
                                                <option value="">🏢 所有客戶 (全部)</option>
                                            </select>

                                            <select id="prMethodFilter" class="form-select form-select-sm fw-bold text-secondary" style="max-width: 155px;" onchange="window.onChangePaidReportFilter()">
                                                <option value="">💳 所有收款方式</option>
                                                <option value="銀行匯款">🏦 銀行匯款</option>
                                                <option value="支票收款">🎫 支票收款</option>
                                                <option value="現金收款">💵 現金收款</option>
                                                <option value="折讓/抵扣">📉 折讓/抵扣</option>
                                                <option value="外部系統同步沖帳">🔄 外部/對帳單快沖</option>
                                            </select>

                                            <select id="prSourceFilter" class="form-select form-select-sm fw-bold text-secondary" style="max-width: 155px;" onchange="window.onChangePaidReportFilter()">
                                                <option value="">🏷️ 所有帳款來源</option>
                                                <option value="ERP原生帳款">📅 ERP原生帳款</option>
                                                <option value="5月前歷史帳款">🕰️ 5月前歷史帳款</option>
                                                <option value="跨期混合沖帳(含5月前)">🔗 跨期混合沖帳</option>
                                            </select>

                                            <input type="search" id="prSearchInput" class="form-control form-control-sm fw-bold" style="max-width: 210px;" placeholder="🔍 搜單號、發票、品名、備註..." oninput="window.onChangePaidReportFilter()">

                                            <!-- 進階優化 1：僅顯示有匯費/折讓差額開關 -->
                                            <div class="form-check form-switch mb-0 ms-1">
                                                <input class="form-check-input" type="checkbox" id="prOnlyDiffSwitch" onchange="window.onChangePaidReportFilter()" style="cursor:pointer;">
                                                <label class="form-check-label small fw-bold text-danger" for="prOnlyDiffSwitch" style="cursor:pointer;">⚡ 僅顯示有匯費/折讓差額</label>
                                            </div>
                                        </div>

                                        <button type="button" class="btn btn-sm btn-success fw-bold shadow-sm px-3 py-1" onclick="window.exportPaidReportExcel()">
                                            📥 下載區間三表 Excel (.xlsx)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- 右側：列印前勾選要列印的工作表 (支援單選或多選) -->
                            <div class="col-12 col-lg-4">
                                <div class="p-3 bg-white border border-success rounded shadow-sm h-100 d-flex flex-column justify-content-between">
                                    <div>
                                        <div class="small fw-bold text-success mb-1">
                                            🖨️ 列印前選擇要列印的已沖帳工作表（可單選或多選）：
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectPaidPrintSheets('ALL')">[全選三表]</a>
                                            <a href="javascript:void(0)" class="ms-1 text-decoration-none" onclick="window.quickSelectPaidPrintSheets('SUMMARY')">[印表1+表3]</a>
                                        </div>
                                        <div class="d-flex flex-wrap gap-3 mt-1">
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintPaid_s1" checked>1. 收款沖帳總表
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintPaid_s2">2. 發票品項展開明細
                                            </label>
                                            <label class="form-check-label small fw-bold" style="cursor:pointer;">
                                                <input type="checkbox" class="form-check-input me-1" id="cbPrintPaid_s3" checked>3. 客戶別收款統計
                                            </label>
                                        </div>
                                    </div>
                                    <button type="button" class="btn btn-success fw-bold shadow-sm w-100 mt-2 py-2" onclick="window.printSelectedPaidReportSheets()">
                                        🖨️ 預覽並執行區間報表列印
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 區間即時統計總覽橫幅 -->
                        <div class="row g-2 mb-3 text-center">
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">🧾 區間沖帳總單數 / 品項數</div>
                                    <div class="fs-5 fw-bold text-dark mt-1" id="prStatCount">0 單 (0 筆品項)</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">📘 區間帳面應收總額 (G欄)</div>
                                    <div class="fs-5 fw-bold text-primary mt-1" id="prStatReceivable">$0</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm" style="border-bottom: 3px solid #198754 !important;">
                                    <div class="small text-success fw-bold">🟢 區間實際收款總額 (H欄)</div>
                                    <div class="fs-4 fw-bold text-success mt-1" id="prStatReceived">$0</div>
                                </div>
                            </div>
                            <div class="col-6 col-md-3">
                                <div class="p-2 bg-white border rounded shadow-sm">
                                    <div class="small text-muted fw-bold">📉 匯費 / 折讓 / 差額總計 (I欄)</div>
                                    <div class="fs-5 fw-bold text-danger mt-1" id="prStatDiff">$0</div>
                                </div>
                            </div>
                        </div>

                        <!-- 三大工作表分頁切換列 -->
                        <div class="d-flex flex-wrap justify-content-between align-items-center bg-white border rounded-top px-3 pt-2 border-bottom-0">
                            <ul class="nav nav-tabs border-bottom-0" id="prSheetTabs">
                                <li class="nav-item">
                                    <button type="button" class="nav-link active fw-bold" id="prTabBtn_PAID_S1" onclick="window.switchPaidReportSheet('PAID_S1')">
                                        📑 工作表 1：已沖帳收款總表 (依沖帳單) <span class="badge bg-success ms-1" id="prBadge_s1">0 單</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="prTabBtn_PAID_S2" onclick="window.switchPaidReportSheet('PAID_S2')">
                                        📑 工作表 2：已沖帳發票與品項明細表 <span class="badge bg-primary ms-1" id="prBadge_s2">0 筆</span>
                                    </button>
                                </li>
                                <li class="nav-item">
                                    <button type="button" class="nav-link fw-bold" id="prTabBtn_PAID_S3" onclick="window.switchPaidReportSheet('PAID_S3')">
                                        📑 工作表 3：客戶別已收款與方式統計表 <span class="badge bg-dark ms-1" id="prBadge_s3">0 客戶</span>
                                    </button>
                                </li>
                            </ul>
                            <div class="pb-2 d-flex align-items-center gap-2">
                                <span id="prDrillBanner" style="display:none;"></span>
                                <span class="small fw-bold text-secondary" id="prPeriodRangeLabel">查詢期間：全部期間</span>
                            </div>
                        </div>

                        <!-- 工作表內容渲染容器 -->
                        <div class="bg-white border rounded-bottom shadow-sm p-3" id="prSheetContentContainer" style="min-height: 420px; max-height: 60vh; overflow: auto;">
                        </div>
                    </div>
                    <div class="modal-footer bg-white py-2 d-flex justify-content-between">
                        <div class="small text-secondary">
                            💡 <strong>提示</strong>：點擊「<strong>工作表 1</strong>」每列右側的「<strong>🖨️ 憑證</strong>」可單獨印出該筆收款沖帳核銷傳票；點擊「<strong>工作表 3</strong>」客戶金額可下鑽檢視明細！
                        </div>
                        <button type="button" class="btn btn-secondary fw-bold px-4" data-bs-dismiss="modal">關閉視窗</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', paidModalHtml);
    }

    // 載入未收比對中心、上傳單據與撤銷堆疊的持久化進度
    window.loadUnpaidReconcileWorkspace();
    window.loadPaymentUndoStack();
    window.loadUploadedPaymentDocWorkspace();
};

// 判斷一筆銷售明細是否屬於「2026/05/01 以前」的歷史帳款
window.isLegacySalesItem = function(s) {
    if (!s) return false;
    if (s.shipStatus === '歷史已結案' || String(s.lot || '').includes('5月前歷史')) return true;
    const d = new Date(s.time);
    if (!isNaN(d.getTime()) && d < new Date('2026-05-01T00:00:00')) return true;
    return false;
};

// 判斷一筆銷售明細是否有效且尚未作廢
window.isValidReceivableItem = function(s) {
    if (!s || s.shipStatus === '作廢') return false;
    const parentInv = (globalHistory || []).find(h => h.paperNo === s.paperNo);
    if (parentInv && parentInv.status === '作廢') return false;
    return true;
};

// ============================================================================
// 1.5 復刻「未收款-11511.xlsx」三工作表連動分析、下鑽與多選列印引擎
// ============================================================================
window.openUnpaidWorkbookModal = function() {
    window.initPaymentModule();
    const wv = window.paymentModuleState.workbookView;
    wv.drillFilter = null;

    const hasErpUnpaid = (globalSalesDetails || []).some(s => window.isValidReceivableItem(s) && s.payStatus !== '已沖帳');
    const hasExtUnpaid = (window.paymentModuleState.unpaidReconcile.extRows || []).length > 0;
    if (!hasErpUnpaid && hasExtUnpaid) {
        wv.dataSource = 'EXT_EXCEL';
    }

    const srcSel = document.getElementById('wbDataSourceSelect');
    if (srcSel) srcSel.value = wv.dataSource;

    const agingSw = document.getElementById('wbAgingHighlightSwitch');
    if (agingSw) agingSw.checked = !!wv.agingHighlight;

    window.renderUnpaidWorkbookModalContent();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('unpaidWorkbookModal')).show();
};

window.handleWorkbookDirectExcelUpload = function(input) {
    if (!input.files || !input.files[0]) return;
    if (typeof XLSX === 'undefined') return alert("Excel 解析引擎載入中，請稍候再試！");

    const file = input.files[0];
    const fileName = file.name;
    showLoading(`📂 正在載入「${fileName}」至三表分析中心...`);

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array', raw: true });
            const sheetName = wb.SheetNames.find(n => n.includes('未付款')) || wb.SheetNames.find(n => n.includes('明細')) || wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            const rows = window.parseUnpaidExcelRows(aoa);
            hideLoading();

            if (rows.length === 0) return alert("未在此 Excel 中解析到符合「未付款-OLD」結構的明細列！");

            window.paymentModuleState.unpaidReconcile.fileName = fileName;
            window.paymentModuleState.unpaidReconcile.extRows = rows;
            window.saveUnpaidReconcileWorkspace();
            window.prepareLegacyStagedItems(rows);
            window.runUnpaidReconciliation(true);

            window.paymentModuleState.workbookView.dataSource = 'EXT_EXCEL';
            window.paymentModuleState.workbookView.drillFilter = null;
            const srcSel = document.getElementById('wbDataSourceSelect');
            if (srcSel) srcSel.value = 'EXT_EXCEL';

            window.renderUnpaidWorkbookModalContent();
            showToast(`✅ 已成功載入「${fileName}」（共 ${rows.length} 筆明細）並完成三表動態連動運算！`);
        } catch (err) {
            hideLoading();
            alert("解析失敗：" + err.message);
        } finally {
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

window.onChangeWorkbookOptions = function() {
    const wv = window.paymentModuleState.workbookView;
    const srcSel = document.getElementById('wbDataSourceSelect');
    const agingSw = document.getElementById('wbAgingHighlightSwitch');

    if (srcSel) {
        if (srcSel.value === 'EXT_EXCEL' && (!window.paymentModuleState.unpaidReconcile.extRows || window.paymentModuleState.unpaidReconcile.extRows.length === 0)) {
            alert("目前尚未上傳外部「未收款明細.xlsx」！請點擊旁邊的「📤 載入外部Excel」按鈕選擇您的 Excel 檔案（如：未收款-11511.xlsx）。");
            srcSel.value = 'ERP_LIVE';
        }
        wv.dataSource = srcSel.value;
    }
    if (agingSw) wv.agingHighlight = agingSw.checked;
    wv.drillFilter = null;
    window.renderUnpaidWorkbookModalContent();
};

window.setWorkbookClientDisplayMode = function(mode) {
    window.paymentModuleState.workbookView.clientDisplayMode = mode;
    const btnCode = document.getElementById('btnWbModeCodeOnly');
    const btnName = document.getElementById('btnWbModeCodeName');
    if (btnCode) btnCode.classList.toggle('active', mode === 'CODE_ONLY');
    if (btnName) btnName.classList.toggle('active', mode === 'CODE_AND_NAME');
    window.renderUnpaidWorkbookModalContent();
};

window.switchWorkbookSheet = function(sheetId, keepDrill = false) {
    const wv = window.paymentModuleState.workbookView;
    wv.activeSheet = sheetId;
    if (!keepDrill && sheetId !== 'SHEET_2') {
        wv.drillFilter = null;
    }
    ['SHEET_1', 'SHEET_2', 'SHEET_3'].forEach(s => {
        const btn = document.getElementById(`wbTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === sheetId);
    });
    window.renderUnpaidWorkbookModalContent();
};

window.quickSelectWorkbookPrintSheets = function(type) {
    const c1 = document.getElementById('cbPrintWb_s1');
    const c2 = document.getElementById('cbPrintWb_s2');
    const c3 = document.getElementById('cbPrintWb_s3');
    if (type === 'ALL') {
        if (c1) c1.checked = true;
        if (c2) c2.checked = true;
        if (c3) c3.checked = true;
    } else if (type === 'PIVOTS') {
        if (c1) c1.checked = true;
        if (c2) c2.checked = false;
        if (c3) c3.checked = true;
    }
};

window.buildUnpaidWorkbookDataModel = function() {
    const wv = window.paymentModuleState.workbookView;
    const isExt = wv.dataSource === 'EXT_EXCEL' && (window.paymentModuleState.unpaidReconcile.extRows || []).length > 0;
    const rawItems = [];

    if (isExt) {
        (window.paymentModuleState.unpaidReconcile.extRows || []).forEach((r, idx) => {
            if (r.isPaid) return;
            const dStr = window.parseExternalDateStr ? window.parseExternalDateStr(r.date) : String(r.date || '');
            const ymMatch = dStr.match(/^(\d{4})-(\d{2})/);
            const yr = ymMatch ? parseInt(ymMatch[1], 10) : 2026;
            const mo = ymMatch ? parseInt(ymMatch[2], 10) : 5;
            const cId = r.custId || (window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(r.clientName) : r.clientName);
            const cName = r.clientName || (window.getErpClientNameByCustId ? window.getErpClientNameByCustId(cId) : cId);

            rawItems.push({
                seq: idx + 1,
                erpRowIdx: null,
                orderCode: r.extOrderCode || String(1060000 + idx + 1),
                custId: String(cId || '未設代號').trim(),
                clientName: String(cName || '').trim(),
                dateStr: dStr,
                year: yr,
                month: mo,
                yearMonth: `${yr}-${String(mo).padStart(2, '0')}`,
                isPreMay: dStr < ERP_START_CUTOFF_DATE,
                isVoid: false,
                isPaid: false,
                productCode: r.ispn || r.productName || '',
                productName: r.productName || '',
                qty: Number(r.qty) || 0,
                price: Number(r.price) || 0,
                total: Math.round((Number(r.total) || 0) * 100) / 100,
                paperNo: r.paperNo || '',
                noteK: r.noteK || '',
                clientPoL: r.clientPoL || r.orderNo || '',
                reconcileDate: String(r.extPayDate || '').trim(),
                auditNote: r.auditNote || ''
            });
        });
    } else {
        let seqCounter = 0;
        (globalSalesDetails || []).forEach(s => {
            if (!window.isValidReceivableItem(s)) return;
            if (s.payStatus === '已沖帳') return;

            seqCounter++;
            const d = new Date(s.time);
            const validDate = !isNaN(d.getTime());
            const yr = validDate ? d.getFullYear() : 2026;
            const mo = validDate ? (d.getMonth() + 1) : 5;
            const dStr = validDate
                ? `${yr}-${String(mo).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                : getTodayStr();

            const cId = window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(s.client) : (s.client || '未設代號');
            const prodCode = window.getProductCodeByName ? window.getProductCodeByName(s.name, s.client) : s.name;
            const remainTotal = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0)) * 100) / 100;

            let extOrd = '';
            const lotStr = String(s.lot || '');
            const extMatch = lotStr.match(/外部單號:(\d+)/);
            if (extMatch) extOrd = extMatch[1];
            else extOrd = String(s.rowIdx || (1060000 + seqCounter)).slice(-7);

            const recDateStr = String(s.payDate || '').trim();

            rawItems.push({
                seq: seqCounter,
                erpRowIdx: s.rowIdx,
                orderCode: extOrd,
                custId: String(cId || '未設代號').trim(),
                clientName: String(s.client || '').trim(),
                dateStr: dStr,
                year: yr,
                month: mo,
                yearMonth: `${yr}-${String(mo).padStart(2, '0')}`,
                isPreMay: window.isLegacySalesItem(s) || (dStr < ERP_START_CUTOFF_DATE),
                isVoid: false,
                isPaid: false,
                productCode: prodCode,
                productName: s.name || '',
                qty: Math.round((Number(s.qty) || 0) * 1000) / 1000,
                price: Math.round((Number(s.price) || 0) * 1000) / 1000,
                total: remainTotal,
                paperNo: s.paperNo || '',
                noteK: '',
                clientPoL: s.orderNo || '',
                reconcileDate: recDateStr,
                auditNote: lotStr.replace(/\[5月前歷史應收\]\s*(外部單號:\d+)?/g, '').trim()
            });
        });
    }

    const grandTotal = Math.round(rawItems.reduce((sum, x) => sum + x.total, 0) * 100) / 100;

    const recDateMap = new Map();
    let blankRecDateSum = 0;
    rawItems.forEach(item => {
        const rd = item.reconcileDate || '';
        if (!rd) {
            blankRecDateSum = Math.round((blankRecDateSum + item.total) * 100) / 100;
        } else {
            recDateMap.set(rd, Math.round(((recDateMap.get(rd) || 0) + item.total) * 100) / 100);
        }
    });
    const recDateCols = Array.from(recDateMap.keys()).sort();

    const yearsMap = new Map();
    const clientMatrix = new Map();

    rawItems.forEach(item => {
        if (!yearsMap.has(item.year)) yearsMap.set(item.year, new Set());
        yearsMap.get(item.year).add(item.month);

        const cKey = item.custId;
        if (!clientMatrix.has(cKey)) {
            clientMatrix.set(cKey, {
                custId: cKey,
                clientName: item.clientName,
                byYm: {},
                byYear: {},
                total: 0
            });
        }
        const entry = clientMatrix.get(cKey);
        if (!entry.clientName && item.clientName) entry.clientName = item.clientName;
        entry.byYm[item.yearMonth] = Math.round(((entry.byYm[item.yearMonth] || 0) + item.total) * 100) / 100;
        entry.byYear[item.year] = Math.round(((entry.byYear[item.year] || 0) + item.total) * 100) / 100;
        entry.total = Math.round((entry.total + item.total) * 100) / 100;
    });

    const sortedYears = Array.from(yearsMap.keys()).sort((a, b) => a - b);
    const yearStructure = sortedYears.map(yr => ({
        year: yr,
        months: Array.from(yearsMap.get(yr)).sort((a, b) => a - b)
    }));

    const sortedClientRows = Array.from(clientMatrix.values()).sort((a, b) =>
        String(a.custId).localeCompare(String(b.custId), undefined, { numeric: true })
    );

    const colTotalsByYm = {};
    const colTotalsByYear = {};
    sortedClientRows.forEach(cRow => {
        Object.keys(cRow.byYm).forEach(ym => {
            colTotalsByYm[ym] = Math.round(((colTotalsByYm[ym] || 0) + cRow.byYm[ym]) * 100) / 100;
        });
        Object.keys(cRow.byYear).forEach(yr => {
            colTotalsByYear[yr] = Math.round(((colTotalsByYear[yr] || 0) + cRow.byYear[yr]) * 100) / 100;
        });
    });

    return {
        isExt: isExt,
        sourceName: isExt ? (window.paymentModuleState.unpaidReconcile.fileName || '外部未收款明細.xlsx') : '本系統即時未收帳款',
        rawItems: rawItems,
        grandTotal: grandTotal,
        sheet1: {
            recDateCols: recDateCols,
            recDateMap: recDateMap,
            blankSum: blankRecDateSum,
            grandTotal: grandTotal
        },
        sheet3: {
            yearStructure: yearStructure,
            clientRows: sortedClientRows,
            colTotalsByYm: colTotalsByYm,
            colTotalsByYear: colTotalsByYear,
            grandTotal: grandTotal
        }
    };
};

window.formatWbNumber = function(val) {
    if (val === undefined || val === null || val === '' || val === 0) return '';
    const n = Math.round(Number(val) * 100) / 100;
    if (n === 0) return '';
    return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
};

window.formatWbClientLabel = function(custId, clientName, forceMode = null) {
    const mode = forceMode || window.paymentModuleState.workbookView.clientDisplayMode || 'CODE_AND_NAME';
    if (mode === 'CODE_ONLY') return custId;
    if (!clientName || clientName === custId || clientName.startsWith('未知客戶')) return custId;
    const shortName = clientName
        .replace(/醫療財團法人|醫療社團法人|財團法人/g, '')
        .replace(/\(委託.*$/g, '')
        .replace(/-委託.*$/g, '');
    return `${custId} ${shortName}`;
};

window.renderUnpaidWorkbookModalContent = function() {
    const container = document.getElementById('wbSheetContentContainer');
    if (!container) return;

    const model = window.buildUnpaidWorkbookDataModel();
    const wv = window.paymentModuleState.workbookView;

    setSafeText('wbBadge_s2', `${model.rawItems.length} 筆`);
    setSafeText('wbBadge_s3', `${model.sheet3.clientRows.length} 客戶`);
    setSafeText('wbGrandTotalBadge', '$' + (window.formatWbNumber(model.grandTotal) || '0'));
    setSafeText('wbSourceStatusText', `目前資料源：${model.sourceName}`);

    ['SHEET_1', 'SHEET_2', 'SHEET_3'].forEach(s => {
        const btn = document.getElementById(`wbTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === wv.activeSheet);
    });

    if (wv.activeSheet === 'SHEET_1') {
        container.innerHTML = window.generateSheet1Html(model, false);
    } else if (wv.activeSheet === 'SHEET_2') {
        container.innerHTML = window.generateSheet2Html(model, false);
    } else {
        container.innerHTML = window.generateSheet3Html(model, false);
    }
};

window.generateSheet1Html = function(model, forPrint = false) {
    const s1 = model.sheet1;
    const cols = s1.recDateCols || [];

    const headerCells = cols.map(c => `<th class="text-end bg-light" style="min-width: 120px;">${escapeQuotes(c)}</th>`).join('');
    const valCells = cols.map(c => {
        const v = s1.recDateMap.get(c) || 0;
        const clickAttr = !forPrint ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook({reconcileDate:'${escapeQuotes(c)}', title:'沖帳日批次：${escapeQuotes(c)}'})" title="點擊下鑽檢視此沖帳日批次明細"` : '';
        return `<td class="text-end fw-bold text-primary" ${clickAttr}>${window.formatWbNumber(v)}</td>`;
    }).join('');

    const totalCells = cols.map(c => {
        const v = s1.recDateMap.get(c) || 0;
        return `<td class="text-end fw-bold">${window.formatWbNumber(v)}</td>`;
    }).join('');

    const blankClickAttr = !forPrint ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook({reconcileDate:'__BLANK__', title:'沖帳日：(空白) 尚未排程未收明細'})" title="點擊下鑽檢視尚未填沖帳日之明細"` : '';
    const allClickAttr = !forPrint ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook(null)" title="點擊檢視全部未收明細"` : '';

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 1：【收款總表】（依「是否付款 × 沖帳日批次」交叉樞紐分析）</h6>
            <span class="small text-muted">報表基準日：${getTodayStr()} ｜ 資料來源：${escapeQuotes(model.sourceName)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-bordered align-middle mb-0" style="font-size: 0.92rem; max-width: 820px; border-color: #adb5bd;">
                <thead>
                    <tr style="background-color: #dce6f1;">
                        <th style="width: 160px;">加總 - 總價</th>
                        <th colspan="${cols.length + 2}">欄標籤（沖帳日）</th>
                    </tr>
                    <tr style="background-color: #edf2f8;">
                        <th>列標籤（是否付款）</th>
                        ${headerCells}
                        <th class="text-end" style="min-width: 140px;">(空白)</th>
                        <th class="text-end" style="min-width: 150px;">總計</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="fw-bold">FALSE <span class="small text-muted fw-normal">(未付款)</span></td>
                        ${valCells}
                        <td class="text-end fw-bold text-danger" ${blankClickAttr}>${window.formatWbNumber(s1.blankSum) || '0'}</td>
                        <td class="text-end fw-bold text-dark" ${allClickAttr}>${window.formatWbNumber(s1.grandTotal) || '0'}</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr style="background-color: #dce6f1; border-top: 2px solid #495057;">
                        <td class="fw-bold">總計</td>
                        ${totalCells}
                        <td class="text-end fw-bold text-danger">${window.formatWbNumber(s1.blankSum) || '0'}</td>
                        <td class="text-end fw-bold text-danger fs-6">${window.formatWbNumber(s1.grandTotal) || '0'}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

window.generateSheet3Html = function(model, forPrint = false) {
    const s3 = model.sheet3;
    const wv = window.paymentModuleState.workbookView;
    const yrStruct = s3.yearStructure || [];

    if (yrStruct.length === 0) {
        return `<div class="text-center text-muted py-5">🎉 目前沒有任何未收款資料可供分析</div>`;
    }

    let topHeaderHtml = `<th rowspan="2" class="align-middle" style="min-width: ${wv.clientDisplayMode === 'CODE_AND_NAME' ? '210px' : '105px'}; position: sticky; left: 0; z-index: 2; background-color: #dce6f1;">客戶代號</th>`;
    let subHeaderHtml = '';

    yrStruct.forEach(ys => {
        topHeaderHtml += `<th colspan="${ys.months.length}" class="text-center" style="background-color: #dce6f1;">${ys.year}年</th>`;
        topHeaderHtml += `<th rowspan="2" class="align-middle text-end" style="background-color: #e2efda; min-width: 105px;">${ys.year}年 合計</th>`;
        ys.months.forEach(m => {
            const ymKey = `${ys.year}-${String(m).padStart(2, '0')}`;
            const isPreMayCol = ymKey < '2026-05';
            const thBg = (wv.agingHighlight && isPreMayCol) ? '#fce8e6' : '#edf2f8';
            subHeaderHtml += `<th class="text-end" style="background-color: ${thBg}; min-width: 82px;">${m}月</th>`;
        });
    });
    topHeaderHtml += `<th rowspan="2" class="align-middle text-end" style="background-color: #fce4d6; min-width: 115px;">總計</th>`;

    const bodyRowsHtml = s3.clientRows.map(cRow => {
        const label = window.formatWbClientLabel(cRow.custId, cRow.clientName);
        const clientClick = !forPrint
            ? `style="cursor:pointer; position: sticky; left: 0; background-color: #fff; z-index: 1;" onclick="window.drillDownWorkbook({custId:'${escapeQuotes(cRow.custId)}', title:'客戶：${escapeQuotes(label)} 全部未收明細'})" title="點擊檢視此客戶所有未收明細"`
            : `style="background-color: #fff;"`;

        let cellsHtml = `<td class="fw-bold text-dark text-nowrap" ${clientClick}>${escapeQuotes(label)}</td>`;

        yrStruct.forEach(ys => {
            ys.months.forEach(m => {
                const ymKey = `${ys.year}-${String(m).padStart(2, '0')}`;
                const val = cRow.byYm[ymKey] || 0;
                const isPreMayCol = ymKey < '2026-05';
                const cellBg = (wv.agingHighlight && isPreMayCol && val > 0) ? 'background-color: #fff0f0;' : '';
                const clickAttr = (!forPrint && val > 0)
                    ? `style="cursor:pointer; text-decoration:underline; ${cellBg}" onclick="window.drillDownWorkbook({custId:'${escapeQuotes(cRow.custId)}', yearMonth:'${ymKey}', title:'客戶 ${escapeQuotes(label)} ｜ ${ys.year}年${m}月 未收明細'})" title="點擊下鑽檢視構成此金額之發票明細"`
                    : `style="${cellBg}"`;
                cellsHtml += `<td class="text-end ${val > 0 ? 'text-dark' : 'text-muted'}" ${clickAttr}>${window.formatWbNumber(val)}</td>`;
            });

            const yrVal = cRow.byYear[ys.year] || 0;
            const yrClick = (!forPrint && yrVal > 0)
                ? `style="background-color: #f4f9f0; cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook({custId:'${escapeQuotes(cRow.custId)}', year:${ys.year}, title:'客戶 ${escapeQuotes(label)} ｜ ${ys.year}年全年 未收明細'})"`
                : `style="background-color: #f4f9f0;"`;
            cellsHtml += `<td class="text-end fw-bold" ${yrClick}>${window.formatWbNumber(yrVal)}</td>`;
        });

        const totClick = !forPrint
            ? `style="background-color: #fff9f5; cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook({custId:'${escapeQuotes(cRow.custId)}', title:'客戶 ${escapeQuotes(label)} 總計未收明細'})"`
            : `style="background-color: #fff9f5;"`;
        cellsHtml += `<td class="text-end fw-bold text-danger" ${totClick}>${window.formatWbNumber(cRow.total)}</td>`;

        return `<tr>${cellsHtml}</tr>`;
    }).join('');

    let footCellsHtml = `<td class="fw-bold" style="position: sticky; left: 0; background-color: #dce6f1; z-index: 1;">總計</td>`;
    yrStruct.forEach(ys => {
        ys.months.forEach(m => {
            const ymKey = `${ys.year}-${String(m).padStart(2, '0')}`;
            const mSum = s3.colTotalsByYm[ymKey] || 0;
            const mClick = (!forPrint && mSum > 0)
                ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownWorkbook({yearMonth:'${ymKey}', title:'全體客戶 ｜ ${ys.year}年${m}月 未收明細'})"`
                : '';
            footCellsHtml += `<td class="text-end fw-bold" ${mClick}>${window.formatWbNumber(mSum)}</td>`;
        });
        const ySum = s3.colTotalsByYear[ys.year] || 0;
        footCellsHtml += `<td class="text-end fw-bold text-primary" style="background-color: #d8ead0;">${window.formatWbNumber(ySum)}</td>`;
    });
    footCellsHtml += `<td class="text-end fw-bold text-danger fs-6" style="background-color: #f8cbad;">${window.formatWbNumber(s3.grandTotal) || '0'}</td>`;

    return `
    <div>
        <div class="d-flex flex-wrap justify-content-between align-items-center mb-2">
            <div>
                <h6 class="fw-bold text-dark mb-0">📑 工作表 3：【分析表1】（加總 - 總價 ｜ 客戶代號 × 年度/月份 帳齡交叉矩陣）</h6>
            </div>
            <div class="small text-muted">
                ${wv.agingHighlight ? '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger me-2">粉紅底色 = 2026年5月前跨期歷史未收帳</span>' : ''}
                報表日期：${getTodayStr()}
            </div>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle mb-0" style="font-size: ${forPrint ? '0.74rem' : '0.84rem'}; border-color: #adb5bd;">
                <thead>
                    <tr>${topHeaderHtml}</tr>
                    <tr>${subHeaderHtml}</tr>
                </thead>
                <tbody>
                    ${bodyRowsHtml}
                </tbody>
                <tfoot>
                    <tr style="background-color: #dce6f1; border-top: 2px solid #343a40;">
                        ${footCellsHtml}
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

window.generateSheet2Html = function(model, forPrint = false) {
    const wv = window.paymentModuleState.workbookView;
    const drill = wv.drillFilter;
    const term = (wv.sheet2Search || '').trim().toLowerCase();

    let list = model.rawItems || [];
    if (!forPrint && drill) {
        list = list.filter(x => {
            if (drill.custId && x.custId !== drill.custId) return false;
            if (drill.year && x.year !== Number(drill.year)) return false;
            if (drill.yearMonth && x.yearMonth !== drill.yearMonth) return false;
            if (drill.reconcileDate !== undefined && drill.reconcileDate !== '') {
                if (drill.reconcileDate === '__BLANK__' && x.reconcileDate !== '') return false;
                if (drill.reconcileDate !== '__BLANK__' && x.reconcileDate !== drill.reconcileDate) return false;
            }
            return true;
        });
    }

    if (!forPrint && term) {
        list = list.filter(x =>
            String(x.orderCode || '').toLowerCase().includes(term) ||
            String(x.custId || '').toLowerCase().includes(term) ||
            String(x.clientName || '').toLowerCase().includes(term) ||
            String(x.productCode || '').toLowerCase().includes(term) ||
            String(x.productName || '').toLowerCase().includes(term) ||
            String(x.paperNo || '').toLowerCase().includes(term) ||
            String(x.clientPoL || '').toLowerCase().includes(term) ||
            String(x.auditNote || '').toLowerCase().includes(term)
        );
    }

    const filteredSum = Math.round(list.reduce((s, x) => s + x.total, 0) * 100) / 100;

    const toolbarHtml = !forPrint ? `
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2 p-2 bg-light border rounded">
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <h6 class="fw-bold text-dark mb-0">📑 工作表 2：【未付款-OLD】（14 欄標準未收款明細表）</h6>
                ${drill ? `
                    <span class="badge bg-warning text-dark fs-6">
                        🔎 下鑽篩選中：${escapeQuotes(drill.title)}（共 ${list.length} 筆 / 小計 $${window.formatWbNumber(filteredSum) || '0'}）
                    </span>
                    <button type="button" class="btn btn-sm btn-danger fw-bold py-0 px-2" onclick="window.clearWorkbookDrillFilter()">
                        ❌ 清除篩選顯示全部 (${model.rawItems.length} 筆)
                    </button>
                ` : `<span class="small text-muted">共 ${list.length} 筆明細</span>`}
            </div>
            <div style="min-width: 260px;">
                <input type="search" class="form-control form-control-sm fw-bold" placeholder="🔍 搜尋單號、客戶代號、產品代號、發票號碼..." value="${escapeQuotes(wv.sheet2Search || '')}" oninput="window.onWorkbookSheet2Search(this.value)">
            </div>
        </div>
    ` : `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 2：【未付款-OLD】（未收款明細表 ｜ 共 ${list.length} 筆）</h6>
            <span class="small text-muted">列印日期：${getTodayStr()}</span>
        </div>
    `;

    const rowsHtml = list.map(item => {
        const cLabel = window.formatWbClientLabel(item.custId, item.clientName);
        const rowBg = (wv.agingHighlight && item.isPreMay) ? 'background-color: #fff5f5;' : '';
        const actionTd = !forPrint ? `
            <td class="text-center">
                ${item.erpRowIdx ? `<button type="button" class="btn btn-sm btn-outline-success fw-bold py-0 px-2" onclick="window.paySingleItemFromWorkbook(${item.erpRowIdx})">⚡ 沖帳</button>` : `<span class="text-muted small">外部列</span>`}
            </td>
        ` : '';

        return `
        <tr style="${rowBg}">
            <td>${escapeQuotes(item.orderCode)}</td>
            <td class="fw-bold text-nowrap">${escapeQuotes(cLabel)}</td>
            <td class="text-nowrap">${escapeQuotes(item.dateStr)}</td>
            <td class="text-center text-muted">FALSE</td>
            <td class="text-center text-danger fw-bold">FALSE</td>
            <td><code>${escapeQuotes(item.productCode)}</code>${wv.clientDisplayMode === 'CODE_AND_NAME' && item.productName && item.productName !== item.productCode ? `<div class="small text-muted">${escapeQuotes(item.productName)}</div>` : ''}</td>
            <td class="text-end">${item.qty}</td>
            <td class="text-end">${window.formatWbNumber(item.price) || '0'}</td>
            <td class="text-end fw-bold text-danger">${window.formatWbNumber(item.total) || '0'}</td>
            <td class="fw-bold text-primary">${escapeQuotes(item.paperNo)}</td>
            <td>${escapeQuotes(item.noteK)}</td>
            <td>${escapeQuotes(item.clientPoL)}</td>
            <td class="text-center text-success fw-bold">${escapeQuotes(item.reconcileDate)}</td>
            <td class="small text-secondary">${escapeQuotes(item.auditNote)}</td>
            ${actionTd}
        </tr>`;
    }).join('');

    return `
    <div>
        ${toolbarHtml}
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.72rem' : '0.82rem'}; border-color: #adb5bd;">
                <thead style="background-color: #dce6f1;">
                    <tr>
                        <th>訂單代號</th>
                        <th>客戶代號</th>
                        <th>出貨日期</th>
                        <th class="text-center">註銷</th>
                        <th class="text-center">是否付款</th>
                        <th>產品代號</th>
                        <th class="text-end">出貨數量</th>
                        <th class="text-end">單價</th>
                        <th class="text-end">總價</th>
                        <th>發票號碼</th>
                        <th>備考</th>
                        <th>客戶編號</th>
                        <th class="text-center">沖帳日</th>
                        <th>核對備註</th>
                        ${!forPrint ? '<th class="text-center">快速沖帳</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr style="background-color: #dce6f1; border-top: 2px solid #343a40;">
                        <td colspan="8" class="text-end fw-bold">合計 (I欄 總價加總)：</td>
                        <td class="text-end fw-bold text-danger fs-6">${window.formatWbNumber(filteredSum) || '0'}</td>
                        <td colspan="${!forPrint ? '6' : '5'}" class="small text-muted">
                            ${filteredSum !== model.grandTotal ? `(全表未收總計：$${window.formatWbNumber(model.grandTotal) || '0'})` : ''}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

window.drillDownWorkbook = function(filterObj) {
    const wv = window.paymentModuleState.workbookView;
    wv.drillFilter = filterObj;
    window.switchWorkbookSheet('SHEET_2', true);
    if (filterObj && filterObj.title) {
        showToast(`🔎 已下鑽篩選「${filterObj.title}」之未收明細`);
    }
};

window.clearWorkbookDrillFilter = function() {
    window.paymentModuleState.workbookView.drillFilter = null;
    window.renderUnpaidWorkbookModalContent();
};

window.onWorkbookSheet2Search = debounce(function(val) {
    window.paymentModuleState.workbookView.sheet2Search = val || '';
    window.renderUnpaidWorkbookModalContent();
}, 200);

window.paySingleItemFromWorkbook = function(erpRowIdx) {
    if (!erpRowIdx) return;
    window.paymentModuleState.selectedRowIndices.clear();
    window.paymentModuleState.selectedRowIndices.add(erpRowIdx);
    window.updateSelectedReceivableSummary();
    window.openExecutePaymentModal();
};

window.printSelectedUnpaidWorkbookSheets = function() {
    const pS1 = document.getElementById('cbPrintWb_s1')?.checked;
    const pS2 = document.getElementById('cbPrintWb_s2')?.checked;
    const pS3 = document.getElementById('cbPrintWb_s3')?.checked;

    if (!pS1 && !pS2 && !pS3) {
        return alert("請至少勾選一個要列印的工作表（1.收款總表 / 2.未付款-OLD / 3.分析表1）！");
    }

    const model = window.buildUnpaidWorkbookDataModel();
    const selectedBlocks = [];

    const buildPrintHeader = (sheetTitle) => `
        <div style="border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #000;">長固實業有限公司 — 未收款分析報表 (${sheetTitle})</div>
                <div style="font-size: 12px; color: #444;">資料來源：${escapeQuotes(model.sourceName)} ｜ 未收款總計：$${window.formatWbNumber(model.grandTotal) || '0'}</div>
            </div>
            <div style="font-size: 12px; color: #333; text-align: right;">
                製表人員：${escapeQuotes(myName || '管理員')} ｜ 列印日期：${getTodayStr()}
            </div>
        </div>
    `;

    if (pS1) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildPrintHeader('工作表1：收款總表')}
                ${window.generateSheet1Html(model, true)}
            </div>
        `);
    }
    if (pS2) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildPrintHeader('工作表2：未付款-OLD 明細表')}
                ${window.generateSheet2Html(model, true)}
            </div>
        `);
    }
    if (pS3) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildPrintHeader('工作表3：分析表1 客戶×年月帳齡表')}
                ${window.generateSheet3Html(model, true)}
            </div>
        `);
    }

    const combinedHtml = selectedBlocks.map((blockHtml, idx) => {
        const isLast = idx === selectedBlocks.length - 1;
        return `<div class="${!isLast ? 'print-sheet-page-break' : ''}" style="margin-bottom: 18px;">${blockHtml}</div>`;
    }).join('');

    bootstrap.Modal.getInstance(document.getElementById('unpaidWorkbookModal'))?.hide();

    let printEl = document.getElementById('printUnpaidWorkbookArea');
    if (!printEl) {
        printEl = document.createElement('div');
        printEl.id = 'printUnpaidWorkbookArea';
        printEl.style.display = 'none';
        document.body.appendChild(printEl);
    }
    printEl.innerHTML = combinedHtml;

    window.applyPrintStyle('A4', 'landscape');
    window.showPrintPreview('printUnpaidWorkbookArea');
};

window.exportUnpaidWorkbookExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 引擎載入中，請稍候！");
    const model = window.buildUnpaidWorkbookDataModel();
    const wv = window.paymentModuleState.workbookView;
    const wb = XLSX.utils.book_new();

    const s1 = model.sheet1;
    const s1Cols = s1.recDateCols || [];
    const s1Row1 = ["加總 - 總價", "欄標籤", ...s1Cols.map(() => ""), ""];
    const s1Row2 = ["列標籤", ...s1Cols, "(空白)", "總計"];
    const s1Row3 = ["FALSE", ...s1Cols.map(c => s1.recDateMap.get(c) || 0), s1.blankSum, s1.grandTotal];
    const s1Row4 = ["總計", ...s1Cols.map(c => s1.recDateMap.get(c) || 0), s1.blankSum, s1.grandTotal];

    const ws1 = XLSX.utils.aoa_to_sheet([s1Row1, s1Row2, s1Row3, s1Row4]);
    XLSX.utils.book_append_sheet(wb, ws1, "收款總表");

    const s2Aoa = [[
        "訂單代號", "客戶代號", "出貨日期", "註銷", "是否付款",
        "產品代號", "出貨數量", "單價", "總價", "發票號碼",
        "傋考", "客戶編號", "沖帳日", "核對備註"
    ]];
    model.rawItems.forEach(item => {
        const cLabel = wv.clientDisplayMode === 'CODE_ONLY' ? item.custId : window.formatWbClientLabel(item.custId, item.clientName);
        s2Aoa.push([
            item.orderCode, cLabel, item.dateStr, false, false,
            item.productCode, item.qty, item.price, item.total, item.paperNo,
            item.noteK, item.clientPoL, item.reconcileDate, item.auditNote
        ]);
    });
    s2Aoa.push(["", "", "", "", "", "", "", "總計", model.grandTotal, "", "", "", "", ""]);

    const ws2 = XLSX.utils.aoa_to_sheet(s2Aoa);
    ws2['!cols'] = [
        { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
        { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
        { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, "未付款-OLD");

    const s3 = model.sheet3;
    const yrStruct = s3.yearStructure || [];

    const rowTitle = ["加總 - 總價"];
    const rowYearHeader = [""];
    const rowMonthHeader = [""];

    yrStruct.forEach(ys => {
        ys.months.forEach((m, idx) => {
            rowYearHeader.push(idx === 0 ? `${ys.year}年` : "");
            rowMonthHeader.push(`${m}月`);
        });
        rowYearHeader.push(`${ys.year}年 合計`);
        rowMonthHeader.push("");
    });
    rowYearHeader.push("總計");
    rowMonthHeader.push("");

    const s3Aoa = [rowTitle, rowYearHeader, rowMonthHeader];

    s3.clientRows.forEach(cRow => {
        const cLabel = wv.clientDisplayMode === 'CODE_ONLY' ? cRow.custId : window.formatWbClientLabel(cRow.custId, cRow.clientName);
        const line = [cLabel];
        yrStruct.forEach(ys => {
            ys.months.forEach(m => {
                const ymKey = `${ys.year}-${String(m).padStart(2, '0')}`;
                const v = cRow.byYm[ymKey];
                line.push(v ? v : "");
            });
            line.push(cRow.byYear[ys.year] || "");
        });
        line.push(cRow.total);
        s3Aoa.push(line);
    });

    const totalLine = ["總計"];
    yrStruct.forEach(ys => {
        ys.months.forEach(m => {
            const ymKey = `${ys.year}-${String(m).padStart(2, '0')}`;
            totalLine.push(s3.colTotalsByYm[ymKey] || 0);
        });
        totalLine.push(s3.colTotalsByYear[ys.year] || 0);
    });
    totalLine.push(s3.grandTotal);
    s3Aoa.push(totalLine);

    const ws3 = XLSX.utils.aoa_to_sheet(s3Aoa);
    XLSX.utils.book_append_sheet(wb, ws3, "分析表1");

    XLSX.writeFile(wb, `未收款三表分析_${getTodayStr()}.xlsx`);
    showToast("📥 已成功匯出包含「收款總表、未付款-OLD、分析表1」之 Excel 檔案！");
};

// ============================================================================
// 1.8 【新增核心】點擊「🟢 累計已完成沖帳」：時間區間查詢、三表 Excel 下載、多選列印與單張憑證列印
// ============================================================================
window.openPaidReportModal = function() {
    window.initPaymentModule();
    const pv = window.paymentModuleState.paidReportView;
    pv.drillClient = null;

    // 填充客戶下拉選單
    const clientSel = document.getElementById('prClientFilter');
    if (clientSel) {
        const clientsSet = new Set();
        (globalPayments || []).forEach(p => {
            if (p.status !== '已作廢' && p.client) clientsSet.add(p.client);
        });
        const sortedClients = Array.from(clientsSet).sort();
        const curVal = pv.clientFilter || '';
        clientSel.innerHTML = '<option value="">🏢 所有客戶 (全部)</option>' +
            sortedClients.map(c => `<option value="${escapeQuotes(c)}">${escapeQuotes(c)}</option>`).join('');
        if (sortedClients.includes(curVal)) clientSel.value = curVal;
    }

    // 同步介面控制項狀態
    if (document.getElementById('prDateBasis')) document.getElementById('prDateBasis').value = pv.dateBasis || 'PAY_DATE';
    if (document.getElementById('prStartDate')) document.getElementById('prStartDate').value = pv.startDate || '';
    if (document.getElementById('prEndDate')) document.getElementById('prEndDate').value = pv.endDate || '';
    if (document.getElementById('prMethodFilter')) document.getElementById('prMethodFilter').value = pv.methodFilter || '';
    if (document.getElementById('prSourceFilter')) document.getElementById('prSourceFilter').value = pv.sourceFilter || '';
    if (document.getElementById('prSearchInput')) document.getElementById('prSearchInput').value = pv.searchTerm || '';
    if (document.getElementById('prOnlyDiffSwitch')) document.getElementById('prOnlyDiffSwitch').checked = !!pv.onlyDiff;

    window.renderPaidReportModalContent();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('paidReportModal')).show();
};

// 一鍵設定時間區間快捷按鈕
window.setPaidReportQuickDate = function(preset) {
    const now = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let sDate = '';
    let eDate = '';

    if (preset === 'TODAY') {
        sDate = fmt(now);
        eDate = fmt(now);
    } else if (preset === 'THIS_WEEK') {
        const day = now.getDay() || 7;
        const mon = new Date(now);
        mon.setDate(now.getDate() - day + 1);
        sDate = fmt(mon);
        eDate = fmt(now);
    } else if (preset === 'THIS_MONTH') {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        sDate = fmt(first);
        eDate = fmt(last);
    } else if (preset === 'LAST_MONTH') {
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last = new Date(now.getFullYear(), now.getMonth(), 0);
        sDate = fmt(first);
        eDate = fmt(last);
    } else if (preset === 'LAST_3_MONTHS') {
        const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        sDate = fmt(first);
        eDate = fmt(now);
    } else if (preset === 'THIS_YEAR') {
        sDate = `${now.getFullYear()}-01-01`;
        eDate = `${now.getFullYear()}-12-31`;
    } else if (preset === 'ALL') {
        sDate = '';
        eDate = '';
    }

    const sInput = document.getElementById('prStartDate');
    const eInput = document.getElementById('prEndDate');
    const mPicker = document.getElementById('prMonthPicker');
    if (sInput) sInput.value = sDate;
    if (eInput) eInput.value = eDate;
    if (mPicker) mPicker.value = '';

    window.onChangePaidReportFilter();
};

window.setPaidReportMonthPicker = function(ymVal) {
    if (!ymVal) return;
    const parts = ymVal.split('-');
    if (parts.length !== 2) return;
    const yr = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10);
    const lastDay = new Date(yr, mo, 0).getDate();
    const sDate = `${yr}-${String(mo).padStart(2, '0')}-01`;
    const eDate = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const sInput = document.getElementById('prStartDate');
    const eInput = document.getElementById('prEndDate');
    if (sInput) sInput.value = sDate;
    if (eInput) eInput.value = eDate;

    window.onChangePaidReportFilter();
};

window.onChangePaidReportFilter = debounce(function() {
    const pv = window.paymentModuleState.paidReportView;
    pv.dateBasis = document.getElementById('prDateBasis')?.value || 'PAY_DATE';
    pv.startDate = document.getElementById('prStartDate')?.value || '';
    pv.endDate = document.getElementById('prEndDate')?.value || '';
    pv.clientFilter = document.getElementById('prClientFilter')?.value || '';
    pv.methodFilter = document.getElementById('prMethodFilter')?.value || '';
    pv.sourceFilter = document.getElementById('prSourceFilter')?.value || '';
    pv.searchTerm = (document.getElementById('prSearchInput')?.value || '').trim();
    pv.onlyDiff = !!document.getElementById('prOnlyDiffSwitch')?.checked;

    window.renderPaidReportModalContent();
}, 150);

window.switchPaidReportSheet = function(sheetId, keepDrill = false) {
    const pv = window.paymentModuleState.paidReportView;
    pv.activeSheet = sheetId;
    if (!keepDrill && sheetId === 'PAID_S3') {
        pv.drillClient = null;
    }
    ['PAID_S1', 'PAID_S2', 'PAID_S3'].forEach(s => {
        const btn = document.getElementById(`prTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === sheetId);
    });
    window.renderPaidReportModalContent();
};

window.quickSelectPaidPrintSheets = function(mode) {
    const c1 = document.getElementById('cbPrintPaid_s1');
    const c2 = document.getElementById('cbPrintPaid_s2');
    const c3 = document.getElementById('cbPrintPaid_s3');
    if (mode === 'ALL') {
        if (c1) c1.checked = true;
        if (c2) c2.checked = true;
        if (c3) c3.checked = true;
    } else if (mode === 'SUMMARY') {
        if (c1) c1.checked = true;
        if (c2) c2.checked = false;
        if (c3) c3.checked = true;
    }
};

// 動態建構「已完成沖帳」三工作表資料模型
window.buildPaidReportDataModel = function() {
    const pv = window.paymentModuleState.paidReportView;
    const term = (pv.searchTerm || '').toLowerCase();

    const filteredRecords = (globalPayments || []).filter(p => {
        if (!p || p.status === '已作廢') return false;

        // 取出該筆紀錄的比較日期 (YYYY-MM-DD)
        let recordDateStr = '';
        if (pv.dateBasis === 'CREATE_TIME') {
            const d = new Date(Number(p.time) || Date.now());
            if (!isNaN(d.getTime())) {
                recordDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
        } else {
            recordDateStr = window.parseExternalDateStr ? window.parseExternalDateStr(p.payDate) : String(p.payDate || '').trim();
        }

        if (pv.startDate && recordDateStr && recordDateStr < pv.startDate) return false;
        if (pv.endDate && recordDateStr && recordDateStr > pv.endDate) return false;

        if (pv.clientFilter && !String(p.client || '').includes(pv.clientFilter)) return false;
        if (pv.drillClient && p.client !== pv.drillClient) return false;
        if (pv.methodFilter && p.payMethod !== pv.methodFilter) return false;
        if (pv.sourceFilter && p.sourceType !== pv.sourceFilter) return false;

        // 進階優化 1：僅顯示有匯費/折讓差額之沖帳單
        if (pv.onlyDiff && Math.abs(Number(p.diffAmount) || 0) < 0.01) return false;

        if (term) {
            const match =
                String(p.paymentNo || '').toLowerCase().includes(term) ||
                String(p.paperNos || '').toLowerCase().includes(term) ||
                String(p.client || '').toLowerCase().includes(term) ||
                String(p.memo || '').toLowerCase().includes(term) ||
                String(p.staff || '').toLowerCase().includes(term) ||
                String(p.itemsJson || '').toLowerCase().includes(term);
            if (!match) return false;
        }
        return true;
    });

    // 依收款日與建立時間由新到舊排序
    filteredRecords.sort((a, b) => {
        const dA = String(a.payDate || '');
        const dB = String(b.payDate || '');
        if (dA !== dB) return dB.localeCompare(dA);
        return (Number(b.time) || 0) - (Number(a.time) || 0);
    });

    let totalReceivable = 0;
    let totalReceived = 0;
    let totalDiff = 0;
    const expandedLineItems = [];
    const clientSummaryMap = new Map();

    filteredRecords.forEach(p => {
        const recAmt = Math.round((Number(p.receivableTotal) || 0) * 100) / 100;
        const actAmt = Math.round((Number(p.receivedAmount) || 0) * 100) / 100;
        const difAmt = Math.round((Number(p.diffAmount) || 0) * 100) / 100;

        totalReceivable = Math.round((totalReceivable + recAmt) * 100) / 100;
        totalReceived = Math.round((totalReceived + actAmt) * 100) / 100;
        totalDiff = Math.round((totalDiff + difAmt) * 100) / 100;

        const custId = window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(p.client) : '';

        // 展開 itemsJson 至工作表 2
        let itemsArr = [];
        try { itemsArr = JSON.parse(p.itemsJson || '[]'); } catch (e) { itemsArr = []; }

        if (itemsArr.length > 0) {
            itemsArr.forEach(itm => {
                expandedLineItems.push({
                    paymentNo: p.paymentNo,
                    payDate: p.payDate,
                    payMethod: p.payMethod,
                    custId: custId,
                    client: p.client,
                    paperNo: itm.paperNo || p.paperNos || '--',
                    orderNo: itm.orderNo || '--',
                    productCode: window.getProductCodeByName ? window.getProductCodeByName(itm.name, p.client) : '',
                    name: itm.name || '沖帳品項',
                    qty: Number(itm.qty) || 1,
                    price: Number(itm.price) || Number(itm.subtotal) || 0,
                    subtotal: Math.round((Number(itm.subtotal) || ((Number(itm.qty)||1)*(Number(itm.price)||0))) * 100) / 100,
                    staff: p.staff || '',
                    memo: p.memo || ''
                });
            });
        } else {
            expandedLineItems.push({
                paymentNo: p.paymentNo,
                payDate: p.payDate,
                payMethod: p.payMethod,
                custId: custId,
                client: p.client,
                paperNo: p.paperNos || '--',
                orderNo: '--',
                productCode: '',
                name: '(整筆發票匯總沖銷)',
                qty: 1,
                price: actAmt,
                subtotal: actAmt,
                staff: p.staff || '',
                memo: p.memo || ''
            });
        }

        // 累計工作表 3：客戶別統計
        const cKey = p.client || '未命名客戶';
        if (!clientSummaryMap.has(cKey)) {
            clientSummaryMap.set(cKey, {
                custId: custId,
                client: cKey,
                recordCount: 0,
                invoiceSet: new Set(),
                receivableSum: 0,
                receivedSum: 0,
                diffSum: 0,
                wireSum: 0,
                checkSum: 0,
                otherSum: 0
            });
        }
        const cs = clientSummaryMap.get(cKey);
        cs.recordCount++;
        String(p.paperNos || '').split(',').map(s => s.trim()).filter(Boolean).forEach(inv => cs.invoiceSet.add(inv));
        cs.receivableSum = Math.round((cs.receivableSum + recAmt) * 100) / 100;
        cs.receivedSum = Math.round((cs.receivedSum + actAmt) * 100) / 100;
        cs.diffSum = Math.round((cs.diffSum + difAmt) * 100) / 100;

        if (String(p.payMethod).includes('匯款')) {
            cs.wireSum = Math.round((cs.wireSum + actAmt) * 100) / 100;
        } else if (String(p.payMethod).includes('支票')) {
            cs.checkSum = Math.round((cs.checkSum + actAmt) * 100) / 100;
        } else {
            cs.otherSum = Math.round((cs.otherSum + actAmt) * 100) / 100;
        }
    });

    const clientSummaryRows = Array.from(clientSummaryMap.values()).sort((a, b) => b.receivedSum - a.receivedSum);

    const periodText = (pv.startDate || pv.endDate)
        ? `${pv.startDate || '最早'} ～ ${pv.endDate || '最新'}`
        : '全部歷史期間';

    return {
        periodText: periodText,
        dateBasisText: pv.dateBasis === 'CREATE_TIME' ? '依系統建立日' : '依實際收款日',
        records: filteredRecords,
        lineItems: expandedLineItems,
        clientSummaries: clientSummaryRows,
        totalReceivable: totalReceivable,
        totalReceived: totalReceived,
        totalDiff: totalDiff
    };
};

// 渲染「🟢 已完成沖帳區間查詢中心」視窗內容
window.renderPaidReportModalContent = function() {
    const container = document.getElementById('prSheetContentContainer');
    if (!container) return;

    const model = window.buildPaidReportDataModel();
    const pv = window.paymentModuleState.paidReportView;

    setSafeText('prStatCount', `${model.records.length} 單 (${model.lineItems.length} 筆品項)`);
    setSafeText('prStatReceivable', '$' + (window.formatWbNumber(model.totalReceivable) || '0'));
    setSafeText('prStatReceived', '$' + (window.formatWbNumber(model.totalReceived) || '0'));
    setSafeText('prStatDiff', '$' + (window.formatWbNumber(model.totalDiff) || '0'));

    setSafeText('prBadge_s1', `${model.records.length} 單`);
    setSafeText('prBadge_s2', `${model.lineItems.length} 筆`);
    setSafeText('prBadge_s3', `${model.clientSummaries.length} 客戶`);
    setSafeText('prPeriodRangeLabel', `${model.dateBasisText}：${model.periodText}`);

    const drillEl = document.getElementById('prDrillBanner');
    if (drillEl) {
        if (pv.drillClient) {
            drillEl.style.display = 'inline-block';
            drillEl.innerHTML = `
                <span class="badge bg-warning text-dark">
                    🔎 下鑽客戶：${escapeQuotes(pv.drillClient)}
                    <a href="javascript:void(0)" class="text-danger fw-bold ms-1 text-decoration-none" onclick="window.clearPaidReportDrill()">[✕ 清除]</a>
                </span>`;
        } else {
            drillEl.style.display = 'none';
            drillEl.innerHTML = '';
        }
    }

    ['PAID_S1', 'PAID_S2', 'PAID_S3'].forEach(s => {
        const btn = document.getElementById(`prTabBtn_${s}`);
        if (btn) btn.classList.toggle('active', s === pv.activeSheet);
    });

    if (pv.activeSheet === 'PAID_S1') {
        container.innerHTML = window.generatePaidSheet1Html(model, false);
    } else if (pv.activeSheet === 'PAID_S2') {
        container.innerHTML = window.generatePaidSheet2Html(model, false);
    } else {
        container.innerHTML = window.generatePaidSheet3Html(model, false);
    }
};

// 產生已沖帳【工作表 1：已沖帳收款總表 (依沖帳單歸戶)】HTML
window.generatePaidSheet1Html = function(model, forPrint = false) {
    const list = model.records || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選時間區間與篩選條件下沒有已完成沖帳的紀錄</div>`;
    }

    const rowsHtml = list.map((p, idx) => {
        const d = new Date(Number(p.time) || Date.now());
        const createStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const cId = window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(p.client) : '';
        const hasDiff = Math.abs(Number(p.diffAmount) || 0) >= 0.01;

        const actionCols = !forPrint ? `
            <td class="text-center text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold py-0 px-2 me-1" onclick="window.printSinglePaymentVoucher(${p.rowIdx})" title="列印單張收款沖帳傳票憑證">🖨️ 憑證</button>
                <button type="button" class="btn btn-sm btn-outline-danger fw-bold py-0 px-2" onclick="window.voidPaymentFromReportModal(${p.rowIdx})" title="作廢此筆沖帳並退回未收款">↩️ 作廢</button>
            </td>
        ` : '';

        return `
        <tr style="${hasDiff ? 'background-color: #fffdf2;' : ''}">
            <td class="text-center text-muted fw-bold">${idx + 1}</td>
            <td class="fw-bold text-primary text-nowrap">${escapeQuotes(p.paymentNo)}</td>
            <td class="fw-bold text-dark text-nowrap">${escapeQuotes(p.payDate)}</td>
            <td class="small text-muted text-nowrap">${createStr}</td>
            <td class="fw-bold">${cId && cId !== p.client ? `<span class="badge bg-light text-secondary border me-1">${escapeQuotes(cId)}</span>` : ''}${escapeQuotes(p.client)}</td>
            <td><span class="badge bg-light text-dark border">${escapeQuotes(p.payMethod)}</span></td>
            <td class="small text-primary fw-bold" style="max-width: 220px;">${escapeQuotes(p.paperNos)}</td>
            <td class="text-end fw-bold">$${Number(p.receivableTotal || 0).toLocaleString()}</td>
            <td class="text-end fw-bold text-success fs-6">$${Number(p.receivedAmount || 0).toLocaleString()}</td>
            <td class="text-end fw-bold ${hasDiff ? 'text-danger' : 'text-muted'}">$${Number(p.diffAmount || 0).toLocaleString()}</td>
            <td><span class="badge bg-info text-dark" style="font-size:0.72rem;">${escapeQuotes(p.sourceType)}</span></td>
            <td class="text-center small">${escapeQuotes(p.staff)}</td>
            <td class="small text-danger fw-bold">${escapeQuotes(p.memo || '')}</td>
            ${actionCols}
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 1：【已沖帳收款總表】（共 ${list.length} 筆沖帳單）</h6>
            <span class="small text-muted">${escapeQuotes(model.dateBasisText)}：${escapeQuotes(model.periodText)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.74rem' : '0.84rem'}; border-color: #adb5bd;">
                <thead style="background-color: #d1e7dd;">
                    <tr>
                        <th class="text-center" style="width:42px;">#</th>
                        <th>沖帳單號</th>
                        <th>實際收款日</th>
                        <th>系統建立時間</th>
                        <th>客戶名稱</th>
                        <th>收款方式</th>
                        <th>沖銷發票清單</th>
                        <th class="text-end">帳面應收總額</th>
                        <th class="text-end">實際收款金額</th>
                        <th class="text-end">匯費/折讓差額</th>
                        <th>帳款來源</th>
                        <th class="text-center">經辦</th>
                        <th>備註說明</th>
                        ${!forPrint ? '<th class="text-center" style="width:130px;">傳票 / 操作</th>' : ''}
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #d1e7dd; border-top: 2px solid #198754;">
                        <td colspan="7" class="text-end fw-bold">區間總計（共 ${list.length} 張沖帳單）：</td>
                        <td class="text-end fw-bold text-dark">$${(window.formatWbNumber(model.totalReceivable) || '0')}</td>
                        <td class="text-end fw-bold text-success fs-6">$${(window.formatWbNumber(model.totalReceived) || '0')}</td>
                        <td class="text-end fw-bold text-danger">$${(window.formatWbNumber(model.totalDiff) || '0')}</td>
                        <td colspan="${!forPrint ? '4' : '3'}"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 產生已沖帳【工作表 2：已沖帳發票與品項展開明細表】HTML
window.generatePaidSheet2Html = function(model, forPrint = false) {
    const items = model.lineItems || [];
    if (items.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選區間內沒有展開之發票品項明細</div>`;
    }

    const totalItemSub = Math.round(items.reduce((s, x) => s + (Number(x.subtotal) || 0), 0) * 100) / 100;

    const rowsHtml = items.map((itm, idx) => `
        <tr>
            <td class="text-center text-muted">${idx + 1}</td>
            <td class="fw-bold text-primary text-nowrap">${escapeQuotes(itm.paymentNo)}</td>
            <td class="text-nowrap">${escapeQuotes(itm.payDate)}</td>
            <td>${escapeQuotes(itm.payMethod)}</td>
            <td class="fw-bold">${itm.custId && itm.custId !== itm.client ? `<small class="text-muted">(${escapeQuotes(itm.custId)})</small> ` : ''}${escapeQuotes(itm.client)}</td>
            <td class="fw-bold text-primary">${escapeQuotes(itm.paperNo)}</td>
            <td>${escapeQuotes(itm.orderNo)}</td>
            <td>${itm.productCode && itm.productCode !== itm.name ? `<code>${escapeQuotes(itm.productCode)}</code> ` : ''}${escapeQuotes(itm.name)}</td>
            <td class="text-center fw-bold">${itm.qty}</td>
            <td class="text-end">$${Number(itm.price || 0).toLocaleString()}</td>
            <td class="text-end fw-bold text-success">$${Number(itm.subtotal || 0).toLocaleString()}</td>
            <td class="text-center small">${escapeQuotes(itm.staff)}</td>
            <td class="small text-secondary">${escapeQuotes(itm.memo)}</td>
        </tr>
    `).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 2：【已沖帳發票與品項展開明細表】（共 ${items.length} 筆品項明細）</h6>
            <span class="small text-muted">${escapeQuotes(model.dateBasisText)}：${escapeQuotes(model.periodText)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.73rem' : '0.83rem'}; border-color: #adb5bd;">
                <thead style="background-color: #cfe2ff;">
                    <tr>
                        <th class="text-center" style="width:42px;">#</th>
                        <th>沖帳單號</th>
                        <th>實際收款日</th>
                        <th>收款方式</th>
                        <th>客戶名稱</th>
                        <th>發票號碼</th>
                        <th>訂單編號</th>
                        <th>產品代號 / 品名規格</th>
                        <th class="text-center">數量</th>
                        <th class="text-end">單價</th>
                        <th class="text-end">品項沖銷金額</th>
                        <th class="text-center">經辦</th>
                        <th>沖帳備註</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #cfe2ff; border-top: 2px solid #0d6efd;">
                        <td colspan="10" class="text-end fw-bold">展開品項沖銷金額合計：</td>
                        <td class="text-end fw-bold text-success fs-6">$${window.formatWbNumber(totalItemSub) || '0'}</td>
                        <td colspan="2" class="small text-muted">(實收總計：$${window.formatWbNumber(model.totalReceived) || '0'})</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 產生已沖帳【工作表 3：客戶別已收款與收款方式統計表】HTML
window.generatePaidSheet3Html = function(model, forPrint = false) {
    const list = model.clientSummaries || [];
    if (list.length === 0) {
        return `<div class="text-center text-muted py-5">📭 所選區間內沒有客戶收款統計資料</div>`;
    }

    let sumWire = 0, sumCheck = 0, sumOther = 0;
    const rowsHtml = list.map((c, idx) => {
        sumWire = Math.round((sumWire + c.wireSum) * 100) / 100;
        sumCheck = Math.round((sumCheck + c.checkSum) * 100) / 100;
        sumOther = Math.round((sumOther + c.otherSum) * 100) / 100;
        const pct = model.totalReceived > 0 ? ((c.receivedSum / model.totalReceived) * 100).toFixed(1) + '%' : '0.0%';

        const clickAttr = !forPrint
            ? `style="cursor:pointer; text-decoration:underline;" onclick="window.drillDownPaidReportClient('${escapeQuotes(c.client)}')" title="點擊下鑽檢視此客戶之沖帳明細"`
            : '';

        return `
        <tr>
            <td class="text-center text-muted fw-bold">${idx + 1}</td>
            <td class="fw-bold text-primary">${escapeQuotes(c.custId || '--')}</td>
            <td class="fw-bold text-dark" ${clickAttr}>${escapeQuotes(c.client)}</td>
            <td class="text-center fw-bold">${c.recordCount} 單</td>
            <td class="text-center">${c.invoiceSet.size} 張</td>
            <td class="text-end fw-bold">$${c.receivableSum.toLocaleString()}</td>
            <td class="text-end fw-bold text-success fs-6" ${clickAttr}>$${c.receivedSum.toLocaleString()}</td>
            <td class="text-end ${Math.abs(c.diffSum) > 0 ? 'text-danger fw-bold' : 'text-muted'}">$${c.diffSum.toLocaleString()}</td>
            <td class="text-end text-primary">$${c.wireSum.toLocaleString()}</td>
            <td class="text-end text-info text-dark">$${c.checkSum.toLocaleString()}</td>
            <td class="text-end text-secondary">$${c.otherSum.toLocaleString()}</td>
            <td class="text-end fw-bold text-secondary">${pct}</td>
        </tr>`;
    }).join('');

    return `
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="fw-bold text-dark mb-0">📑 工作表 3：【客戶別已收款與收款方式統計表】（共 ${list.length} 家客戶）</h6>
            <span class="small text-muted">${escapeQuotes(model.dateBasisText)}：${escapeQuotes(model.periodText)}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered table-hover align-middle mb-0" style="font-size: ${forPrint ? '0.75rem' : '0.85rem'}; border-color: #adb5bd;">
                <thead style="background-color: #e2e3e5;">
                    <tr>
                        <th class="text-center" style="width:42px;">排行</th>
                        <th>客戶代號</th>
                        <th>客戶名稱</th>
                        <th class="text-center">沖帳單數</th>
                        <th class="text-center">沖銷發票數</th>
                        <th class="text-end">帳面應收合計</th>
                        <th class="text-end">實際收款合計</th>
                        <th class="text-end">匯費/折讓差額</th>
                        <th class="text-end">🏦 銀行匯款</th>
                        <th class="text-end">🎫 支票收款</th>
                        <th class="text-end">💵 其他方式</th>
                        <th class="text-end">收款佔比</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background-color: #d1e7dd; border-top: 2px solid #198754;">
                        <td colspan="3" class="text-end fw-bold">全體客戶總計：</td>
                        <td class="text-center fw-bold">${model.records.length} 單</td>
                        <td class="text-center">--</td>
                        <td class="text-end fw-bold">$${window.formatWbNumber(model.totalReceivable) || '0'}</td>
                        <td class="text-end fw-bold text-success fs-6">$${window.formatWbNumber(model.totalReceived) || '0'}</td>
                        <td class="text-end fw-bold text-danger">$${window.formatWbNumber(model.totalDiff) || '0'}</td>
                        <td class="text-end fw-bold text-primary">$${window.formatWbNumber(sumWire) || '0'}</td>
                        <td class="text-end fw-bold text-dark">$${window.formatWbNumber(sumCheck) || '0'}</td>
                        <td class="text-end fw-bold text-secondary">$${window.formatWbNumber(sumOther) || '0'}</td>
                        <td class="text-end fw-bold">100%</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;
};

// 進階優化 2：從「工作表 3 客戶別統計」點擊下鑽至該客戶之沖帳明細
window.drillDownPaidReportClient = function(clientName) {
    const pv = window.paymentModuleState.paidReportView;
    pv.drillClient = clientName;
    window.switchPaidReportSheet('PAID_S1', true);
    showToast(`🔎 已為您篩選「${clientName}」於此區間內之沖帳單明細`);
};

window.clearPaidReportDrill = function() {
    window.paymentModuleState.paidReportView.drillClient = null;
    window.renderPaidReportModalContent();
};

// 進階優化 4：於區間查詢視窗內直接執行作廢退回未收
window.voidPaymentFromReportModal = function(rowIdx) {
    window.voidPaymentRecord(rowIdx);
    setTimeout(() => {
        if (document.getElementById('paidReportModal')?.classList.contains('show')) {
            window.renderPaidReportModalContent();
        }
    }, 300);
};

// 進階優化 3：單筆沖帳單「🧾 收款沖帳核銷傳票憑證」獨立列印
window.printSinglePaymentVoucher = function(rowIdx) {
    const p = (globalPayments || []).find(x => x.rowIdx === rowIdx);
    if (!p) return alert("找不到該筆沖帳單資料！");

    let items = [];
    try { items = JSON.parse(p.itemsJson || '[]'); } catch (e) { items = []; }

    const d = new Date(Number(p.time) || Date.now());
    const createStr = isNaN(d.getTime()) ? getTodayStr() : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const cId = window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(p.client) : '';

    const itemsRowsHtml = items.length > 0 ? items.map((itm, i) => `
        <tr>
            <td style="border:1px solid #000; padding:8px; text-align:center;">${i + 1}</td>
            <td style="border:1px solid #000; padding:8px; font-weight:bold;">${escapeQuotes(itm.paperNo || '--')}</td>
            <td style="border:1px solid #000; padding:8px;">${escapeQuotes(itm.orderNo || '--')}</td>
            <td style="border:1px solid #000; padding:8px;">${escapeQuotes(itm.name || '')}</td>
            <td style="border:1px solid #000; padding:8px; text-align:center;">${itm.qty || 1}</td>
            <td style="border:1px solid #000; padding:8px; text-align:right;">$${Number(itm.price || 0).toLocaleString()}</td>
            <td style="border:1px solid #000; padding:8px; text-align:right; font-weight:bold;">$${Number(itm.subtotal || 0).toLocaleString()}</td>
        </tr>
    `).join('') : `
        <tr>
            <td colspan="7" style="border:1px solid #000; padding:12px; text-align:center;">沖銷發票清單：${escapeQuotes(p.paperNos)}</td>
        </tr>
    `;

    const voucherHtml = `
        <div style="padding: 12mm 15mm; max-width: 820px; margin: 0 auto; background: #fff; color: #000; font-family: 'MingLiU', '微軟正黑體', sans-serif;">
            <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 16px;">
                <h3 style="margin: 0; font-weight: 900; letter-spacing: 4px;">長固實業有限公司</h3>
                <h4 style="margin: 8px 0 0 0; font-weight: bold; letter-spacing: 6px;">收款沖帳核銷憑證 (沖帳傳票)</h4>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 14px; line-height: 1.8; margin-bottom: 12px;">
                <div style="width: 58%;">
                    <div><strong>付款客戶：</strong>${cId && cId !== p.client ? `[${escapeQuotes(cId)}] ` : ''}${escapeQuotes(p.client)}</div>
                    <div><strong>收款方式：</strong>${escapeQuotes(p.payMethod)} ｜ <strong>帳款來源：</strong>${escapeQuotes(p.sourceType)}</div>
                    <div><strong>沖銷發票：</strong>${escapeQuotes(p.paperNos)}</div>
                </div>
                <div style="width: 40%; text-align: right;">
                    <div><strong>沖帳單號：</strong><span style="font-size:16px; font-weight:bold;">${escapeQuotes(p.paymentNo)}</span></div>
                    <div><strong>實際收款日：</strong><strong>${escapeQuotes(p.payDate)}</strong></div>
                    <div><strong>製表時間：</strong>${createStr}</div>
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 14px; border: 2px solid #000; margin-bottom: 14px;">
                <thead>
                    <tr style="background-color: #f1f3f5;">
                        <th style="border:1px solid #000; padding:8px; width:45px; text-align:center;">項次</th>
                        <th style="border:1px solid #000; padding:8px; width:115px;">發票號碼</th>
                        <th style="border:1px solid #000; padding:8px; width:105px;">訂單編號</th>
                        <th style="border:1px solid #000; padding:8px;">品名及規格</th>
                        <th style="border:1px solid #000; padding:8px; width:60px; text-align:center;">數量</th>
                        <th style="border:1px solid #000; padding:8px; width:95px; text-align:right;">單價</th>
                        <th style="border:1px solid #000; padding:8px; width:110px; text-align:right;">應收小計</th>
                    </tr>
                </thead>
                <tbody>${itemsRowsHtml}</tbody>
            </table>

            <div style="display: flex; justify-content: space-between; border: 2px solid #000; padding: 12px; background: #f8f9fa; font-size: 15px; margin-bottom: 14px;">
                <div><strong>帳面應收總額：</strong>$${Number(p.receivableTotal || 0).toLocaleString()}</div>
                <div><strong>匯費 / 折讓 / 差額：</strong>$${Number(p.diffAmount || 0).toLocaleString()}</div>
                <div style="font-size: 17px;"><strong>實際收款金額：$${Number(p.receivedAmount || 0).toLocaleString()} 元整</strong></div>
            </div>

            <div style="border: 1px solid #000; padding: 10px; font-size: 14px; min-height: 48px; margin-bottom: 24px;">
                <strong>備註說明：</strong>${escapeQuotes(p.memo || '無')}
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 14px; padding-top: 10px; border-top: 1px dashed #666;">
                <div style="width: 24%;"><strong>核准：</strong></div>
                <div style="width: 24%;"><strong>會計覆核：</strong></div>
                <div style="width: 24%;"><strong>出納收款：</strong></div>
                <div style="width: 24%;"><strong>經辦製表：</strong>${escapeQuotes(p.staff || myName || '')}</div>
            </div>
        </div>
    `;

    bootstrap.Modal.getInstance(document.getElementById('paidReportModal'))?.hide();

    let printEl = document.getElementById('printPaidReportArea');
    if (!printEl) {
        printEl = document.createElement('div');
        printEl.id = 'printPaidReportArea';
        printEl.style.display = 'none';
        document.body.appendChild(printEl);
    }
    printEl.innerHTML = voucherHtml;

    window.applyPrintStyle('A4', 'portrait');
    window.showPrintPreview('printPaidReportArea');
};

// 🖨️ 列印前依勾選的工作表（可單選或多選）產生已沖帳區間報表列印預覽與 PDF
window.printSelectedPaidReportSheets = function() {
    const pS1 = document.getElementById('cbPrintPaid_s1')?.checked;
    const pS2 = document.getElementById('cbPrintPaid_s2')?.checked;
    const pS3 = document.getElementById('cbPrintPaid_s3')?.checked;

    if (!pS1 && !pS2 && !pS3) {
        return alert("請至少勾選一張要列印的工作表（1.收款沖帳總表 / 2.發票品項展開明細 / 3.客戶別收款統計）！");
    }

    const model = window.buildPaidReportDataModel();
    if (model.records.length === 0) {
        return alert("目前所選區間內沒有已完成沖帳的資料可供列印！");
    }

    const selectedBlocks = [];
    const buildHeader = (sheetTitle) => `
        <div style="border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div style="font-size: 18px; font-weight: bold; color: #000;">長固實業有限公司 — 已完成沖帳收款報表 (${sheetTitle})</div>
                <div style="font-size: 12px; color: #444;">
                    ${escapeQuotes(model.dateBasisText)}：${escapeQuotes(model.periodText)} ｜ 
                    區間應收：$${window.formatWbNumber(model.totalReceivable) || '0'} ｜ 
                    區間實收：$${window.formatWbNumber(model.totalReceived) || '0'} ｜ 
                    差額：$${window.formatWbNumber(model.totalDiff) || '0'}
                </div>
            </div>
            <div style="font-size: 12px; color: #333; text-align: right;">
                製表人員：${escapeQuotes(myName || '管理員')} ｜ 列印日期：${getTodayStr()}
            </div>
        </div>
    `;

    if (pS1) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildHeader('工作表1：已沖帳收款總表')}
                ${window.generatePaidSheet1Html(model, true)}
            </div>
        `);
    }
    if (pS2) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildHeader('工作表2：已沖帳發票與品項明細表')}
                ${window.generatePaidSheet2Html(model, true)}
            </div>
        `);
    }
    if (pS3) {
        selectedBlocks.push(`
            <div style="padding: 12px; background: #fff;">
                ${buildHeader('工作表3：客戶別已收款與方式統計表')}
                ${window.generatePaidSheet3Html(model, true)}
            </div>
        `);
    }

    const combinedHtml = selectedBlocks.map((blockHtml, idx) => {
        const isLast = idx === selectedBlocks.length - 1;
        return `<div class="${!isLast ? 'print-sheet-page-break' : ''}" style="margin-bottom: 18px;">${blockHtml}</div>`;
    }).join('');

    bootstrap.Modal.getInstance(document.getElementById('paidReportModal'))?.hide();

    let printEl = document.getElementById('printPaidReportArea');
    if (!printEl) {
        printEl = document.createElement('div');
        printEl.id = 'printPaidReportArea';
        printEl.style.display = 'none';
        document.body.appendChild(printEl);
    }
    printEl.innerHTML = combinedHtml;

    window.applyPrintStyle('A4', 'landscape');
    window.showPrintPreview('printPaidReportArea');
};

// 📥 下載所選時間區間之「已完成沖帳三工作表 Excel (.xlsx)」
window.exportPaidReportExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍候！");
    const model = window.buildPaidReportDataModel();
    if (model.records.length === 0) return alert("目前所選區間內無已沖帳資料可供匯出！");

    const wb = XLSX.utils.book_new();

    // 工作表 1：已沖帳收款總表
    const s1Aoa = [[
        "項次", "沖帳單號", "實際收款日", "建立時間", "客戶代號", "客戶名稱",
        "收款方式", "沖銷發票清單", "帳面應收總額", "實際收款金額", "匯費/折讓/差額",
        "帳款來源", "經辦人員", "備註說明"
    ]];
    model.records.forEach((p, idx) => {
        const d = new Date(Number(p.time) || Date.now());
        const tStr = isNaN(d.getTime()) ? '' : d.toLocaleString();
        const cId = window.getPrimaryCustIdByClientName ? window.getPrimaryCustIdByClientName(p.client) : '';
        s1Aoa.push([
            idx + 1, p.paymentNo, p.payDate, tStr, cId, p.client,
            p.payMethod, p.paperNos, Number(p.receivableTotal) || 0, Number(p.receivedAmount) || 0, Number(p.diffAmount) || 0,
            p.sourceType, p.staff, p.memo || ''
        ]);
    });
    s1Aoa.push([
        "", "總計", `(${model.periodText})`, "", "", `共 ${model.records.length} 單`,
        "", "", model.totalReceivable, model.totalReceived, model.totalDiff,
        "", "", ""
    ]);
    const ws1 = XLSX.utils.aoa_to_sheet(s1Aoa);
    ws1['!cols'] = [
        { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 28 },
        { wch: 14 }, { wch: 26 }, { wch: 15 }, { wch: 15 }, { wch: 14 },
        { wch: 18 }, { wch: 12 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "1_已沖帳收款總表");

    // 工作表 2：已沖帳發票與品項明細表
    const s2Aoa = [[
        "項次", "沖帳單號", "實際收款日", "收款方式", "客戶代號", "客戶名稱",
        "發票號碼", "訂單編號", "產品代號", "品名規格", "數量", "單價", "品項沖銷金額", "經辦人員", "沖帳備註"
    ]];
    let itemTotal = 0;
    model.lineItems.forEach((itm, idx) => {
        itemTotal = Math.round((itemTotal + (Number(itm.subtotal) || 0)) * 100) / 100;
        s2Aoa.push([
            idx + 1, itm.paymentNo, itm.payDate, itm.payMethod, itm.custId, itm.client,
            itm.paperNo, itm.orderNo, itm.productCode, itm.name, itm.qty, itm.price, itm.subtotal, itm.staff, itm.memo
        ]);
    });
    s2Aoa.push(["", "", "", "", "", "", "", "", "", "合計", "", "", itemTotal, "", ""]);
    const ws2 = XLSX.utils.aoa_to_sheet(s2Aoa);
    ws2['!cols'] = [
        { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 26 },
        { wch: 15 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 26 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, "2_已沖帳發票品項明細");

    // 工作表 3：客戶別已收款與收款方式統計表
    const s3Aoa = [[
        "排行", "客戶代號", "客戶名稱", "沖帳單數", "沖銷發票數",
        "帳面應收合計", "實際收款合計", "匯費/折讓差額", "銀行匯款合計", "支票收款合計", "其他方式合計", "收款佔比(%)"
    ]];
    let sumW = 0, sumC = 0, sumO = 0;
    model.clientSummaries.forEach((c, idx) => {
        sumW = Math.round((sumW + c.wireSum) * 100) / 100;
        sumC = Math.round((sumC + c.checkSum) * 100) / 100;
        sumO = Math.round((sumO + c.otherSum) * 100) / 100;
        const pct = model.totalReceived > 0 ? Number(((c.receivedSum / model.totalReceived) * 100).toFixed(2)) : 0;
        s3Aoa.push([
            idx + 1, c.custId, c.client, c.recordCount, c.invoiceSet.size,
            c.receivableSum, c.receivedSum, c.diffSum, c.wireSum, c.checkSum, c.otherSum, pct
        ]);
    });
    s3Aoa.push([
        "", "", "總計", model.records.length, "",
        model.totalReceivable, model.totalReceived, model.totalDiff, sumW, sumC, sumO, 100
    ]);
    const ws3 = XLSX.utils.aoa_to_sheet(s3Aoa);
    ws3['!cols'] = [
        { wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 10 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, ws3, "3_客戶別收款統計表");

    const cleanPeriod = model.periodText.replace(/[\/\s～:]/g, '_');
    XLSX.writeFile(wb, `長固ERP_已完成沖帳區間報表_${cleanPeriod}.xlsx`);
    showToast("📥 已成功下載「已完成沖帳區間三表 Excel (.xlsx)」！");
};
// ============================================================================
// 2. 渲染模組主控與頂部 KPI 更新
// ============================================================================
window.renderPaymentModule = function() {
    window.initPaymentModule();
    window.updatePaymentClientDropdowns();
    window.updatePaymentTopKpis();
    window.renderUndoBannerUI();
    window.refreshUploadedDocReconciliation();
    window.renderPendingReceivables();
    window.renderPaymentHistory();
    window.renderLegacyUnpaidManager();
};

window.updatePaymentClientDropdowns = function() {
    const clients = new Set();
    (globalSalesDetails || []).forEach(s => { if (s.client) clients.add(s.client); });
    (globalPayments || []).forEach(p => { if (p.client) clients.add(p.client); });
    const sorted = Array.from(clients).sort();

    ['payPendingClient', 'payHistClient'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const cur = el.value;
            el.innerHTML = '<option value="">🏢 所有客戶 (全部)</option>' + sorted.map(c => `<option value="${escapeQuotes(c)}">${escapeQuotes(c)}</option>`).join('');
            if (sorted.includes(cur)) el.value = cur;
        }
    });
};

window.updatePaymentTopKpis = function() {
    let erpUnpaidSum = 0, erpUnpaidCnt = 0;
    let legUnpaidSum = 0, legUnpaidCnt = 0;

    (globalSalesDetails || []).forEach(s => {
        if (!window.isValidReceivableItem(s)) return;
        if (s.payStatus === '已沖帳') return;

        const amt = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0)) * 100) / 100;
        if (window.isLegacySalesItem(s)) {
            legUnpaidSum = Math.round((legUnpaidSum + amt) * 100) / 100;
            legUnpaidCnt++;
        } else {
            erpUnpaidSum = Math.round((erpUnpaidSum + amt) * 100) / 100;
            erpUnpaidCnt++;
        }
    });

    let totalPaidSum = 0, totalPaidCnt = 0;
    (globalPayments || []).forEach(p => {
        if (p.status !== '已作廢') {
            totalPaidSum = Math.round((totalPaidSum + (Number(p.receivedAmount) || 0)) * 100) / 100;
            totalPaidCnt++;
        }
    });

    const totalUnpaid = Math.round((erpUnpaidSum + legUnpaidSum) * 100) / 100;
    const totalUnpaidCnt = erpUnpaidCnt + legUnpaidCnt;

    setSafeText('payKpiTotalUnpaid', '$' + totalUnpaid.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
    setSafeText('payKpiTotalUnpaidCount', `共 ${totalUnpaidCnt} 筆未收明細`);
    setSafeText('payKpiErpUnpaid', '$' + erpUnpaidSum.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
    setSafeText('payKpiErpUnpaidCount', `${erpUnpaidCnt} 筆明細`);
    setSafeText('payKpiLegacyUnpaid', '$' + legUnpaidSum.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
    setSafeText('payKpiLegacyUnpaidCount', `${legUnpaidCnt} 筆歷史明細`);
    setSafeText('payKpiTotalPaid', '$' + totalPaidSum.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
    setSafeText('payKpiTotalPaidCount', `共 ${totalPaidCnt} 筆沖帳單`);
};

// ============================================================================
// 2.5 外部付款單/對帳單上傳 (支援 PDF / Excel) ＆ AI 轉 Excel ＆ 三階段快速沖帳
// ============================================================================
window.openGeminiKeyModal = function() {
    const savedKey = localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
    const input = document.getElementById('inputGeminiApiKey');
    if (input) input.value = savedKey;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('geminiKeySettingModal')).show();
};

window.saveGeminiApiKey = function(clearKey) {
    if (clearKey) {
        localStorage.removeItem(GEMINI_API_KEY_STORAGE);
        const input = document.getElementById('inputGeminiApiKey');
        if (input) input.value = '';
        showToast("🗑️ 已清除 Gemini API 金鑰，將使用內建本地 PDF.js 引擎解析");
    } else {
        const val = (document.getElementById('inputGeminiApiKey')?.value || '').trim();
        if (!val) return alert("請輸入有效的 Gemini API Key！");
        localStorage.setItem(GEMINI_API_KEY_STORAGE, val);
        showToast("✅ 已儲存 Gemini AI 金鑰！上傳 PDF 時將自動啟用 AI 深度視覺轉檔");
    }
    bootstrap.Modal.getInstance(document.getElementById('geminiKeySettingModal'))?.hide();
};

// 處理使用者於「1. 待收款與執行沖帳」上傳 PDF 或 Excel 付款單
window.handlePaymentStatementUpload = async function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();

    try {
        let extractedRows = [];
        let fileType = 'EXCEL';

        if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
            fileType = 'PDF';
            extractedRows = await window.parsePaymentPdfStatement(file);
        } else {
            if (typeof XLSX === 'undefined') {
                alert("Excel 解析引擎載入中，請稍候一秒再試！");
                return;
            }
            showLoading("📂 正在解析上傳之 Excel 對帳單...");
            const arrayBuf = await file.arrayBuffer();
            const wb = XLSX.read(new Uint8Array(arrayBuf), { type: 'array', raw: true });
            const targetSheetName = wb.SheetNames.find(n => n.includes('付款') || n.includes('對帳') || n.includes('沖帳')) || wb.SheetNames[0];
            const ws = wb.Sheets[targetSheetName];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            extractedRows = window.extractStandardPaymentRowsFromAoa(aoa);
            hideLoading();
        }

        if (!extractedRows || extractedRows.length === 0) {
            hideLoading();
            return alert("⚠️ 無法從該檔案中識別出有效的「發票號碼與金額」資料列！\n若您上傳的是掃描圖檔型 PDF，請點擊「🤖 AI 轉檔設定」填入 Gemini API Key 以啟用 AI 視覺辨識。");
        }

        const now = new Date();
        const tStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        const dr = window.paymentModuleState.docReconcile;
        dr.fileName = fileName;
        dr.fileType = fileType;
        dr.uploadedAt = tStr;
        dr.convertedExcelRows = extractedRows;
        dr.resolvedKeys = {};
        dr.stage3Filter = 'ALL';

        window.saveUploadedPaymentDocWorkspace();
        window.refreshUploadedDocReconciliation();

        const exactCnt = dr.exactMatches.length;
        const pendingCnt = dr.pendingReviews.length;

        if (exactCnt > 0) {
            // 第一階段：自動彈出「⚡ 比對無誤一鍵快速確認沖帳」視窗
            window.openQuickMatchModal();
            showToast(`🎯 解析完成！發現 ${exactCnt} 筆 100% 比對無誤資料，已為您自動彈出快速沖帳視窗！`);
        } else if (pendingCnt > 0) {
            showToast(`⚠️ 解析完成！本單據無 100% 完全相符之未沖帳發票，已為您展開 ${pendingCnt} 筆待確認人工覆核清單！`);
            const zone = document.getElementById('payDocPendingReviewZone');
            if (zone) zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            showToast("ℹ️ 檔案解析完成，但未發現任何可對帳之發票項目。");
        }
    } catch (err) {
        hideLoading();
        console.error("解析上傳付款單失敗:", err);
        alert("解析檔案時發生錯誤：" + (err.message || err));
    } finally {
        input.value = '';
    }
};

// 雙核心解析 PDF 付款單 (優先使用 Gemini AI 視覺解析，自動備援本地 PDF.js 表格重組解析)
window.parsePaymentPdfStatement = async function(file) {
    const geminiKey = (localStorage.getItem(GEMINI_API_KEY_STORAGE) || '').trim();

    if (geminiKey) {
        try {
            showLoading("🤖 正在透過 Gemini AI 將 PDF 智慧解析並轉換為 Excel 格式...");
            const base64Pdf = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const res = String(reader.result || '');
                    resolve(res.includes(',') ? res.split(',')[1] : res);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const promptText = `你是一個專業的台灣醫療器材 ERP 財務對帳 AI 助理。請從這份 PDF 付款通知單/對帳單中，精準擷取每一筆發票或帳款明細。
要求：
1. 僅回傳純 JSON Array 格式，不要有任何 Markdown 語法或額外說明。
2. 每個物件包含以下欄位：
   - "paperNo": 發票號碼 (標準格式如 AB-12345678 或 AB12345678，若有請務必擷取並轉大寫)
   - "date": 單據日期或發票日期或付款日 (轉為 YYYY-MM-DD 格式，若為民國年如 115/05/12 請加 1911 轉為 2026-05-12)
   - "clientName": 客戶/醫院名稱 (若單據上有出現醫院或公司名稱請填入)
   - "custId": 客戶代號 (若有外部代號如 200001 請填入，無則填 "")
   - "paidAmount": 該筆實付/付款/對帳金額 (數字，若單據上有扣除匯費後的實付金額或發票金額請填數字)
   - "receivableAmount": 帳面應收/發票原金額 (數字，若無特別區分則與 paidAmount 相同)
   - "feeOrDiscount": 匯費或折讓扣款金額 (數字，無則填 0)
   - "productOrMemo": 品名規格、訂單編號或備註說明`;

            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } }
                        ]
                    }],
                    generationConfig: { temperature: 0.0 }
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                const jsonMatch = rawText.match(/\[[\s\S]*\]/);
                if (jsonMatch) rawText = jsonMatch[0];
                const parsedArr = JSON.parse(rawText);
                if (Array.isArray(parsedArr) && parsedArr.length > 0) {
                    hideLoading();
                    return parsedArr.map((item, idx) => ({
                        rowNo: idx + 1,
                        paperNo: String(item.paperNo || '').trim().toUpperCase(),
                        normInvNo: window.normalizeInvoiceNo(item.paperNo),
                        date: window.parseExternalDateStr(item.date) || getTodayStr(),
                        clientName: String(item.clientName || '').trim(),
                        custId: String(item.custId || '').trim(),
                        paidAmount: Math.round((parseFloat(String(item.paidAmount).replace(/,/g, '')) || 0) * 100) / 100,
                        receivableAmount: Math.round((parseFloat(String(item.receivableAmount || item.paidAmount).replace(/,/g, '')) || 0) * 100) / 100,
                        feeOrDiscount: Math.round((parseFloat(String(item.feeOrDiscount).replace(/,/g, '')) || 0) * 100) / 100,
                        memo: String(item.productOrMemo || '').trim()
                    })).filter(r => r.normInvNo || r.paidAmount > 0);
                }
            }
        } catch (aiErr) {
            console.warn("Gemini AI 解析 PDF 發生例外，自動切換為本地 PDF.js 引擎解析:", aiErr);
        }
    }

    showLoading("📄 正在解析 PDF 對帳單內容並轉換為 Excel 結構...");
    if (!window.pdfjsLib) {
        await new Promise(r => setTimeout(r, 1200));
    }
    if (!window.pdfjsLib) {
        hideLoading();
        throw new Error("PDF 解析元件尚未載入完成，請稍候 2 秒再試，或點擊「🤖 AI 轉檔設定」設定 Gemini 金鑰！");
    }

    const arrayBuf = await file.arrayBuffer();
    const pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuf) }).promise;
    const allLines = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const rowBuckets = [];
        textContent.items.forEach(item => {
            const str = String(item.str || '').trim();
            if (!str) return;
            const x = item.transform[4];
            const y = item.transform[5];
            let bucket = rowBuckets.find(b => Math.abs(b.y - y) < 4.5);
            if (!bucket) {
                bucket = { y: y, items: [] };
                rowBuckets.push(bucket);
            }
            bucket.items.push({ x: x, text: str });
        });

        rowBuckets.sort((a, b) => b.y - a.y);
        rowBuckets.forEach(b => {
            b.items.sort((x1, x2) => x1.x - x2.x);
            allLines.push(b.items.map(i => i.text));
        });
    }

    hideLoading();
    return window.extractStandardPaymentRowsFromAoa(allLines);
};

// 從二维陣列 (Excel AOA 或 PDF 行陣列) 智慧識別發票號碼、金額、客戶與日期
window.extractStandardPaymentRowsFromAoa = function(aoa) {
    if (!Array.isArray(aoa) || aoa.length === 0) return [];

    for (let r = 0; r < Math.min(12, aoa.length); r++) {
        const rowStr = (aoa[r] || []).map(x => String(x || '').trim()).join(',');
        if (rowStr.includes('訂單代號') && rowStr.includes('客戶代號') && rowStr.includes('發票號碼')) {
            const stdRows = window.parseUnpaidExcelRows(aoa);
            return stdRows.map((sr, i) => ({
                rowNo: i + 1,
                paperNo: sr.paperNo,
                normInvNo: window.normalizeInvoiceNo(sr.paperNo),
                date: sr.extPayDate ? window.parseExternalDateStr(sr.extPayDate) : sr.date,
                clientName: sr.clientName,
                custId: sr.custId,
                paidAmount: sr.total,
                receivableAmount: sr.total,
                feeOrDiscount: 0,
                memo: `${sr.productName ? sr.productName + ' ' : ''}${sr.orderNo ? '[單號:' + sr.orderNo + '] ' : ''}${sr.auditNote || ''}`.trim()
            })).filter(x => x.normInvNo);
        }
    }

    let headerIdx = -1;
    let colMap = { inv: -1, paidAmt: -1, recAmt: -1, fee: -1, date: -1, client: -1, custId: -1, memo: -1 };

    for (let r = 0; r < Math.min(15, aoa.length); r++) {
        const row = aoa[r] || [];
        let foundInvCol = -1;
        let foundAmtCol = -1;

        row.forEach((cell, cIdx) => {
            const txt = String(cell || '').trim();
            if (/發票號碼|發票字軌|憑證號碼|發票編號|INVOICE/i.test(txt)) foundInvCol = cIdx;
            if (/實收|實付|付款金額|匯款金額|沖帳金額|應付金額|發票金額|總價|總計|小計|含稅金額|AMOUNT|TOTAL/i.test(txt)) {
                if (foundAmtCol === -1) foundAmtCol = cIdx;
            }
        });

        if (foundInvCol !== -1) {
            headerIdx = r;
            row.forEach((cell, cIdx) => {
                const txt = String(cell || '').trim();
                if (colMap.inv === -1 && /發票號碼|發票字軌|憑證號碼|發票編號|INVOICE/i.test(txt)) colMap.inv = cIdx;
                else if (colMap.paidAmt === -1 && /實收|實付|付款金額|匯款金額|沖帳金額|淨額/i.test(txt)) colMap.paidAmt = cIdx;
                else if (colMap.recAmt === -1 && /應收|應付|帳面|發票金額|總價|總計|小計|含稅|金額/i.test(txt)) colMap.recAmt = cIdx;
                else if (colMap.fee === -1 && /匯費|手續費|折讓|差額|扣款/i.test(txt)) colMap.fee = cIdx;
                else if (colMap.date === -1 && /收款日|付款日|沖帳日|匯款日|發票日|開立日|出貨日|日期/i.test(txt)) colMap.date = cIdx;
                else if (colMap.client === -1 && /客戶名稱|醫院名稱|買受人|廠商名稱|客戶|對象/i.test(txt)) colMap.client = cIdx;
                else if (colMap.custId === -1 && /客戶代號|CUSTID|客戶編號/i.test(txt)) colMap.custId = cIdx;
                else if (colMap.memo === -1 && /備註|說明|品名|摘要|單號/i.test(txt)) colMap.memo = cIdx;
            });
            if (colMap.paidAmt === -1 && colMap.recAmt !== -1) colMap.paidAmt = colMap.recAmt;
            break;
        }
    }

    const extracted = [];
    const invRegex = /\b([A-Z]{2}[\s\-]?\d{8}|OLD[\-\_][A-Za-z0-9\-]+)\b/i;

    const startRow = headerIdx >= 0 ? headerIdx + 1 : 0;
    let detectedGlobalClient = '';

    for (let r = 0; r < Math.min(10, aoa.length); r++) {
        const lineText = (aoa[r] || []).join(' ');
        const matchedClient = (globalClients || []).find(c => c.name && lineText.includes(c.name));
        if (matchedClient) {
            detectedGlobalClient = matchedClient.name;
            break;
        }
    }

    for (let r = startRow; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const fullRowText = row.map(c => String(c || '').trim()).filter(Boolean).join(' ');
        if (!fullRowText || (/合計|總計|小計|頁次|製表/.test(fullRowText) && !invRegex.test(fullRowText))) continue;

        let paperNo = '';
        if (colMap.inv >= 0 && row[colMap.inv] !== undefined) {
            const cellStr = String(row[colMap.inv] || '').trim().toUpperCase();
            const m = cellStr.match(invRegex);
            paperNo = m ? m[1] : cellStr;
        }
        if (!paperNo || !invRegex.test(paperNo)) {
            const m = fullRowText.match(invRegex);
            if (m) paperNo = m[1].toUpperCase();
        }
        if (!paperNo) continue;

        const normInv = window.normalizeInvoiceNo(paperNo);
        if (normInv.length < 5) continue;

        let paidAmt = 0;
        let recAmt = 0;
        let feeAmt = 0;

        const parseNum = (v) => {
            if (typeof v === 'number') return v;
            const clean = String(v || '').replace(/[$,\s元NT]/gi, '');
            const n = parseFloat(clean);
            return isNaN(n) ? NaN : n;
        };

        if (colMap.paidAmt >= 0 && !isNaN(parseNum(row[colMap.paidAmt]))) {
            paidAmt = parseNum(row[colMap.paidAmt]);
        }
        if (colMap.recAmt >= 0 && !isNaN(parseNum(row[colMap.recAmt]))) {
            recAmt = parseNum(row[colMap.recAmt]);
        }
        if (colMap.fee >= 0 && !isNaN(parseNum(row[colMap.fee]))) {
            feeAmt = parseNum(row[colMap.fee]);
        }

        if (paidAmt === 0 && recAmt === 0) {
            const nums = [];
            row.forEach(cell => {
                const s = String(cell || '').trim();
                if (!s || invRegex.test(s)) return;
                if (/^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(s) || /^\d{2,3}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(s)) return;
                const n = parseNum(s);
                if (!isNaN(n) && n > 0 && n < 100000000) {
                    nums.push(n);
                }
            });
            if (nums.length > 0) {
                paidAmt = nums[nums.length - 1];
                recAmt = nums[0];
            }
        }

        if (paidAmt === 0 && recAmt > 0) paidAmt = recAmt - feeAmt;
        if (recAmt === 0 && paidAmt > 0) recAmt = paidAmt + feeAmt;

        let dateStr = '';
        if (colMap.date >= 0 && row[colMap.date]) {
            dateStr = window.parseExternalDateStr(row[colMap.date]);
        }
        if (!dateStr) {
            for (const cell of row) {
                const dCandidate = window.parseExternalDateStr(cell);
                if (/^\d{4}-\d{2}-\d{2}$/.test(dCandidate)) {
                    dateStr = dCandidate;
                    break;
                }
            }
        }

        let custId = colMap.custId >= 0 ? String(row[colMap.custId] || '').trim() : '';
        let clientName = colMap.client >= 0 ? String(row[colMap.client] || '').trim() : '';
        if (!clientName && custId && window.getErpClientNameByCustId) {
            clientName = window.getErpClientNameByCustId(custId);
        }
        if (!clientName && detectedGlobalClient) {
            clientName = detectedGlobalClient;
        }

        let memoStr = colMap.memo >= 0 ? String(row[colMap.memo] || '').trim() : '';

        extracted.push({
            rowNo: r + 1,
            paperNo: paperNo,
            normInvNo: normInv,
            date: dateStr || getTodayStr(),
            clientName: clientName,
            custId: custId,
            paidAmount: Math.round(paidAmt * 100) / 100,
            receivableAmount: Math.round(recAmt * 100) / 100,
            feeOrDiscount: Math.round(feeAmt * 100) / 100,
            memo: memoStr
        });
    }

    return extracted;
};

// 下載由 PDF / AI 轉換後的標準 Excel 對帳單檔案
window.downloadConvertedPaymentExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍候！");
    const dr = window.paymentModuleState.docReconcile;
    const rowsData = dr.convertedExcelRows || [];
    if (rowsData.length === 0) return alert("目前無已解析的單據資料可供下載！");

    const aoa = [[
        "項次", "發票號碼", "單據/收款日期", "客戶名稱", "外部客戶代號",
        "帳面應收金額", "單據實收/實付金額", "匯費/折讓差額", "品名或備註說明"
    ]];

    rowsData.forEach((r, idx) => {
        const diff = Math.round(((r.receivableAmount || r.paidAmount) - r.paidAmount) * 100) / 100;
        aoa.push([
            idx + 1,
            r.paperNo,
            r.date,
            r.clientName || '',
            r.custId || '',
            r.receivableAmount || r.paidAmount,
            r.paidAmount,
            r.feeOrDiscount || diff,
            r.memo || ''
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 28 }, { wch: 14 },
        { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 36 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "AI轉換對帳明細表");

    const baseName = (dr.fileName || '對帳單').replace(/\.[^/.]+$/, '');
    XLSX.writeFile(wb, `${baseName}_AI轉Excel_${getTodayStr()}.xlsx`);
    showToast("📥 已成功下載轉換後之 Excel 檔案！");
};

// 儲存與載入上傳單據狀態
window.saveUploadedPaymentDocWorkspace = function() {
    try {
        const dr = window.paymentModuleState.docReconcile;
        localStorage.setItem(PAYMENT_DOC_UPLOAD_STORAGE_KEY, JSON.stringify({
            fileName: dr.fileName,
            fileType: dr.fileType,
            uploadedAt: dr.uploadedAt,
            convertedExcelRows: dr.convertedExcelRows,
            resolvedKeys: dr.resolvedKeys || {},
            stage3Filter: dr.stage3Filter || 'ALL'
        }));
    } catch (e) {
        console.warn("儲存上傳付款單暫存失敗:", e);
    }
};

window.loadUploadedPaymentDocWorkspace = function() {
    try {
        const raw = localStorage.getItem(PAYMENT_DOC_UPLOAD_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.convertedExcelRows) || parsed.convertedExcelRows.length === 0) return false;

        const dr = window.paymentModuleState.docReconcile;
        dr.fileName = parsed.fileName || '';
        dr.fileType = parsed.fileType || 'EXCEL';
        dr.uploadedAt = parsed.uploadedAt || '';
        dr.convertedExcelRows = parsed.convertedExcelRows;
        dr.resolvedKeys = parsed.resolvedKeys || {};
        dr.stage3Filter = parsed.stage3Filter || 'ALL';
        return true;
    } catch (e) {
        return false;
    }
};

window.clearUploadedPaymentDoc = function() {
    if (!confirm("確定要清除目前載入的對帳單資料嗎？（已寫入資料庫的沖帳紀錄不會受影響）")) return;
    localStorage.removeItem(PAYMENT_DOC_UPLOAD_STORAGE_KEY);
    window.paymentModuleState.docReconcile = {
        fileName: '',
        fileType: '',
        uploadedAt: '',
        convertedExcelRows: [],
        exactMatches: [],
        pendingReviews: [],
        resolvedKeys: {},
        stage3Filter: 'ALL'
    };
    window.refreshUploadedDocReconciliation();
    showToast("🗑️ 已清除上傳之對帳單暫存資料");
};

// 核心勾稽引擎：將上傳的付款單依發票號碼歸戶，並與本系統 globalSalesDetails 比對分為「第一階段無誤」與「第三階段三類待確認」
window.refreshUploadedDocReconciliation = function() {
    const dr = window.paymentModuleState.docReconcile;
    const rawRows = dr.convertedExcelRows || [];

    const badge = document.getElementById('payDocStatusBadge');
    const btnReopen = document.getElementById('btnReopenQuickMatchModal');
    const btnDlExcel = document.getElementById('btnDownloadConvertedExcel');
    const btnClearDoc = document.getElementById('btnClearUploadedPayDoc');
    const stage3Zone = document.getElementById('payDocPendingReviewZone');

    if (rawRows.length === 0) {
        if (badge) badge.style.display = 'none';
        if (btnReopen) btnReopen.style.display = 'none';
        if (btnDlExcel) btnDlExcel.style.display = 'none';
        if (btnClearDoc) btnClearDoc.style.display = 'none';
        if (stage3Zone) stage3Zone.style.display = 'none';
        return;
    }

    const docGroups = new Map();
    rawRows.forEach(r => {
        const key = r.normInvNo || window.normalizeInvoiceNo(r.paperNo);
        if (!key) return;
        if (!docGroups.has(key)) {
            docGroups.set(key, {
                docKey: key,
                displayPaperNo: r.paperNo,
                date: r.date || getTodayStr(),
                clientName: r.clientName || '',
                custId: r.custId || '',
                docPaidTotal: 0,
                docRecTotal: 0,
                memos: [],
                rawItems: []
            });
        }
        const g = docGroups.get(key);
        g.docPaidTotal = Math.round((g.docPaidTotal + (Number(r.paidAmount) || 0)) * 100) / 100;
        g.docRecTotal = Math.round((g.docRecTotal + (Number(r.receivableAmount || r.paidAmount) || 0)) * 100) / 100;
        if (r.memo && !g.memos.includes(r.memo)) g.memos.push(r.memo);
        if (!g.clientName && r.clientName) g.clientName = r.clientName;
        if (!g.custId && r.custId) g.custId = r.custId;
        g.rawItems.push(r);
    });

    const erpGroups = new Map();
    (globalSalesDetails || []).forEach(s => {
        if (!window.isValidReceivableItem(s)) return;
        const normKey = window.normalizeInvoiceNo(s.paperNo);
        if (!normKey) return;
        if (!erpGroups.has(normKey)) {
            erpGroups.set(normKey, []);
        }
        erpGroups.get(normKey).push(s);
    });

    const exactMatches = [];
    const pendingReviews = [];
    const resolvedMap = dr.resolvedKeys || {};

    docGroups.forEach((docG, normKey) => {
        if (resolvedMap[normKey]) return;

        const eList = erpGroups.get(normKey) || [];
        if (eList.length === 0) {
            const resolvedClient = docG.clientName || (docG.custId && window.getErpClientNameByCustId ? window.getErpClientNameByCustId(docG.custId) : '') || '未知客戶';
            pendingReviews.push({
                docKey: normKey,
                type: 'NOT_FOUND',
                paperNo: docG.displayPaperNo,
                date: docG.date,
                client: resolvedClient,
                custId: docG.custId,
                erpReceivable: 0,
                docPaidAmount: docG.docPaidTotal,
                diffAmount: 0,
                memo: docG.memos.join(' | ') || '外部對帳單品項',
                erpRowIndices: []
            });
            return;
        }

        const unpaidErpItems = eList.filter(e => e.payStatus !== '已沖帳');
        const eFirst = eList[0];
        const invDateStr = eFirst.time ? new Date(eFirst.time).toISOString().slice(0, 10) : docG.date;

        if (unpaidErpItems.length === 0) {
            const origPayNos = [...new Set(eList.map(e => e.paymentNo).filter(Boolean))].join(', ') || '歷史已沖帳';
            const origPayDates = [...new Set(eList.map(e => e.payDate).filter(Boolean))].join(', ') || '--';
            const paidSum = Math.round(eList.reduce((sum, e) => sum + (Number(e.subtotal) || ((Number(e.qty)||0)*(Number(e.price)||0))), 0));

            pendingReviews.push({
                docKey: normKey,
                type: 'ALREADY_PAID',
                paperNo: eFirst.paperNo || docG.displayPaperNo,
                date: invDateStr,
                payDate: docG.date,
                client: eFirst.client || docG.clientName,
                erpReceivable: paidSum,
                docPaidAmount: docG.docPaidTotal,
                origPaymentNo: origPayNos,
                origPayDate: origPayDates,
                memo: docG.memos.join(' | '),
                erpRowIndices: eList.map(e => e.rowIdx)
            });
            return;
        }

        const erpUnpaidTotal = Math.round(unpaidErpItems.reduce((sum, e) => {
            const sub = (Number(e.subtotal) || ((Number(e.qty)||0) * (Number(e.price)||0))) - (Number(e.paidAmount) || 0);
            return sum + sub;
        }, 0));

        const diff = Math.round((erpUnpaidTotal - docG.docPaidTotal) * 100) / 100;
        const itemsSummary = unpaidErpItems.map(e => `${e.name} x${e.qty}`).join('、');

        if (Math.abs(diff) < 1) {
            exactMatches.push({
                docKey: normKey,
                paperNo: eFirst.paperNo || docG.displayPaperNo,
                date: invDateStr,
                payDate: docG.date || getTodayStr(),
                client: eFirst.client,
                itemsSummary: itemsSummary,
                erpReceivable: erpUnpaidTotal,
                docPaidAmount: docG.docPaidTotal,
                erpRowIndices: unpaidErpItems.map(e => e.rowIdx),
                erpItems: unpaidErpItems
            });
        } else {
            pendingReviews.push({
                docKey: normKey,
                type: 'AMOUNT_DIFF',
                paperNo: eFirst.paperNo || docG.displayPaperNo,
                date: invDateStr,
                payDate: docG.date || getTodayStr(),
                client: eFirst.client,
                itemsSummary: itemsSummary,
                erpReceivable: erpUnpaidTotal,
                docPaidAmount: docG.docPaidTotal,
                diffAmount: diff,
                memo: docG.memos.join(' | '),
                erpRowIndices: unpaidErpItems.map(e => e.rowIdx)
            });
        }
    });

    dr.exactMatches = exactMatches;
    dr.pendingReviews = pendingReviews;

    if (badge) {
        badge.innerText = `📄 ${dr.fileName} (${dr.uploadedAt})`;
        badge.style.display = 'inline-block';
    }
    if (btnDlExcel) btnDlExcel.style.display = 'inline-block';
    if (btnClearDoc) btnClearDoc.style.display = 'inline-block';

    if (btnReopen) {
        if (exactMatches.length > 0) {
            btnReopen.style.display = 'inline-block';
            setSafeText('btnReopenQuickMatchCount', `${exactMatches.length} 筆`);
        } else {
            btnReopen.style.display = 'none';
        }
    }

    window.renderQuickMatchModalTable();
    window.renderStage3PendingReviewZone();
};

// ============================================================================
// 2.6 第一階段：「⚡ 比對無誤一鍵快速確認沖帳」彈跳視窗邏輯
// ============================================================================
window.openQuickMatchModal = function() {
    const dr = window.paymentModuleState.docReconcile;
    if (!dr.exactMatches || dr.exactMatches.length === 0) {
        return alert("目前沒有待處理的 100% 比對無誤資料！");
    }

    const defaultDate = dr.exactMatches[0]?.payDate || getTodayStr();
    const dateInput = document.getElementById('qm_payDate');
    if (dateInput) dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : getTodayStr();

    const memoInput = document.getElementById('qm_memo');
    if (memoInput && !memoInput.value) memoInput.value = `對帳單(${dr.fileName})比對無誤快速沖帳`;

    window.renderQuickMatchModalTable();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('quickMatchPaymentModal')).show();
};

window.renderQuickMatchModalTable = function() {
    const tbody = document.getElementById('qmTableBody');
    if (!tbody) return;

    const dr = window.paymentModuleState.docReconcile;
    const list = dr.exactMatches || [];

    const btnModalUndo = document.getElementById('btnQmModalUndo');
    if (btnModalUndo) {
        btnModalUndo.style.display = (window.paymentModuleState.undoStack || []).length > 0 ? 'inline-block' : 'none';
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-success fw-bold py-4">🎉 所有 100% 比對無誤之資料皆已完成沖帳！</td></tr>`;
        setSafeText('qmTotalCount', '0');
        setSafeText('qmTotalAmount', '$0');
        return;
    }

    tbody.innerHTML = list.map((item, idx) => {
        return `
        <tr>
            <td class="text-center">
                <input type="checkbox" class="form-check-input cb-qm-item" value="${escapeQuotes(item.docKey)}" checked onchange="window.updateQuickMatchSelectedSummary()">
            </td>
            <td class="text-center text-muted fw-bold">${idx + 1}</td>
            <td><strong class="text-primary fs-6">${escapeQuotes(item.paperNo)}</strong></td>
            <td>${escapeQuotes(item.date)}</td>
            <td class="fw-bold">${escapeQuotes(item.client)}</td>
            <td class="small text-secondary" style="max-width: 260px;">${escapeQuotes(item.itemsSummary)}</td>
            <td class="text-end fw-bold text-dark">$${item.erpReceivable.toLocaleString()}</td>
            <td class="text-end fw-bold text-success fs-6">$${item.docPaidAmount.toLocaleString()}</td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-outline-success fw-bold w-100" onclick="window.confirmSingleQuickMatchItem('${escapeQuotes(item.docKey)}')">
                    ⚡ 單筆確認
                </button>
            </td>
        </tr>`;
    }).join('');

    window.updateQuickMatchSelectedSummary();
};

window.toggleAllQuickMatchCheckboxes = function(checked) {
    const master = document.getElementById('qmMasterCheckbox');
    if (master) master.checked = checked;
    document.querySelectorAll('.cb-qm-item').forEach(cb => { cb.checked = checked; });
    window.updateQuickMatchSelectedSummary();
};

window.updateQuickMatchSelectedSummary = function() {
    const dr = window.paymentModuleState.docReconcile;
    const checkedKeys = new Set(Array.from(document.querySelectorAll('.cb-qm-item:checked')).map(cb => cb.value));
    let cnt = 0;
    let sum = 0;
    (dr.exactMatches || []).forEach(item => {
        if (checkedKeys.has(item.docKey)) {
            cnt++;
            sum += item.erpReceivable;
        }
    });
    setSafeText('qmTotalCount', cnt);
    setSafeText('qmTotalAmount', '$' + sum.toLocaleString());
    const btn = document.getElementById('btnConfirmBatchQuickMatch');
    if (btn) {
        btn.innerHTML = `⚡ 一鍵確認沖帳勾選無誤資料 (共 ${cnt} 筆 / $${sum.toLocaleString()})`;
        btn.disabled = cnt === 0;
    }
};

window.confirmSingleQuickMatchItem = function(docKey) {
    window.executeQuickMatchItemsByKeys([docKey]);
};

window.confirmBatchQuickMatchPayment = function() {
    const checkedKeys = Array.from(document.querySelectorAll('.cb-qm-item:checked')).map(cb => cb.value);
    if (checkedKeys.length === 0) return alert("請至少勾選一筆要確認沖帳的無誤資料！");
    window.executeQuickMatchItemsByKeys(checkedKeys);
};

window.executeQuickMatchItemsByKeys = function(docKeysArray) {
    const dr = window.paymentModuleState.docReconcile;
    const targetSet = new Set(docKeysArray || []);
    const targetItems = (dr.exactMatches || []).filter(x => targetSet.has(x.docKey));
    if (targetItems.length === 0) return;

    const payDate = document.getElementById('qm_payDate')?.value || getTodayStr();
    const payMethod = document.getElementById('qm_payMethod')?.value || '銀行匯款';
    const memo = (document.getElementById('qm_memo')?.value || '').trim() || `對帳單(${dr.fileName})比對無誤快速沖帳`;

    if (!payDate) return alert("請選擇實際收款日期！");

    const previousSalesStates = [];
    const allSalesUpdates = [];
    const newPaymentRecords = [];

    const byClient = new Map();
    targetItems.forEach(item => {
        const cKey = item.client || '未命名客戶';
        if (!byClient.has(cKey)) byClient.set(cKey, []);
        byClient.get(cKey).push(item);
    });

    const todayCompact = getTodayStr().replace(/-/g, '');
    let baseSeq = (globalPayments || []).filter(p => String(p.paymentNo || '').includes(todayCompact)).length;
    const baseNow = Date.now();
    let idxCounter = 0;

    byClient.forEach((clientMatchItems, clientName) => {
        baseSeq++;
        idxCounter++;
        const seqStr = String(baseSeq).padStart(3, '0');
        const paymentNo = `PAY-${todayCompact}-${seqStr}`;
        const paperNosList = clientMatchItems.map(x => x.paperNo).filter(Boolean).join(', ');

        let clientReceivableSum = 0;
        const itemsSnapshot = [];
        let hasLegacy = false;
        let hasErp = false;

        clientMatchItems.forEach(mItem => {
            mItem.erpRowIndices.forEach(rIdx => {
                const s = (globalSalesDetails || []).find(sd => sd.rowIdx === rIdx);
                if (!s) return;

                previousSalesStates.push({
                    rowIdx: s.rowIdx,
                    payStatus: s.payStatus || '未收款',
                    paidAmount: Number(s.paidAmount) || 0,
                    payDate: s.payDate || '',
                    paymentNo: s.paymentNo || ''
                });

                const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))));
                clientReceivableSum += sub;

                if (window.isLegacySalesItem(s)) hasLegacy = true;
                else hasErp = true;

                itemsSnapshot.push({
                    rowIdx: s.rowIdx,
                    paperNo: s.paperNo,
                    orderNo: s.orderNo,
                    name: s.name,
                    qty: s.qty,
                    price: s.price,
                    subtotal: sub
                });

                s.payStatus = '已沖帳';
                s.paidAmount = sub;
                s.payDate = payDate;
                s.paymentNo = paymentNo;

                allSalesUpdates.push({
                    rowIdx: s.rowIdx,
                    payStatus: '已沖帳',
                    paidAmount: sub,
                    payDate: payDate,
                    paymentNo: paymentNo
                });
            });
        });

        const sourceType = (hasLegacy && hasErp) ? '跨期混合沖帳(含5月前)' : (hasLegacy ? '5月前歷史帳款' : 'ERP原生帳款');
        const pRec = {
            rowIdx: baseNow + idxCounter + Math.floor(Math.random() * 1000),
            paymentNo: paymentNo,
            time: baseNow + idxCounter,
            payDate: payDate,
            client: clientName,
            payMethod: payMethod,
            paperNos: paperNosList,
            receivableTotal: clientReceivableSum,
            receivedAmount: clientReceivableSum,
            diffAmount: 0,
            status: '已沖帳結清',
            itemsJson: JSON.stringify(itemsSnapshot),
            sourceType: sourceType,
            staff: myName || '管理員',
            memo: memo
        };

        newPaymentRecords.push(pRec);
        globalPayments.unshift(pRec);
    });

    const totalQuickAmt = newPaymentRecords.reduce((s, r) => s + r.receivedAmount, 0);
    const createdPayNos = newPaymentRecords.map(r => r.paymentNo);

    window.pushPaymentUndoSnapshot({
        actionLabel: `⚡ 快速沖帳 ${targetItems.length} 張比對無誤發票（共 $${totalQuickAmt.toLocaleString()}｜單號：${createdPayNos.join(', ')}）`,
        paymentRowIndices: newPaymentRecords.map(r => r.rowIdx),
        paymentNos: createdPayNos,
        previousSalesStates: previousSalesStates,
        createdSalesRowIndices: [],
        resolvedDocKeys: docKeysArray,
        fromQuickModal: true
    });

    showLoading(`⚡ 正在批次寫入 ${targetItems.length} 張無誤發票之沖帳紀錄...`);

    pushToSyncQueue('batchExecutePaymentReconcile', {
        paymentRecords: newPaymentRecords,
        salesUpdates: allSalesUpdates
    }, () => {
        hideLoading();
        window.saveUploadedPaymentDocWorkspace();
        window.renderPaymentModule();

        const remainingExact = (window.paymentModuleState.docReconcile.exactMatches || []).length;
        const remainingPending = (window.paymentModuleState.docReconcile.pendingReviews || []).length;

        if (remainingExact === 0) {
            const qmModalEl = document.getElementById('quickMatchPaymentModal');
            if (qmModalEl) {
                bootstrap.Modal.getInstance(qmModalEl)?.hide();
            }
            if (remainingPending > 0) {
                showToast(`🎉 ${targetItems.length} 張無誤發票已全數完成沖帳！視窗已自動關閉，請接著覆核下方 ${remainingPending} 筆待確認項目。`);
                setTimeout(() => {
                    const zone = document.getElementById('payDocPendingReviewZone');
                    if (zone) zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 350);
            } else {
                showToast(`🎉 恭喜！本份對帳單所有無誤發票（${targetItems.length} 張）已全數沖帳完畢！`);
            }
        } else {
            showToast(`✅ 已確認沖帳 ${targetItems.length} 張發票！視窗內尚有 ${remainingExact} 張無誤發票待確認。`);
        }
    });
};

// ============================================================================
// 2.7 第二階段：防呆「⏪ 撤銷返回上一步」快照與還原引擎
// ============================================================================
window.pushPaymentUndoSnapshot = function(snapshotObj) {
    const now = new Date();
    const tStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    snapshotObj.timeStr = tStr;

    if (!Array.isArray(window.paymentModuleState.undoStack)) {
        window.paymentModuleState.undoStack = [];
    }
    window.paymentModuleState.undoStack.push(snapshotObj);
    if (window.paymentModuleState.undoStack.length > 10) {
        window.paymentModuleState.undoStack.shift();
    }
    try {
        sessionStorage.setItem(PAYMENT_UNDO_STORAGE_KEY, JSON.stringify(window.paymentModuleState.undoStack));
    } catch (e) {}
    window.renderUndoBannerUI();
};

window.loadPaymentUndoStack = function() {
    try {
        const raw = sessionStorage.getItem(PAYMENT_UNDO_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) window.paymentModuleState.undoStack = parsed;
        }
    } catch (e) {}
};

window.renderUndoBannerUI = function() {
    const banner = document.getElementById('payUndoBanner');
    const stack = window.paymentModuleState.undoStack || [];
    const btnModalUndo = document.getElementById('btnQmModalUndo');

    if (btnModalUndo) {
        btnModalUndo.style.display = stack.length > 0 ? 'inline-block' : 'none';
    }

    if (!banner) return;
    if (stack.length === 0) {
        banner.style.display = 'none';
        return;
    }

    const lastSnap = stack[stack.length - 1];
    banner.style.display = 'block';
    setSafeText('payUndoBannerTitle', `✅ 最新完成 (${lastSnap.timeStr || '剛剛'})：${lastSnap.actionLabel}`);
    setSafeText('payUndoStackCount', stack.length);
};

window.undoLastPaymentAction = function(keepModalOpen = false) {
    const stack = window.paymentModuleState.undoStack || [];
    if (stack.length === 0) return alert("目前沒有可撤銷的上一步沖帳操作！");

    const lastSnap = stack[stack.length - 1];
    if (!confirm(`⏪ 確定要撤銷上一步操作嗎？\n\n【即將還原】：${lastSnap.actionLabel}\n\n系統將自動從雲端資料庫移除該筆沖帳單，並將所有關聯發票恢復為沖帳前狀態！`)) {
        return;
    }

    showLoading("⏪ 正在撤銷沖帳並將資料庫與發票恢復至上一步狀態...");

    const delRowSet = new Set(lastSnap.paymentRowIndices || []);
    const delNoSet = new Set(lastSnap.paymentNos || []);
    globalPayments = (globalPayments || []).filter(p => !delRowSet.has(p.rowIdx) && !delNoSet.has(p.paymentNo));

    if (lastSnap.createdSalesRowIndices && lastSnap.createdSalesRowIndices.length > 0) {
        const createdSet = new Set(lastSnap.createdSalesRowIndices);
        globalSalesDetails = (globalSalesDetails || []).filter(s => !createdSet.has(s.rowIdx));
    }

    (lastSnap.previousSalesStates || []).forEach(prev => {
        const s = (globalSalesDetails || []).find(sd => sd.rowIdx === prev.rowIdx);
        if (s) {
            s.payStatus = prev.payStatus || '未收款';
            s.paidAmount = Number(prev.paidAmount) || 0;
            s.payDate = prev.payDate || '';
            s.paymentNo = prev.paymentNo || '';
        }
    });

    const dr = window.paymentModuleState.docReconcile;
    if (dr && dr.resolvedKeys && Array.isArray(lastSnap.resolvedDocKeys)) {
        lastSnap.resolvedDocKeys.forEach(k => {
            delete dr.resolvedKeys[k];
        });
    }

    stack.pop();
    try {
        sessionStorage.setItem(PAYMENT_UNDO_STORAGE_KEY, JSON.stringify(stack));
    } catch (e) {}

    pushToSyncQueue('undoPaymentReconcile', {
        paymentRowIndices: lastSnap.paymentRowIndices || [],
        paymentNos: lastSnap.paymentNos || [],
        previousSalesStates: lastSnap.previousSalesStates || [],
        createdSalesRowIndices: lastSnap.createdSalesRowIndices || []
    }, () => {
        hideLoading();
        window.saveUploadedPaymentDocWorkspace();
        window.renderPaymentModule();
        showToast("⏪ 已成功撤銷上一步操作！所有發票與帳款已完整還原為未沖帳狀態。");

        if (lastSnap.fromQuickModal && !keepModalOpen && (dr.exactMatches || []).length > 0) {
            window.openQuickMatchModal();
        }
    });
};

// ============================================================================
// 2.8 第三階段：「⚠️ 付款單據待確認 / 金額相異人工覆核區」渲染與操作邏輯
// ============================================================================
window.setStage3Filter = function(filterType) {
    window.paymentModuleState.docReconcile.stage3Filter = filterType;
    window.saveUploadedPaymentDocWorkspace();
    window.renderStage3PendingReviewZone();
};

window.renderStage3PendingReviewZone = function() {
    const zone = document.getElementById('payDocPendingReviewZone');
    const listContainer = document.getElementById('payDocPendingReviewList');
    if (!zone || !listContainer) return;

    const dr = window.paymentModuleState.docReconcile;
    const allPending = dr.pendingReviews || [];

    if (!dr.convertedExcelRows || dr.convertedExcelRows.length === 0 || allPending.length === 0) {
        zone.style.display = 'none';
        return;
    }

    zone.style.display = 'block';

    const cntDiff = allPending.filter(x => x.type === 'AMOUNT_DIFF').length;
    const cntPaid = allPending.filter(x => x.type === 'ALREADY_PAID').length;
    const cntNotFound = allPending.filter(x => x.type === 'NOT_FOUND').length;

    setSafeText('stage3TotalPendingBadge', `${allPending.length} 筆待處理`);
    setSafeText('s3Cnt_ALL', allPending.length);
    setSafeText('s3Cnt_AMOUNT_DIFF', cntDiff);
    setSafeText('s3Cnt_ALREADY_PAID', cntPaid);
    setSafeText('s3Cnt_NOT_FOUND', cntNotFound);

    const btnBatchDismiss = document.getElementById('btnBatchDismissAlreadyPaid');
    if (btnBatchDismiss) {
        btnBatchDismiss.style.display = cntPaid > 0 ? 'inline-block' : 'none';
    }

    const curFilter = dr.stage3Filter || 'ALL';
    ['ALL', 'AMOUNT_DIFF', 'ALREADY_PAID', 'NOT_FOUND'].forEach(f => {
        const btn = document.getElementById(`s3Filter_${f}`);
        if (btn) btn.classList.toggle('active', curFilter === f);
    });

    const filtered = curFilter === 'ALL' ? allPending : allPending.filter(x => x.type === curFilter);

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="text-center text-muted py-3">🎉 此分類下沒有待確認項目</div>`;
        return;
    }

    listContainer.innerHTML = filtered.map(item => {
        if (item.type === 'AMOUNT_DIFF') {
            const diffSign = item.diffAmount > 0 ? `扣匯費/折讓差額：$${item.diffAmount.toLocaleString()}` : `溢收差額：$${Math.abs(item.diffAmount).toLocaleString()}`;
            return `
            <div class="p-3 mb-2 rounded border border-warning bg-white shadow-sm" style="border-left: 5px solid #ffc107 !important;">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="badge bg-warning text-dark">🟡 發票吻合・金額有差額</span>
                            <strong class="fs-6 text-primary">${escapeQuotes(item.paperNo)}</strong>
                            <strong class="text-dark">${escapeQuotes(item.client)}</strong>
                            <span class="small text-muted">(開立日: ${escapeQuotes(item.date)})</span>
                        </div>
                        <div class="mt-2 d-flex flex-wrap align-items-center gap-2">
                            <span class="px-2 py-1 rounded bg-light border fw-bold text-dark">
                                本系統應收：<span class="text-primary fs-6">$${item.erpReceivable.toLocaleString()}</span>
                            </span>
                            <span class="fw-bold text-warning">⚡</span>
                            <span class="px-2 py-1 rounded bg-success bg-opacity-10 border border-success fw-bold text-dark">
                                付款單實付：<span class="text-success fs-6">$${item.docPaidAmount.toLocaleString()}</span>
                            </span>
                            <span class="badge bg-danger fs-6">自動計算${diffSign}</span>
                        </div>
                        <div class="small text-secondary mt-1">📦 明細：${escapeQuotes(item.itemsSummary || item.memo || '--')}</div>
                    </div>
                    <div class="d-flex flex-column gap-1" style="min-width: 220px;">
                        <button type="button" class="btn btn-warning fw-bold shadow-sm text-dark" onclick="window.openStage3DiffPaymentModal('${escapeQuotes(item.docKey)}')">
                            💰 帶入實收與差額執行沖帳
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.dismissUploadedDocItem('${escapeQuotes(item.docKey)}')">
                            略過此筆
                        </button>
                    </div>
                </div>
            </div>`;
        } else if (item.type === 'ALREADY_PAID') {
            return `
            <div class="p-3 mb-2 rounded border bg-white shadow-sm" style="border-left: 5px solid #0d6efd !important;">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="badge bg-primary">🔵 本系統先前已沖帳 (重複出現)</span>
                            <strong class="fs-6 text-primary">${escapeQuotes(item.paperNo)}</strong>
                            <strong class="text-dark">${escapeQuotes(item.client)}</strong>
                            <span class="small text-muted">(單據金額: $${item.docPaidAmount.toLocaleString()})</span>
                        </div>
                        <div class="small fw-bold text-primary mt-1">
                            📌 原沖帳單號：<code>${escapeQuotes(item.origPaymentNo)}</code> ｜ 原收款日：<strong>${escapeQuotes(item.origPayDate)}</strong>
                        </div>
                    </div>
                    <div style="min-width: 190px;">
                        <button type="button" class="btn btn-outline-primary fw-bold w-100 shadow-sm" onclick="window.dismissUploadedDocItem('${escapeQuotes(item.docKey)}')">
                            ✅ 標記已知悉忽略
                        </button>
                    </div>
                </div>
            </div>`;
        } else {
            return `
            <div class="p-3 mb-2 rounded border bg-white shadow-sm" style="border-left: 5px solid #dc3545 !important;">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="badge bg-danger">🔴 本系統查無對應未收明細</span>
                            <strong class="fs-6 text-danger">${escapeQuotes(item.paperNo)}</strong>
                            <strong class="text-dark">${escapeQuotes(item.client)}</strong>
                            <span class="badge bg-light text-dark border">單據日期: ${escapeQuotes(item.date)}</span>
                        </div>
                        <div class="mt-1 fw-bold text-dark">
                            付款單實付金額：<span class="text-danger fs-6">$${item.docPaidAmount.toLocaleString()}</span>
                            <span class="small text-muted fw-normal ms-2">(可能為尚未匯入之 5月前舊帳，或單據發票號碼誤植)</span>
                        </div>
                        ${item.memo ? `<div class="small text-secondary mt-1">📝 單據備註/品項：${escapeQuotes(item.memo)}</div>` : ''}
                    </div>
                    <div class="d-flex flex-column gap-1" style="min-width: 230px;">
                        <button type="button" class="btn btn-sm btn-danger fw-bold shadow-sm" onclick="window.supplementAndPayFromStage3('${escapeQuotes(item.docKey)}')">
                            ⚡ 一鍵補建歷史應收並直接沖帳
                        </button>
                        <div class="d-flex gap-1">
                            <button type="button" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" onclick="window.searchPendingFromStage3('${escapeQuotes(item.client)}', '${escapeQuotes(item.paperNo)}')">
                                🔍 下方搜尋對照
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-secondary fw-bold" onclick="window.dismissUploadedDocItem('${escapeQuotes(item.docKey)}')">
                                忽略
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        }
    }).join('');
};

window.openStage3DiffPaymentModal = function(docKey) {
    const dr = window.paymentModuleState.docReconcile;
    const item = (dr.pendingReviews || []).find(x => x.docKey === docKey && x.type === 'AMOUNT_DIFF');
    if (!item) return;

    window.paymentModuleState.selectedRowIndices.clear();
    (item.erpRowIndices || []).forEach(id => window.paymentModuleState.selectedRowIndices.add(id));
    window.paymentModuleState.activeStage3Key = docKey;
    window.updateSelectedReceivableSummary();

    window.openExecutePaymentModal({
        customReceivedAmount: item.docPaidAmount,
        customPayDate: /^\d{4}-\d{2}-\d{2}$/.test(item.payDate) ? item.payDate : getTodayStr(),
        customMemo: `對帳單實付 $${item.docPaidAmount.toLocaleString()} (自動計算匯費/折讓差額 $${item.diffAmount.toLocaleString()})`
    });
};

window.dismissUploadedDocItem = function(docKey) {
    const dr = window.paymentModuleState.docReconcile;
    if (!dr.resolvedKeys) dr.resolvedKeys = {};
    dr.resolvedKeys[docKey] = { time: Date.now(), by: myName || '管理員' };
    window.saveUploadedPaymentDocWorkspace();
    window.refreshUploadedDocReconciliation();
    showToast("✅ 已將該筆單據項目標記為已知悉並移出待確認清單");
};

window.batchDismissAlreadyPaidDocItems = function() {
    const dr = window.paymentModuleState.docReconcile;
    const paidItems = (dr.pendingReviews || []).filter(x => x.type === 'ALREADY_PAID');
    if (paidItems.length === 0) return;
    if (!dr.resolvedKeys) dr.resolvedKeys = {};
    paidItems.forEach(item => {
        dr.resolvedKeys[item.docKey] = { time: Date.now(), by: myName || '管理員' };
    });
    window.saveUploadedPaymentDocWorkspace();
    window.refreshUploadedDocReconciliation();
    showToast(`✅ 已批次忽略 ${paidItems.length} 筆本系統先前已沖帳之重複項目！`);
};

window.searchPendingFromStage3 = function(clientName, paperNo) {
    const clientSelect = document.getElementById('payPendingClient');
    const searchInput = document.getElementById('payPendingSearch');

    if (clientSelect && clientName && clientName !== '未知客戶') {
        const hasOption = Array.from(clientSelect.options).some(opt => opt.value === clientName);
        if (hasOption) {
            clientSelect.value = clientName;
            if (searchInput) searchInput.value = '';
        } else if (searchInput) {
            clientSelect.value = '';
            searchInput.value = clientName;
        }
    } else if (searchInput) {
        searchInput.value = paperNo || '';
    }

    window.renderPendingReceivables();
    const filterBox = document.getElementById('payPendingFilterBox');
    if (filterBox) filterBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`🔍 已為您在下方篩選「${clientName !== '未知客戶' ? clientName : paperNo}」之待收款明細供人工對照！`);
};

window.supplementAndPayFromStage3 = function(docKey) {
    const dr = window.paymentModuleState.docReconcile;
    const item = (dr.pendingReviews || []).find(x => x.docKey === docKey && x.type === 'NOT_FOUND');
    if (!item) return;

    let targetClient = item.client && item.client !== '未知客戶' ? item.client : '';
    if (!targetClient) {
        targetClient = prompt(`請確認此張發票【${item.paperNo}】所屬的客戶名稱：`, '') || '';
        targetClient = targetClient.trim();
        if (!targetClient) return;
    }

    const newRowIdx = Date.now() + Math.floor(Math.random() * 1000);
    const ts = new Date('2026-04-30T12:00:00').getTime();
    const newSalesItem = {
        rowIdx: newRowIdx,
        time: ts,
        paperNo: item.paperNo,
        client: targetClient,
        orderNo: '對帳單補建',
        name: item.memo || '歷史應收帳款補登 (對帳單匯入)',
        qty: 1,
        unit: '式',
        price: item.docPaidAmount,
        subtotal: item.docPaidAmount,
        shipStatus: '歷史已結案',
        shippedQty: 1,
        lot: '[5月前歷史應收-對帳單補建]',
        expiry: '',
        payStatus: '未收款',
        paidAmount: 0,
        payDate: '',
        paymentNo: ''
    };

    showLoading(`📥 正在為發票 ${item.paperNo} 補建歷史應收明細...`);
    globalSalesDetails.push(newSalesItem);

    pushToSyncQueue('importHistoricalUnpaid', { items: [newSalesItem] }, () => {
        hideLoading();
        window.paymentModuleState.selectedRowIndices.clear();
        window.paymentModuleState.selectedRowIndices.add(newRowIdx);
        window.paymentModuleState.activeStage3Key = docKey;
        window.paymentModuleState.activeCreatedSalesRowIdx = newRowIdx;

        window.renderPaymentModule();

        window.openExecutePaymentModal({
            customReceivedAmount: item.docPaidAmount,
            customPayDate: /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : getTodayStr(),
            customMemo: `由對帳單一鍵補建歷史應收並直接沖帳`
        });
    });
};

// ============================================================================
// 3. 【頁籤 1】待收款清單與執行沖帳
// ============================================================================
window.setPaymentViewMode = function(mode) {
    window.paymentModuleState.viewMode = mode;
    const btnInv = document.getElementById('btnPayViewInvoice');
    const btnItm = document.getElementById('btnPayViewItem');
    if (btnInv && btnItm) {
        btnInv.classList.toggle('active', mode === 'invoice');
        btnItm.classList.toggle('active', mode === 'item');
    }
    window.renderPendingReceivables();
};

window.getFilteredPendingReceivables = function() {
    const term = (document.getElementById('payPendingSearch')?.value || '').trim().toLowerCase();
    const fClient = document.getElementById('payPendingClient')?.value || '';
    const fPeriod = document.getElementById('payPendingPeriod')?.value || 'ALL';
    const fStart = document.getElementById('payPendingStart')?.value || '';
    const fEnd = document.getElementById('payPendingEnd')?.value || '';

    const sTime = fStart ? new Date(fStart).setHours(0, 0, 0, 0) : null;
    const eTime = fEnd ? new Date(fEnd).setHours(23, 59, 59, 999) : null;

    return (globalSalesDetails || []).filter(s => {
        if (!window.isValidReceivableItem(s)) return false;
        if (s.payStatus === '已沖帳') return false;

        const isLeg = window.isLegacySalesItem(s);
        if (fPeriod === 'ERP' && isLeg) return false;
        if (fPeriod === 'LEGACY' && !isLeg) return false;
        if (fClient && s.client !== fClient) return false;

        if (sTime && s.time < sTime) return false;
        if (eTime && s.time > eTime) return false;

        if (term) {
            const match =
                String(s.paperNo || '').toLowerCase().includes(term) ||
                String(s.client || '').toLowerCase().includes(term) ||
                String(s.orderNo || '').toLowerCase().includes(term) ||
                String(s.name || '').toLowerCase().includes(term) ||
                String(s.lot || '').toLowerCase().includes(term);
            if (!match) return false;
        }
        return true;
    });
};

window.renderPendingReceivables = debounce(function() {
    const container = document.getElementById('payPendingContainer');
    if (!container) return;

    const list = window.getFilteredPendingReceivables();
    window.updateSelectedReceivableSummary();

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-white">🎉 目前無符合條件的待收款明細</div>`;
        return;
    }

    const selSet = window.paymentModuleState.selectedRowIndices;
    const mode = window.paymentModuleState.viewMode || 'invoice';

    if (mode === 'invoice') {
        const groups = new Map();
        list.forEach(s => {
            const key = `${s.paperNo || '無發票號'}__${s.client || ''}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    paperNo: s.paperNo || '(未填發票號)',
                    client: s.client || '',
                    time: s.time,
                    orderNos: new Set(),
                    isLegacy: window.isLegacySalesItem(s),
                    totalAmt: 0,
                    items: []
                });
            }
            const g = groups.get(key);
            if (s.orderNo) g.orderNos.add(s.orderNo);
            const sub = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0)) * 100) / 100;
            g.totalAmt = Math.round((g.totalAmt + sub) * 100) / 100;
            g.items.push({ ...s, remainSub: sub });
        });

        let html = '';
        groups.forEach(g => {
            const d = new Date(g.time);
            const dateStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
            const allChecked = g.items.every(i => selSet.has(i.rowIdx));
            const rowIdsJson = JSON.stringify(g.items.map(i => i.rowIdx));
            const eraBadge = g.isLegacy
                ? `<span class="badge bg-warning text-dark ms-2">🕰️ 5月前歷史應收</span>`
                : `<span class="badge bg-light text-primary border ms-2">📅 ERP應收</span>`;

            const itemsHtml = g.items.map(i => {
                const itemChecked = selSet.has(i.rowIdx) ? 'checked' : '';
                return `
                <div class="d-flex justify-content-between align-items-center py-1 border-bottom" style="font-size:0.86rem;">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-2" ${itemChecked} onchange="window.toggleReceivableItem(${i.rowIdx}, this.checked)">
                        <span>${escapeQuotes(i.name)} <span class="badge bg-light text-dark border ms-1">x${i.qty}</span> <small class="text-muted">(單價: $${Number(i.price).toLocaleString()})</small></span>
                    </div>
                    <strong class="text-dark">$${i.remainSub.toLocaleString()}</strong>
                </div>`;
            }).join('');

            html += `
            <div class="item-row bg-white shadow-sm p-3 mb-2 border-start border-4 ${allChecked ? 'border-success' : (g.isLegacy ? 'border-warning' : 'border-primary')}">
                <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3" style="transform: scale(1.35); cursor:pointer;" ${allChecked ? 'checked' : ''} onchange='window.toggleReceivableInvoiceGroup(${rowIdsJson}, this.checked)'>
                        <div>
                            <div class="fw-bold fs-6 text-dark">${escapeQuotes(g.client)} ${eraBadge}</div>
                            <div class="small text-muted mt-1">
                                發票號碼：<strong class="text-primary">${escapeQuotes(g.paperNo)}</strong> ｜ 開立日：${dateStr} ｜ 單號：${escapeQuotes(Array.from(g.orderNos).join(', ') || '--')}
                            </div>
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="fs-5 fw-bold text-danger">$${g.totalAmt.toLocaleString()}</div>
                        <button class="btn btn-sm btn-outline-success fw-bold mt-1" onclick='window.quickPaySingleGroup(${rowIdsJson})'>⚡ 單張直接沖帳</button>
                    </div>
                </div>
                <div class="ps-4">${itemsHtml}</div>
            </div>`;
        });
        container.innerHTML = html;
    } else {
        const rowsHtml = list.map(s => {
            const d = new Date(s.time);
            const dateStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
            const sub = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0)) * 100) / 100;
            const isChecked = selSet.has(s.rowIdx) ? 'checked' : '';
            const isLeg = window.isLegacySalesItem(s);

            return `
            <tr>
                <td class="text-center"><input type="checkbox" class="form-check-input" style="transform:scale(1.2);" ${isChecked} onchange="window.toggleReceivableItem(${s.rowIdx}, this.checked)"></td>
                <td>${dateStr} ${isLeg ? '<span class="badge bg-warning text-dark">5月前</span>' : ''}</td>
                <td class="fw-bold text-primary">${escapeQuotes(s.paperNo || '--')}</td>
                <td class="fw-bold">${escapeQuotes(s.client)}</td>
                <td>${escapeQuotes(s.orderNo || '--')}</td>
                <td>${escapeQuotes(s.name)}</td>
                <td class="text-center fw-bold">${s.qty}</td>
                <td class="text-end">$${Number(s.price).toLocaleString()}</td>
                <td class="text-end fw-bold text-danger">$${sub.toLocaleString()}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
        <div class="table-responsive border rounded bg-white shadow-sm" style="max-height: 600px; overflow-y: auto;">
            <table class="table table-hover table-bordered align-middle mb-0" style="font-size: 0.88rem;">
                <thead class="table-light position-sticky top-0">
                    <tr>
                        <th class="text-center" style="width:42px;">選取</th>
                        <th>出貨/開立日</th>
                        <th>發票號碼</th>
                        <th>客戶名稱</th>
                        <th>訂單編號</th>
                        <th>品名規格</th>
                        <th class="text-center">數量</th>
                        <th class="text-end">單價</th>
                        <th class="text-end">應收小計</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
    }
}, 150);

window.toggleReceivableItem = function(rowIdx, checked) {
    if (checked) window.paymentModuleState.selectedRowIndices.add(rowIdx);
    else window.paymentModuleState.selectedRowIndices.delete(rowIdx);
    window.updateSelectedReceivableSummary();
    window.renderPendingReceivables();
};

window.toggleReceivableInvoiceGroup = function(rowIdxArr, checked) {
    (rowIdxArr || []).forEach(id => {
        if (checked) window.paymentModuleState.selectedRowIndices.add(id);
        else window.paymentModuleState.selectedRowIndices.delete(id);
    });
    window.updateSelectedReceivableSummary();
    window.renderPendingReceivables();
};

window.toggleSelectAllVisibleReceivables = function(selectAll) {
    const visibleList = window.getFilteredPendingReceivables();
    visibleList.forEach(s => {
        if (selectAll) window.paymentModuleState.selectedRowIndices.add(s.rowIdx);
        else window.paymentModuleState.selectedRowIndices.delete(s.rowIdx);
    });
    window.updateSelectedReceivableSummary();
    window.renderPendingReceivables();
};

window.updateSelectedReceivableSummary = function() {
    const selSet = window.paymentModuleState.selectedRowIndices;
    let count = 0;
    let sum = 0;
    (globalSalesDetails || []).forEach(s => {
        if (selSet.has(s.rowIdx) && window.isValidReceivableItem(s) && s.payStatus !== '已沖帳') {
            count++;
            sum = Math.round((sum + ((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0))) * 100) / 100;
        }
    });
    setSafeText('paySelectedCount', count);
    setSafeText('paySelectedSum', '$' + sum.toLocaleString());
};

window.quickPaySingleGroup = function(rowIdxArr) {
    window.paymentModuleState.selectedRowIndices.clear();
    window.paymentModuleState.activeStage3Key = null;
    window.paymentModuleState.activeCreatedSalesRowIdx = null;
    (rowIdxArr || []).forEach(id => window.paymentModuleState.selectedRowIndices.add(id));
    window.updateSelectedReceivableSummary();
    window.openExecutePaymentModal();
};

window.openExecutePaymentModal = function(presetOptions = null) {
    const selSet = window.paymentModuleState.selectedRowIndices;
    const selectedItems = (globalSalesDetails || []).filter(s => selSet.has(s.rowIdx) && window.isValidReceivableItem(s) && s.payStatus !== '已沖帳');

    if (selectedItems.length === 0) {
        return alert("請先勾選至少一筆要沖帳的待收款發票或品項明細！");
    }

    const clients = [...new Set(selectedItems.map(s => s.client).filter(Boolean))];
    if (clients.length > 1 && !presetOptions) {
        if (!confirm(`⚠️ 您勾選的明細包含 ${clients.length} 間不同客戶（${clients.join('、')}）。\n確定要合併在同一筆沖帳單中嗎？`)) {
            return;
        }
    }

    const todayCompact = getTodayStr().replace(/-/g, '');
    const seq = String((globalPayments || []).filter(p => String(p.paymentNo || '').includes(todayCompact)).length + 1).padStart(3, '0');
    const paymentNo = `PAY-${todayCompact}-${seq}`;

    const paperNos = [...new Set(selectedItems.map(s => s.paperNo).filter(Boolean))].join(', ');
    let receivableTotal = 0;
    const previewHtml = selectedItems.map(s => {
        const sub = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0)) * 100) / 100;
        receivableTotal = Math.round((receivableTotal + sub) * 100) / 100;
        return `<div class="d-flex justify-content-between border-bottom py-1">
            <span><strong>[${escapeQuotes(s.paperNo || '無單號')}]</strong> ${escapeQuotes(s.name)} x${s.qty}</span>
            <strong class="text-primary">$${sub.toLocaleString()}</strong>
        </div>`;
    }).join('');

    const actReceived = (presetOptions && presetOptions.customReceivedAmount !== undefined)
        ? presetOptions.customReceivedAmount
        : receivableTotal;
    const diffVal = Math.round((receivableTotal - actReceived) * 100) / 100;

    document.getElementById('pe_paymentNo').value = paymentNo;
    document.getElementById('pe_payDate').value = (presetOptions && presetOptions.customPayDate) ? presetOptions.customPayDate : getTodayStr();
    document.getElementById('pe_payMethod').value = '銀行匯款';
    document.getElementById('pe_client').value = clients.join(' / ');
    document.getElementById('pe_paperNos').value = paperNos || '無發票號碼';
    document.getElementById('pe_receivableTotal').value = receivableTotal;
    document.getElementById('pe_receivedAmount').value = actReceived;
    document.getElementById('pe_diffAmount').value = diffVal;
    document.getElementById('pe_memo').value = (presetOptions && presetOptions.customMemo) ? presetOptions.customMemo : '';
    document.getElementById('pe_itemsPreview').innerHTML = previewHtml;

    bootstrap.Modal.getOrCreateInstance(document.getElementById('paymentExecuteModal')).show();
};

window.recalcPaymentDiff = function() {
    const rec = parseFloat(document.getElementById('pe_receivableTotal').value) || 0;
    const act = parseFloat(document.getElementById('pe_receivedAmount').value) || 0;
    document.getElementById('pe_diffAmount').value = Math.round((rec - act) * 100) / 100;
};

window.confirmExecutePayment = function() {
    const btn = event ? event.currentTarget : null;
    const selSet = window.paymentModuleState.selectedRowIndices;
    const selectedItems = (globalSalesDetails || []).filter(s => selSet.has(s.rowIdx) && window.isValidReceivableItem(s) && s.payStatus !== '已沖帳');
    if (selectedItems.length === 0) return;

    const paymentNo = document.getElementById('pe_paymentNo').value.trim();
    const payDate = document.getElementById('pe_payDate').value;
    const payMethod = document.getElementById('pe_payMethod').value;
    const client = document.getElementById('pe_client').value.trim();
    const paperNos = document.getElementById('pe_paperNos').value.trim();
    const receivableTotal = parseFloat(document.getElementById('pe_receivableTotal').value) || 0;
    const receivedAmount = parseFloat(document.getElementById('pe_receivedAmount').value) || 0;
    const diffAmount = Math.round((receivableTotal - receivedAmount) * 100) / 100;
    const memo = document.getElementById('pe_memo').value.trim();

    if (!payDate) return alert("請選擇實際收款日！");
    if (window.lockButton(btn)) return;

    const hasLegacy = selectedItems.some(s => window.isLegacySalesItem(s));
    const hasErp = selectedItems.some(s => !window.isLegacySalesItem(s));
    const sourceType = (hasLegacy && hasErp) ? '跨期混合沖帳(含5月前)' : (hasLegacy ? '5月前歷史帳款' : 'ERP原生帳款');

    const previousSalesStates = [];
    const itemsSnapshot = selectedItems.map(s => {
        previousSalesStates.push({
            rowIdx: s.rowIdx,
            payStatus: s.payStatus || '未收款',
            paidAmount: Number(s.paidAmount) || 0,
            payDate: s.payDate || '',
            paymentNo: s.paymentNo || ''
        });
        const sub = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0)))) * 100) / 100;
        return {
            rowIdx: s.rowIdx,
            paperNo: s.paperNo,
            orderNo: s.orderNo,
            name: s.name,
            qty: s.qty,
            price: s.price,
            subtotal: sub
        };
    });

    const newPayRecord = {
        rowIdx: Date.now() + Math.floor(Math.random() * 1000),
        paymentNo: paymentNo,
        time: Date.now(),
        payDate: payDate,
        client: client,
        payMethod: payMethod,
        paperNos: paperNos,
        receivableTotal: receivableTotal,
        receivedAmount: receivedAmount,
        diffAmount: diffAmount,
        status: '已沖帳結清',
        itemsJson: JSON.stringify(itemsSnapshot),
        sourceType: sourceType,
        staff: myName || '管理員',
        memo: memo
    };

    const salesUpdates = [];
    selectedItems.forEach(s => {
        const sub = Math.round(((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0)))) * 100) / 100;
        s.payStatus = '已沖帳';
        s.paidAmount = sub;
        s.payDate = payDate;
        s.paymentNo = paymentNo;
        salesUpdates.push({
            rowIdx: s.rowIdx,
            payStatus: '已沖帳',
            paidAmount: sub,
            payDate: payDate,
            paymentNo: paymentNo
        });
    });

    globalPayments.unshift(newPayRecord);
    window.paymentModuleState.selectedRowIndices.clear();

    const resolvedDocKeys = [];
    if (window.paymentModuleState.activeStage3Key) {
        const k = window.paymentModuleState.activeStage3Key;
        if (!window.paymentModuleState.docReconcile.resolvedKeys) {
            window.paymentModuleState.docReconcile.resolvedKeys = {};
        }
        window.paymentModuleState.docReconcile.resolvedKeys[k] = { time: Date.now(), by: myName || '管理員' };
        resolvedDocKeys.push(k);
        window.paymentModuleState.activeStage3Key = null;
    }

    const createdSalesArr = [];
    if (window.paymentModuleState.activeCreatedSalesRowIdx) {
        createdSalesArr.push(window.paymentModuleState.activeCreatedSalesRowIdx);
        window.paymentModuleState.activeCreatedSalesRowIdx = null;
    }

    window.pushPaymentUndoSnapshot({
        actionLabel: `💰 沖帳單 ${paymentNo}（${client}｜發票：${paperNos}｜實收 $${receivedAmount.toLocaleString()}）`,
        paymentRowIndices: [newPayRecord.rowIdx],
        paymentNos: [paymentNo],
        previousSalesStates: previousSalesStates,
        createdSalesRowIndices: createdSalesArr,
        resolvedDocKeys: resolvedDocKeys,
        fromQuickModal: false
    });

    pushToSyncQueue('executePaymentReconcile', {
        paymentRecord: newPayRecord,
        salesUpdates: salesUpdates
    }, () => {
        bootstrap.Modal.getInstance(document.getElementById('paymentExecuteModal')).hide();
        window.saveUploadedPaymentDocWorkspace();
        window.renderPaymentModule();
        if (document.getElementById('unpaidWorkbookModal')?.classList.contains('show')) {
            window.renderUnpaidWorkbookModalContent();
        }
        if (document.getElementById('paidReportModal')?.classList.contains('show')) {
            window.renderPaidReportModalContent();
        }
        if (window.paymentModuleState.unpaidReconcile.extRows.length > 0) {
            window.runUnpaidReconciliation(true);
        }
        showToast(`✅ 沖帳成功！單號 ${paymentNo} 已寫入「沖帳記錄表」並連動更新「銷售明細總表」`);
    });
};

// ============================================================================
// 4. 【頁籤 2】沖帳記錄總表查詢、作廢退回重沖、Excel 匯出
// ============================================================================
window.renderPaymentHistory = debounce(function() {
    const container = document.getElementById('payHistoryContainer');
    if (!container) return;

    const term = (document.getElementById('payHistSearch')?.value || '').trim().toLowerCase();
    const fClient = document.getElementById('payHistClient')?.value || '';
    const fStatus = document.getElementById('payHistStatus')?.value || '';

    let arr = globalPayments || [];
    if (fClient) arr = arr.filter(p => p.client.includes(fClient));
    if (fStatus) arr = arr.filter(p => p.status === fStatus);
    if (term) {
        arr = arr.filter(p =>
            String(p.paymentNo || '').toLowerCase().includes(term) ||
            String(p.paperNos || '').toLowerCase().includes(term) ||
            String(p.client || '').toLowerCase().includes(term) ||
            String(p.memo || '').toLowerCase().includes(term) ||
            String(p.itemsJson || '').toLowerCase().includes(term)
        );
    }

    if (arr.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-white">尚無符合條件的沖帳紀錄</div>`;
        return;
    }

    container.innerHTML = arr.map(p => {
        const isVoid = p.status === '已作廢';
        let items = [];
        try { items = JSON.parse(p.itemsJson || '[]'); } catch (e) { items = []; }

        const itemsHtml = items.map(i =>
            `<div class="small text-secondary">▪ [${escapeQuotes(i.paperNo || '--')}] ${escapeQuotes(i.name)} x${i.qty} ($${Number(i.subtotal || 0).toLocaleString()})</div>`
        ).join('');

        const badgeStatus = isVoid
            ? `<span class="badge bg-danger ms-2">已作廢</span>`
            : `<span class="badge bg-success ms-2">${escapeQuotes(p.status)}</span>`;

        const actionBtns = !isVoid
            ? `<button class="btn btn-sm btn-outline-primary fw-bold me-1" onclick="window.printSinglePaymentVoucher(${p.rowIdx})">🖨️ 列印憑證</button>
               <button class="btn btn-sm btn-outline-danger fw-bold" onclick="window.voidPaymentRecord(${p.rowIdx})">↩️ 作廢退回未收</button>`
            : '';

        return `
        <div class="item-row bg-white shadow-sm p-3 mb-2 border-start border-4 ${isVoid ? 'border-secondary opacity-75' : 'border-success'}">
            <div class="d-flex justify-content-between align-items-start border-bottom pb-2 mb-2">
                <div>
                    <div class="fw-bold fs-6 text-dark">
                        ${escapeQuotes(p.client)} ${badgeStatus}
                        <span class="badge bg-light text-dark border ms-1">${escapeQuotes(p.payMethod)}</span>
                        <span class="badge bg-info text-dark ms-1">${escapeQuotes(p.sourceType)}</span>
                    </div>
                    <div class="small text-muted mt-1">
                        沖帳單號：<strong class="text-primary">${escapeQuotes(p.paymentNo)}</strong> ｜ 實際收款日：<strong>${escapeQuotes(p.payDate)}</strong> ｜ 經辦：${escapeQuotes(p.staff)}
                    </div>
                    <div class="small text-secondary mt-1">沖銷發票：${escapeQuotes(p.paperNos)}</div>
                    ${p.memo ? `<div class="small text-danger fw-bold mt-1">📝 備註：${escapeQuotes(p.memo)}</div>` : ''}
                </div>
                <div class="text-end">
                    <div class="small text-muted">應收: $${Number(p.receivableTotal).toLocaleString()} | 差額: $${Number(p.diffAmount).toLocaleString()}</div>
                    <div class="fs-5 fw-bold text-success">實收: $${Number(p.receivedAmount).toLocaleString()}</div>
                    <div class="mt-1">${actionBtns}</div>
                </div>
            </div>
            <div>${itemsHtml}</div>
        </div>`;
    }).join('');
}, 200);

window.voidPaymentRecord = function(rowIdx) {
    const p = (globalPayments || []).find(x => x.rowIdx === rowIdx);
    if (!p) return;
    if (!confirm(`確定要作廢沖帳單【${p.paymentNo}】嗎？\n⚠️ 系統將自動把此單沖銷的所有發票品項退回「未收款」狀態！`)) return;

    p.status = '已作廢';
    let items = [];
    try { items = JSON.parse(p.itemsJson || '[]'); } catch (e) { items = []; }
    const salesRowIndices = items.map(i => i.rowIdx).filter(Boolean);

    (globalSalesDetails || []).forEach(s => {
        if (salesRowIndices.includes(s.rowIdx) || (p.paymentNo && s.paymentNo === p.paymentNo)) {
            s.payStatus = '未收款';
            s.paidAmount = 0;
            s.payDate = '';
            s.paymentNo = '';
        }
    });

    pushToSyncQueue('voidPaymentRecord', {
        rowIdx: rowIdx,
        paymentNo: p.paymentNo,
        salesRowIndices: salesRowIndices
    }, () => {
        window.renderPaymentModule();
        if (document.getElementById('paidReportModal')?.classList.contains('show')) {
            window.renderPaidReportModalContent();
        }
        showToast(`🗑️ 已作廢沖帳單 ${p.paymentNo}，關聯明細已退回「未收款」`);
    });
};

window.exportPaymentRecordsExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中，請稍候！");
    if (!globalPayments || globalPayments.length === 0) return alert("目前無沖帳記錄可匯出！");

    const rows = [[
        "沖帳單號", "建立時間", "實際收款日", "客戶名稱", "收款方式",
        "沖銷發票清單", "應收帳款總額", "實收金額", "匯費/折讓/差額", "沖帳狀態",
        "沖銷明細JSON", "帳款來源", "經辦人員", "備註說明"
    ]];

    globalPayments.forEach(p => {
        const d = new Date(p.time);
        const tStr = isNaN(d.getTime()) ? '' : d.toLocaleString();
        rows.push([
            p.paymentNo, tStr, p.payDate, p.client, p.payMethod,
            p.paperNos, p.receivableTotal, p.receivedAmount, p.diffAmount, p.status,
            p.itemsJson, p.sourceType, p.staff, p.memo
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 30 }, { wch: 14 },
        { wch: 28 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 14 },
        { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "沖帳記錄表");
    XLSX.writeFile(wb, `長固ERP_沖帳記錄表_${getTodayStr()}.xlsx`);
};

// ============================================================================
// 5. 解析外部「未收款明細.xlsx (未付款-OLD)」通用引擎
// ============================================================================
window.parseUnpaidExcelRows = function(aoa) {
    let headerIdx = 0;
    for (let r = 0; r < Math.min(10, aoa.length); r++) {
        const rowStr = (aoa[r] || []).map(x => String(x || '').trim()).join(',');
        if (rowStr.includes('訂單代號') || rowStr.includes('客戶代號') || rowStr.includes('是否付款')) {
            headerIdx = r;
            break;
        }
    }

    const parsed = [];
    for (let r = headerIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;

        const extOrderCode = String(row[0] || '').trim();
        const custId       = String(row[1] || '').trim();
        const rawDate      = row[2];
        const isVoid       = String(row[3] || '').trim().toUpperCase() === 'TRUE';
        const isPaid       = String(row[4] || '').trim().toUpperCase() === 'TRUE';
        const ispn         = String(row[5] || '').trim();
        const qty          = Math.round((parseFloat(row[6]) || 0) * 1000) / 1000;
        const price        = Math.round((parseFloat(row[7]) || 0) * 1000) / 1000;
        const total        = Math.round((parseFloat(row[8]) || 0) * 100) / 100;
        const paperNo      = String(row[9] || '').trim().toUpperCase();
        const noteK        = String(row[10] || '').trim();
        const clientPoL    = String(row[11] || '').trim();
        const extPayDate   = String(row[12] || '').trim();
        const auditNote    = [row[13], row[14], row[15]].map(x => String(x || '').trim()).filter(Boolean).join(' | ');

        if (!extOrderCode && !custId && !ispn && !paperNo) continue;
        if (isVoid) continue;

        const cleanDate = window.parseExternalDateStr ? window.parseExternalDateStr(rawDate) : String(rawDate || '');
        const isPreMay = cleanDate && cleanDate < ERP_START_CUTOFF_DATE;
        const clientName = window.getErpClientNameByCustId ? window.getErpClientNameByCustId(custId) : custId;
        const prodInfo = window.findProductNameByCode ? window.findProductNameByCode(ispn, clientName) : { name: ispn, unit: '式' };

        parsed.push({
            excelRowNo: r + 1,
            extOrderCode: extOrderCode,
            custId: custId,
            clientName: clientName,
            date: cleanDate || String(rawDate || ''),
            isPreMay: !!isPreMay,
            isPaid: isPaid,
            ispn: ispn,
            productName: prodInfo.name || ispn,
            unit: prodInfo.unit || '式',
            qty: qty,
            price: price,
            total: total,
            paperNo: paperNo,
            orderNo: clientPoL || noteK || extOrderCode,
            noteK: noteK,
            clientPoL: clientPoL,
            extPayDate: extPayDate,
            auditNote: auditNote
        });
    }
    return parsed;
};

window.handleUnpaidExcelUpload = function(input, sourceTab) {
    if (!input.files || !input.files[0]) return;
    if (typeof XLSX === 'undefined') return alert("Excel 解析引擎載入中，請稍候再試！");

    const file = input.files[0];
    const fileName = file.name;
    showLoading("📂 正在解析外部系統「未收款明細.xlsx」...");

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array', raw: true });
            const sheetName = wb.SheetNames.find(n => n.includes('未付款')) || wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            const rows = window.parseUnpaidExcelRows(aoa);
            hideLoading();

            if (rows.length === 0) return alert("未解析到有效的未收款明細資料列！");

            window.paymentModuleState.unpaidReconcile.fileName = fileName;
            window.paymentModuleState.unpaidReconcile.extRows = rows;
            window.saveUnpaidReconcileWorkspace();

            window.prepareLegacyStagedItems(rows);
            window.runUnpaidReconciliation(true);

            if (sourceTab === 'LEGACY_TAB') {
                window.renderLegacyUnpaidManager();
                showToast(`✅ 已掃描完成！共發現 ${window.paymentModuleState.legacyStagedItems.length} 筆尚未匯入的「5月前歷史未收帳」`);
            } else {
                window.renderUnpaidReconcileCenter();
                showToast(`✅ 未收款明細比對完成（共載入 ${rows.length} 筆外部未收明細）！`);
            }
        } catch (err) {
            hideLoading();
            console.error("解析未收款明細失敗:", err);
            alert("解析失敗：" + err.message);
        } finally {
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

// ============================================================================
// 6. 【頁籤 3】5月前歷史未收帳管理與一鍵安全匯入
// ============================================================================
window.prepareLegacyStagedItems = function(extRows) {
    const preMayRows = (extRows || []).filter(r => r.isPreMay && !r.isPaid);
    const staged = [];

    preMayRows.forEach((r, idx) => {
        const alreadyInErp = (globalSalesDetails || []).some(s =>
            String(s.paperNo || '').trim().toUpperCase() === r.paperNo &&
            Math.abs((Number(s.qty) || 0) - r.qty) < 0.001 &&
            Math.abs((Number(s.subtotal) || 0) - r.total) < 1 &&
            (s.name === r.productName || String(s.lot || '').includes(r.extOrderCode))
        );

        if (!alreadyInErp) {
            staged.push({
                ...r,
                tempId: `LEG_${Date.now()}_${idx}`
            });
        }
    });

    window.paymentModuleState.legacyStagedItems = staged;
};

window.renderLegacyUnpaidManager = function() {
    const stagingBox = document.getElementById('payLegacyStagingBox');
    const existingBox = document.getElementById('payLegacyExistingContainer');
    const btnImport = document.getElementById('btnImportLegacyBatch');
    if (!existingBox) return;

    const staged = window.paymentModuleState.legacyStagedItems || [];
    if (staged.length > 0 && stagingBox) {
        stagingBox.style.display = 'block';
        if (btnImport) btnImport.style.display = 'inline-block';

        const totalStagedAmt = staged.reduce((sum, x) => sum + x.total, 0);
        const rowsHtml = staged.map((x, i) => `
            <tr>
                <td class="text-center"><input type="checkbox" class="form-check-input cb-legacy-import" value="${i}" checked></td>
                <td>${escapeQuotes(x.date)}</td>
                <td class="fw-bold text-primary">${escapeQuotes(x.paperNo || '--')}</td>
                <td class="fw-bold">${escapeQuotes(x.clientName)} <small class="text-muted">(${escapeQuotes(x.custId)})</small></td>
                <td><code>${escapeQuotes(x.ispn)}</code><br><small>${escapeQuotes(x.productName)}</small></td>
                <td class="text-center">${x.qty}</td>
                <td class="text-end">$${x.price.toLocaleString()}</td>
                <td class="text-end fw-bold text-danger">$${x.total.toLocaleString()}</td>
                <td><small class="text-secondary">單號: ${escapeQuotes(x.orderNo)}<br>${escapeQuotes(x.auditNote)}</small></td>
            </tr>
        `).join('');

        stagingBox.innerHTML = `
        <div class="card border-warning shadow-sm">
            <div class="card-header bg-warning bg-opacity-25 d-flex justify-content-between align-items-center">
                <span class="fw-bold text-dark">🔎 掃描發現 <strong>${staged.length} 筆</strong> 尚未匯入本系統之「2026/05/01 前歷史未收明細」（合計 <strong class="text-danger">$${totalStagedAmt.toLocaleString()}</strong>）</span>
                <button class="btn btn-sm btn-primary fw-bold shadow-sm" onclick="window.confirmImportLegacyUnpaid()">📥 立即匯入勾選項目至待沖帳池</button>
            </div>
            <div class="table-responsive" style="max-height: 360px; overflow-y: auto;">
                <table class="table table-sm table-bordered align-middle mb-0 bg-white" style="font-size:0.85rem;">
                    <thead class="table-light position-sticky top-0">
                        <tr>
                            <th class="text-center" style="width:40px;"><input type="checkbox" class="form-check-input" checked onchange="document.querySelectorAll('.cb-legacy-import').forEach(c=>c.checked=this.checked)"></th>
                            <th>出貨日期</th>
                            <th>發票號碼</th>
                            <th>客戶名稱 (CUSTID)</th>
                            <th>產品代號 / 品名</th>
                            <th class="text-center">數量</th>
                            <th class="text-end">單價</th>
                            <th class="text-end">未收總價</th>
                            <th>訂單編號 / 備註</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>`;
    } else if (stagingBox) {
        stagingBox.style.display = 'none';
        if (btnImport) btnImport.style.display = 'none';
    }

    const existingLegacy = (globalSalesDetails || []).filter(s => window.isValidReceivableItem(s) && window.isLegacySalesItem(s));
    if (existingLegacy.length === 0) {
        existingBox.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-white">目前系統內尚無已匯入的 5月前歷史未收帳款（請點擊上方「📂 上傳未收款明細.xlsx」進行掃描匯入）</div>`;
        return;
    }

    const existRowsHtml = existingLegacy.map(s => {
        const d = new Date(s.time);
        const dtStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const isPaid = s.payStatus === '已沖帳';
        const statusBadge = isPaid
            ? `<span class="badge bg-success">🟢 已沖帳 (${escapeQuotes(s.paymentNo || '')})</span>`
            : `<span class="badge bg-warning text-dark">🟡 待收款沖帳</span>`;

        return `
        <tr>
            <td>${dtStr}</td>
            <td class="fw-bold text-primary">${escapeQuotes(s.paperNo)}</td>
            <td class="fw-bold">${escapeQuotes(s.client)}</td>
            <td>${escapeQuotes(s.orderNo || '--')}</td>
            <td>${escapeQuotes(s.name)}</td>
            <td class="text-center">${s.qty}</td>
            <td class="text-end">$${Number(s.price).toLocaleString()}</td>
            <td class="text-end fw-bold text-danger">$${Number(s.subtotal).toLocaleString()}</td>
            <td class="text-center">${statusBadge}</td>
        </tr>`;
    }).join('');

    existingBox.innerHTML = `
    <div class="table-responsive border rounded bg-white shadow-sm" style="max-height: 480px; overflow-y: auto;">
        <table class="table table-hover table-bordered align-middle mb-0" style="font-size:0.86rem;">
            <thead class="table-light position-sticky top-0">
                <tr>
                    <th>歷史出貨日</th>
                    <th>發票號碼</th>
                    <th>客戶名稱</th>
                    <th>訂單編號</th>
                    <th>品名規格</th>
                    <th class="text-center">數量</th>
                    <th class="text-end">單價</th>
                    <th class="text-end">應收金額</th>
                    <th class="text-center">目前沖帳狀態</th>
                </tr>
            </thead>
            <tbody>${existRowsHtml}</tbody>
        </table>
    </div>`;
};

window.confirmImportLegacyUnpaid = function() {
    const cbs = document.querySelectorAll('.cb-legacy-import:checked');
    const staged = window.paymentModuleState.legacyStagedItems || [];
    if (cbs.length === 0 || staged.length === 0) return alert("請勾選要匯入的 5月前歷史未收項目！");

    const selectedIndices = Array.from(cbs).map(cb => parseInt(cb.value, 10));
    const toImport = selectedIndices.map(i => staged[i]).filter(Boolean);

    if (!confirm(`確定要將這 ${toImport.length} 筆「2026年5月前歷史未收明細」安全匯入本系統待沖帳池嗎？\n(系統將自動標記為「歷史已結案」，不會扣減現有庫存)`)) return;

    showLoading("📥 正在將 5月前歷史未收帳款匯入 Supabase 待沖帳池...");
    const baseNow = Date.now();
    const payloadItems = toImport.map((item, idx) => {
        const ts = new Date(item.date).getTime() || (baseNow - 86400000 * 60);
        const rIdx = baseNow + idx;
        const lotInfo = `[5月前歷史應收] 外部單號:${item.extOrderCode}${item.auditNote ? ' ' + item.auditNote : ''}`.trim();

        const sdObj = {
            rowIdx: rIdx,
            time: ts,
            paperNo: item.paperNo || `OLD-${item.extOrderCode}`,
            client: item.clientName,
            orderNo: item.orderNo,
            name: item.productName,
            qty: item.qty,
            unit: item.unit || '式',
            price: item.price,
            subtotal: item.total,
            shipStatus: '歷史已結案',
            shippedQty: item.qty,
            lot: lotInfo,
            expiry: '',
            payStatus: '未收款',
            paidAmount: 0,
            payDate: '',
            paymentNo: ''
        };
        globalSalesDetails.push(sdObj);
        return sdObj;
    });

    pushToSyncQueue('importHistoricalUnpaid', { items: payloadItems }, () => {
        hideLoading();
        window.prepareLegacyStagedItems(window.paymentModuleState.unpaidReconcile.extRows || []);
        window.runUnpaidReconciliation(true);
        window.renderPaymentModule();
        showToast(`✅ 成功匯入 ${payloadItems.length} 筆 5月前歷史未收帳款！現在可直接在「待收款與執行沖帳」進行沖帳。`);
    });
};

// ============================================================================
// 7. 【頁籤 4】跨系統未收款/沖帳報表智慧勾稽中心
// ============================================================================
window.saveUnpaidReconcileWorkspace = function() {
    try {
        const now = new Date();
        const tStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const ur = window.paymentModuleState.unpaidReconcile;
        ur.uploadedAt = tStr;

        localStorage.setItem(PAYMENT_RECONCILE_STORAGE_KEY, JSON.stringify({
            fileName: ur.fileName,
            uploadedAt: tStr,
            extRows: ur.extRows,
            reviewedMap: ur.reviewedMap || {}
        }));

        const badge = document.getElementById('unpaidRecSaveBadge');
        if (badge) {
            badge.innerText = `💾 進度已自動記憶 (${tStr})`;
            badge.style.display = 'inline-block';
        }
    } catch (e) {
        console.warn("儲存未收比對快取失敗:", e);
    }
};

window.loadUnpaidReconcileWorkspace = function() {
    try {
        const raw = localStorage.getItem(PAYMENT_RECONCILE_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.extRows) || parsed.extRows.length === 0) return false;

        const ur = window.paymentModuleState.unpaidReconcile;
        ur.fileName = parsed.fileName || '未收款明細.xlsx';
        ur.uploadedAt = parsed.uploadedAt || '';
        ur.extRows = parsed.extRows;
        ur.reviewedMap = parsed.reviewedMap || {};

        window.prepareLegacyStagedItems(ur.extRows);
        window.runUnpaidReconciliation(true);
        return true;
    } catch (e) {
        return false;
    }
};

window.clearUnpaidReconcileWorkspace = function() {
    if (!confirm("確定要清除「未收款跨系統比對中心」的暫存檔案與已覆核進度嗎？")) return;
    localStorage.removeItem(PAYMENT_RECONCILE_STORAGE_KEY);
    window.paymentModuleState.unpaidReconcile = {
        fileName: '',
        uploadedAt: '',
        extRows: [],
        results: [],
        reviewedMap: {},
        currentFilter: 'ALL_DIFF',
        searchTerm: ''
    };
    window.paymentModuleState.legacyStagedItems = [];
    window.renderUnpaidReconcileCenter();
    window.renderLegacyUnpaidManager();
    showToast("🗑️ 已清除未收款比對暫存記憶");
};

window.runUnpaidReconciliation = function(silent = false) {
    const ur = window.paymentModuleState.unpaidReconcile;
    const extRows = (ur.extRows || []).filter(r => !r.isPaid);
    if (extRows.length === 0) {
        if (!silent) alert("請先上傳外部系統「未收款明細.xlsx」！");
        return;
    }

    const extByInv = new Map();
    extRows.forEach(r => {
        const key = r.paperNo || `__NOINV_${r.extOrderCode}`;
        if (!extByInv.has(key)) extByInv.set(key, []);
        extByInv.get(key).push(r);
    });

    const validExtDates = extRows.map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const maxExtDate = validExtDates.length > 0 ? validExtDates[validExtDates.length - 1] : '2099-12-31';
    const maxExtTimestamp = new Date(maxExtDate + 'T23:59:59').getTime();

    const erpByInv = new Map();
    (globalSalesDetails || []).forEach(s => {
        if (!window.isValidReceivableItem(s)) return;
        if (s.time > maxExtTimestamp && s.payStatus !== '已沖帳') return;
        const key = String(s.paperNo || '').trim().toUpperCase();
        if (!key || key.startsWith('[借用中]')) return;
        if (!erpByInv.has(key)) erpByInv.set(key, []);
        erpByInv.get(key).push(s);
    });

    const allInvs = Array.from(new Set([...extByInv.keys(), ...erpByInv.keys()])).sort();
    const results = [];

    allInvs.forEach(invNo => {
        const xList = extByInv.get(invNo) || [];
        const eList = erpByInv.get(invNo) || [];

        const xTotal = Math.round(xList.reduce((sum, x) => sum + x.total, 0) * 100) / 100;
        const xQty   = Math.round(xList.reduce((sum, x) => sum + x.qty, 0) * 1000) / 1000;
        const eTotal = Math.round(eList.reduce((sum, e) => sum + (Number(e.subtotal) || ((Number(e.qty)||0)*(Number(e.price)||0))), 0) * 100) / 100;
        const eQty   = Math.round(eList.reduce((sum, e) => sum + (Number(e.qty) || 0), 0) * 1000) / 1000;

        if (xList.length > 0 && eList.length > 0) {
            const xFirst = xList[0];
            const eFirst = eList[0];
            const allErpPaid = eList.every(e => e.payStatus === '已沖帳');
            const someErpPaid = eList.some(e => e.payStatus === '已沖帳');

            if (allErpPaid || someErpPaid) {
                const payNos = [...new Set(eList.map(e => e.paymentNo).filter(Boolean))].join(', ');
                const payDates = [...new Set(eList.map(e => e.payDate).filter(Boolean))].join(', ');
                const item = {
                    recKey: `UR|${invNo}|ERP_PAID`,
                    category: 'ERP_PAID_EXT_UNPAID',
                    invNo: invNo,
                    date: eFirst.time ? new Date(eFirst.time).toISOString().slice(0, 10) : xFirst.date,
                    client: eFirst.client,
                    extCustId: xFirst.custId,
                    erpQty: eQty,
                    extQty: xQty,
                    erpTotal: eTotal,
                    extTotal: xTotal,
                    erpPayStatus: `已沖帳 (${payNos || '無單號'} / ${payDates || ''})`,
                    extPayStatus: '外部仍列未收款',
                    diag: `🔵 本系統已於 ${payDates || '先前'} 完成收款沖帳（單號: ${payNos}），但外部系統「未收款明細」尚未銷帳！請提醒會計於外部系統補沖帳。`,
                    erpRowIndices: eList.map(e => e.rowIdx)
                };
                results.push(item);
            } else {
                const isAmtMatch = Math.abs(eTotal - xTotal) < 1;
                const isQtyMatch = Math.abs(eQty - xQty) < 0.001;
                const item = {
                    recKey: `UR|${invNo}|BOTH_UNPAID`,
                    category: (isAmtMatch && isQtyMatch) ? 'MATCH' : 'VALUE_DIFF',
                    invNo: invNo,
                    date: xFirst.date,
                    client: eFirst.client,
                    extCustId: xFirst.custId,
                    erpQty: eQty,
                    extQty: xQty,
                    erpTotal: eTotal,
                    extTotal: xTotal,
                    erpPayStatus: '未收款',
                    extPayStatus: '未收款',
                    diag: (isAmtMatch && isQtyMatch)
                        ? '🟢 兩邊系統皆為「未收款」且數量、總金額完全一致'
                        : `🟡 兩邊皆未收，但數值不符（本系統: 數量 ${eQty} / 總額 $${eTotal.toLocaleString()} vs 外部: 數量 ${xQty} / 總額 $${xTotal.toLocaleString()}）`,
                    erpRowIndices: eList.map(e => e.rowIdx)
                };
                results.push(item);
            }
        } else if (xList.length > 0 && eList.length === 0) {
            const xFirst = xList[0];
            const isPreMay = xFirst.isPreMay;
            const item = {
                recKey: `UR|${invNo}|ONLY_EXT`,
                category: 'ONLY_EXT_UNPAID',
                invNo: invNo,
                date: xFirst.date,
                client: xFirst.clientName,
                extCustId: xFirst.custId,
                erpQty: null,
                extQty: xQty,
                erpTotal: null,
                extTotal: xTotal,
                erpPayStatus: isPreMay ? '🕰️ 5月前歷史舊帳(未匯入)' : '🔴 本系統無此明細',
                extPayStatus: `未收款 (${xFirst.auditNote || '無備註'})`,
                diag: isPreMay
                    ? `🕰️ 此筆為 2026/05/01 以前之歷史未收帳（出貨日: ${xFirst.date}），點擊上方「📥 一鍵匯入所有5月前歷史未收帳」即可轉入本系統待沖帳池！`
                    : `🔴 外部系統列為未收（出貨日: ${xFirst.date}），但本系統「銷售明細總表」查無此發票明細！`,
                isPreMay: isPreMay,
                extRawGroup: xList
            };
            results.push(item);
        } else if (eList.length > 0 && xList.length === 0) {
            const unpaidErpList = eList.filter(e => e.payStatus !== '已沖帳');
            if (unpaidErpList.length === 0) return;

            const eFirst = unpaidErpList[0];
            const d = new Date(eFirst.time);
            const dtStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const uTotal = Math.round(unpaidErpList.reduce((sum, e) => sum + (Number(e.subtotal) || ((Number(e.qty)||0)*(Number(e.price)||0))), 0) * 100) / 100;
            const uQty   = Math.round(unpaidErpList.reduce((sum, e) => sum + (Number(e.qty) || 0), 0) * 1000) / 1000;

            const item = {
                recKey: `UR|${invNo}|ONLY_ERP`,
                category: 'ONLY_ERP_UNPAID',
                invNo: invNo,
                date: dtStr,
                client: eFirst.client,
                extCustId: '--',
                erpQty: uQty,
                extQty: null,
                erpTotal: uTotal,
                extTotal: null,
                erpPayStatus: '未收款 (本系統尚未沖帳)',
                extPayStatus: '外部不在未收表 (外部可能已沖帳)',
                diag: `🟣 本系統仍列為「未收款 ($${uTotal.toLocaleString()})」，但外部未收款明細無此發票（若外部系統已收款銷帳，請點擊右側「⚡ 一鍵同步沖帳」將本系統同步標記為已沖帳）`,
                erpRowIndices: unpaidErpList.map(e => e.rowIdx)
            };
            results.push(item);
        }
    });

    ur.results = results;
    window.renderUnpaidReconcileCenter();
};

window.renderUnpaidReconcileCenter = function() {
    const ur = window.paymentModuleState.unpaidReconcile;
    const results = ur.results || [];
    const revMap = ur.reviewedMap || {};

    if (!ur.extRows || ur.extRows.length === 0) {
        if (document.getElementById('unpaidRecKpiRow')) document.getElementById('unpaidRecKpiRow').style.display = 'none';
        if (document.getElementById('unpaidRecToolbar')) document.getElementById('unpaidRecToolbar').style.setProperty('display', 'none', 'important');
        if (document.getElementById('btnExportUnpaidRecExcel')) document.getElementById('btnExportUnpaidRecExcel').style.display = 'none';
        if (document.getElementById('btnClearUnpaidRecCache')) document.getElementById('btnClearUnpaidRecCache').style.display = 'none';
        return;
    }

    let cErpPaid = 0, cOnlyErp = 0, cOnlyExt = 0, cValDiff = 0, cRev = 0, cMatch = 0;
    results.forEach(r => {
        const isRev = !!revMap[r.recKey];
        if (r.category === 'MATCH') cMatch++;
        else if (isRev) cRev++;
        else {
            if (r.category === 'ERP_PAID_EXT_UNPAID') cErpPaid++;
            else if (r.category === 'ONLY_ERP_UNPAID') cOnlyErp++;
            else if (r.category === 'ONLY_EXT_UNPAID') cOnlyExt++;
            else if (r.category === 'VALUE_DIFF') cValDiff++;
        }
    });

    const cAllDiff = cErpPaid + cOnlyErp + cOnlyExt + cValDiff;
    setSafeText('uCountAllDiff', cAllDiff);
    setSafeText('uCountErpPaid', cErpPaid);
    setSafeText('uCountOnlyErp', cOnlyErp);
    setSafeText('uCountOnlyExt', cOnlyExt);
    setSafeText('uCountValDiff', cValDiff);
    setSafeText('uCountReviewed', cRev);
    setSafeText('uCountMatch', cMatch);

    if (document.getElementById('unpaidRecKpiRow')) document.getElementById('unpaidRecKpiRow').style.display = 'flex';
    if (document.getElementById('unpaidRecToolbar')) document.getElementById('unpaidRecToolbar').style.setProperty('display', 'flex', 'important');
    if (document.getElementById('btnExportUnpaidRecExcel')) document.getElementById('btnExportUnpaidRecExcel').style.display = 'inline-block';
    if (document.getElementById('btnClearUnpaidRecCache')) document.getElementById('btnClearUnpaidRecCache').style.display = 'inline-block';

    window.renderUnpaidReconcileTable();
};

window.setUnpaidReconcileFilter = function(f) {
    window.paymentModuleState.unpaidReconcile.currentFilter = f;
    window.renderUnpaidReconcileTable();
};

window.onUnpaidReconcileSearch = debounce(function(val) {
    window.paymentModuleState.unpaidReconcile.searchTerm = (val || '').trim().toLowerCase();
    window.renderUnpaidReconcileTable();
}, 200);

window.toggleUnpaidReviewItem = function(recKey, markReviewed) {
    const ur = window.paymentModuleState.unpaidReconcile;
    if (!ur.reviewedMap) ur.reviewedMap = {};
    if (markReviewed) {
        const now = new Date();
        ur.reviewedMap[recKey] = {
            time: `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
            staff: myName || '管理員'
        };
    } else {
        delete ur.reviewedMap[recKey];
    }
    window.saveUnpaidReconcileWorkspace();
    window.renderUnpaidReconcileCenter();
};

window.batchToggleUnpaidReview = function(markReviewed) {
    const cbs = document.querySelectorAll('.cb-unpaid-rec:checked');
    if (cbs.length === 0) return alert("請先勾選至少一筆項目！");
    const ur = window.paymentModuleState.unpaidReconcile;
    if (!ur.reviewedMap) ur.reviewedMap = {};
    const now = new Date();
    const tStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    cbs.forEach(cb => {
        if (markReviewed) ur.reviewedMap[cb.value] = { time: tStr, staff: myName || '管理員' };
        else delete ur.reviewedMap[cb.value];
    });
    window.saveUnpaidReconcileWorkspace();
    window.renderUnpaidReconcileCenter();
    showToast(markReviewed ? `✅ 已批次標記 ${cbs.length} 筆為「已覆核」` : `↩️ 已批次還原 ${cbs.length} 筆`);
};

window.openBatchImportLegacyFromReconcile = function() {
    const staged = window.paymentModuleState.legacyStagedItems || [];
    if (staged.length === 0) return alert("目前所有 5月前歷史未收帳款皆已匯入本系統，無須重複匯入！");
    const tabBtn = document.querySelector('button[data-bs-target="#tabPayLegacy"]');
    if (tabBtn) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
    window.renderLegacyUnpaidManager();
};

window.renderUnpaidReconcileTable = function() {
    const container = document.getElementById('unpaidRecResultContainer');
    if (!container) return;

    const ur = window.paymentModuleState.unpaidReconcile;
    const filter = ur.currentFilter || 'ALL_DIFF';
    const term = ur.searchTerm || '';
    const revMap = ur.reviewedMap || {};
    let list = ur.results || [];

    if (filter === 'ALL_DIFF') list = list.filter(r => r.category !== 'MATCH' && !revMap[r.recKey]);
    else if (filter === 'REVIEWED') list = list.filter(r => r.category !== 'MATCH' && !!revMap[r.recKey]);
    else if (filter === 'MATCH') list = list.filter(r => r.category === 'MATCH');
    else list = list.filter(r => r.category === filter && !revMap[r.recKey]);

    if (term) {
        list = list.filter(r =>
            String(r.invNo || '').toLowerCase().includes(term) ||
            String(r.client || '').toLowerCase().includes(term) ||
            String(r.extCustId || '').toLowerCase().includes(term) ||
            String(r.diag || '').toLowerCase().includes(term)
        );
    }

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4 border rounded bg-light">🎉 此分類下沒有任何待處理項目</div>`;
        return;
    }

    const rowsHtml = list.map((r, i) => {
        const isRev = !!revMap[r.recKey];
        const revInfo = revMap[r.recKey];
        let actionHtml = '';

        if (r.category !== 'MATCH') {
            if (isRev) {
                actionHtml += `<div class="badge bg-secondary mb-1 d-block">☑️ ${escapeQuotes(revInfo.staff)} ${escapeQuotes(revInfo.time)}</div>
                <button class="btn btn-sm btn-outline-warning text-dark fw-bold w-100 mb-1" onclick="window.toggleUnpaidReviewItem('${escapeQuotes(r.recKey)}', false)">↩️ 還原</button>`;
            } else {
                actionHtml += `<button class="btn btn-sm btn-success fw-bold w-100 mb-1" onclick="window.toggleUnpaidReviewItem('${escapeQuotes(r.recKey)}', true)">✅ 已覆核</button>`;
            }

            if (r.category === 'ONLY_ERP_UNPAID' && r.erpRowIndices && r.erpRowIndices.length > 0) {
                actionHtml += `<button class="btn btn-sm btn-primary fw-bold w-100" onclick='window.quickPaySingleGroup(${JSON.stringify(r.erpRowIndices)})'>⚡ 一鍵同步沖帳</button>`;
            }
        } else {
            actionHtml = `<span class="badge bg-light text-success border">帳務一致</span>`;
        }

        return `
        <tr>
            <td class="text-center">${r.category !== 'MATCH' ? `<input type="checkbox" class="form-check-input cb-unpaid-rec" value="${escapeQuotes(r.recKey)}">` : ''}</td>
            <td class="text-center text-muted fw-bold">${i + 1}</td>
            <td><strong class="text-primary">${escapeQuotes(r.invNo)}</strong><div class="small text-muted">${escapeQuotes(r.date || '')}</div></td>
            <td><div class="fw-bold">${escapeQuotes(r.client)}</div>${r.extCustId && r.extCustId !== '--' ? `<small class="text-muted">外部代號: ${escapeQuotes(r.extCustId)}</small>` : ''}</td>
            <td><div class="small fw-bold text-primary">本系統: ${escapeQuotes(r.erpPayStatus)}</div><div class="small text-danger mt-1">外部表: ${escapeQuotes(r.extPayStatus)}</div></td>
            <td class="text-end"><div>本系統: <strong>${r.erpQty !== null ? r.erpQty : '--'}</strong></div><div>外部: <strong>${r.extQty !== null ? r.extQty : '--'}</strong></div></td>
            <td class="text-end"><div>本系統: <strong class="text-primary">${r.erpTotal !== null ? '$' + r.erpTotal.toLocaleString() : '--'}</strong></div><div>外部: <strong class="text-danger">${r.extTotal !== null ? '$' + r.extTotal.toLocaleString() : '--'}</strong></div></td>
            <td class="small fw-bold text-dark" style="min-width:220px;">${escapeQuotes(r.diag)}</td>
            <td class="text-center" style="min-width:130px;">${actionHtml}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <div class="table-responsive border rounded bg-white shadow-sm" style="max-height: 600px; overflow-y: auto;">
        <table class="table table-hover table-bordered align-middle mb-0" style="font-size: 0.87rem;">
            <thead class="table-light position-sticky top-0">
                <tr>
                    <th class="text-center" style="width:38px;"><input type="checkbox" class="form-check-input" onchange="document.querySelectorAll('.cb-unpaid-rec').forEach(c=>c.checked=this.checked)"></th>
                    <th class="text-center" style="width:42px;">#</th>
                    <th>發票號碼 / 日期</th>
                    <th>客戶名稱 (CUSTID)</th>
                    <th>雙系統沖帳狀態對照</th>
                    <th class="text-end">未收數量</th>
                    <th class="text-end">未收總額</th>
                    <th>AI 勾稽診斷與處理建議</th>
                    <th class="text-center">操作</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    </div>`;
};

window.exportUnpaidReconcileExcel = function() {
    if (typeof XLSX === 'undefined') return alert("Excel 模組載入中！");
    const ur = window.paymentModuleState.unpaidReconcile;
    const results = ur.results || [];
    if (results.length === 0) return alert("無比對資料可匯出！");

    const revMap = ur.reviewedMap || {};
    const rows = [[
        "比對分類", "人工覆核狀態", "發票號碼", "日期", "客戶名稱", "外部CUSTID",
        "本系統沖帳狀態", "外部系統狀態", "本系統數量", "外部數量", "本系統金額", "外部金額", "診斷說明"
    ]];

    results.forEach(r => {
        const rev = revMap[r.recKey];
        rows.push([
            r.category,
            rev ? `☑️ 已覆核 (${rev.staff} ${rev.time})` : (r.category === 'MATCH' ? '吻合' : '待處理'),
            r.invNo, r.date, r.client, r.extCustId,
            r.erpPayStatus, r.extPayStatus,
            r.erpQty !== null ? r.erpQty : '', r.extQty !== null ? r.extQty : '',
            r.erpTotal !== null ? r.erpTotal : '', r.extTotal !== null ? r.extTotal : '',
            r.diag
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 12 },
        { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 65 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "未收與沖帳跨系統比對報告");
    XLSX.writeFile(wb, `長固ERP_未收與沖帳跨系統比對報告_${getTodayStr()}.xlsx`);
};
