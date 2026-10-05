/**
 * @file app.js
 *
 * ticket-in Interactive Demo – Client-side state machine
 *
 * Implements: Auth -> Queue -> Seat Selection -> Order -> Payment -> Tickets
 * Architecture: Vanilla ES module, no build step required.
 */

/* ============================================================================
   Constants & Config
   ============================================================================ */

const API_BASE = '';
const EVENT_ID = '01935b30-0000-7000-8000-000000000001';
const HOLD_TTL_SECONDS = 600;
const QUEUE_POLL_INTERVAL_MS = 3000;

/** Simulated seat layout for UI (backed by real API calls for holds/orders). */
const SEAT_LAYOUT = {
  vip: Array.from({ length: 10 }, (_, i) => ({
    id: `seat-${String(i + 1).padStart(3, '0')}`,
    number: `VIP-${String(i + 1).padStart(2, '0')}`,
    category: 'VIP',
    price: 1500000,
    status: 'available',
  })),
  cat1: Array.from({ length: 20 }, (_, i) => ({
    id: `seat-${String(i + 11).padStart(3, '0')}`,
    number: `C1-${String(i + 1).padStart(2, '0')}`,
    category: 'CAT 1',
    price: 800000,
    status: 'available',
  })),
  cat2: Array.from({ length: 30 }, (_, i) => ({
    id: `seat-${String(i + 31).padStart(3, '0')}`,
    number: `C2-${String(i + 1).padStart(2, '0')}`,
    category: 'CAT 2',
    price: 400000,
    status: 'available',
  })),
};

/* ============================================================================
   Application State
   ============================================================================ */

const state = {
  step: 0,
  userId: null,
  accessToken: null,
  username: '',
  queueRank: null,
  queueStatus: 'IDLE',
  admissionToken: null,
  queuePollTimer: null,
  holdCountdownTimer: null,
  holdRemainingSeconds: HOLD_TTL_SECONDS,
  holdId: null,
  selectedSeats: [],
  orderId: null,
  orderTotal: 0,
  paymentDone: false,
  tickets: [],
};

/* ============================================================================
   DOM References
   ============================================================================ */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ============================================================================
   Toast Notifications
   ============================================================================ */

function showToast(message, type = 'info', duration = 4000) {
  const container = $('toast-container');
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ============================================================================
   API Helpers
   ============================================================================ */

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.accessToken) {
    headers['Authorization'] = `Bearer ${state.accessToken}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const msg = body.detail || body.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ============================================================================
   Step Navigation
   ============================================================================ */

function setStep(step) {
  state.step = step;
  $$('.step-panel').forEach((el, i) => {
    el.classList.toggle('hidden', i !== step);
  });
  $$('.step-btn').forEach((el, i) => {
    el.classList.remove('active', 'completed');
    if (i < step) el.classList.add('completed');
    if (i === step) el.classList.add('active');
  });
}

/* ============================================================================
   Step 0: Authentication
   ============================================================================ */

let authMode = 'login';

function initAuth() {
  const loginTab = $('tab-login');
  const registerTab = $('tab-register');
  const registerFields = $('register-fields');

  loginTab.addEventListener('click', () => {
    authMode = 'login';
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    registerFields.classList.add('hidden');
    $('auth-submit-btn').textContent = 'Sign In';
  });

  registerTab.addEventListener('click', () => {
    authMode = 'register';
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerFields.classList.remove('hidden');
    $('auth-submit-btn').textContent = 'Create Account';
  });

  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('auth-submit-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    const email = $('input-email').value.trim();
    const password = $('input-password').value;

    try {
      if (authMode === 'register') {
        const username = $('input-username').value.trim();
        await apiFetch('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, username, password, role: 'user' }),
        });
        showToast('Account created successfully', 'success');
      }

      const res = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, password }),
      });

      state.userId = res.user?.id ?? res.userId ?? res.id;
      state.accessToken = res.tokens?.accessToken ?? res.accessToken;
      state.username = res.user?.username ?? email;

      $('header-user').textContent = `@${state.username}`;
      $('header-user').classList.remove('hidden');

      showToast(`Welcome back, ${state.username}!`, 'success');
      setStep(1);
      initQueue();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  });
}

/* ============================================================================
   Step 1: Waiting Room Queue
   ============================================================================ */

function initQueue() {
  $('btn-join-queue').addEventListener('click', joinQueue);
}

async function joinQueue() {
  const btn = $('btn-join-queue');
  btn.disabled = true;
  btn.classList.add('btn-loading');
  try {
    const res = await apiFetch(`/api/v1/queue/${EVENT_ID}/join`, {
      method: 'POST',
      body: JSON.stringify({ userId: state.userId }),
    });
    state.queueStatus = res.status ?? 'QUEUED';
    state.queueRank = res.rank ?? 1;
    updateQueueDisplay();
    showToast(`Joined queue at position #${state.queueRank}`, 'success');
    startQueuePolling();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
}

function startQueuePolling() {
  $('btn-join-queue').classList.add('hidden');
  $('queue-polling').classList.remove('hidden');
  updateQueueDisplay();
  pollQueueStatus();
  state.queuePollTimer = setInterval(pollQueueStatus, QUEUE_POLL_INTERVAL_MS);
}

async function pollQueueStatus() {
  try {
    const res = await apiFetch(`/api/v1/queue/${EVENT_ID}/status`);
    state.queueStatus = res.status ?? state.queueStatus;
    state.queueRank = res.rank ?? state.queueRank;
    state.admissionToken = res.admissionToken ?? state.admissionToken;
    updateQueueDisplay();

    if (state.queueStatus === 'ADMITTED' && state.admissionToken) {
      clearInterval(state.queuePollTimer);
      onAdmitted();
    }
  } catch {
    /* silently retry */
  }
}

function updateQueueDisplay() {
  const rankEl = $('queue-rank-value');
  const statusEl = $('queue-status-value');
  if (rankEl) rankEl.textContent = state.queueRank ?? '--';
  if (statusEl) statusEl.textContent = state.queueStatus;
}

function onAdmitted() {
  $('queue-admitted-section').classList.remove('hidden');
  $('queue-polling').classList.add('hidden');
  const shortToken = state.admissionToken ? state.admissionToken.substring(0, 40) + '...' : 'N/A';
  $('admission-token-value').textContent = shortToken;
  showToast('You are admitted! Proceed to seat selection.', 'success');
}

$('btn-skip-queue').addEventListener('click', () => {
  clearInterval(state.queuePollTimer);
  state.admissionToken = 'demo-bypass-token';
  $('queue-admitted-section').classList.remove('hidden');
  $('queue-polling').classList.add('hidden');
  $('btn-join-queue').classList.add('hidden');
  $('admission-token-value').textContent = '(Demo mode – skipped queue)';
  showToast('Queue skipped for demo purposes', 'warning');
});

$('btn-to-seats').addEventListener('click', () => {
  setStep(2);
  initSeatMap();
});

/* ============================================================================
   Step 2: Seat Selection
   ============================================================================ */

function initSeatMap() {
  renderSeatCategory('vip-seats', SEAT_LAYOUT.vip);
  renderSeatCategory('cat1-seats', SEAT_LAYOUT.cat1);
  renderSeatCategory('cat2-seats', SEAT_LAYOUT.cat2);
  updateSeatSelection();
}

function renderSeatCategory(containerId, seats) {
  const container = $(containerId);
  container.innerHTML = '';
  seats.forEach((seat) => {
    const el = document.createElement('button');
    el.className = `seat seat-${seat.status}`;
    el.textContent = seat.number.split('-')[1];
    el.title = `${seat.number} - ${formatIDR(seat.price)} - ${seat.status}`;
    el.dataset.seatId = seat.id;
    el.dataset.seatNumber = seat.number;
    el.dataset.price = seat.price;
    el.dataset.category = seat.category;

    if (seat.status === 'available') {
      el.addEventListener('click', () => toggleSeat(seat, el));
    } else {
      el.disabled = true;
    }
    container.appendChild(el);
  });
}

function toggleSeat(seat, el) {
  const idx = state.selectedSeats.findIndex((s) => s.id === seat.id);
  if (idx >= 0) {
    state.selectedSeats.splice(idx, 1);
    el.classList.remove('seat-selected');
    el.classList.add('seat-available');
  } else {
    if (state.selectedSeats.length >= 4) {
      showToast('Maximum 4 seats per user per event', 'warning');
      return;
    }
    state.selectedSeats.push(seat);
    el.classList.remove('seat-available');
    el.classList.add('seat-selected');
  }
  updateSeatSelection();
}

function updateSeatSelection() {
  const info = $('seat-selection-info');
  const btn = $('btn-hold-seats');
  const count = state.selectedSeats.length;
  const total = state.selectedSeats.reduce((s, seat) => s + seat.price, 0);

  if (count === 0) {
    info.classList.remove('visible');
    btn.disabled = true;
  } else {
    info.classList.add('visible');
    $('selected-seat-list').textContent = state.selectedSeats.map((s) => s.number).join(', ');
    $('selected-seat-total').textContent = formatIDR(total);
    btn.disabled = false;
  }
}

$('btn-hold-seats').addEventListener('click', async () => {
  const btn = $('btn-hold-seats');
  btn.disabled = true;
  btn.classList.add('btn-loading');
  const seatIds = state.selectedSeats.map((s) => s.id);

  try {
    const res = await apiFetch('/api/v1/holds', {
      method: 'POST',
      body: JSON.stringify({ eventId: EVENT_ID, seatIds }),
    });

    state.holdId = res.holds?.[0]?.id ?? res.holdId ?? 'demo-hold';
    state.holdRemainingSeconds = HOLD_TTL_SECONDS;
    state.orderTotal = state.selectedSeats.reduce((s, seat) => s + seat.price, 0);

    /* Mark seats as held visually */
    state.selectedSeats.forEach((seat) => {
      const el = document.querySelector(`[data-seat-id="${seat.id}"]`);
      if (el) {
        el.classList.remove('seat-selected');
        el.classList.add('seat-held');
        el.disabled = true;
      }
      const found = [...SEAT_LAYOUT.vip, ...SEAT_LAYOUT.cat1, ...SEAT_LAYOUT.cat2].find(
        (s) => s.id === seat.id,
      );
      if (found) found.status = 'held';
    });

    showToast('Seats held successfully! Complete your order.', 'success');
    setStep(3);
    initOrder();
  } catch (err) {
    showToast(`Hold failed: ${err.message}`, 'error');
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
});

/* ============================================================================
   Step 3: Order & Hold Countdown
   ============================================================================ */

function initOrder() {
  renderOrderSummary();
  startHoldCountdown();
  $('btn-create-order').addEventListener('click', createOrder);
}

function renderOrderSummary() {
  const tbody = $('order-items-body');
  tbody.innerHTML = state.selectedSeats
    .map(
      (s) => `
      <div class="order-row">
        <span class="order-label">${s.number} (${s.category})</span>
        <span class="order-value">${formatIDR(s.price)}</span>
      </div>`,
    )
    .join('');
  $('order-total-display').textContent = formatIDR(state.orderTotal);
}

function startHoldCountdown() {
  const display = $('hold-timer-display');
  display.textContent = formatTimer(state.holdRemainingSeconds);

  state.holdCountdownTimer = setInterval(() => {
    state.holdRemainingSeconds -= 1;
    display.textContent = formatTimer(state.holdRemainingSeconds);
    if (state.holdRemainingSeconds <= 60) display.classList.add('urgent');
    if (state.holdRemainingSeconds <= 0) {
      clearInterval(state.holdCountdownTimer);
      showToast('Hold expired! Please select seats again.', 'error');
      setStep(2);
    }
  }, 1000);
}

async function createOrder() {
  const btn = $('btn-create-order');
  btn.disabled = true;
  btn.classList.add('btn-loading');
  const idempotencyKey = `demo-order-${Date.now()}`;

  try {
    const res = await apiFetch('/api/v1/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ holdId: state.holdId }),
    });

    state.orderId = res.id ?? res.orderId;
    $('order-id-display').textContent = state.orderId;
    $('order-status-display').textContent = 'PENDING';
    clearInterval(state.holdCountdownTimer);
    showToast('Order created successfully', 'success');
    setStep(4);
    initPayment();
  } catch (err) {
    showToast(`Order failed: ${err.message}`, 'error');
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
}

/* ============================================================================
   Step 4: Payment Simulation
   ============================================================================ */

function initPayment() {
  $('payment-order-id').textContent = state.orderId ?? 'N/A';
  $('payment-amount-display').textContent = formatIDR(state.orderTotal);
  $('btn-simulate-payment').addEventListener('click', simulatePayment);
}

async function simulatePayment() {
  const btn = $('btn-simulate-payment');
  btn.disabled = true;
  btn.classList.add('btn-loading');

  try {
    /* Trigger the payment-simulator checkout which fires the HMAC webhook */
    await apiFetch('/api/v1/payments/checkout', {
      method: 'POST',
      body: JSON.stringify({ orderId: state.orderId, amount: state.orderTotal }),
    });

    /* Simulate async completion delay */
    await new Promise((r) => setTimeout(r, 1500));

    state.paymentDone = true;
    $('payment-pending').classList.add('hidden');
    $('payment-success').classList.remove('hidden');
    showToast('Payment processed! Tickets are being issued...', 'success');

    /* Poll for issued tickets */
    setTimeout(fetchTickets, 2500);
  } catch (err) {
    showToast(`Payment error: ${err.message}`, 'error');
    btn.disabled = false;
    btn.classList.remove('btn-loading');
  }
}

/* ============================================================================
   Step 5: Tickets
   ============================================================================ */

async function fetchTickets() {
  try {
    const res = await apiFetch('/api/v1/tickets');
    state.tickets = Array.isArray(res) ? res : (res.tickets ?? []);
    if (state.tickets.length > 0) {
      setStep(5);
      renderTickets();
    } else {
      showToast('Tickets are still processing, retrying...', 'info');
      setTimeout(fetchTickets, 2000);
    }
  } catch (err) {
    showToast(`Ticket fetch error: ${err.message}`, 'error');
  }
}

function renderTickets() {
  const container = $('tickets-container');
  container.innerHTML = '';
  state.tickets.forEach((ticket) => {
    const card = createTicketCard(ticket);
    container.appendChild(card);
  });
  $('btn-go-to-tickets').click();
}

function createTicketCard(ticket) {
  const el = document.createElement('div');
  el.className = 'ticket-card';
  const isCheckedIn = ticket.status === 'CHECKED_IN';

  el.innerHTML = `
    <div class="ticket-header">
      <div>
        <div class="ticket-event">ticket-in Demo Concert 2026</div>
        <div class="ticket-event-sub">Jakarta International Stadium</div>
      </div>
      <div class="ticket-code-badge">${ticket.ticketCode ?? 'TIX-DEMO'}</div>
    </div>
    <div class="ticket-divider"><div class="ticket-dashes"></div></div>
    <div class="ticket-body">
      <div class="ticket-details">
        <div class="ticket-detail-row">
          <div class="ticket-field">
            <div class="ticket-field-label">Seat</div>
            <div class="ticket-field-value">${ticket.seatNumber ?? ticket.seatId ?? 'N/A'}</div>
          </div>
          <div class="ticket-field">
            <div class="ticket-field-label">Category</div>
            <div class="ticket-field-value">${ticket.categoryName ?? 'VIP'}</div>
          </div>
          <div class="ticket-field">
            <div class="ticket-field-label">Price</div>
            <div class="ticket-field-value">${formatIDR(ticket.price ?? 0)}</div>
          </div>
        </div>
        <div class="ticket-detail-row">
          <div class="ticket-field">
            <div class="ticket-field-label">Holder</div>
            <div class="ticket-field-value">${state.username}</div>
          </div>
          <div class="ticket-field">
            <div class="ticket-field-label">Status</div>
            <div class="ticket-field-value" style="color: ${isCheckedIn ? 'var(--accent-green)' : 'var(--accent-cyan)'}">
              ${ticket.status}
            </div>
          </div>
        </div>
      </div>
      <div class="ticket-qr">${generateQrSvg(ticket.ticketCode ?? ticket.id)}</div>
    </div>
    <div class="ticket-status-bar ${isCheckedIn ? 'checked-in' : ''}">
      <span class="ticket-status-text">${isCheckedIn ? '✓ CHECKED IN' : 'VALID – NOT YET SCANNED'}</span>
      ${
        !isCheckedIn
          ? `<button class="btn btn-sm btn-success" onclick="verifyTicket('${ticket.id}', this)">
               🔍 Verify at Gate
             </button>`
          : '<span style="font-size:18px">✅</span>'
      }
    </div>
  `;
  return el;
}

window.verifyTicket = async (ticketId, btnEl) => {
  btnEl.disabled = true;
  try {
    const res = await apiFetch(`/api/v1/tickets/${ticketId}/verify`, { method: 'POST' });
    const card = btnEl.closest('.ticket-card');
    card.querySelector('.ticket-status-bar').classList.add('checked-in');
    card.querySelector('.ticket-status-text').textContent = '✓ CHECKED IN';
    btnEl.replaceWith(document.createTextNode('✅'));
    const statusField = card.querySelectorAll('.ticket-field-value')[4];
    if (statusField) statusField.textContent = 'CHECKED_IN';
    showToast('Gate verification successful!', 'success');
  } catch (err) {
    showToast(`Verify failed: ${err.message}`, 'error');
    btnEl.disabled = false;
  }
};

/** Generate a minimal QR-like SVG pattern for visual representation. */
function generateQrSvg(code) {
  const hash = [...(code ?? 'demo')].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
  const cells = Array.from({ length: 49 }, (_, i) => ((hash ^ (i * 7919)) & 1) === 1);
  const size = 7;
  const rects = cells
    .map((on, i) => {
      const x = (i % size) * 8;
      const y = Math.floor(i / size) * 8;
      return on ? `<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/>` : '';
    })
    .join('');
  return `<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" style="background:#fff">${rects}</svg>`;
}

/* ============================================================================
   Health Check
   ============================================================================ */

async function checkHealth() {
  try {
    const res = await apiFetch('/health');
    const dot = $('health-dot');
    const label = $('health-label');
    if (res.status === 'ok') {
      dot.classList.remove('offline');
      label.textContent = 'API Online';
    }
  } catch {
    $('health-dot').classList.add('offline');
    $('health-label').textContent = 'API Offline';
  }
}

/* ============================================================================
   Bootstrap
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  checkHealth();
  setInterval(checkHealth, 30000);

  $('btn-go-to-tickets').addEventListener('click', () => setStep(5));
});
