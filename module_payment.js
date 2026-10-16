/**
 * ============================================================================
 * 模組 7：收款明細與沖帳 + 跨系統未收款智慧勾稽中心 (module_payment.js)
 * 【快速沖帳彈跳視窗 ＆ 防呆返回上一步升級版】
 * 1. 待收款管理與收款沖帳 (雙向連動「沖帳記錄表」與「銷售明細總表」N~Q欄)
 * 2. 沖帳記錄總表查詢、作廢退回重沖、Excel 匯出
 * 3. 2026年5月前歷史未收帳款 (期初應收) 安全隔離匯入與進度追蹤
 * 4. 跨系統「未收款明細.xlsx」AI 智慧勾稽比對中心
 * 5. 上傳後自動彈出「⚡ 比對無誤資料一鍵快速沖帳視窗」、完成自動消失 ＆ 防呆撤銷返回機制
 * ============================================================================
 */

const PAYMENT_RECONCILE_STORAGE_KEY = 'changgu_erp_unpaid_reconcile_v2';
const ERP_START_CUTOFF_DATE = '2026-05-01';

window.paymentModuleState = {
    viewMode: 'invoice', // 'invoice' (依發票歸戶) | 'item' (依單一品項)
    selectedRowIndices: new Set(),
    legacyStagedItems: [],
    fastModalMode: 'ALL_ACCURATE', // 'ALL_ACCURATE' | 'SYNC_PAID' | 'EXACT_MATCH'
    fastBatchHistoryStack: [], // 儲存每次快速沖帳的批次紀錄供「返回上一步 (撤銷)」使用
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
// 1. 初始化模組介面與彈跳視窗
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
                <div class="p-3 bg-light border rounded mb-3">
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
                                    上傳外部系統產出的 <code>未收款明細.xlsx</code>（<code>未付款-OLD</code> 工作表），系統會<strong>先自動彈出「⚡ 比對無誤一鍵快速沖帳視窗」</strong>供您秒速完成正確資料沖帳，接著再處理待確認差異。
                                </div>
                            </div>
                            <div class="d-flex flex-wrap gap-2">
                                <label class="btn btn-primary fw-bold shadow-sm mb-0" style="cursor:pointer;">
                                    📂 上傳外部「未收款明細.xlsx」
                                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="window.handleUnpaidExcelUpload(this, 'RECONCILE_TAB')">
                                </label>
                                <button id="btnOpenFastAccurateModal" class="btn btn-warning text-dark fw-bold shadow-sm" style="display:none;" onclick="window.openFastAccurateReconcileModal(false)">
                                    ⚡ 無誤資料快速沖帳 (<span id="fastAccurateRemainBadge">0</span>)
                                </button>
                                <button id="btnUndoFastAccurate" class="btn btn-outline-danger fw-bold shadow-sm" style="display:none;" onclick="window.undoLastFastAccuratePayment()">
                                    ⏪ 撤銷上次快速沖帳 (返回上一步)
                                </button>
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

    // 建立「💰 執行收款沖帳」一般彈跳視窗
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

    // 【項目 2 全新視窗】上傳外部「未收款明細.xlsx」後自動彈出之「⚡ 比對無誤資料 — 一鍵快速確認沖帳」彈跳視窗
    if (!document.getElementById('fastAccurateReconcileModal')) {
        const fastModalHtml = `
        <div class="modal fade" id="fastAccurateReconcileModal" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered modal-xl">
                <div class="modal-content border-0 shadow-lg">
                    <div class="modal-header text-white" style="background: linear-gradient(135deg, #0ca678, #198754);">
                        <div>
                            <h5 class="modal-title fw-bold mb-0">⚡ 步驟 1：比對無誤資料 — 快速一鍵確認沖帳</h5>
                            <div class="small opacity-75 mt-1">
                                以下僅列出經 AI 比對後「<strong>資料完全正確無誤</strong>」的項目。完成快速沖帳後，視窗將自動消失並進入步驟 2 處理待確認差異。
                            </div>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" title="暫時略過，先看比對主表"></button>
                    </div>

                    <div class="modal-body bg-light">
                        <!-- 防呆返回上一步提示列 -->
                        <div id="fastUndoAlertBanner" class="alert alert-warning border-warning d-flex justify-content-between align-items-center py-2 px-3 mb-3 shadow-sm" style="display:none !important;">
                            <div class="small fw-bold text-dark">
                                🛡️ <strong>防呆保護機制已就緒</strong>：<span id="fastUndoAlertText">您剛才已完成一批快速沖帳。</span>
                            </div>
                            <button type="button" class="btn btn-sm btn-danger fw-bold shadow-sm" onclick="window.undoLastFastAccuratePayment()">
                                ⏪ 撤銷剛才的沖帳 (返回上一步)
                            </button>
                        </div>

                        <!-- 模式切換與收款參數設定列 -->
                        <div class="p-3 bg-white border rounded shadow-sm mb-3">
                            <div class="d-flex flex-wrap justify-content-between align-items-center border-bottom pb-2 mb-3 gap-2">
                                <div class="btn-group btn-group-sm" role="group">
                                    <button type="button" id="btnFastMode_ALL_ACCURATE" class="btn btn-outline-success active fw-bold" onclick="window.setFastModalMode('ALL_ACCURATE')">
                                        ✨ 全部比對無誤待沖項目 (<span id="fastCntAll">0</span>)
                                    </button>
                                    <button type="button" id="btnFastMode_SYNC_PAID" class="btn btn-outline-primary fw-bold" onclick="window.setFastModalMode('SYNC_PAID')">
                                        🟣 外部已銷帳・本系統待同步沖帳 (<span id="fastCntSync">0</span>)
                                    </button>
                                    <button type="button" id="btnFastMode_EXACT_MATCH" class="btn btn-outline-success fw-bold" onclick="window.setFastModalMode('EXACT_MATCH')">
                                        🟢 雙邊金額數量 100% 吻合之發票 (<span id="fastCntMatch">0</span>)
                                    </button>
                                </div>

                                <div class="d-flex align-items-center gap-2">
                                    <select id="fastFilterClient" class="form-select form-select-sm fw-bold text-secondary" style="min-width: 200px;" onchange="window.renderFastAccurateList()">
                                        <option value="">🏢 所有客戶 (顯示全部)</option>
                                    </select>
                                    <button type="button" class="btn btn-sm btn-outline-secondary fw-bold text-nowrap" onclick="window.toggleAllFastCheckboxes(true)">☑️ 全選</button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary fw-bold text-nowrap" onclick="window.toggleAllFastCheckboxes(false)">⬜ 全不選</button>
                                </div>
                            </div>

                            <div class="row g-2 align-items-center">
                                <div class="col-6 col-md-3">
                                    <label class="small fw-bold text-muted">實際收款日</label>
                                    <input type="date" id="fast_payDate" class="form-control form-control-sm fw-bold text-primary">
                                </div>
                                <div class="col-6 col-md-3">
                                    <label class="small fw-bold text-muted">收款方式</label>
                                    <select id="fast_payMethod" class="form-select form-select-sm fw-bold">
                                        <option value="外部系統同步沖帳">🔄 外部系統同步沖帳</option>
                                        <option value="銀行匯款">🏦 銀行匯款 / 電匯</option>
                                        <option value="支票收款">🎫 支票收款</option>
                                        <option value="現金收款">💵 現金收款</option>
                                    </select>
                                </div>
                                <div class="col-12 col-md-6">
                                    <label class="small fw-bold text-muted">批次沖帳備註 (選填)</label>
                                    <input type="text" id="fast_memo" class="form-control form-control-sm" placeholder="例如：跨系統比對無誤快速批次沖帳">
                                </div>
                            </div>
                        </div>

                        <!-- 比對無誤待沖帳清單表格 -->
                        <div id="fastAccurateListContainer" class="bg-white border rounded shadow-sm" style="max-height: 400px; overflow-y: auto;"></div>
                    </div>

                    <div class="modal-footer bg-white border-top d-flex flex-wrap justify-content-between align-items-center">
                        <div>
                            <span class="fw-bold text-dark">
                                目前勾選：<span class="text-success fs-5" id="fastSelectedCount">0</span> 張無誤發票 ｜ 確認沖帳總額：<span class="text-danger fs-4" id="fastSelectedTotalAmt">$0</span>
                            </span>
                        </div>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-secondary fw-bold px-3" data-bs-dismiss="modal">
                                稍後處理 (先看比對明細表)
                            </button>
                            <button type="button" class="btn btn-success fw-bold px-4 py-2 fs-5 shadow-sm" onclick="window.confirmFastAccuratePayment()">
                                ⚡ 一鍵確認沖帳勾選項目
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', fastModalHtml);
    }

    window.loadUnpaidReconcileWorkspace();
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
    window.renderPendingReceivables();
    window.renderPaymentHistory();
    window.renderLegacyUnpaidManager();
    window.updateFastUndoButtonsUI();
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
    (rowIdxArr || []).forEach(id => window.paymentModuleState.selectedRowIndices.add(id));
    window.updateSelectedReceivableSummary();
    window.openExecutePaymentModal();
};

window.openExecutePaymentModal = function() {
    const selSet = window.paymentModuleState.selectedRowIndices;
    const selectedItems = (globalSalesDetails || []).filter(s => selSet.has(s.rowIdx) && window.isValidReceivableItem(s) && s.payStatus !== '已沖帳');

    if (selectedItems.length === 0) {
        return alert("請先勾選至少一筆要沖帳的待收款發票或品項明細！");
    }

    const clients = [...new Set(selectedItems.map(s => s.client).filter(Boolean))];
    if (clients.length > 1) {
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

    document.getElementById('pe_paymentNo').value = paymentNo;
    document.getElementById('pe_payDate').value = getTodayStr();
    document.getElementById('pe_payMethod').value = '銀行匯款';
    document.getElementById('pe_client').value = clients.join(' / ');
    document.getElementById('pe_paperNos').value = paperNos || '無發票號碼';
    document.getElementById('pe_receivableTotal').value = receivableTotal;
    document.getElementById('pe_receivedAmount').value = receivableTotal;
    document.getElementById('pe_diffAmount').value = 0;
    document.getElementById('pe_memo').value = '';
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

    const itemsSnapshot = selectedItems.map(s => {
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

    pushToSyncQueue('executePaymentReconcile', {
        paymentRecord: newPayRecord,
        salesUpdates: salesUpdates
    }, () => {
        bootstrap.Modal.getInstance(document.getElementById('paymentExecuteModal')).hide();
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
        if (window.paymentModuleState.unpaidReconcile.extRows.length > 0) {
            window.runUnpaidReconciliation(true);
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
    showLoading("📂 正在解析外部系統「未收款明細.xlsx」並篩選比對無誤資料...");

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
                // 【項目 2 核心流程】上傳分析完成後，自動跳出「⚡ 比對無誤資料 — 一鍵快速確認沖帳」彈跳視窗
                window.openFastAccurateReconcileModal(true);
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
// 6. 【項目 2 核心功能】比對無誤資料快速沖帳彈跳視窗 ＆ 防呆撤銷返回上一步
// ============================================================================
window.getAccurateReadyForPayItems = function() {
    const ur = window.paymentModuleState.unpaidReconcile;
    const results = ur.results || [];
    // 比對後完全正確且本系統尚未沖帳的兩類資料：
    // 1. ONLY_ERP_UNPAID：發票於本系統完整無誤，且外部「未收款明細」中已不在未收名單（代表外部已收款沖帳，僅待本系統同步一鍵沖帳）
    // 2. MATCH：雙系統發票號碼、客戶、數量、總價 100% 完全吻合無誤之未收發票
    return results.filter(r =>
        (r.category === 'ONLY_ERP_UNPAID' || r.category === 'MATCH') &&
        r.erpRowIndices && r.erpRowIndices.length > 0
    );
};

window.updateFastUndoButtonsUI = function() {
    const accurateAll = window.getAccurateReadyForPayItems();
    const btnOpen = document.getElementById('btnOpenFastAccurateModal');
    const badge = document.getElementById('fastAccurateRemainBadge');
    if (btnOpen && badge) {
        badge.innerText = accurateAll.length;
        btnOpen.style.display = (window.paymentModuleState.unpaidReconcile.extRows.length > 0 && accurateAll.length > 0)
            ? 'inline-block'
            : 'none';
    }

    const stack = window.paymentModuleState.fastBatchHistoryStack || [];
    const btnUndo = document.getElementById('btnUndoFastAccurate');
    const banner = document.getElementById('fastUndoAlertBanner');
    const bannerText = document.getElementById('fastUndoAlertText');

    if (stack.length > 0) {
        const lastBatch = stack[stack.length - 1];
        if (btnUndo) {
            btnUndo.style.display = 'inline-block';
            btnUndo.innerHTML = `⏪ 撤銷上次快速沖帳 (${lastBatch.invoiceCount}張 / $${Number(lastBatch.totalAmount).toLocaleString()})`;
        }
        if (banner && bannerText) {
            banner.style.setProperty('display', 'flex', 'important');
            bannerText.innerText = `剛才已快速沖銷 ${lastBatch.invoiceCount} 張無誤發票（共 $${Number(lastBatch.totalAmount).toLocaleString()}，產生 ${lastBatch.paymentRecords.length} 筆沖帳單）。若操作有誤可立即撤銷返回！`;
        }
    } else {
        if (btnUndo) btnUndo.style.display = 'none';
        if (banner) banner.style.setProperty('display', 'none', 'important');
    }
};

window.openFastAccurateReconcileModal = function(isAutoTriggered = false) {
    const accurateAll = window.getAccurateReadyForPayItems();
    window.updateFastUndoButtonsUI();

    if (accurateAll.length === 0) {
        if (!isAutoTriggered) {
            alert("目前所有比對無誤的發票皆已完成沖帳！請直接於主畫面處理待確認差異項目。");
        } else {
            showToast("✅ 外部未收款報表已載入，目前無待快速沖帳項目，請直接檢視下方比對清單。");
        }
        return;
    }

    const syncCount = accurateAll.filter(r => r.category === 'ONLY_ERP_UNPAID').length;
    const matchCount = accurateAll.filter(r => r.category === 'MATCH').length;

    setSafeText('fastCntAll', accurateAll.length);
    setSafeText('fastCntSync', syncCount);
    setSafeText('fastCntMatch', matchCount);

    // 預設優先選取「全部比對無誤待沖項目」(若只想先沖外部已銷帳項目亦可一鍵切換)
    window.paymentModuleState.fastModalMode = 'ALL_ACCURATE';
    ['ALL_ACCURATE', 'SYNC_PAID', 'EXACT_MATCH'].forEach(m => {
        const b = document.getElementById('btnFastMode_' + m);
        if (b) b.classList.toggle('active', m === 'ALL_ACCURATE');
    });

    // 更新客戶下拉篩選器
    const clients = [...new Set(accurateAll.map(r => r.client).filter(Boolean))].sort();
    const clientSel = document.getElementById('fastFilterClient');
    if (clientSel) {
        clientSel.innerHTML = '<option value="">🏢 所有客戶 (顯示全部)</option>' +
            clients.map(c => `<option value="${escapeQuotes(c)}">${escapeQuotes(c)}</option>`).join('');
    }

    if (document.getElementById('fast_payDate')) document.getElementById('fast_payDate').value = getTodayStr();
    if (document.getElementById('fast_payMethod')) document.getElementById('fast_payMethod').value = '外部系統同步沖帳';
    if (document.getElementById('fast_memo')) document.getElementById('fast_memo').value = `跨系統比對無誤快速確認沖帳 (${window.paymentModuleState.unpaidReconcile.fileName || ''})`;

    window.renderFastAccurateList();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('fastAccurateReconcileModal')).show();
};

window.setFastModalMode = function(mode) {
    window.paymentModuleState.fastModalMode = mode;
    ['ALL_ACCURATE', 'SYNC_PAID', 'EXACT_MATCH'].forEach(m => {
        const b = document.getElementById('btnFastMode_' + m);
        if (b) b.classList.toggle('active', m === mode);
    });
    window.renderFastAccurateList();
};

window.getFilteredFastAccurateItems = function() {
    const mode = window.paymentModuleState.fastModalMode || 'ALL_ACCURATE';
    const fClient = document.getElementById('fastFilterClient')?.value || '';
    let list = window.getAccurateReadyForPayItems();

    if (mode === 'SYNC_PAID') list = list.filter(r => r.category === 'ONLY_ERP_UNPAID');
    else if (mode === 'EXACT_MATCH') list = list.filter(r => r.category === 'MATCH');

    if (fClient) list = list.filter(r => r.client === fClient);
    return list;
};

window.renderFastAccurateList = function() {
    const container = document.getElementById('fastAccurateListContainer');
    if (!container) return;

    const list = window.getFilteredFastAccurateItems();
    const accurateAll = window.getAccurateReadyForPayItems();
    setSafeText('fastCntAll', accurateAll.length);
    setSafeText('fastCntSync', accurateAll.filter(r => r.category === 'ONLY_ERP_UNPAID').length);
    setSafeText('fastCntMatch', accurateAll.filter(r => r.category === 'MATCH').length);

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-4">🎉 此分類下所有比對無誤的資料皆已完成沖帳！</div>`;
        window.updateFastSelectedSummary();
        return;
    }

    const rowsHtml = list.map((r, idx) => {
        const typeBadge = r.category === 'ONLY_ERP_UNPAID'
            ? `<span class="badge" style="background-color:#862e9c;">🟣 外部已銷帳・待本系統同步</span>`
            : `<span class="badge bg-success">🟢 雙邊6大欄位 100% 吻合</span>`;

        return `
        <tr>
            <td class="text-center">
                <input type="checkbox" class="form-check-input cb-fast-acc" value="${escapeQuotes(r.recKey)}" data-amt="${r.erpTotal || 0}" style="transform:scale(1.25); cursor:pointer;" checked onchange="window.updateFastSelectedSummary()">
            </td>
            <td class="text-center text-muted fw-bold">${idx + 1}</td>
            <td class="fw-bold text-primary">${escapeQuotes(r.invNo)}</td>
            <td>${escapeQuotes(r.date || '')}</td>
            <td class="fw-bold text-dark">${escapeQuotes(r.client)}</td>
            <td>${typeBadge}</td>
            <td class="text-center fw-bold">${r.erpQty}</td>
            <td class="text-end fw-bold text-danger fs-6">$${Number(r.erpTotal || 0).toLocaleString()}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <table class="table table-hover table-bordered align-middle mb-0" style="font-size: 0.88rem;">
        <thead class="table-light position-sticky top-0" style="z-index: 5;">
            <tr>
                <th class="text-center" style="width: 45px;">
                    <input type="checkbox" class="form-check-input" style="transform:scale(1.25);" checked onchange="window.toggleAllFastCheckboxes(this.checked)">
                </th>
                <th class="text-center" style="width: 45px;">#</th>
                <th>發票號碼</th>
                <th>開立日期</th>
                <th>客戶名稱</th>
                <th>AI 智慧比對無誤類型</th>
                <th class="text-center">總數量</th>
                <th class="text-end">確認沖帳金額</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
    </table>`;

    window.updateFastSelectedSummary();
};

window.toggleAllFastCheckboxes = function(checked) {
    document.querySelectorAll('.cb-fast-acc').forEach(cb => {
        cb.checked = checked;
    });
    window.updateFastSelectedSummary();
};

window.updateFastSelectedSummary = function() {
    const cbs = document.querySelectorAll('.cb-fast-acc:checked');
    let total = 0;
    cbs.forEach(cb => {
        total += (parseFloat(cb.getAttribute('data-amt')) || 0);
    });
    setSafeText('fastSelectedCount', cbs.length);
    setSafeText('fastSelectedTotalAmt', '$' + Math.round(total).toLocaleString());
};

// 執行快速一鍵確認沖帳（完成後若無剩餘無誤項目，彈跳視窗自動關閉消失！）
window.confirmFastAccuratePayment = async function() {
    const btn = event ? event.currentTarget : null;
    const cbs = document.querySelectorAll('.cb-fast-acc:checked');
    if (cbs.length === 0) return alert("請至少勾選一筆要確認沖帳的無誤發票！");

    const payDate = document.getElementById('fast_payDate')?.value || getTodayStr();
    const payMethod = document.getElementById('fast_payMethod')?.value || '外部系統同步沖帳';
    const memo = document.getElementById('fast_memo')?.value.trim() || '跨系統比對無誤快速確認沖帳';

    const selectedKeys = new Set(Array.from(cbs).map(cb => cb.value));
    const accurateAll = window.getAccurateReadyForPayItems();
    const targetResults = accurateAll.filter(r => selectedKeys.has(r.recKey));
    if (targetResults.length === 0) return;

    if (window.lockButton(btn)) return;
    showLoading(`⚡ 正在為 ${targetResults.length} 張比對無誤發票執行一鍵快速沖帳...`);

    try {
        // 依「客戶名稱」自動分組建立沖帳單，確保沖帳記錄表每筆客戶帳務清晰
        const byClient = new Map();
        targetResults.forEach(r => {
            const cName = r.client || '未知客戶';
            if (!byClient.has(cName)) byClient.set(cName, []);
            byClient.get(cName).push(...(r.erpRowIndices || []));
        });

        const todayCompact = getTodayStr().replace(/-/g, '');
        let baseSeq = (globalPayments || []).filter(p => String(p.paymentNo || '').includes(todayCompact)).length;

        const createdPayRecords = [];
        const affectedSalesRowIndices = [];
        let batchTotalAmount = 0;

        let idxOffset = 0;
        for (const [clientName, rowIndices] of byClient.entries()) {
            const uniqueRowIds = [...new Set(rowIndices)];
            const salesItems = (globalSalesDetails || []).filter(s => uniqueRowIds.includes(s.rowIdx) && s.payStatus !== '已沖帳');
            if (salesItems.length === 0) continue;

            baseSeq++;
            idxOffset++;
            const paymentNo = `PAY-${todayCompact}-${String(baseSeq).padStart(3, '0')}`;
            const paperNos = [...new Set(salesItems.map(s => s.paperNo).filter(Boolean))].join(', ');

            let recTotal = 0;
            const itemsSnap = salesItems.map(s => {
                const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))));
                recTotal += sub;
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

            const payRec = {
                rowIdx: Date.now() + Math.floor(Math.random() * 1000) + idxOffset,
                paymentNo: paymentNo,
                time: Date.now() + idxOffset,
                payDate: payDate,
                client: clientName,
                payMethod: payMethod,
                paperNos: paperNos,
                receivableTotal: recTotal,
                receivedAmount: recTotal,
                diffAmount: 0,
                status: '已沖帳結清',
                itemsJson: JSON.stringify(itemsSnap),
                sourceType: '跨系統比對快速沖帳',
                staff: myName || '管理員',
                memo: memo
            };

            const salesUpdates = [];
            salesItems.forEach(s => {
                const sub = Math.round((Number(s.subtotal) || ((Number(s.qty)||0) * (Number(s.price)||0))));
                s.payStatus = '已沖帳';
                s.paidAmount = sub;
                s.payDate = payDate;
                s.paymentNo = paymentNo;
                affectedSalesRowIndices.push(s.rowIdx);
                salesUpdates.push({
                    rowIdx: s.rowIdx,
                    payStatus: '已沖帳',
                    paidAmount: sub,
                    payDate: payDate,
                    paymentNo: paymentNo
                });
            });

            globalPayments.unshift(payRec);
            createdPayRecords.push({
                rowIdx: payRec.rowIdx,
                paymentNo: payRec.paymentNo,
                salesRowIndices: salesUpdates.map(u => u.rowIdx)
            });
            batchTotalAmount += recTotal;

            await executeSupabaseAction('executePaymentReconcile', {
                paymentRecord: payRec,
                salesUpdates: salesUpdates
            });
        }

        // 將本次快速沖帳存入防呆返回堆疊 (支援隨時撤銷返回上一步)
        if (createdPayRecords.length > 0) {
            window.paymentModuleState.fastBatchHistoryStack.push({
                batchId: `FB_${Date.now()}`,
                time: Date.now(),
                invoiceCount: targetResults.length,
                totalAmount: batchTotalAmount,
                paymentRecords: createdPayRecords,
                allSalesRowIndices: affectedSalesRowIndices
            });
        }

        // 重新執行未收勾稽與畫面更新
        window.runUnpaidReconciliation(true);
        window.renderPaymentModule();
        window.saveUnpaidReconcileWorkspace();
        hideLoading();

        const remainingAccurate = window.getAccurateReadyForPayItems();
        const modalEl = document.getElementById('fastAccurateReconcileModal');

        // 【項目 2 關鍵體驗】待所有正確無誤資料沖帳完畢（或該分類已清空）後，彈跳視窗自動消失，切換至步驟 2 處理待確認差異！
        if (remainingAccurate.length === 0 || window.getFilteredFastAccurateItems().length === 0) {
            if (modalEl) {
                const modalInst = bootstrap.Modal.getInstance(modalEl);
                if (modalInst) modalInst.hide();
            }
            window.setUnpaidReconcileFilter('ALL_DIFF');
            showToast(`🎉 已完成 ${targetResults.length} 張無誤發票快速沖帳（共 $${batchTotalAmount.toLocaleString()}）！視窗已自動關閉，請接著檢視待確認差異。`);
        } else {
            window.renderFastAccurateList();
            window.updateFastUndoButtonsUI();
            showToast(`✅ 已成功沖銷 ${targetResults.length} 張發票（共 $${batchTotalAmount.toLocaleString()}）！尚有 ${remainingAccurate.length} 筆無誤資料可繼續沖帳。`);
        }
    } catch (err) {
        hideLoading();
        console.error("快速沖帳失敗:", err);
        alert("快速沖帳執行失敗：" + err.message);
    }
};

// 【項目 2 防呆核心】撤銷上次快速沖帳（返回上一步）
window.undoLastFastAccuratePayment = async function() {
    const stack = window.paymentModuleState.fastBatchHistoryStack || [];
    if (stack.length === 0) return alert("目前沒有可撤銷的快速沖帳批次紀錄！");

    const lastBatch = stack[stack.length - 1];
    if (!confirm(`⏪ 防呆返回確認：\n確定要撤銷剛才執行的快速沖帳批次嗎？\n\n▪ 沖銷發票數：${lastBatch.invoiceCount} 張\n▪ 沖銷總金額：$${Number(lastBatch.totalAmount).toLocaleString()}\n▪ 產生沖帳單：${lastBatch.paymentRecords.map(p => p.paymentNo).join(', ')}\n\n確認後系統將自動作廢上述沖帳單，並將所有關聯明細完整退回「未收款」狀態！`)) {
        return;
    }

    showLoading("⏪ 正在撤銷上次快速沖帳並還原明細狀態...");
    try {
        stack.pop();

        // 1. 還原前端記憶體狀態
        const payRowSet = new Set(lastBatch.paymentRecords.map(p => p.rowIdx));
        const payNoSet = new Set(lastBatch.paymentRecords.map(p => p.paymentNo));
        const salesRowSet = new Set(lastBatch.allSalesRowIndices || []);

        (globalPayments || []).forEach(p => {
            if (payRowSet.has(p.rowIdx) || payNoSet.has(p.paymentNo)) {
                p.status = '已作廢';
            }
        });

        (globalSalesDetails || []).forEach(s => {
            if (salesRowSet.has(s.rowIdx) || payNoSet.has(s.paymentNo)) {
                s.payStatus = '未收款';
                s.paidAmount = 0;
                s.payDate = '';
                s.paymentNo = '';
            }
        });

        // 2. 同步還原 Supabase 資料庫
        for (const pRec of lastBatch.paymentRecords) {
            await executeSupabaseAction('voidPaymentRecord', {
                rowIdx: pRec.rowIdx,
                paymentNo: pRec.paymentNo,
                salesRowIndices: pRec.salesRowIndices
            });
        }

        // 3. 重新計算比對並重新打開快速沖帳彈跳視窗，讓操作員重新勾選
        window.runUnpaidReconciliation(true);
        window.renderPaymentModule();
        window.saveUnpaidReconcileWorkspace();
        hideLoading();

        window.openFastAccurateReconcileModal(false);
        showToast(`⏪ 已成功撤銷上次快速沖帳！${lastBatch.invoiceCount} 張發票已完整退回未收狀態。`);
    } catch (err) {
        hideLoading();
        alert("撤銷失敗：" + err.message);
    }
};

// ============================================================================
// 7. 【頁籤 3】5月前歷史未收帳管理與一鍵安全匯入
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
// 8. 【頁籤 4】跨系統未收款/沖帳報表智慧勾稽中心
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
            reviewedMap: ur.reviewedMap || {},
            fastBatchHistoryStack: window.paymentModuleState.fastBatchHistoryStack || []
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
        window.paymentModuleState.fastBatchHistoryStack = parsed.fastBatchHistoryStack || [];

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
    window.paymentModuleState.fastBatchHistoryStack = [];
    window.renderUnpaidReconcileCenter();
    window.renderLegacyUnpaidManager();
    window.updateFastUndoButtonsUI();
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
                extPayStatus: '外部不在未收表 (外部已銷帳)',
                diag: `🟣 本系統仍列為「未收款 ($${uTotal.toLocaleString()})」，但外部未收款明細無此發票（代表外部已收款銷帳，可一鍵同步標記為已沖帳）`,
                erpRowIndices: unpaidErpList.map(e => e.rowIdx)
            };
            results.push(item);
        }
    });

    ur.results = results;
    window.updateFastUndoButtonsUI();
    window.renderUnpaidReconcileCenter();
};

window.renderUnpaidReconcileCenter = function() {
    const ur = window.paymentModuleState.unpaidReconcile;
    const results = ur.results || [];
    const revMap = ur.reviewedMap || {};

    window.updateFastUndoButtonsUI();

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
                actionHtml += `<button class="btn btn-sm btn-primary fw-bold w-100" onclick='window.quickPaySingleGroup(${JSON.stringify(r.erpRowIndices)})'>⚡ 單張同步沖帳</button>`;
            }
        } else {
            if (r.erpRowIndices && r.erpRowIndices.length > 0) {
                actionHtml = `<button class="btn btn-sm btn-outline-success fw-bold w-100" onclick='window.quickPaySingleGroup(${JSON.stringify(r.erpRowIndices)})'>💰 執行沖帳</button>`;
            } else {
                actionHtml = `<span class="badge bg-light text-success border">帳務一致</span>`;
            }
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
