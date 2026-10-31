// Brightloop Client Application (Phase 3 Billing & Subscription Operations)

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
document.querySelectorAll('.tab-button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((tc) => (tc.style.display = 'none'));

    btn.classList.add('active');
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    if (target) target.style.display = 'block';
  });
});

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
  document.getElementById('auth-section').style.display = 'grid';
});

// Initialize workspace after login
async function initWorkspace() {
  try {
    const me = await api('/api/v1/auth/me');
    state.user = me.data;

    document.getElementById('user-display').textContent = state.user.displayName;
    document.getElementById('user-role').textContent = state.user.role;
    document.getElementById('auth-status').style.display = 'flex';
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('workspace-section').style.display = 'block';

    // Set default target billing date to today
    const dateInput = document.getElementById('billing-target-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    await loadData();
    setupQuotationStudio();
  } catch (err) {
    console.error('Session initialization failed:', err);
  }
}

async function loadData() {
  const [custRes, prodRes, planRes, taxRes, discRes, quoteRes, subRes, invRes, runRes, occRes] = await Promise.all([
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

  renderCustomersTable();
  renderProductsTable();
  renderPlansTable();
  renderQuotationsTable();
  renderSubscriptionsTable();
  renderInvoicesTable();
  renderBillingRunsTable();
  renderOccurrencesTable();
}

function renderCustomersTable() {
  const tbody = document.querySelector('#customers-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.customers.map((c) => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.email}</td>
      <td>${c.phone || '—'}</td>
      <td><code>${c.taxIdentifier || '—'}</code></td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No customers found</td></tr>';
}

function renderProductsTable() {
  const tbody = document.querySelector('#products-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.products.map((p) => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge draft">${p.productType}</span></td>
      <td>${formatINR(p.salesPriceCents)}</td>
      <td>${p.variants?.map((v) => `${v.label} (${v.adjustmentType === 'fixed' ? '+' + formatINR(v.adjustmentValue) : '+' + v.adjustmentValue + '%'})`).join(', ') || '—'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No products found</td></tr>';
}

function renderPlansTable() {
  const tbody = document.querySelector('#plans-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.plans.map((p) => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge sent">${p.interval} (x${p.intervalCount})</span></td>
      <td>${p.minQuantity}</td>
      <td>${p.autoRenew ? '✓ Yes' : 'No'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No plans found</td></tr>';
}

function renderQuotationsTable() {
  const tbody = document.querySelector('#quotations-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.quotations.map((q) => {
    let actionHtml = '';
    if (q.status === 'draft') {
      actionHtml = `<button class="button secondary sm" onclick="sendQuote('${q.id}')">Send</button>`;
    } else if (q.status === 'sent') {
      actionHtml = `<button class="button secondary sm" onclick="acceptQuote('${q.id}')">Accept</button>`;
    } else if (q.status === 'accepted') {
      actionHtml = `<button class="button primary sm" onclick="convertQuote('${q.id}')">Convert to Sub</button>`;
    } else if (q.status === 'converted') {
      actionHtml = `<span style="color:var(--primary);font-size:12px;font-weight:700;">✓ Sub Created</span>`;
    }

    return `
      <tr>
        <td><strong>${q.quotationNumber}</strong></td>
        <td>${q.customerName || 'Customer'}</td>
        <td><strong>${formatINR(q.grandTotalCents)}</strong></td>
        <td><span class="badge ${q.status}">${q.status}</span></td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No quotations yet. Create one on the left.</td></tr>';
}

function renderSubscriptionsTable() {
  const tbody = document.querySelector('#subscriptions-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.subscriptions.map((s) => {
    let actionsHtml = '';
    if (s.status === 'confirmed') {
      actionsHtml = `<button class="button primary sm" onclick="activateSubscription('${s.id}')">Activate</button>`;
    } else if (s.status === 'active') {
      actionsHtml = `
        <button class="button secondary sm" onclick="pauseSubscription('${s.id}')">Pause</button>
        <button class="button secondary sm" onclick="renewSubscription('${s.id}')">Renew</button>
        <button class="button secondary sm" onclick="closeSubscription('${s.id}')" style="color:var(--danger);">Close</button>
      `;
    } else if (s.status === 'paused') {
      actionsHtml = `
        <button class="button primary sm" onclick="resumeSubscription('${s.id}')">Resume</button>
        <button class="button secondary sm" onclick="closeSubscription('${s.id}')" style="color:var(--danger);">Close</button>
      `;
    } else {
      actionsHtml = '<span style="color:var(--text-muted);font-size:12px;">Closed</span>';
    }

    const nextBilling = s.nextBillingAt ? new Date(s.nextBillingAt).toLocaleDateString() : '—';

    return `
      <tr>
        <td><strong style="color:var(--primary);">${s.subscriptionNumber}</strong></td>
        <td>${s.customerName || 'Customer'}</td>
        <td>${s.planName || 'Plan'}</td>
        <td><strong>${formatINR(s.grandTotalCents)}</strong></td>
        <td>${nextBilling}</td>
        <td><span class="badge ${s.status}">${s.status}</span></td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No confirmed subscriptions yet. Convert an accepted quote to create one.</td></tr>';
}

// Invoices Table
function renderInvoicesTable() {
  const tbody = document.querySelector('#invoices-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.invoices.map((inv) => {
    let actions = `
      <button class="button primary sm" onclick="downloadInvoicePdf('${inv.id}', '${inv.invoiceNumber}')">PDF</button>
      <button class="button secondary sm" onclick="printInvoice('${inv.id}')">Print</button>
    `;

    if (inv.status === 'draft') {
      actions = `<button class="button secondary sm" onclick="confirmInvoice('${inv.id}')">Confirm</button> ` + actions;
    } else if (inv.status === 'confirmed' || inv.status === 'sent') {
      actions = `<button class="button secondary sm" onclick="sendInvoice('${inv.id}')">Send Email</button> ` + actions;
    }

    if (inv.status !== 'cancelled' && inv.status !== 'paid') {
      actions += ` <button class="button secondary sm" onclick="cancelInvoice('${inv.id}')" style="color:var(--danger);">Cancel</button>`;
    }

    return `
      <tr>
        <td><strong>${inv.invoiceNumber}</strong></td>
        <td>${inv.customerName || 'Customer'}</td>
        <td>${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
        <td><strong>${formatINR(inv.grandTotalCents)}</strong></td>
        <td><span class="badge ${inv.status}">${inv.status}</span></td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No invoices generated yet. Run a billing sweep or convert due subscriptions.</td></tr>';
}

// Billing Runs Table
function renderBillingRunsTable() {
  const tbody = document.querySelector('#billing-runs-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.billingRuns.map((r) => `
    <tr>
      <td><strong>${r.runNumber}</strong></td>
      <td>${new Date(r.targetDate).toLocaleDateString()}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td>${r.successfulCount} / ${r.failedCount}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No billing sweeps recorded yet.</td></tr>';
}

// Billing Occurrences Table
function renderOccurrencesTable() {
  const tbody = document.querySelector('#occurrences-table tbody');
  if (!tbody) return;
  tbody.innerHTML = state.occurrences.map((o) => `
    <tr>
      <td><strong>${o.subscriptionNumber || o.subscriptionId}</strong></td>
      <td><span class="badge ${o.status}">${o.status}</span></td>
      <td style="color:${o.lastError ? 'var(--danger)' : 'var(--text-muted)'};font-size:12px;">${o.lastError || 'None'}</td>
      <td>${o.status === 'failed' ? `<button class="button primary sm" onclick="retryOccurrence('${o.id}')">Retry</button>` : '—'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Failure queue is clear. All occurrences succeeded.</td></tr>';
}

// Live Quotation Studio
function setupQuotationStudio() {
  const custSelect = document.getElementById('quote-customer-select');
  const planSelect = document.getElementById('quote-plan-select');
  const prodSelect = document.getElementById('quote-product-select');
  const varSelect = document.getElementById('quote-variant-select');
  const discSelect = document.getElementById('quote-discount-select');
  const taxSelect = document.getElementById('quote-tax-select');
  const qtyInput = document.getElementById('quote-qty-input');

  if (custSelect) {
    custSelect.innerHTML = state.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  if (planSelect) {
    planSelect.innerHTML = state.plans.map((p) => `<option value="${p.id}">${p.name} (${p.interval})</option>`).join('');
  }
  if (prodSelect) {
    prodSelect.innerHTML = state.products.map((p) => `<option value="${p.id}">${p.name} - ${formatINR(p.salesPriceCents)}</option>`).join('');
  }
  if (discSelect) {
    discSelect.innerHTML = '<option value="">No Discount</option>' + state.discountRules.map((d) => `<option value="${d.id}">${d.name} (${d.type === 'fixed' ? formatINR(d.value) : d.value + '%'})</option>`).join('');
  }
  if (taxSelect) {
    taxSelect.innerHTML = '<option value="">No Tax Rule</option>' + state.taxRules.map((t) => `<option value="${t.id}">${t.name} (${t.ratePercentage}%)</option>`).join('');
  }

  function updateVariants() {
    const selectedProdId = prodSelect?.value;
    const prod = state.products.find((p) => p.id === selectedProdId);
    if (varSelect) {
      if (prod && prod.variants && prod.variants.length > 0) {
        varSelect.innerHTML = '<option value="">No Variant (Base Price)</option>' +
          prod.variants.map((v) => `<option value="${v.id}">${v.label} (${v.adjustmentType === 'fixed' ? '+' + formatINR(v.adjustmentValue) : '+' + v.adjustmentValue + '%'})`).join('');
      } else {
        varSelect.innerHTML = '<option value="">No Variant (Base Price)</option>';
      }
    }
    updateLiveCalculation();
  }

  function updateLiveCalculation() {
    const prod = state.products.find((p) => p.id === prodSelect?.value);
    if (!prod) return;

    const qty = parseInt(qtyInput?.value) || 1;
    let unitPrice = Number(prod.salesPriceCents || 0);
    const variantId = varSelect?.value;

    if (variantId && prod.variants) {
      const v = prod.variants.find((vr) => vr.id === variantId);
      if (v) {
        if (v.adjustmentType === 'fixed') unitPrice += Number(v.adjustmentValue || 0);
        else if (v.adjustmentType === 'percentage') unitPrice += Math.round((unitPrice * Number(v.adjustmentValue || 0)) / 100);
      }
    }

    const subtotal = qty * unitPrice;

    // Discount
    let discount = 0;
    const discRule = state.discountRules.find((d) => d.id === discSelect?.value);
    if (discRule && subtotal >= Number(discRule.minThresholdCents || 0)) {
      if (discRule.type === 'percentage') discount = Math.round((subtotal * Number(discRule.value)) / 100);
      else if (discRule.type === 'fixed') discount = Math.min(subtotal, Math.round(Number(discRule.value)));
    }

    const taxable = Math.max(0, subtotal - discount);

    // Tax
    let tax = 0;
    const taxRule = state.taxRules.find((t) => t.id === taxSelect?.value);
    if (taxRule) {
      tax = Math.round((taxable * Number(taxRule.ratePercentage)) / 100);
    }

    const grandTotal = taxable + tax;

    document.getElementById('preview-subtotal').textContent = formatINR(subtotal);
    document.getElementById('preview-discount').textContent = `-${formatINR(discount)}`;
    document.getElementById('preview-taxable').textContent = formatINR(taxable);
    document.getElementById('preview-tax').textContent = `+${formatINR(tax)}`;
    document.getElementById('preview-total').textContent = formatINR(grandTotal);
  }

  prodSelect?.addEventListener('change', updateVariants);
  varSelect?.addEventListener('change', updateLiveCalculation);
  qtyInput?.addEventListener('input', updateLiveCalculation);
  discSelect?.addEventListener('change', updateLiveCalculation);
  taxSelect?.addEventListener('change', updateLiveCalculation);

  updateVariants();
}

// Quote Form Submit
document.getElementById('create-quote-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const customerId = document.getElementById('quote-customer-select').value;
  const planId = document.getElementById('quote-plan-select').value;
  const productId = document.getElementById('quote-product-select').value;
  const variantId = document.getElementById('quote-variant-select').value || null;
  const quantity = parseInt(document.getElementById('quote-qty-input').value) || 1;
  const discountRuleId = document.getElementById('quote-discount-select').value || null;
  const taxRuleId = document.getElementById('quote-tax-select').value || null;

  try {
    const res = await api('/api/v1/quotations', {
      method: 'POST',
      body: JSON.stringify({
        customerId,
        planId,
        discountRuleId,
        taxRuleId,
        lines: [{ productId, variantId, quantity }],
      }),
    });
    showMessage('quote-form-message', `Quotation ${res.data.quotationNumber} created!`, 'success');
    const quoteListRes = await api('/api/v1/quotations');
    state.quotations = quoteListRes.data || [];
    renderQuotationsTable();
  } catch (err) {
    showMessage('quote-form-message', err.message, 'error');
  }
});

// Create Customer Form Submit
document.getElementById('create-customer-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    await api('/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form)),
    });
    showMessage('customer-form-message', 'Customer added successfully!', 'success');
    e.currentTarget.reset();
    const custRes = await api('/api/v1/customers');
    state.customers = custRes.data || [];
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

// Check existing session
if (state.token) {
  initWorkspace();
}
