/**
 * ============================================================================
 * 模組 7：收款明細與沖帳 + 跨系統未收款智慧勾稽中心 (module_payment.js)
 * 【PDF/Excel 智慧上傳 ＆ ⚡比對無誤一鍵快沖彈窗 ＆ ⏪防呆撤銷 ＆ ⚠️三階段人工覆核升級版】
 * 1. 待收款管理與收款沖帳 (雙向連動「沖帳記錄表」與「銷售明細總表」N~Q欄)
 * 2. 支援上傳 PDF / Excel 付款單對帳，內建 Gemini AI / PDF.js 轉 Excel 檔案下載功能
 * 3. 第一階段：自動彈出「⚡ 比對無誤一鍵快速確認沖帳」視窗，完成後自動消失
 * 4. 第二階段：內建「⏪ 撤銷返回上一步」防呆快照還原機制 (同步還原 Supabase 與前端狀態)
 * 5. 第三階段：自動展開「⚠️ 付款單據待確認 / 金額相異人工覆核區」(差額帶入沖帳 / 已沖忽略 / 補建舊帳沖帳)
 * 6. 沖帳記錄總表查詢、作廢退回重沖、5月前歷史未收帳管理、跨系統未收勾稽中心
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
        <!-- 頂部應收與沖帳總覽 KPI -->
        <div class="row g-2 mb-3">
            <div class="col-6 col-md-3">
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100" style="border-left: 4px solid #dc3545 !important;">
                    <div class="small fw-bold text-muted">🔴 總待收款金額 (含稅)</div>
                    <div class="fs-4 fw-bold text-danger mt-1" id="payKpiTotalUnpaid">$0</div>
                    <div class="small text-secondary" id="payKpiTotalUnpaidCount">共 0 筆未收明細</div>
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
                <div class="p-3 rounded border bg-white shadow-sm text-center h-100" style="border-left: 4px solid #198754 !important;">
                    <div class="small fw-bold text-muted">🟢 累計已完成沖帳</div>
                    <div class="fs-4 fw-bold text-success mt-1" id="payKpiTotalPaid">$0</div>
                    <div class="small text-secondary" id="payKpiTotalPaidCount">共 0 筆沖帳單</div>
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
        <div class="modal fade" id="paymentExecuteModal" tabindex="-1">
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
                        <!-- 頂部批次收款資訊設定與視窗內撤銷按鈕 -->
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

                        <!-- 比對無誤清單表格 -->
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

        const amt = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0));
        if (window.isLegacySalesItem(s)) {
            legUnpaidSum += amt;
            legUnpaidCnt++;
        } else {
            erpUnpaidSum += amt;
            erpUnpaidCnt++;
        }
    });

    let totalPaidSum = 0, totalPaidCnt = 0;
    (globalPayments || []).forEach(p => {
        if (p.status !== '已作廢') {
            totalPaidSum += (Number(p.receivedAmount) || 0);
            totalPaidCnt++;
        }
    });

    const totalUnpaid = erpUnpaidSum + legUnpaidSum;
    const totalUnpaidCnt = erpUnpaidCnt + legUnpaidCnt;

    setSafeText('payKpiTotalUnpaid', '$' + totalUnpaid.toLocaleString());
    setSafeText('payKpiTotalUnpaidCount', `共 ${totalUnpaidCnt} 筆未收明細`);
    setSafeText('payKpiErpUnpaid', '$' + erpUnpaidSum.toLocaleString());
    setSafeText('payKpiErpUnpaidCount', `${erpUnpaidCnt} 筆明細`);
    setSafeText('payKpiLegacyUnpaid', '$' + legUnpaidSum.toLocaleString());
    setSafeText('payKpiLegacyUnpaidCount', `${legUnpaidCnt} 筆歷史明細`);
    setSafeText('payKpiTotalPaid', '$' + totalPaidSum.toLocaleString());
    setSafeText('payKpiTotalPaidCount', `共 ${totalPaidCnt} 筆沖帳單`);
};

// ============================================================================
// 2.5 【新增核心】外部付款單/對帳單上傳 (支援 PDF / Excel) ＆ AI 轉 Excel ＆ 三階段快速沖帳
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

    // 核心一：若已設定 Gemini API Key，優先透過 Gemini 2.5 Flash 視覺模型精準轉為結構化帳款列
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

    // 核心二：使用內建 PDF.js 進行本地座標文字重組與表格解析
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
        // 依 Y 座標分組重組同一行的欄位文字
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

    // 1. 先檢查是否為標準「未收款明細.xlsx」格式
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

    // 2. 動態偵測一般對帳單 / 醫院匯款通知單的表頭欄位位置
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
                if (colMap.inv === -1 && /發票號碼|發票字軌|憑證號碼|發票編號|发List|INVOICE/i.test(txt)) colMap.inv = cIdx;
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
    // 尋找台灣標準統一發票號碼格式 (例如 AB-12345678, AB12345678) 或系統借用單號
    const invRegex = /\b([A-Z]{2}[\s\-]?\d{8}|OLD[\-\_][A-Za-z0-9\-]+)\b/i;

    const startRow = headerIdx >= 0 ? headerIdx + 1 : 0;
    let detectedGlobalClient = '';

    // 嘗試從前幾行表頭文字掃描是否包含已知客戶/醫院名稱
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
        if (!fullRowText || /合計|總計|小計|頁次|製表/.test(fullRowText) && !invRegex.test(fullRowText)) continue;

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

        // 正規化發票顯示格式 (若為 2英文+8數字且無連字號，查看本系統是否有連字號習慣，比對時一律用 normalizeInvoiceNo)
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

        // 若未從指定欄抓到金額，從該列所有數值型欄位自動提取金額
        if (paidAmt === 0 && recAmt === 0) {
            const nums = [];
            row.forEach(cell => {
                const s = String(cell || '').trim();
                if (!s || invRegex.test(s)) return;
                // 排除日期與8碼統編/單號
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

    // 1. 將上傳單據依「正規化發票號碼」歸戶合併
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

    // 2. 將本系統所有有效銷售明細依「正規化發票號碼」歸戶
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
        if (resolvedMap[normKey]) return; // 已透過人工覆核忽略或處理完成

        const eList = erpGroups.get(normKey) || [];
        if (eList.length === 0) {
            // 🔴 情況 3：付款單上有這張發票，但本系統找不到對應未收明細
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
            // 🔵 情況 2：該筆發票在本系統已經是「已沖帳」狀態
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

        // 計算本系統該張發票的待收總額
        const erpUnpaidTotal = Math.round(unpaidErpItems.reduce((sum, e) => {
            const sub = (Number(e.subtotal) || ((Number(e.qty)||0) * (Number(e.price)||0))) - (Number(e.paidAmount) || 0);
            return sum + sub;
        }, 0));

        const diff = Math.round((erpUnpaidTotal - docG.docPaidTotal) * 100) / 100;
        const itemsSummary = unpaidErpItems.map(e => `${e.name} x${e.qty}`).join('、');

        if (Math.abs(diff) < 1) {
            // 🟢 第一階段：100% 比對完全無誤（發票吻合、未沖帳、金額完全一致無差額）
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
            // 🟡 情況 1：發票號碼吻合，但「付款金額」與「本系統應收金額」有差額（如扣 30 元匯費或折讓）
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

    // 更新頂部控制列按鈕狀態
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

    // 同步渲染第一階段彈窗內容與第三階段人工覆核清單
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
    if (dateInput && !dateInput.value) dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : getTodayStr();
    else if (dateInput) dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(defaultDate) ? defaultDate : getTodayStr();

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

    let totalSum = 0;
    tbody.innerHTML = list.map((item, idx) => {
        totalSum += item.erpReceivable;
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

// 單筆點擊快速確認沖帳
window.confirmSingleQuickMatchItem = function(docKey) {
    window.executeQuickMatchItemsByKeys([docKey]);
};

// 批次一鍵確認沖帳所有勾選的無誤資料
window.confirmBatchQuickMatchPayment = function() {
    const checkedKeys = Array.from(document.querySelectorAll('.cb-qm-item:checked')).map(cb => cb.value);
    if (checkedKeys.length === 0) return alert("請至少勾選一筆要確認沖帳的無誤資料！");
    window.executeQuickMatchItemsByKeys(checkedKeys);
};

// 實際執行第一階段快速沖帳（依客戶自動歸戶生成沖帳單、建立 Undo 快照、寫入 Supabase，若全部完成則自動關閉彈窗）
window.executeQuickMatchItemsByKeys = function(docKeysArray) {
    const dr = window.paymentModuleState.docReconcile;
    const targetSet = new Set(docKeysArray || []);
    const targetItems = (dr.exactMatches || []).filter(x => targetSet.has(x.docKey));
    if (targetItems.length === 0) return;

    const payDate = document.getElementById('qm_payDate')?.value || getTodayStr();
    const payMethod = document.getElementById('qm_payMethod')?.value || '銀行匯款';
    const memo = (document.getElementById('qm_memo')?.value || '').trim() || `對帳單(${dr.fileName})比對無誤快速沖帳`;

    if (!payDate) return alert("請選擇實際收款日期！");

    // 1. 建立沖帳前安全快照 (供「⏪ 撤銷返回上一步」還原使用)
    const previousSalesStates = [];
    const allSalesUpdates = [];
    const newPaymentRecords = [];

    // 依客戶分組建立沖帳單，讓每家客戶有一張清晰的沖帳單號
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

                // 備份沖帳前原始狀態
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

                // 更新前端記憶體狀態
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

    // 推入撤銷堆疊
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
            // 當所有比對無誤的資料皆完成沖帳後，彈跳視窗自動消失！
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
    // 最多保留最近 10 步撤銷紀錄
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

// 執行「⏪ 撤銷返回上一步」
window.undoLastPaymentAction = function(keepModalOpen = false) {
    const stack = window.paymentModuleState.undoStack || [];
    if (stack.length === 0) return alert("目前沒有可撤銷的上一步沖帳操作！");

    const lastSnap = stack[stack.length - 1];
    if (!confirm(`⏪ 確定要撤銷上一步操作嗎？\n\n【即將還原】：${lastSnap.actionLabel}\n\n系統將自動從雲端資料庫移除該筆沖帳單，並將所有關聯發票恢復為沖帳前狀態！`)) {
        return;
    }

    showLoading("⏪ 正在撤銷沖帳並將資料庫與發票恢復至上一步狀態...");

    // 1. 還原前端記憶體中的 globalPayments
    const delRowSet = new Set(lastSnap.paymentRowIndices || []);
    const delNoSet = new Set(lastSnap.paymentNos || []);
    globalPayments = (globalPayments || []).filter(p => !delRowSet.has(p.rowIdx) && !delNoSet.has(p.paymentNo));

    // 2. 若該步驟有臨時補建歷史應收明細，將其移除
    if (lastSnap.createdSalesRowIndices && lastSnap.createdSalesRowIndices.length > 0) {
        const createdSet = new Set(lastSnap.createdSalesRowIndices);
        globalSalesDetails = (globalSalesDetails || []).filter(s => !createdSet.has(s.rowIdx));
    }

    // 3. 還原前端記憶體中的 globalSalesDetails 沖帳狀態
    (lastSnap.previousSalesStates || []).forEach(prev => {
        const s = (globalSalesDetails || []).find(sd => sd.rowIdx === prev.rowIdx);
        if (s) {
            s.payStatus = prev.payStatus || '未收款';
            s.paidAmount = Number(prev.paidAmount) || 0;
            s.payDate = prev.payDate || '';
            s.paymentNo = prev.paymentNo || '';
        }
    });

    // 4. 還原上傳單據的已處理標記 (resolvedKeys)
    const dr = window.paymentModuleState.docReconcile;
    if (dr && dr.resolvedKeys && Array.isArray(lastSnap.resolvedDocKeys)) {
        lastSnap.resolvedDocKeys.forEach(k => {
            delete dr.resolvedKeys[k];
        });
    }

    // 移除堆疊頂端
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

        // 若撤銷的是第一階段快速沖帳且原本視窗已關閉，貼心詢問或重新開啟視窗
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
            // 🟡 情況 1：發票號碼吻合，但「付款金額」與「本系統應收金額」有差額
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
            // 🔵 情況 2：該筆發票在本系統已經是「已沖帳」狀態
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
            // 🔴 情況 3：付款單上有這張發票，但本系統找不到對應未收明細
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

// 🟡 情況 1 動作：一鍵帶入實收與差額打開沖帳確認視窗
window.openStage3DiffPaymentModal = function(docKey) {
    const dr = window.paymentModuleState.docReconcile;
    const item = (dr.pendingReviews || []).find(x => x.docKey === docKey && x.type === 'AMOUNT_DIFF');
    if (!item) return;

    window.paymentModuleState.selectedRowIndices.clear();
    (item.erpRowIndices || []).forEach(id => window.paymentModuleState.selectedRowIndices.add(id));
    window.paymentModuleState.activeStage3Key = docKey;
    window.updateSelectedReceivableSummary();

    // 開啟標準執行沖帳視窗，並自動預填實收金額與匯費/折讓差額
    window.openExecutePaymentModal({
        customReceivedAmount: item.docPaidAmount,
        customPayDate: /^\d{4}-\d{2}-\d{2}$/.test(item.payDate) ? item.payDate : getTodayStr(),
        customMemo: `對帳單實付 $${item.docPaidAmount.toLocaleString()} (自動計算匯費/折讓差額 $${item.diffAmount.toLocaleString()})`
    });
};

// 🔵 情況 2 動作：標記已知悉忽略 (單筆與批次)
window.dismissUploadedDocItem = function(docKey) {
    const dr = window.paymentModuleState.docReconcile;
    if (!dr.resolvedKeys) dr.resolvedKeys = {};
    dr.resolvedKeys[docKey] = { time: Date.now(), by: myName || '管理員' };
    window.saveUploadedPaymentDocWorkspace();
    window.refreshUploadedDocReconciliation();
    showToast("✅ 已將該筆單據項目愛標記為已知悉並移出待確認清單");
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

// 🔴 情況 3 動作 A：於下方待收款清單自動帶入客戶搜尋對照
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

// 🔴 情況 3 動作 B：一鍵補建歷史應收並直接打開沖帳確認視窗
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
    const ts = new Date('2026-04-30T12:00:00').getTime(); // 歸入 5月前歷史應收池，不影響 5月後出貨庫存
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

        // 立即打開沖帳視窗並帶入金額
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
        // 依發票號碼 + 客戶歸戶
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
            const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0));
            g.totalAmt += sub;
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
        // 依單一品項明細表格檢視
        const rowsHtml = list.map(s => {
            const d = new Date(s.time);
            const dateStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
            const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0));
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
            sum += Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0));
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

// 開啟執行沖帳視窗 (支援從第三階段自動帶入實收金額、差額、收款日與備註)
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
        const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))) - (Number(s.paidAmount) || 0));
        receivableTotal += sub;
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

// 確認執行沖帳（寫入沖帳記錄表 ＋ 更新銷售明細總表 N~Q 欄 ＋ 自動納入「⏪ 撤銷返回上一步」保護）
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
        const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))));
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
        const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))));
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

    // 若本次沖帳是從第三階段待確認清單觸發，將該項目設為已處理並納入 Undo 紀錄
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

        const voidBtn = !isVoid
            ? `<button class="btn btn-sm btn-outline-danger fw-bold" onclick="window.voidPaymentRecord(${p.rowIdx})">↩️ 作廢退回未收</button>`
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
                    <div class="mt-1">${voidBtn}</div>
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
    // 欄位結構對應「未收款明細.xlsx」：
    // A(0):訂單代號, B(1):客戶代號, C(2):出貨日期, D(3):註銷, E(4):是否付款,
    // F(5):產品代號, G(6):出貨數量, H(7):單價, I(8):總價, J(9):發票號碼,
    // K(10):備考, L(11):客戶編號, M(12):沖帳日, N(13)~P(15):核對備註
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

        // 排除最底部的總計列 (無訂單代號、無客戶代號、無產品代號、無發票號碼)
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

            // 同時更新頁籤 3 (5月前歷史帳暫存) 與 頁籤 4 (跨系統未收比對中心)
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
        // 檢查是否已經匯入過 globalSalesDetails
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

    // 顯示已存在於 globalSalesDetails 的 5月前歷史帳款
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

    // 將外部未收明細依「發票號碼 (J欄)」分組
    const extByInv = new Map();
    extRows.forEach(r => {
        const key = r.paperNo || `__NOINV_${r.extOrderCode}`;
        if (!extByInv.has(key)) extByInv.set(key, []);
        extByInv.get(key).push(r);
    });

    // 找出外部檔案涵蓋的最晚日期，避免把外部報表匯出日期之後的新發票誤判為外部已沖帳
    const validExtDates = extRows.map(r => r.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const maxExtDate = validExtDates.length > 0 ? validExtDates[validExtDates.length - 1] : '2099-12-31';
    const maxExtTimestamp = new Date(maxExtDate + 'T23:59:59').getTime();

    // 將本系統銷售明細 (含未收與已沖帳) 依「發票號碼」分組
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

        const xTotal = Math.round(xList.reduce((sum, x) => sum + x.total, 0));
        const xQty   = Math.round(xList.reduce((sum, x) => sum + x.qty, 0) * 1000) / 1000;
        const eTotal = Math.round(eList.reduce((sum, e) => sum + (Number(e.subtotal) || ((Number(e.qty)||0)*(Number(e.price)||0))), 0));
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
            // 僅檢查本系統「未收款」但外部「未收款明細.xlsx」裡面沒有的項目
            const unpaidErpList = eList.filter(e => e.payStatus !== '已沖帳');
            if (unpaidErpList.length === 0) return;

            const eFirst = unpaidErpList[0];
            const d = new Date(eFirst.time);
            const dtStr = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const uTotal = Math.round(unpaidErpList.reduce((sum, e) => sum + (Number(e.subtotal) || ((Number(e.qty)||0)*(Number(e.price)||0))), 0));
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
