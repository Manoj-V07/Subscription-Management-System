// Brightloop Client Application (Phase 4 Payments, Finance & Subscriptions Operations)

const state = {
  token: sessionStorage.getItem('brightloop_access_token') || null,
  user: null,
  customers: [],
  products: [],
  plans: [],
  taxRules: [],
  discountRules: [],
  quotations: [],
  subscriptions: [],
  invoices: [],
  billingRuns: [],
  occurrences: [],
  payments: [],
  reportsSummary: null,
  overdueInvoices: [],
};

const api = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const response = await fetch(path, { headers, ...options });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || 'Request failed');
  }
  return body;
};

function formatINR(cents) {
  const rupees = (Number(cents || 0) / 100).toFixed(2);
  return `₹${Number(rupees).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function showMessage(id, message, type = 'success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `form-message ${type}`;
  setTimeout(() => {
    if (el.textContent === message) el.textContent = '';
  }, 5000);
}

// Tab Switching
function switchTab(tabName) {
  document.querySelectorAll('.tab-button').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach((tc) => (tc.style.display = 'none'));

  const btn = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  const target = document.getElementById(`tab-${tabName}`);
  if (target) {
    target.style.display = 'block';
  }
}

document.querySelectorAll('.tab-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// Customer Portal Tab Switching
function switchCustomerTab(tabName) {
  document.querySelectorAll('.cust-tab-button').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.cust-tab-content').forEach((tc) => (tc.style.display = 'none'));

  const btn = document.querySelector(`.cust-tab-button[data-cust-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  const target = document.getElementById(`cust-tab-${tabName}`);
  if (target) {
    target.style.display = 'block';
  }
}

document.querySelectorAll('.cust-tab-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchCustomerTab(btn.dataset.custTab);
  });
});

function switchAuthView(view) {
  const isLogin = view === 'login';
  document.getElementById('login-view').hidden = !isLogin;
  document.getElementById('signup-view').hidden = isLogin;
  document.getElementById('login-tab').classList.toggle('active', isLogin);
  document.getElementById('signup-tab').classList.toggle('active', !isLogin);
  document.getElementById('login-tab').setAttribute('aria-selected', String(isLogin));
  document.getElementById('signup-tab').setAttribute('aria-selected', String(!isLogin));
  document.getElementById(isLogin ? 'login-tab' : 'signup-tab').focus();
}

document.getElementById('login-tab')?.addEventListener('click', () => switchAuthView('login'));
document.getElementById('signup-tab')?.addEventListener('click', () => switchAuthView('signup'));
document.getElementById('show-login')?.addEventListener('click', () => switchAuthView('login'));
document.getElementById('show-signup')?.addEventListener('click', () => switchAuthView('signup'));

// Auth Handlers
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    const res = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    state.token = res.data.accessToken;
    sessionStorage.setItem('brightloop_access_token', state.token);
    state.user = res.data.user;
    initWorkspace();
  } catch (err) {
    showMessage('login-message', err.message, 'error');
  }
});

document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    showMessage('register-message', 'Account registered! You can now sign in.', 'success');
    e.currentTarget.reset();
  } catch (err) {
    showMessage('register-message', err.message, 'error');
  }
});

document.getElementById('logout-button')?.addEventListener('click', async () => {
  try { await api('/api/v1/auth/logout', { method: 'POST' }); } catch (_) {}
  state.token = null;
  state.user = null;
  sessionStorage.removeItem('brightloop_access_token');
  document.getElementById('auth-status').style.display = 'none';
  document.getElementById('workspace-section').style.display = 'none';
  document.getElementById('customer-portal-section').style.display = 'none';
  document.getElementById('auth-section').style.display = 'grid';
});

// Initialize workspace after login
async function initWorkspace() {
  try {
    const me = await api('/api/v1/auth/me');
    state.user = me.data;

    document.getElementById('user-display').textContent = state.user.displayName;
    const roleEl = document.getElementById('user-role');
    roleEl.textContent = state.user.role;
    roleEl.className = `role-tag ${state.user.role}`;

    document.getElementById('auth-status').style.display = 'flex';
    document.getElementById('auth-section').style.display = 'none';

    if (state.user.role === 'customer') {
      document.getElementById('workspace-section').style.display = 'none';
      document.getElementById('customer-portal-section').style.display = 'block';
      const heroEl = document.getElementById('customer-hero-title');
      if (heroEl) heroEl.textContent = `Welcome, ${state.user.displayName}`;
      await loadCustomerPortalData();
    } else {
      document.getElementById('customer-portal-section').style.display = 'none';
      document.getElementById('workspace-section').style.display = 'block';

      // Role-based visibility for staff vs admin
      const catalogTabBtn = document.getElementById('tab-btn-catalog');
      if (catalogTabBtn) {
        catalogTabBtn.style.display = state.user.role === 'admin' ? 'flex' : 'none';
      }

      // Set default target billing date and payment date to today
      const today = new Date().toISOString().slice(0, 10);
      const dateInput = document.getElementById('billing-target-date');
      if (dateInput && !dateInput.value) dateInput.value = today;

      const paymentDateInput = document.getElementById('payment-date-input');
      if (paymentDateInput && !paymentDateInput.value) paymentDateInput.value = today;

      await loadData();
      setupQuotationStudio();
      setupFinanceWorkspace();
    }
  } catch (err) {
    console.error('Session initialization failed:', err);
  }
}

async function loadData() {
  const [
    custRes, prodRes, planRes, taxRes, discRes,
    quoteRes, subRes, invRes, runRes, occRes,
    payRes, summaryRes, overdueRes
  ] = await Promise.all([
    api('/api/v1/customers').catch(() => ({ data: [] })),
    api('/api/v1/products').catch(() => ({ data: [] })),
    api('/api/v1/plans').catch(() => ({ data: [] })),
    api('/api/v1/tax-rules').catch(() => ({ data: [] })),
    api('/api/v1/discount-rules').catch(() => ({ data: [] })),
    api('/api/v1/quotations').catch(() => ({ data: [] })),
    api('/api/v1/subscriptions').catch(() => ({ data: [] })),
    api('/api/v1/invoices').catch(() => ({ data: [] })),
    api('/api/v1/billing-runs').catch(() => ({ data: [] })),
    api('/api/v1/billing-occurrences').catch(() => ({ data: [] })),
    api('/api/v1/payments').catch(() => ({ data: [] })),
    api('/api/v1/reports/summary').catch(() => ({ data: null })),
    api('/api/v1/reports/overdue-invoices').catch(() => ({ data: [] })),
  ]);

  state.customers = custRes.data || [];
  state.products = prodRes.data || [];
  state.plans = planRes.data || [];
  state.taxRules = taxRes.data || [];
  state.discountRules = discRes.data || [];
  state.quotations = quoteRes.data || [];
  state.subscriptions = subRes.data || [];
  state.invoices = invRes.data || [];
  state.billingRuns = runRes.data || [];
  state.occurrences = occRes.data || [];
  state.payments = payRes.data || [];
  state.reportsSummary = summaryRes.data || null;
  state.overdueInvoices = overdueRes.data || [];

  renderCustomersTable();
  renderProductsTable();
  renderPlansTable();
  renderQuotationsTable();
  renderSubscriptionsTable();
  renderInvoicesTable();
  renderBillingRunsTable();
  renderOccurrencesTable();
  renderFinanceKpis();
  renderPaymentsTable();
  renderOverdueTable();
  populatePaymentInvoiceSelect();
}

function renderCustomersTable() {
  const tbody = document.querySelector('#customers-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.customers
    .map(
      (c) => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.email}</td>
      <td>${c.phone || '-'}</td>
      <td><code>${c.tax_identifier || '-'}</code></td>
    </tr>
  `
    )
    .join('');
}

function renderProductsTable() {
  const tbody = document.querySelector('#products-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.products
    .map(
      (p) => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:var(--text-muted)">${p.code}</small></td>
      <td><span class="badge pending">${p.type}</span></td>
      <td>${formatINR(p.base_price_cents)}</td>
      <td>${p.variants?.length ? p.variants.map((v) => `${v.name} (+${formatINR(v.price_adjustment_cents)})`).join(', ') : 'None'}</td>
    </tr>
  `
    )
    .join('');
}

function renderPlansTable() {
  const tbody = document.querySelector('#plans-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.plans
    .map(
      (p) => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:var(--text-muted)">${p.code}</small></td>
      <td>${p.interval_count} ${p.interval}(s)</td>
      <td>${p.min_quantity}</td>
      <td>${p.auto_renew ? 'Yes' : 'No'}</td>
    </tr>
  `
    )
    .join('');
}

function renderQuotationsTable() {
  const tbody = document.querySelector('#quotations-table tbody');
  if (!tbody) return;
  if (!state.quotations.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No quotations configured yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.quotations
    .map((q) => {
      let actions = '';
      if (q.status === 'draft') {
        actions = `<button class="button secondary sm" onclick="sendQuote('${q.id}')">Send to Client</button>`;
      } else if (q.status === 'sent') {
        actions = `<button class="button primary sm" onclick="acceptQuote('${q.id}')">Accept Quote</button>`;
      } else if (q.status === 'accepted') {
        actions = `<button class="button primary sm" onclick="convertQuote('${q.id}')">Convert to Subscription</button>`;
      } else if (q.status === 'converted') {
        actions = `<span class="badge paid">Converted</span>`;
      }

      const qNum = q.quotationNumber || q.quotation_number || q.id;
      const cName = q.customerName || q.customer_name || '-';
      const total = q.grandTotalCents !== undefined ? q.grandTotalCents : q.grand_total_cents;

      return `
      <tr>
        <td><strong>${qNum}</strong></td>
        <td>${cName}</td>
        <td>${formatINR(total)}</td>
        <td><span class="badge ${q.status}">${q.status}</span></td>
        <td>${actions}</td>
      </tr>
    `;
    })
    .join('');
}

function renderSubscriptionsTable() {
  const tbody = document.querySelector('#subscriptions-table tbody');
  if (!tbody) return;
  if (!state.subscriptions.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No confirmed subscriptions found.</td></tr>';
    return;
  }
  tbody.innerHTML = state.subscriptions
    .map((s) => {
      let lifecycle = '';
      if (s.status === 'draft') {
        lifecycle = `<button class="button primary sm" onclick="activateSubscription('${s.id}')">Activate</button>`;
      } else if (s.status === 'active') {
        lifecycle = `
          <button class="button secondary sm" onclick="pauseSubscription('${s.id}')">Pause</button>
          <button class="button secondary sm" onclick="renewSubscription('${s.id}')">Renew</button>
          <button class="button danger sm" onclick="closeSubscription('${s.id}')">Close</button>
        `;
      } else if (s.status === 'paused') {
        lifecycle = `
          <button class="button primary sm" onclick="resumeSubscription('${s.id}')">Resume</button>
          <button class="button danger sm" onclick="closeSubscription('${s.id}')">Close</button>
        `;
      }

      const subNum = s.subscriptionNumber || s.subscription_number || s.id;
      const cName = s.customerName || s.customer_name || '-';
      const pName = s.planName || s.plan_name || '-';
      const grandTotal = s.grandTotalCents !== undefined ? s.grandTotalCents : s.grand_total_cents;
      const balanceDue = s.balanceDueCents !== undefined ? s.balanceDueCents : s.balance_due_cents;
      const createdAt = s.createdAt || s.created_at;

      return `
      <tr>
        <td><strong>${subNum}</strong></td>
        <td>${cName}</td>
        <td>${pName}</td>
        <td>${formatINR(grandTotal)}</td>
        <td>${formatINR(balanceDue)}</td>
        <td><span class="badge ${s.status}">${s.status}</span></td>
        <td>${lifecycle || (createdAt ? new Date(createdAt).toLocaleDateString() : '-')}</td>
      </tr>
    `;
    })
    .join('');
}

function renderInvoicesTable() {
  const tbody = document.querySelector('#invoices-table tbody');
  if (!tbody) return;
  if (!state.invoices.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;">No invoices generated yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.invoices
    .map((inv) => {
      const invNum = inv.invoiceNumber || inv.invoice_number || inv.id;
      const cName = inv.customerName || inv.customer_name || '-';
      const dueDate = inv.dueDate || inv.due_date;
      const grandTotal = inv.grandTotalCents !== undefined ? inv.grandTotalCents : inv.grand_total_cents;
      const balanceDue = inv.balanceDueCents !== undefined ? inv.balanceDueCents : inv.balance_due_cents;

      let actions = `
        <button class="button secondary sm" onclick="downloadInvoicePdf('${inv.id}', '${invNum}')">PDF</button>
        <button class="button secondary sm" onclick="printInvoice('${inv.id}')">Print</button>
      `;

      if (inv.status === 'draft') {
        actions += ` <button class="button primary sm" onclick="confirmInvoice('${inv.id}')">Confirm</button>`;
      } else if (inv.status === 'confirmed') {
        actions += ` <button class="button primary sm" onclick="sendInvoice('${inv.id}')">Send</button>`;
      }

      if (['confirmed', 'sent', 'partially_paid', 'overdue'].includes(inv.status) && Number(balanceDue) > 0) {
        actions += ` <button class="button success sm" style="background:#059669;color:#fff;" onclick="selectInvoiceForPayment('${inv.id}')">Record Payment</button>`;
      }

      if (['draft', 'confirmed', 'sent'].includes(inv.status)) {
        actions += ` <button class="button danger sm" onclick="cancelInvoice('${inv.id}')">Cancel</button>`;
      }

      return `
      <tr>
        <td><strong>${invNum}</strong></td>
        <td>${cName}</td>
        <td>${dueDate ? new Date(dueDate).toLocaleDateString() : '-'}</td>
        <td>
          ${formatINR(grandTotal)}
          ${Number(balanceDue) > 0 && Number(balanceDue) < Number(grandTotal) ? `<br><small style="color:var(--warning)">Due: ${formatINR(balanceDue)}</small>` : ''}
        </td>
        <td><span class="badge ${inv.status}">${inv.status}</span></td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap;">${actions}</div></td>
      </tr>
    `;
    })
    .join('');
}

function renderBillingRunsTable() {
  const tbody = document.querySelector('#billing-runs-table tbody');
  if (!tbody) return;
  if (!state.billingRuns.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No billing sweeps executed yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.billingRuns
    .map(
      (r) => {
        const runNum = r.runNumber || r.run_number || r.id;
        const targetDate = r.targetDate || r.target_date;
        const successCount = r.successfulCount !== undefined ? r.successfulCount : r.successful_count;
        const failedCount = r.failedCount !== undefined ? r.failedCount : r.failed_count;
        const formattedDate = targetDate ? (targetDate.includes('T') ? targetDate.slice(0, 10) : targetDate) : '-';
        return `
    <tr>
      <td><strong>${runNum}</strong></td>
      <td>${formattedDate}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td><span style="color:var(--primary)">${successCount} ok</span> / <span style="color:var(--danger)">${failedCount} err</span></td>
    </tr>
  `;
      }
    )
    .join('');
}

function renderOccurrencesTable() {
  const tbody = document.querySelector('#occurrences-table tbody');
  if (!tbody) return;
  if (!state.occurrences.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No occurrences recorded.</td></tr>';
    return;
  }
  tbody.innerHTML = state.occurrences
    .map(
      (o) => {
        const subRef = o.subscriptionNumber || o.subscription_number || o.subscriptionId || o.subscription_id;
        const err = o.lastError || o.last_error || 'None';
        return `
    <tr>
      <td><strong>${subRef}</strong></td>
      <td><span class="badge ${o.status}">${o.status}</span></td>
      <td style="color:var(--danger)"><small>${err}</small></td>
      <td>
        ${o.status === 'failed' ? `<button class="button primary sm" onclick="retryOccurrence('${o.id}')">Retry</button>` : '-'}
      </td>
    </tr>
  `;
      }
    )
    .join('');
}

// ---------------------------------------------------------------------------
// FINANCE & PAYMENTS DASHBOARD (PHASE 4)
// ---------------------------------------------------------------------------

function renderFinanceKpis() {
  const summary = state.reportsSummary;
  if (!summary) return;

  const activeValEl = document.getElementById('kpi-active-subs-value');
  const activeCntEl = document.getElementById('kpi-active-subs-count');
  const revColEl = document.getElementById('kpi-revenue-collected');
  const revCntEl = document.getElementById('kpi-payments-count');
  const outValEl = document.getElementById('kpi-outstanding-cents');
  const outCntEl = document.getElementById('kpi-unpaid-invoices-count');
  const ovrValEl = document.getElementById('kpi-overdue-cents');
  const ovrCntEl = document.getElementById('kpi-overdue-count');
  const reconStEl = document.getElementById('kpi-reconciliation-status');
  const reconFmEl = document.getElementById('kpi-reconciliation-formula');
  const reconCard = document.getElementById('kpi-reconciliation-card');

  if (activeValEl) activeValEl.textContent = formatINR(summary.activeSubscriptions?.totalValueCents || 0);
  if (activeCntEl) activeCntEl.textContent = `${summary.activeSubscriptions?.count || 0} active subscriptions`;

  if (revColEl) revColEl.textContent = formatINR(summary.revenueCollected?.totalCollectedCents || 0);
  if (revCntEl) revCntEl.textContent = `${summary.revenueCollected?.paymentsCount || state.payments.length || 0} payments recorded`;

  if (outValEl) outValEl.textContent = formatINR(summary.amountOutstanding?.totalOutstandingCents || 0);
  if (outCntEl) outCntEl.textContent = `${summary.amountOutstanding?.unpaidInvoicesCount || 0} unpaid/partial invoices`;

  if (ovrValEl) ovrValEl.textContent = formatINR(summary.overdueInvoices?.totalOverdueCents || 0);
  if (ovrCntEl) ovrCntEl.textContent = `${summary.overdueInvoices?.count || 0} overdue invoices`;

  if (summary.reconciliation?.isReconciled) {
    if (reconStEl) {
      reconStEl.textContent = 'Balanced & Reconciled';
      reconStEl.style.color = 'var(--primary)';
    }
    if (reconFmEl) {
      reconFmEl.textContent = `Invoiced (${formatINR(summary.reconciliation.totalInvoicedCents)}) = Collected + Owed`;
    }
  } else {
    if (reconStEl) {
      reconStEl.textContent = 'Discrepancy Detected';
      reconStEl.style.color = 'var(--danger)';
    }
    if (reconFmEl) {
      reconFmEl.textContent = `Variance of ${formatINR(summary.reconciliation?.discrepancyCents || 0)}`;
    }
  }
}

function renderPaymentsTable() {
  const tbody = document.querySelector('#payments-table tbody');
  if (!tbody) return;
  if (!state.payments.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">No payment records found.</td></tr>';
    return;
  }

  tbody.innerHTML = state.payments
    .map(
      (p) => {
        const pNum = p.paymentNumber || p.payment_number || p.id;
        const invNum = p.invoiceNumber || p.invoice_number || '-';
        const cName = p.customerName || p.customer_name || '-';
        const method = (p.method || 'transfer').replace('_', ' ').toUpperCase();
        const amount = p.amountCents !== undefined ? p.amountCents : p.amount_cents;
        const recDate = p.receivedDate || p.received_date || p.createdAt || p.created_at;
        const ref = p.externalReference || p.external_reference || p.notes || '-';
        return `
    <tr>
      <td><strong>${pNum}</strong></td>
      <td><code>${invNum}</code></td>
      <td>${cName}</td>
      <td><span class="badge pending">${method}</span></td>
      <td style="color:var(--primary);font-weight:700;">${formatINR(amount)}</td>
      <td>${recDate ? new Date(recDate).toLocaleDateString() : '-'}</td>
      <td><small style="color:var(--text-muted)">${ref}</small></td>
    </tr>
  `;
      }
    )
    .join('');
}

function renderOverdueTable() {
  const tbody = document.querySelector('#overdue-table tbody');
  if (!tbody) return;
  if (!state.overdueInvoices.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--primary);">No overdue invoices! All active credit terms are healthy.</td></tr>';
    return;
  }

  tbody.innerHTML = state.overdueInvoices
    .map(
      (o) => `
    <tr>
      <td><strong>${o.invoiceNumber || o.invoice_number}</strong></td>
      <td>${o.customerName || o.customer_name}<br><small style="color:var(--text-muted)">${o.customerEmail || o.customer_email || ''}</small></td>
      <td>${new Date(o.dueDate || o.due_date).toLocaleDateString()}</td>
      <td><span class="badge overdue">${o.daysOverdue || 0} days</span></td>
      <td>
        <strong style="color:var(--danger)">${formatINR(o.balanceDueCents !== undefined ? o.balanceDueCents : o.balance_due_cents)}</strong><br>
        <button class="button primary sm" style="margin-top:4px;" onclick="selectInvoiceForPayment('${o.id}')">Pay Now</button>
      </td>
    </tr>
  `
    )
    .join('');
}

function populatePaymentInvoiceSelect() {
  const select = document.getElementById('payment-invoice-select');
  if (!select) return;

  const unpaidInvoices = state.invoices.filter((i) => {
    const bal = i.balanceDueCents !== undefined ? i.balanceDueCents : i.balance_due_cents;
    return ['confirmed', 'sent', 'partially_paid', 'overdue'].includes(i.status) && Number(bal) > 0;
  });

  const currentVal = select.value;
  select.innerHTML = '<option value="">-- Choose confirmed/unpaid invoice --</option>' +
    unpaidInvoices
      .map(
        (i) => {
          const invNum = i.invoiceNumber || i.invoice_number || i.id;
          const cName = i.customerName || i.customer_name || 'Client';
          const bal = i.balanceDueCents !== undefined ? i.balanceDueCents : i.balance_due_cents;
          return `<option value="${i.id}">${invNum} - ${cName} (Due: ${formatINR(bal)})</option>`;
        }
      )
      .join('');

  if (currentVal && unpaidInvoices.some((i) => i.id === currentVal)) {
    select.value = currentVal;
  }
}

function setupFinanceWorkspace() {
  const invoiceSelect = document.getElementById('payment-invoice-select');
  const customerNameInput = document.getElementById('payment-customer-name');
  const amountInput = document.getElementById('payment-amount-input');
  const previewBox = document.getElementById('payment-allocation-preview');
  const previewInvTotal = document.getElementById('preview-invoice-total');
  const previewCurDue = document.getElementById('preview-current-due');
  const previewPayAlloc = document.getElementById('preview-payment-alloc');
  const previewRemDue = document.getElementById('preview-remaining-due');

  const updateAllocationPreview = () => {
    const invId = invoiceSelect?.value;
    const inv = state.invoices.find((i) => i.id === invId);
    if (!inv) {
      if (previewBox) previewBox.style.display = 'none';
      if (customerNameInput) customerNameInput.value = '';
      return;
    }

    const cName = inv.customerName || inv.customer_name || 'Customer';
    if (customerNameInput) customerNameInput.value = cName;
    if (previewBox) previewBox.style.display = 'block';

    const invTotal = inv.grandTotalCents !== undefined ? inv.grandTotalCents : inv.grand_total_cents;
    const curDue = inv.balanceDueCents !== undefined ? inv.balanceDueCents : inv.balance_due_cents;
    const payRupees = parseFloat(amountInput?.value) || 0;
    const payCents = Math.round(payRupees * 100);

    if (previewInvTotal) previewInvTotal.textContent = formatINR(invTotal);
    if (previewCurDue) previewCurDue.textContent = formatINR(curDue);
    if (previewPayAlloc) previewPayAlloc.textContent = formatINR(payCents);

    const remaining = Math.max(0, curDue - payCents);
    if (previewRemDue) {
      previewRemDue.textContent = formatINR(remaining);
      if (payCents > curDue) {
        previewRemDue.textContent = 'OVERPAYMENT EXCEEDED';
        previewRemDue.style.color = 'var(--danger)';
      } else {
        previewRemDue.style.color = 'var(--primary)';
      }
    }
  };

  invoiceSelect?.addEventListener('change', () => {
    const invId = invoiceSelect.value;
    const inv = state.invoices.find((i) => i.id === invId);
    if (inv && amountInput && (!amountInput.value || parseFloat(amountInput.value) <= 0)) {
      const curDue = inv.balanceDueCents !== undefined ? inv.balanceDueCents : inv.balance_due_cents;
      amountInput.value = (Number(curDue) / 100).toFixed(2);
    }
    updateAllocationPreview();
  });

  amountInput?.addEventListener('input', updateAllocationPreview);

  // Payment Form Submission
  document.getElementById('record-payment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const invoiceId = invoiceSelect.value;
    const method = document.getElementById('payment-method-select').value;
    const receivedDate = document.getElementById('payment-date-input').value;
    const amountVal = parseFloat(amountInput.value);
    const amountCents = Math.round(amountVal * 100);
    const externalReference = document.getElementById('payment-reference-input').value.trim();
    const notes = document.getElementById('payment-notes-input').value.trim();

    const inv = state.invoices.find((i) => i.id === invoiceId);
    if (!inv) {
      showMessage('payment-form-message', 'Please select a valid invoice.', 'error');
      return;
    }
    if (amountCents <= 0) {
      showMessage('payment-form-message', 'Payment amount must be greater than zero.', 'error');
      return;
    }
    if (amountCents > inv.balance_due_cents) {
      showMessage('payment-form-message', `Payment of ${formatINR(amountCents)} exceeds invoice balance due of ${formatINR(inv.balance_due_cents)}.`, 'error');
      return;
    }

    try {
      const res = await api('/api/v1/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId,
          method,
          amountCents,
          receivedDate,
          externalReference: externalReference || undefined,
          notes: notes || undefined,
        }),
      });

      showMessage('payment-form-message', `Payment ${res.data.payment.paymentNumber} recorded successfully! Allocated ${formatINR(amountCents)}.`, 'success');
      document.getElementById('record-payment-form').reset();
      document.getElementById('payment-date-input').value = new Date().toISOString().slice(0, 10);
      if (previewBox) previewBox.style.display = 'none';
      await loadData();
    } catch (err) {
      showMessage('payment-form-message', err.message, 'error');
    }
  });

  // CSV Export Buttons
  document.getElementById('btn-export-invoices-csv')?.addEventListener('click', () => downloadReportExport('invoices'));
  document.getElementById('btn-export-payments-csv')?.addEventListener('click', () => downloadReportExport('payments'));
  document.getElementById('btn-export-overdue-csv')?.addEventListener('click', () => downloadReportExport('overdue_invoices'));
}

async function downloadReportExport(resource) {
  try {
    const res = await fetch('/api/v1/reports/exports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({ resource }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Failed to generate CSV export');
    }

    const csvText = await res.text();
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resource}_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}

window.selectInvoiceForPayment = (invoiceId) => {
  switchTab('finance');
  const select = document.getElementById('payment-invoice-select');
  if (select) {
    select.value = invoiceId;
    select.dispatchEvent(new Event('change'));
  }
  const amountInput = document.getElementById('payment-amount-input');
  if (amountInput) amountInput.focus();
};

// ---------------------------------------------------------------------------
// QUOTATION STUDIO & FORM HANDLERS
// ---------------------------------------------------------------------------

function setupQuotationStudio() {
  const custSelect = document.getElementById('quote-customer-select');
  const planSelect = document.getElementById('quote-plan-select');
  const prodSelect = document.getElementById('quote-product-select');
  const varSelect = document.getElementById('quote-variant-select');
  const qtyInput = document.getElementById('quote-qty-input');
  const discSelect = document.getElementById('quote-discount-select');
  const taxSelect = document.getElementById('quote-tax-select');

  if (custSelect) {
    custSelect.innerHTML = state.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  if (planSelect) {
    planSelect.innerHTML = state.plans.map((p) => `<option value="${p.id}">${p.name} (${p.interval})</option>`).join('');
  }
  if (prodSelect) {
    prodSelect.innerHTML = state.products.map((p) => `<option value="${p.id}">${p.name} - ${formatINR(p.base_price_cents)}</option>`).join('');
  }
  if (discSelect) {
    discSelect.innerHTML = '<option value="">No Discount</option>' +
      state.discountRules.map((d) => `<option value="${d.id}">${d.name} (${d.type === 'percentage' ? d.value_percent + '%' : formatINR(d.value_cents)})</option>`).join('');
  }
  if (taxSelect) {
    taxSelect.innerHTML = '<option value="">No Tax Rule</option>' +
      state.taxRules.map((t) => `<option value="${t.id}">${t.name} (${t.rate_percent}%)</option>`).join('');
  }

  const updateVariants = () => {
    const prod = state.products.find((p) => p.id === prodSelect.value);
    if (!varSelect) return;
    varSelect.innerHTML = '<option value="">No Variant (Base Price)</option>';
    if (prod?.variants) {
      prod.variants.forEach((v) => {
        varSelect.innerHTML += `<option value="${v.id}">${v.name} (+${formatINR(v.price_adjustment_cents)})</option>`;
      });
    }
    updateLiveCalculation();
  };

  const updateLiveCalculation = () => {
    const prod = state.products.find((p) => p.id === prodSelect?.value);
    const variantId = varSelect?.value;
    const variant = prod?.variants?.find((v) => v.id === variantId);
    const qty = parseInt(qtyInput?.value) || 1;

    let unitPrice = prod?.base_price_cents || 0;
    if (variant) unitPrice += variant.price_adjustment_cents || 0;

    const subtotal = unitPrice * qty;
    let discount = 0;

    const discRule = state.discountRules.find((d) => d.id === discSelect?.value);
    if (discRule) {
      if (discRule.type === 'percentage') {
        discount = Math.round((subtotal * Number(discRule.value_percent)) / 100);
      } else {
        discount = Math.min(subtotal, discRule.value_cents || 0);
      }
    }

    const taxable = Math.max(0, subtotal - discount);
    let tax = 0;
    const taxRule = state.taxRules.find((t) => t.id === taxSelect?.value);
    if (taxRule) {
      tax = Math.round((taxable * Number(taxRule.rate_percent)) / 100);
    }

    const grandTotal = taxable + tax;

    const subEl = document.getElementById('preview-subtotal');
    const discEl = document.getElementById('preview-discount');
    const taxBaseEl = document.getElementById('preview-taxable');
    const taxEl = document.getElementById('preview-tax');
    const totalEl = document.getElementById('preview-total');

    if (subEl) subEl.textContent = formatINR(subtotal);
    if (discEl) discEl.textContent = `-${formatINR(discount)}`;
    if (taxBaseEl) taxBaseEl.textContent = formatINR(taxable);
    if (taxEl) taxEl.textContent = `+${formatINR(tax)}`;
    if (totalEl) totalEl.textContent = formatINR(grandTotal);
  };

  prodSelect?.addEventListener('change', updateVariants);
  varSelect?.addEventListener('change', updateLiveCalculation);
  qtyInput?.addEventListener('input', updateLiveCalculation);
  discSelect?.addEventListener('change', updateLiveCalculation);
  taxSelect?.addEventListener('change', updateLiveCalculation);

  updateVariants();
}

// Create Quotation Submit
document.getElementById('create-quote-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customerId = document.getElementById('quote-customer-select').value;
  const planId = document.getElementById('quote-plan-select').value;
  const productId = document.getElementById('quote-product-select').value;
  const variantId = document.getElementById('quote-variant-select').value || undefined;
  const quantity = parseInt(document.getElementById('quote-qty-input').value) || 1;
  const discountRuleId = document.getElementById('quote-discount-select').value || undefined;
  const taxRuleId = document.getElementById('quote-tax-select').value || undefined;

  try {
    const res = await api('/api/v1/quotations', {
      method: 'POST',
      body: JSON.stringify({
        customerId,
        planId,
        lines: [{ productId, variantId, quantity }],
        discountRuleId,
        taxRuleId,
      }),
    });
    showMessage('quote-form-message', `Quotation ${res.data.quotation.quotationNumber} created!`, 'success');
    const qRes = await api('/api/v1/quotations');
    state.quotations = qRes.data;
    renderQuotationsTable();
  } catch (err) {
    showMessage('quote-form-message', err.message, 'error');
  }
});

// Create Customer Submit
document.getElementById('create-customer-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    await api('/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form)),
    });
    showMessage('customer-form-message', 'Customer registered successfully!', 'success');
    e.currentTarget.reset();
    const cRes = await api('/api/v1/customers');
    state.customers = cRes.data;
    renderCustomersTable();
    setupQuotationStudio();
  } catch (err) {
    showMessage('customer-form-message', err.message, 'error');
  }
});

// Run Scheduled Billing Form Submit
document.getElementById('run-billing-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const targetDate = document.getElementById('billing-target-date').value;
  try {
    const res = await api('/api/v1/billing-runs', {
      method: 'POST',
      body: JSON.stringify({ targetDate }),
    });
    const run = res.data.billingRun;
    showMessage('billing-run-message', `Billing run ${run.runNumber} finished: ${run.successfulCount} invoices created, ${run.failedCount} failures.`, 'success');
    await loadData();
  } catch (err) {
    showMessage('billing-run-message', err.message, 'error');
  }
});

// Quote Transitions
window.sendQuote = async (id) => {
  try {
    await api(`/api/v1/quotations/${id}/send`, { method: 'POST' });
    const res = await api('/api/v1/quotations');
    state.quotations = res.data;
    renderQuotationsTable();
  } catch (err) { alert(err.message); }
};

window.acceptQuote = async (id) => {
  try {
    await api(`/api/v1/quotations/${id}/confirm`, { method: 'POST' });
    const res = await api('/api/v1/quotations');
    state.quotations = res.data;
    renderQuotationsTable();
  } catch (err) { alert(err.message); }
};

window.convertQuote = async (id) => {
  try {
    const res = await api(`/api/v1/quotations/${id}/convert`, { method: 'POST' });
    alert(`Converted to subscription ${res.data.subscription.subscriptionNumber}!`);
    const [qRes, sRes] = await Promise.all([api('/api/v1/quotations'), api('/api/v1/subscriptions')]);
    state.quotations = qRes.data;
    state.subscriptions = sRes.data;
    renderQuotationsTable();
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

// Subscription Lifecycle Actions
window.activateSubscription = async (id) => {
  try {
    await api(`/api/v1/subscriptions/${id}/activate`, { method: 'POST' });
    const res = await api('/api/v1/subscriptions');
    state.subscriptions = res.data;
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

window.pauseSubscription = async (id) => {
  try {
    await api(`/api/v1/subscriptions/${id}/pause`, { method: 'POST' });
    const res = await api('/api/v1/subscriptions');
    state.subscriptions = res.data;
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

window.resumeSubscription = async (id) => {
  try {
    await api(`/api/v1/subscriptions/${id}/resume`, { method: 'POST' });
    const res = await api('/api/v1/subscriptions');
    state.subscriptions = res.data;
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

window.renewSubscription = async (id) => {
  try {
    await api(`/api/v1/subscriptions/${id}/renew`, { method: 'POST' });
    const res = await api('/api/v1/subscriptions');
    state.subscriptions = res.data;
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

window.closeSubscription = async (id) => {
  const reason = prompt('Enter closure reason:');
  if (reason === null) return;
  try {
    await api(`/api/v1/subscriptions/${id}/close`, { method: 'POST', body: JSON.stringify({ reason }) });
    const res = await api('/api/v1/subscriptions');
    state.subscriptions = res.data;
    renderSubscriptionsTable();
  } catch (err) { alert(err.message); }
};

// Invoice Lifecycle & Actions
window.confirmInvoice = async (id) => {
  try {
    await api(`/api/v1/invoices/${id}/confirm`, { method: 'POST' });
    const res = await api('/api/v1/invoices');
    state.invoices = res.data;
    renderInvoicesTable();
  } catch (err) { alert(err.message); }
};

window.sendInvoice = async (id) => {
  try {
    const res = await api(`/api/v1/invoices/${id}/send`, { method: 'POST' });
    alert(`Email invoice dispatched to ${res.data.notification?.recipient_email}!`);
    const invRes = await api('/api/v1/invoices');
    state.invoices = invRes.data;
    renderInvoicesTable();
  } catch (err) { alert(err.message); }
};

window.downloadInvoicePdf = async (id, invNum) => {
  try {
    const res = await fetch(`/api/v1/invoices/${id}/pdf`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to download PDF');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invNum || 'invoice'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) { alert(err.message); }
};

window.printInvoice = (id) => {
  window.open(`/api/v1/invoices/${id}/print`, '_blank');
};

window.cancelInvoice = async (id) => {
  const reason = prompt('Enter cancellation reason:');
  if (reason === null) return;
  try {
    await api(`/api/v1/invoices/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
    const res = await api('/api/v1/invoices');
    state.invoices = res.data;
    renderInvoicesTable();
  } catch (err) { alert(err.message); }
};

// Retry Failed Occurrence
window.retryOccurrence = async (id) => {
  try {
    const res = await api(`/api/v1/billing-occurrences/${id}/retry`, { method: 'POST' });
    alert(`Occurrence retried! Generated invoice ${res.data.invoice?.invoiceNumber}`);
    await loadData();
  } catch (err) { alert(err.message); }
};

// ==========================================
// CUSTOMER PORTAL DATA & RENDERERS
// ==========================================

async function loadCustomerPortalData() {
  const [custRes, subRes, invRes, payRes] = await Promise.all([
    api('/api/v1/customers').catch(() => ({ data: [] })),
    api('/api/v1/subscriptions').catch(() => ({ data: [] })),
    api('/api/v1/invoices').catch(() => ({ data: [] })),
    api('/api/v1/payments').catch(() => ({ data: [] })),
  ]);

  state.customers = custRes.data || [];
  state.customerProfile = state.customers[0] || null;
  state.subscriptions = subRes.data || [];
  state.invoices = invRes.data || [];
  state.payments = payRes.data || [];

  renderCustomerKpis();
  renderCustomerSubscriptionsTable();
  renderCustomerInvoicesTable();
  renderCustomerPaymentsTable();
  populateCustomerProfileForm();
}

function renderCustomerKpis() {
  const activeSubs = state.subscriptions.filter((s) => s.status === 'active' || s.status === 'confirmed').length;
  const subsEl = document.getElementById('cust-kpi-subs-count');
  if (subsEl) subsEl.textContent = activeSubs;

  const totalBalanceDue = state.invoices.reduce((acc, inv) => {
    return acc + Number(inv.balanceDueCents !== undefined ? inv.balanceDueCents : inv.balance_due_cents || 0);
  }, 0);
  const balEl = document.getElementById('cust-kpi-balance-due');
  if (balEl) balEl.textContent = formatINR(totalBalanceDue);

  const totalPaid = state.payments.reduce((acc, p) => {
    return acc + Number(p.amountCents !== undefined ? p.amountCents : p.amount_cents || 0);
  }, 0);
  const paidEl = document.getElementById('cust-kpi-paid-amount');
  if (paidEl) paidEl.textContent = formatINR(totalPaid);

  const invEl = document.getElementById('cust-kpi-invoices-count');
  if (invEl) invEl.textContent = state.invoices.length;
}

function renderCustomerSubscriptionsTable() {
  const tbody = document.querySelector('#customer-subscriptions-table tbody');
  if (!tbody) return;
  if (!state.subscriptions.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">No active subscriptions found.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.subscriptions
    .map((s) => {
      const grandTotal = s.grandTotalCents !== undefined ? s.grandTotalCents : s.grand_total_cents;
      const balanceDue = s.balanceDueCents !== undefined ? s.balanceDueCents : s.balance_due_cents;
      const startsAt = s.startsAt || s.starts_at;
      const formattedDate = startsAt ? new Date(startsAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
      const statusClass = `status-${s.status}`;
      return `
        <tr>
          <td><strong>${s.subscriptionNumber || s.subscription_number || s.id}</strong></td>
          <td>${s.planName || s.plan_name || 'Standard Tier'}</td>
          <td><span style="text-transform: capitalize;">${s.planInterval || s.plan_interval || 'monthly'}</span></td>
          <td>${formatINR(grandTotal)}</td>
          <td>${formatINR(balanceDue)}</td>
          <td><span class="status-badge ${statusClass}">${s.status}</span></td>
          <td>${formattedDate}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerInvoicesTable() {
  const tbody = document.querySelector('#customer-invoices-table tbody');
  if (!tbody) return;
  if (!state.invoices.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">No invoices generated yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.invoices
    .map((inv) => {
      const grandTotal = inv.grandTotalCents !== undefined ? inv.grandTotalCents : inv.grand_total_cents;
      const balanceDue = inv.balanceDueCents !== undefined ? inv.balanceDueCents : inv.balance_due_cents;
      const dueDate = inv.dueDate || inv.due_date;
      const formattedDueDate = dueDate ? new Date(dueDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
      const statusClass = `status-${inv.status}`;
      return `
        <tr>
          <td><strong>${inv.invoiceNumber || inv.invoice_number || inv.id}</strong></td>
          <td>${formattedDueDate}</td>
          <td>${formatINR(grandTotal)}</td>
          <td style="${Number(balanceDue) > 0 ? 'color: var(--danger); font-weight:600;' : ''}">${formatINR(balanceDue)}</td>
          <td><span class="status-badge ${statusClass}">${inv.status}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="button secondary sm" type="button" onclick="downloadInvoicePdf('${inv.id}', '${inv.invoiceNumber || inv.invoice_number}')">Download PDF</button>
              <button class="button secondary sm" type="button" onclick="printInvoice('${inv.id}')">View</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerPaymentsTable() {
  const tbody = document.querySelector('#customer-payments-table tbody');
  if (!tbody) return;
  if (!state.payments.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">No payments recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.payments
    .map((p) => {
      const amount = p.amountCents !== undefined ? p.amountCents : p.amount_cents;
      const date = p.receivedDate || p.received_date || p.createdAt || p.created_at;
      const formattedDate = date ? new Date(date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
      return `
        <tr>
          <td><strong>${p.paymentNumber || p.payment_number || p.id}</strong></td>
          <td>${p.invoiceNumber || p.invoice_number || '-'}</td>
          <td>${formattedDate}</td>
          <td><span style="text-transform: capitalize;">${(p.method || 'transfer').replace('_', ' ')}</span></td>
          <td style="color: var(--primary); font-weight: 600;">${formatINR(amount)}</td>
          <td><code>${p.externalReference || p.external_reference || '-'}</code></td>
        </tr>
      `;
    })
    .join('');
}

function populateCustomerProfileForm() {
  const profile = state.customerProfile;
  if (!profile) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setVal('cust-prof-name', profile.name || state.user?.displayName || '');
  setVal('cust-prof-email', profile.email || state.user?.email || '');
  setVal('cust-prof-phone', profile.phone || '');
  setVal('cust-prof-tax', profile.taxIdentifier || profile.tax_identifier || '');

  const addr = profile.billingAddress || profile.billing_address || {};
  setVal('cust-prof-street', addr.street || '');
  setVal('cust-prof-city', addr.city || '');
  setVal('cust-prof-state', addr.state || '');
  setVal('cust-prof-zip', addr.postalCode || addr.postal_code || '');
  setVal('cust-prof-country', addr.country || 'India');
}

// Handle customer profile update
document.getElementById('customer-profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.customerProfile?.id) {
    showMessage('customer-profile-message', 'Customer profile record not found.', 'error');
    return;
  }
  const form = e.currentTarget;
  const name = form.querySelector('#cust-prof-name').value.trim();
  const phone = form.querySelector('#cust-prof-phone').value.trim();
  const taxIdentifier = form.querySelector('#cust-prof-tax').value.trim();
  const billingAddress = {
    street: form.querySelector('#cust-prof-street').value.trim(),
    city: form.querySelector('#cust-prof-city').value.trim(),
    state: form.querySelector('#cust-prof-state').value.trim(),
    postalCode: form.querySelector('#cust-prof-zip').value.trim(),
    country: form.querySelector('#cust-prof-country').value.trim(),
  };

  try {
    const res = await api(`/api/v1/customers/${state.customerProfile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, phone, taxIdentifier, billingAddress }),
    });
    state.customerProfile = res.data;
    document.getElementById('customer-hero-title').textContent = `Welcome, ${res.data.name}`;
    document.getElementById('user-display').textContent = res.data.name;
    showMessage('customer-profile-message', 'Profile updated successfully!', 'success');
  } catch (err) {
    showMessage('customer-profile-message', err.message, 'error');
  }
});

// Check existing session
if (state.token) {
  initWorkspace();
}
