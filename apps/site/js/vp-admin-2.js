// ─── Config ──────────────────────────────────────────────────────
const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/admin' : 'https://api.vaultproof.dev/admin';

// ─── Supabase ────────────────────────────────────────────────────
const sbClient = window.supabase.createClient(
  'https://gwzkjiomemjlhtrdrlan.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o'
);

let accessToken = '';

function getHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...getHeaders(), ...(opts.headers || {}) } });
  if (res.status === 401 || res.status === 403) {
    accessToken = '';
    await sbClient.auth.signOut();
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('auth-error').classList.remove('hidden');
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function loginWithGitHub() {
  await sbClient.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin + '/vp-admin' }
  });
}

async function loginWithGoogle() {
  await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/vp-admin' }
  });
}

async function tryAdminAccess(session) {
  if (!session) return;
  accessToken = session.access_token;
  try {
    await apiFetch('/stats');
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    init();
  } catch {
    accessToken = '';
    document.getElementById('auth-error').classList.remove('hidden');
  }
}

// Listen for OAuth callback
sbClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) tryAdminAccess(session);
});

// Auto-login if session exists
(async () => {
  const { data: { session } } = await sbClient.auth.getSession();
  if (session) tryAdminAccess(session);
})();

function logout() {
  accessToken = '';
  sbClient.auth.signOut();
  location.reload();
}

// ─── Init ────────────────────────────────────────────────────────
async function init() {
  await loadStats();
  await loadUsers(1);
  await loadGlobalLogs(1);
  loadAnalytics();
}

async function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '↻ Loading...';
  try {
    await init();
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

// Live clock
setInterval(() => {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// ─── Tabs ────────────────────────────────────────────────────────
function switchTab(tab) {
  // Only keep top-level tab rows active; the analytics sub-tabs
  // must not be affected by top-level tab switches.
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
  ['overview', 'users', 'logs', 'monitoring', 'tests'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
  });
  document.getElementById('user-detail').classList.add('hidden');

  // Stop the Overview-v2 poll whenever we leave the Overview tab
  // (the analytics section lives inside Overview).
  if (tab !== 'overview' && typeof overviewPollInterval !== 'undefined' && overviewPollInterval) {
    clearInterval(overviewPollInterval);
    overviewPollInterval = null;
  }

  if (tab === 'monitoring') loadMonitoring();

  if (tab === 'tests') loadTests();
}

// ─── Stats ───────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await apiFetch('/stats');
    document.getElementById('stat-users').textContent = fmt(s.totalUsers);
    document.getElementById('stat-paid').textContent = fmt(s.paidUsers);
    document.getElementById('stat-keys').textContent = fmt(s.totalKeys);
    document.getElementById('stat-calls-today').textContent = fmt(s.callsToday);
    document.getElementById('stat-calls-month').textContent = fmt(s.callsThisMonth);
    document.getElementById('stat-calls-all').textContent = fmt(s.totalCallsAllTime);
    document.getElementById('stat-active').textContent = fmt(s.activeUsersLast7Days);
    document.getElementById('stat-dev-keys').textContent = fmt(s.totalDevKeys);

    const tierStr = Object.entries(s.tiers || {}).map(([k,v]) => `${k}: ${v}`).join(', ');
    document.getElementById('stat-tiers').textContent = tierStr || '-';
    document.getElementById('stat-tiers').style.fontSize = '13px';
  } catch (e) {
    console.error('Failed to load stats', e);
  }

}

// ─── Users ───────────────────────────────────────────────────────
let usersCurrentPage = 1;
let usersSearchTerm = '';
let searchTimeout = null;

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    usersSearchTerm = document.getElementById('user-search').value.trim();
    loadUsers(1);
  }, 300);
}

async function loadUsers(page) {
  usersCurrentPage = page;
  try {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (usersSearchTerm) params.set('search', usersSearchTerm);
    const data = await apiFetch(`/users?${params}`);
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';

    for (const u of data.users) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.onclick = () => openUserDetail(u.id);
      tr.innerHTML = `
        <td class="mono text-xs">${esc(u.email)}</td>
        <td><span class="badge badge-${u.tier}">${esc(u.tier)}</span></td>
        <td>${u.keyCount}</td>
        <td>${u.devKeyCount}</td>
        <td>${fmt(u.totalCalls)}</td>
        <td class="text-gray-500 text-xs">${fmtDate(u.createdAt)}</td>
      `;
      tbody.appendChild(tr);
    }

    const totalPages = Math.ceil(data.total / data.limit) || 1;
    document.getElementById('user-count').textContent = `${data.total} users`;
    document.getElementById('users-page-info').textContent = `Page ${page} of ${totalPages}`;
    document.getElementById('users-prev').disabled = page <= 1;
    document.getElementById('users-next').disabled = page >= totalPages;
  } catch (e) {
    console.error('Failed to load users', e);
  }
}

function usersPage(delta) {
  loadUsers(usersCurrentPage + delta);
}

// ─── User detail ─────────────────────────────────────────────────
let currentUserId = null;
let currentUserEmail = '';

async function openUserDetail(userId) {
  currentUserId = userId;
  try {
    const u = await apiFetch(`/users/${userId}`);
    currentUserEmail = u.email;

    document.getElementById('tab-users').classList.add('hidden');
    document.getElementById('user-detail').classList.remove('hidden');
    document.getElementById('user-logs-panel').classList.add('hidden');

    document.getElementById('detail-email').textContent = u.email;
    const tierBadge = document.getElementById('detail-tier-badge');
    tierBadge.textContent = u.tier;
    tierBadge.className = `badge badge-${u.tier}`;
    document.getElementById('detail-tier-select').value = u.tier;

    document.getElementById('detail-keys').textContent = u.keySlots.length;
    document.getElementById('detail-devkeys').textContent = u.developerKeys.length;
    document.getElementById('detail-calls').textContent = fmt(u.totalCalls);
    document.getElementById('detail-created').textContent = fmtDate(u.createdAt);

    // Ban button visibility
    document.getElementById('detail-ban-btn').classList.toggle('hidden', u.tier === 'banned');

    // Profile
    document.getElementById('detail-profile').innerHTML = `
      <div><span class="text-gray-500">ID:</span> <span class="mono">${esc(u.id)}</span></div>
      <div><span class="text-gray-500">Email:</span> ${esc(u.email)}</div>
      <div><span class="text-gray-500">Tier:</span> ${esc(u.tier)}</div>
      <div><span class="text-gray-500">Stripe Customer:</span> ${esc(u.stripeCustomerId || 'none')}</div>
      <div><span class="text-gray-500">Stripe Sub:</span> ${esc(u.stripeSubscriptionId || 'none')}</div>
      <div><span class="text-gray-500">Daily Limit:</span> ${u.globalDailyLimit ?? 'none'}</div>
      <div><span class="text-gray-500">Monthly Limit:</span> ${u.globalMonthlyLimit ?? 'none'}</div>
      <div><span class="text-gray-500">Kill Switch:</span> ${u.killSwitch ? 'ON' : 'off'}</div>
    `;

    // Key slots
    const ksTbody = document.getElementById('detail-keyslots-tbody');
    ksTbody.innerHTML = '';
    for (const ks of u.keySlots) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(ks.provider)}</td>
        <td>${esc(ks.label)}</td>
        <td><span class="badge ${ks.status === 'ACTIVE' ? 'badge-pro' : 'badge-banned'}">${esc(ks.status)}</span></td>
        <td>${ks.dailyLimit ?? '-'}</td>
        <td>${ks.monthlyLimit ?? '-'}</td>
        <td class="text-gray-500 text-xs">${fmtDate(ks.createdAt)}</td>
      `;
      ksTbody.appendChild(tr);
    }

    // Dev keys
    const dkTbody = document.getElementById('detail-devkeys-tbody');
    dkTbody.innerHTML = '';
    for (const dk of u.developerKeys) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(dk.label)}</td>
        <td>${esc(dk.mode)}</td>
        <td class="text-xs">${esc(dk.allowedProviders || 'all')}</td>
        <td class="text-gray-500 text-xs">${dk.lastUsed ? fmtDate(dk.lastUsed) : '-'}</td>
        <td class="text-gray-500 text-xs">${fmtDate(dk.createdAt)}</td>
        <td>${dk.revokedAt ? '<span class="text-amber-400 text-xs">' + fmtDate(dk.revokedAt) + '</span>' : '<span class="text-green-400 text-xs">active</span>'}</td>
      `;
      dkTbody.appendChild(tr);
    }

    // Recent activity
    const actTbody = document.getElementById('detail-activity-tbody');
    actTbody.innerHTML = '';
    for (const log of u.recentActivity) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-gray-500 text-xs">${fmtTime(log.timestamp)}</td>
        <td>${esc(log.keySlot?.provider || '-')}</td>
        <td>${esc(log.action)}</td>
        <td class="mono text-xs">${esc(truncate(log.appId, 20))}</td>
        <td class="text-xs text-gray-500">${esc(truncate(log.metadata || '', 60))}</td>
      `;
      actTbody.appendChild(tr);
    }

    // Load per-user stats (chart + per-key breakdown)
    await loadUserStats(userId);
  } catch (e) {
    console.error('Failed to load user detail', e);
  }
}

let userUsageChart = null;

async function loadUserStats(userId) {
  try {
    const stats = await apiFetch(`/users/${userId}/stats?days=30`);

    // Update overview cards with richer data
    document.getElementById('detail-calls').textContent = fmt(stats.overview.totalCalls);

    // Per-key breakdown table
    const pkTbody = document.getElementById('detail-perkey-tbody');
    pkTbody.innerHTML = '';
    for (const k of stats.keys) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(k.provider)}</td>
        <td>${esc(k.label)}</td>
        <td>${fmt(k.callsToday)}</td>
        <td>${fmt(k.callsThisMonth)}</td>
        <td class="${k.errorsThisMonth > 0 ? 'text-amber-400' : 'text-gray-500'}">${fmt(k.errorsThisMonth)}</td>
        <td class="text-gray-500 text-xs">${k.lastUsed ? fmtTime(k.lastUsed) : 'never'}</td>
      `;
      pkTbody.appendChild(tr);
    }

    // Usage chart
    if (userUsageChart) userUsageChart.destroy();
    const ctx = document.getElementById('user-usage-chart').getContext('2d');
    userUsageChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: stats.usage.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'Calls',
            data: stats.usage.map(d => d.calls),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99,102,241,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: 'Errors',
            data: stats.usage.map(d => d.errors),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#64748b', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#475569', font: { size: 10 } }, grid: { color: '#1e1e2e' } },
          y: { beginAtZero: true, ticks: { color: '#475569', font: { size: 10 } }, grid: { color: '#1e1e2e' } },
        },
      },
    });
  } catch (e) {
    console.error('Failed to load user stats', e);
  }
}

function closeUserDetail() {
  document.getElementById('user-detail').classList.add('hidden');
  document.getElementById('tab-users').classList.remove('hidden');
  currentUserId = null;
}

// ─── User logs ───────────────────────────────────────────────────
let userLogsCurrentPage = 1;

async function loadUserLogs(userId, page) {
  userLogsCurrentPage = page;
  document.getElementById('user-logs-panel').classList.remove('hidden');
  try {
    const data = await apiFetch(`/users/${userId}/logs?page=${page}&limit=100`);
    const tbody = document.getElementById('user-logs-tbody');
    tbody.innerHTML = '';

    for (const log of data.logs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-gray-500 text-xs">${fmtTime(log.timestamp)}</td>
        <td>${esc(log.keySlot?.provider || '-')}</td>
        <td>${esc(log.action)}</td>
        <td class="mono text-xs">${esc(truncate(log.appId, 20))}</td>
        <td class="text-xs text-gray-500">${esc(truncate(log.metadata || '', 60))}</td>
      `;
      tbody.appendChild(tr);
    }

    const totalPages = Math.ceil(data.total / data.limit) || 1;
    document.getElementById('ulogs-page-info').textContent = `Page ${page} of ${totalPages} (${data.total} logs)`;
    document.getElementById('ulogs-prev').disabled = page <= 1;
    document.getElementById('ulogs-next').disabled = page >= totalPages;
  } catch (e) {
    console.error('Failed to load user logs', e);
  }
}

function userLogsPage(delta) {
  loadUserLogs(currentUserId, userLogsCurrentPage + delta);
}

// ─── Global logs ─────────────────────────────────────────────────
let globalLogsCurrentPage = 1;

async function loadGlobalLogs(page) {
  globalLogsCurrentPage = page;
  try {
    const action = document.getElementById('log-action-filter').value;
    const params = new URLSearchParams({ page: String(page), limit: '100' });
    if (action) params.set('action', action);

    const data = await apiFetch(`/logs?${params}`);
    const tbody = document.getElementById('logs-tbody');
    tbody.innerHTML = '';

    for (const log of data.logs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-gray-500 text-xs">${fmtTime(log.timestamp)}</td>
        <td class="mono text-xs">${esc(log.keySlot?.user?.email || '-')}</td>
        <td>${esc(log.keySlot?.provider || '-')}</td>
        <td>${esc(log.action)}</td>
        <td class="mono text-xs">${esc(truncate(log.appId, 20))}</td>
        <td class="text-xs text-gray-500">${esc(truncate(log.metadata || '', 50))}</td>
      `;
      tbody.appendChild(tr);
    }

    const totalPages = Math.ceil(data.total / data.limit) || 1;
    document.getElementById('log-count').textContent = `${data.total} logs`;
    document.getElementById('logs-page-info').textContent = `Page ${page} of ${totalPages}`;
    document.getElementById('logs-prev').disabled = page <= 1;
    document.getElementById('logs-next').disabled = page >= totalPages;
  } catch (e) {
    console.error('Failed to load global logs', e);
  }
}

function globalLogsPage(delta) {
  loadGlobalLogs(globalLogsCurrentPage + delta);
}

// ─── Ban ─────────────────────────────────────────────────────────
function confirmBan() {
  document.getElementById('ban-modal-email').textContent = currentUserEmail;
  document.getElementById('ban-modal').classList.remove('hidden');
}

function closeBanModal() {
  document.getElementById('ban-modal').classList.add('hidden');
}

async function executeBan() {
  try {
    await apiFetch(`/users/${currentUserId}/ban`, { method: 'POST' });
    closeBanModal();
    await openUserDetail(currentUserId);
    await loadStats();
  } catch (e) {
    console.error('Ban failed', e);
    alert('Ban failed. Check console.');
  }
}

// ─── Delete ───────────────────────────────────────────────────────
function confirmDelete() {
  document.getElementById('delete-modal-email').textContent = currentUserEmail;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
}

async function executeDelete() {
  try {
    await apiFetch(`/users/${currentUserId}`, { method: 'DELETE' });
    closeDeleteModal();
    closeUserDetail();
    await loadStats();
    await loadUsers(usersCurrentPage);
  } catch (e) {
    console.error('Delete failed', e);
    alert('Delete failed: ' + e.message);
  }
}

// ─── Change tier ──────────────────────────────────────────────────
async function changeTier() {
  const newTier = document.getElementById('detail-tier-select').value;
  try {
    await apiFetch(`/users/${currentUserId}/tier`, {
      method: 'PUT',
      body: JSON.stringify({ tier: newTier }),
    });
    await openUserDetail(currentUserId);
    await loadStats();
  } catch (e) {
    console.error('Tier change failed', e);
    alert('Tier change failed. Check console.');
  }
}

// ─── Analytics ──────────────────────────────────────────────────
let trafficChartInstance = null;
let signupsChartInstance = null;
let analyticsDays = 30;

function setAnalyticsDays(days) {
  analyticsDays = days;
  document.querySelectorAll('.analytics-range-btn').forEach(btn => {
    const isActive = parseInt(btn.dataset.days) === days;
    btn.className = `analytics-range-btn px-2.5 py-1 text-[10px] rounded-md border transition ${isActive ? 'border-indigo-500/40 text-indigo-400' : 'border-[#1e1e2e] text-gray-500 hover:text-white hover:border-indigo-500/40'}`;
  });
  loadAnalytics();
}

async function loadAnalytics() {
  try {
    const days = analyticsDays;
    const [overview, traffic, signups, pages, referrers, countries] = await Promise.all([
      apiFetch('/analytics/overview'),
      apiFetch(`/analytics/traffic?days=${days}`),
      apiFetch(`/analytics/signups?days=${days}`),
      apiFetch(`/analytics/pages?days=${days}`),
      apiFetch(`/analytics/referrers?days=${days}`),
      apiFetch(`/analytics/countries?days=${days}`),
    ]);

    // Overview cards
    document.getElementById('a-views-today').textContent = overview.viewsToday.toLocaleString();
    document.getElementById('a-visitors-today').textContent = overview.visitorsToday.toLocaleString();
    document.getElementById('a-ips-today').textContent = (overview.uniqueIpsToday ?? 0).toLocaleString();
    document.getElementById('a-views-week').textContent = overview.viewsWeek.toLocaleString();
    document.getElementById('a-signups-week').textContent = overview.signupsWeek.toLocaleString();
    document.getElementById('a-signups-today').textContent = overview.signupsToday.toLocaleString();
    document.getElementById('a-total-users').textContent = overview.totalUsers.toLocaleString();

    // Range-specific stats
    const totalViews = traffic.traffic.reduce((sum, d) => sum + d.views, 0);
    const totalSignups = signups.signups.reduce((sum, d) => sum + d.count, 0);
    const totalVisitors = traffic.traffic.reduce((sum, d) => sum + d.visitors, 0);
    document.getElementById('a-views-range').textContent = totalViews.toLocaleString();
    document.getElementById('a-views-range-label').textContent = `Views (${days}d)`;
    document.getElementById('a-signups-range').textContent = totalSignups.toLocaleString();
    document.getElementById('a-signups-range-label').textContent = `Signups (${days}d)`;

    // Computed metrics
    const convRate = totalVisitors > 0 ? ((totalSignups / totalVisitors) * 100).toFixed(1) + '%' : '-';
    const avgViews = days > 0 ? Math.round(totalViews / days).toLocaleString() : '-';
    const avgSignups = days > 0 ? (totalSignups / days).toFixed(1) : '-';
    const pagesPerVisitor = totalVisitors > 0 ? (totalViews / totalVisitors).toFixed(1) : '-';
    document.getElementById('a-conversion').textContent = convRate;
    document.getElementById('a-avg-views').textContent = avgViews;
    document.getElementById('a-avg-signups').textContent = avgSignups;
    document.getElementById('a-bounce-est').textContent = pagesPerVisitor;

    // Chart titles
    document.getElementById('a-traffic-title').textContent = `Traffic (${days} days)`;
    document.getElementById('a-signups-title').textContent = `Signups (${days} days)`;

    // Traffic chart
    if (trafficChartInstance) trafficChartInstance.destroy();
    const tCtx = document.getElementById('trafficChart').getContext('2d');
    trafficChartInstance = new Chart(tCtx, {
      type: 'line',
      data: {
        labels: traffic.traffic.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'Page Views',
            data: traffic.traffic.map(d => d.views),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99,102,241,0.1)',
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Unique Visitors',
            data: traffic.traffic.map(d => d.visitors),
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,0.1)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9ca3af' } } },
        scales: {
          x: { ticks: { color: '#6b7280' }, grid: { color: '#1e1e2e' } },
          y: { ticks: { color: '#6b7280' }, grid: { color: '#1e1e2e' }, beginAtZero: true },
        },
      },
    });

    // Signups chart
    if (signupsChartInstance) signupsChartInstance.destroy();
    const sCtx = document.getElementById('signupsChart').getContext('2d');
    signupsChartInstance = new Chart(sCtx, {
      type: 'bar',
      data: {
        labels: signups.signups.map(d => d.date.slice(5)),
        datasets: [{
          label: 'Signups',
          data: signups.signups.map(d => d.count),
          backgroundColor: '#6366f1',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9ca3af' } } },
        scales: {
          x: { ticks: { color: '#6b7280' }, grid: { color: '#1e1e2e' } },
          y: { ticks: { color: '#6b7280', stepSize: 1 }, grid: { color: '#1e1e2e' }, beginAtZero: true },
        },
      },
    });

    // Top pages table
    const pTbody = document.getElementById('a-pages-tbody');
    pTbody.innerHTML = '';
    for (const p of pages.pages) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="text-xs">${esc(p.page)}</td><td>${p.views}</td>`;
      pTbody.appendChild(tr);
    }

    // Referrers table (grouped by domain)
    const rTbody = document.getElementById('a-referrers-tbody');
    rTbody.innerHTML = '';
    if (!referrers.referrers || referrers.referrers.length === 0) {
      rTbody.innerHTML = '<tr><td colspan="2" class="text-gray-600 text-xs">No referrer data yet</td></tr>';
    } else {
      for (const r of referrers.referrers) {
        const tr = document.createElement('tr');
        const label = r.referrer === '(direct)' ? '<span class="text-gray-500">(direct)</span>' : esc(r.referrer);
        tr.innerHTML = `<td class="text-xs">${label}</td><td>${r.count}</td>`;
        rTbody.appendChild(tr);
      }
    }

    // Countries table
    const cTbody = document.getElementById('a-countries-tbody');
    cTbody.innerHTML = '';
    const countryNames = { US:'United States', GB:'United Kingdom', CA:'Canada', AU:'Australia', DE:'Germany', FR:'France', IN:'India', BR:'Brazil', NL:'Netherlands', JP:'Japan', SG:'Singapore', PL:'Poland', SE:'Sweden', ES:'Spain', MX:'Mexico', IT:'Italy', CH:'Switzerland', KR:'South Korea', PT:'Portugal', RU:'Russia', PK:'Pakistan', NG:'Nigeria', ZA:'South Africa', AR:'Argentina', ID:'Indonesia', TR:'Turkey', UA:'Ukraine', GH:'Ghana', CN:'China', TW:'Taiwan', HK:'Hong Kong', NZ:'New Zealand', IE:'Ireland', FI:'Finland', NO:'Norway', DK:'Denmark', BE:'Belgium', AT:'Austria', CZ:'Czech Republic', RO:'Romania', PH:'Philippines', VN:'Vietnam', TH:'Thailand', MY:'Malaysia', IL:'Israel', SA:'Saudi Arabia', AE:'UAE', EG:'Egypt', KE:'Kenya', CO:'Colombia', CL:'Chile', PE:'Peru' };
    const flagEmoji = c => c.toUpperCase().replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt()));
    if (!countries.countries || countries.countries.length === 0) {
      cTbody.innerHTML = '<tr><td colspan="2" class="text-gray-600 text-xs">No country data yet</td></tr>';
    } else {
      for (const c of countries.countries) {
        const tr = document.createElement('tr');
        const name = countryNames[c.country] || c.country;
        const flag = flagEmoji(c.country);
        tr.innerHTML = `<td class="text-xs">${flag} ${esc(name)}</td><td>${c.count}</td>`;
        cTbody.appendChild(tr);
      }
    }
    // Security probes
    try {
      const probeData = await apiFetch('/security/probes');
      const tbody = document.getElementById('a-probes-tbody');
      const emptyMsg = document.getElementById('a-probes-empty');
      const countEl = document.getElementById('a-probes-count');
      tbody.innerHTML = '';
      if (probeData.probes && probeData.probes.length > 0) {
        emptyMsg.style.display = 'none';
        countEl.textContent = probeData.probes.length + ' detected';
        for (const p of probeData.probes) {
          const tr = document.createElement('tr');
          const typeColor = p.probeType === 'xss' ? 'text-red-400' : p.probeType === 'ssrf' ? 'text-amber-400' : 'text-gray-400';
          tr.innerHTML = `
            <td class="text-gray-500 text-xs">${fmtDate(p.createdAt)}</td>
            <td><span class="${typeColor} text-xs font-bold uppercase">${esc(p.probeType)}</span></td>
            <td class="mono text-xs">${esc(p.ip)}</td>
            <td class="text-xs text-red-300 max-w-[200px] truncate" title="${esc(p.referrer)}">${esc(p.referrer || '-')}</td>
            <td class="text-xs text-gray-500">${esc(p.page || '-')}</td>
            <td class="text-xs text-gray-600 max-w-[150px] truncate" title="${esc(p.userAgent)}">${esc(p.userAgent || '-')}</td>
          `;
          tbody.appendChild(tr);
        }
      } else {
        emptyMsg.style.display = '';
        countEl.textContent = '';
      }
    } catch {}

  } catch (e) {
    console.error('Failed to load analytics', e);
  }
}

// ─── Analytics v2 (GA-style sub-tabs) ───────────────────────────
let overviewPollInterval = null;

function switchAnalyticsSubtab(name) {
  // Stop any ongoing poll
  if (overviewPollInterval) {
    clearInterval(overviewPollInterval);
    overviewPollInterval = null;
  }

  // Toggle panels
  document.querySelectorAll('.analytics-subpanel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('subpanel-' + name);
  if (panel) panel.classList.remove('hidden');

  // Toggle tab active state
  document.querySelectorAll('.analytics-subtab').forEach(t => t.classList.remove('active'));
  const tabEl = document.querySelector('[data-subtab="' + name + '"]');
  if (tabEl) tabEl.classList.add('active');

  // Load data for the selected tab
  if (name === 'overview') {
    loadOverviewV2();
    overviewPollInterval = setInterval(loadOverviewV2, 30000);
  } else if (name === 'funnel') {
    loadFunnel();
  } else if (name === 'investor') {
    loadInvestor();
  } else if (name === 'devices') {
    loadDevices();
  }
}

async function loadOverviewV2() {
  try {
    const data = await apiFetch('/analytics/overview-v2');
    document.getElementById('ov2-visitors').textContent = (data.visitors ?? 0).toLocaleString();
    document.getElementById('ov2-ips').textContent = (data.uniqueIps ?? 0).toLocaleString();
    document.getElementById('ov2-sessions').textContent = (data.sessions ?? 0).toLocaleString();
    document.getElementById('ov2-pageviews').textContent = (data.pageviews ?? 0).toLocaleString();
    document.getElementById('ov2-signups').textContent = (data.signups ?? 0).toLocaleString();
    document.getElementById('ov2-bounce').textContent = (data.bounceRate ?? 0) + '%';
    document.getElementById('ov2-duration').textContent = (data.avgSessionDurationS ?? 0) + 's';
    document.getElementById('ov2-active').textContent = (data.activeNow ?? 0).toLocaleString();
    document.getElementById('ov2-proxy').textContent = (data.proxyCallsToday ?? 0).toLocaleString();
    document.getElementById('ov2-keys').textContent = (data.keysStoredToday ?? 0).toLocaleString();
    document.getElementById('ov2-timestamp').textContent = new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Failed to load overview v2:', e);
  }
}

async function loadFunnel() {
  try {
    const days = 30;
    document.getElementById('funnel-days').textContent = days;
    const { funnel } = await apiFetch('/analytics/funnel?days=' + days);
    const container = document.getElementById('funnel-bars');
    if (!funnel || funnel.length === 0) {
      container.innerHTML = '<div class="text-xs text-gray-500">No funnel data yet.</div>';
      return;
    }
    const maxCount = funnel[0]?.count || 1;
    container.innerHTML = funnel.map((step, i) => {
      const pct = maxCount > 0 ? (step.count / maxCount * 100) : 0;
      const dropoff = i > 0 && funnel[i - 1].count > 0
        ? Math.round((1 - step.count / funnel[i - 1].count) * 100) + '% drop'
        : '';
      return '<div class="mb-3"><div class="flex justify-between text-xs mb-1"><span>' + esc(step.step) + '</span><span class="text-gray-400">' + step.count.toLocaleString() + (dropoff ? ' (' + dropoff + ')' : '') + '</span></div><div class="w-full bg-gray-800 rounded h-6"><div class="rounded h-6" style="width:' + pct + '%;background:#6366f1"></div></div></div>';
    }).join('');
  } catch (e) {
    console.error('Failed to load funnel:', e);
  }
}

async function loadInvestor() {
  try {
    const data = await apiFetch('/analytics/investor');
    document.getElementById('inv-total').textContent = (data.totalUsers ?? 0).toLocaleString();
    document.getElementById('inv-activated').textContent = (data.activatedUsers ?? 0).toLocaleString();
    document.getElementById('inv-activation-rate').textContent = (data.activationRate ?? 0) + '%';
    document.getElementById('inv-dau').textContent = (data.dau ?? 0).toLocaleString();
    document.getElementById('inv-wau').textContent = (data.wau ?? 0).toLocaleString();
    document.getElementById('inv-mau').textContent = (data.mau ?? 0).toLocaleString();
    document.getElementById('inv-stickiness').textContent = (data.dauMauRatio ?? 0) + '%';
    document.getElementById('inv-mrr').textContent = '$' + (data.mrr ?? 0);
    document.getElementById('inv-conversion').textContent = (data.conversionRate ?? 0) + '%';
    document.getElementById('inv-activation-time').textContent = data.medianActivationHrs !== null && data.medianActivationHrs !== undefined ? data.medianActivationHrs + 'h' : 'N/A';
    document.getElementById('inv-churn').textContent = (data.churnRate ?? 0) + '%';
    document.getElementById('inv-proxy-total').textContent = (data.proxyCallsTotal ?? 0).toLocaleString();
    document.getElementById('inv-api-per-user').textContent = (data.apiCallsPerActiveUser ?? 0).toLocaleString();

    const retData = await apiFetch('/analytics/retention');
    if (retData.cohorts && retData.cohorts.length > 0) {
      renderRetentionHeatmap(retData.cohorts);
    } else {
      document.getElementById('retention-heatmap').innerHTML = '<div class="text-xs text-gray-500">No cohort data yet — populates after the daily cron runs at 00:05 UTC.</div>';
    }
  } catch (e) {
    console.error('Failed to load investor metrics:', e);
  }
}

function renderRetentionHeatmap(cohorts) {
  const weeks = {};
  for (const c of cohorts) {
    if (!weeks[c.cohort_week]) weeks[c.cohort_week] = { size: c.cohort_size, weeks: {} };
    weeks[c.cohort_week].weeks[c.week_number] = c.active_count;
  }

  const cohortWeeks = Object.keys(weeks).sort();
  const maxWeekNum = Math.max(...cohorts.map(c => c.week_number), 0);
  const numCols = Math.min(maxWeekNum + 1, 12);

  let html = '<table><thead><tr><th>Cohort</th><th>Size</th>';
  for (let w = 0; w < numCols; w++) html += '<th>W' + w + '</th>';
  html += '</tr></thead><tbody>';

  for (const week of cohortWeeks.slice(-12)) {
    const c = weeks[week];
    html += '<tr><td class="mono text-xs">' + esc(week) + '</td><td>' + c.size + '</td>';
    for (let w = 0; w < numCols; w++) {
      const active = c.weeks[w] ?? 0;
      const pct = c.size > 0 ? Math.round(active / c.size * 100) : 0;
      const intensity = Math.min(pct / 100, 1);
      const bg = 'rgba(99,102,241,' + (0.1 + intensity * 0.7) + ')';
      html += '<td style="background:' + bg + ';text-align:center;font-size:11px">' + pct + '%</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('retention-heatmap').innerHTML = html;
}

async function loadDevices() {
  try {
    const days = 30;
    const data = await apiFetch('/analytics/devices?days=' + days);

    function renderPieList(containerId, items) {
      const list = items || [];
      const total = list.reduce((s, i) => s + i.count, 0);
      const el = document.getElementById(containerId);
      if (list.length === 0) {
        el.innerHTML = '<div class="text-xs text-gray-500">No data yet.</div>';
        return;
      }
      el.innerHTML = list.map(i => {
        const pct = total > 0 ? Math.round(i.count / total * 100) : 0;
        return '<div class="flex justify-between text-sm py-1"><span>' + esc(i.name) + '</span><span class="text-gray-400">' + pct + '% (' + i.count + ')</span></div>';
      }).join('');
    }

    renderPieList('devices-list', data.devices);
    renderPieList('browsers-list', data.browsers);
    renderPieList('oses-list', data.oses);
  } catch (e) {
    console.error('Failed to load devices:', e);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function fmt(n) {
  return Number(n).toLocaleString();
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
         dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '...' : s;
}

// ─── Monitoring Tab ─────────────────────────────────────────────
let monLogsCurrentPage = 1;
let monLogSearchTerm = '';
let monLogSearchTimeout = null;

function debounceMonLogSearch() {
  clearTimeout(monLogSearchTimeout);
  monLogSearchTimeout = setTimeout(() => {
    monLogSearchTerm = document.getElementById('mon-log-search').value.trim();
    loadMonitoringLogs(1);
  }, 300);
}

async function loadMonitoring() {
  await Promise.all([
    loadMonitoringDashboard(),
    loadMonitoringLogs(1),
    loadMonitoringAlerts(),
  ]);
}

async function loadMonitoringDashboard() {
  try {
    const data = await apiFetch('/monitoring/dashboard');

    document.getElementById('mon-active-24h').textContent = fmt(data.activeUsers24h);
    document.getElementById('mon-active-7d').textContent = fmt(data.activeUsers7d);
    document.getElementById('mon-active-30d').textContent = fmt(data.activeUsers30d);
    document.getElementById('mon-error-rate').textContent = data.errorRate + '%';
    document.getElementById('mon-calls-today').textContent = fmt(data.callsToday);
    document.getElementById('mon-calls-week').textContent = fmt(data.callsWeek);
    document.getElementById('mon-calls-month').textContent = fmt(data.callsMonth);
    document.getElementById('mon-near-limit').textContent = fmt(data.usersNearLimit);

    // Top endpoints
    const eTbody = document.getElementById('mon-endpoints-tbody');
    eTbody.innerHTML = '';
    if (!data.topEndpoints || data.topEndpoints.length === 0) {
      eTbody.innerHTML = '<tr><td colspan="3" class="text-gray-600 text-xs text-center py-4">No endpoint data yet</td></tr>';
    } else {
      for (const ep of data.topEndpoints) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${esc(ep.provider)}</td>
          <td class="mono text-xs">${esc(ep.endpoint)}</td>
          <td>${fmt(ep.count)}</td>
        `;
        eTbody.appendChild(tr);
      }
    }
  } catch (e) {
    console.error('Failed to load monitoring dashboard', e);
  }
}

async function loadMonitoringLogs(page) {
  monLogsCurrentPage = page;
  try {
    const params = new URLSearchParams({ page: String(page), limit: '25', action: 'transparent_proxy' });
    if (monLogSearchTerm) params.set('search', monLogSearchTerm);
    const statusFilter = document.getElementById('mon-log-status').value;
    if (statusFilter) params.set('status_filter', statusFilter);

    const data = await apiFetch(`/logs?${params}`);
    const tbody = document.getElementById('mon-logs-tbody');
    tbody.innerHTML = '';

    for (const log of data.logs) {
      let meta = {};
      try { meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata || {}); } catch {}

      const statusCode = meta.status_code || '-';
      const latency = meta.latency_ms != null ? meta.latency_ms + 'ms' : '-';
      const endpoint = meta.endpoint || '-';
      const statusClass = statusCode >= 400 ? 'text-amber-400' : statusCode >= 200 && statusCode < 300 ? 'text-green-400' : 'text-gray-400';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-gray-500 text-xs">${fmtTime(log.timestamp)}</td>
        <td class="mono text-xs">${esc(log.keySlot?.user?.email || '-')}</td>
        <td class="text-xs">${esc(log.keySlot?.label || log.keySlot?.provider || '-')}</td>
        <td class="mono text-xs">${esc(truncate(endpoint, 40))}</td>
        <td class="${statusClass} text-xs font-semibold">${statusCode}</td>
        <td class="text-xs text-gray-500">${latency}</td>
      `;
      tbody.appendChild(tr);
    }

    const totalPages = Math.ceil(data.total / 25) || 1;
    document.getElementById('mon-log-count').textContent = `${data.total} logs`;
    document.getElementById('mon-logs-page-info').textContent = `Page ${page} of ${totalPages}`;
    document.getElementById('mon-logs-prev').disabled = page <= 1;
    document.getElementById('mon-logs-next').disabled = page >= totalPages;
  } catch (e) {
    console.error('Failed to load monitoring logs', e);
  }
}

function monLogsPage(delta) {
  loadMonitoringLogs(monLogsCurrentPage + delta);
}

async function loadMonitoringAlerts() {
  try {
    const data = await apiFetch('/monitoring/alerts');
    const tbody = document.getElementById('mon-alerts-tbody');
    tbody.innerHTML = '';

    if (!data.alerts || data.alerts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-gray-600 text-xs text-center py-4">No alerts yet</td></tr>';
      return;
    }

    for (const a of data.alerts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-gray-500 text-xs">${fmtTime(a.created_at)}</td>
        <td class="text-xs">${esc(a.repo_full_name)}</td>
        <td>${esc(a.provider)}</td>
        <td class="mono text-xs">${esc(truncate(a.file, 40))}</td>
        <td class="mono text-xs text-gray-500">${esc(a.masked_value || '-')}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error('Failed to load monitoring alerts', e);
  }
}

// ─── Tests Tab ──────────────────────────────────────────────────

async function loadTests() {
  await loadTestSettings();
  await loadTestResults();
}

async function loadTestSettings() {
  try {
    const s = await apiFetch('/test-settings');
    document.getElementById('test-enabled').checked = s.enabled;
    const sel = document.getElementById('test-cron-hour');
    sel.innerHTML = '';
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = String(h).padStart(2, '0') + ':00';
      if (h === s.cronHour) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.error('Failed to load test settings', e);
  }
}

async function saveTestSettings() {
  try {
    await apiFetch('/test-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: document.getElementById('test-enabled').checked,
        cronHour: parseInt(document.getElementById('test-cron-hour').value),
      }),
    });
  } catch (e) {
    console.error('Failed to save test settings', e);
  }
}

async function loadTestResults() {
  try {
    const { runs } = await apiFetch('/test-results?limit=50');
    const tbody = document.getElementById('test-runs-tbody');
    tbody.innerHTML = '';

    if (!runs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500 py-6">No test runs yet</td></tr>';
      return;
    }

    // Stats
    const last30 = runs.filter(r => new Date(r.startedAt) > new Date(Date.now() - 30*86400000));
    const passedRuns = last30.filter(r => r.status === 'passed');
    const lastRun = runs[0];

    document.getElementById('test-last-status').innerHTML =
      lastRun.status === 'passed'
        ? '<span style="color:#4ade80">PASSED</span>'
        : '<span style="color:#f87171">FAILED</span>';
    document.getElementById('test-pass-rate').textContent =
      last30.length ? Math.round(passedRuns.length / last30.length * 100) + '%' : '-';
    document.getElementById('test-total-runs').textContent = fmt(last30.length);
    const avgMs = last30.filter(r => r.durationMs).reduce((a, r) => a + r.durationMs, 0) / (last30.filter(r => r.durationMs).length || 1);
    document.getElementById('test-avg-duration').textContent = avgMs ? Math.round(avgMs / 1000) + 's' : '-';

    // Check for stale running records (older than 10 min = stuck)
    var staleRuns = runs.filter(r => r.status === 'running' && (Date.now() - new Date(r.startedAt).getTime()) > 600000);
    if (staleRuns.length > 0) {
      document.getElementById('test-cleanup-btn').classList.remove('hidden');
    } else {
      document.getElementById('test-cleanup-btn').classList.add('hidden');
    }

    // If there's an active (non-stale) running test, show stop/cancel
    var activeRun = runs.find(r => r.status === 'running' && (Date.now() - new Date(r.startedAt).getTime()) <= 600000);
    if (activeRun) {
      activeTestRunId = activeRun.id;
      setTestButtons('running');
    }

    // Table rows
    runs.forEach(r => {
      const statusBadge = r.status === 'passed'
        ? '<span class="badge" style="background:rgba(74,222,128,0.15);color:#4ade80">PASSED</span>'
        : r.status === 'running'
        ? '<span class="badge" style="background:rgba(250,204,21,0.15);color:#facc15">RUNNING</span>'
        : '<span class="badge" style="background:rgba(248,113,113,0.15);color:#f87171">FAILED</span>';
      const dur = r.durationMs ? Math.round(r.durationMs / 1000) + 's' : '-';
      const hasFails = r.failures && r.status === 'failed';
      const rowClick = hasFails ? `onclick="showFailures('${esc(r.failures)}')" style="cursor:pointer"` : '';
      tbody.innerHTML += `<tr ${rowClick}>
        <td>${statusBadge}</td>
        <td>${r.total}</td>
        <td style="color:#4ade80">${r.passed}</td>
        <td style="color:${r.failed > 0 ? '#f87171' : '#64748b'}">${r.failed}</td>
        <td class="mono">${dur}</td>
        <td>${esc(r.triggeredBy)}</td>
        <td>${fmtTime(r.startedAt)}</td>
      </tr>`;
    });
  } catch (e) {
    console.error('Failed to load test results', e);
  }
}

function showFailures(failuresJson) {
  try {
    const failures = JSON.parse(failuresJson);
    const output = failures.map(f => `FAIL: ${f.name}\n  ${f.error}`).join('\n\n');
    document.getElementById('test-failure-output').textContent = output;
    document.getElementById('test-failures').classList.remove('hidden');
  } catch {
    document.getElementById('test-failures').classList.add('hidden');
  }
}

var activeTestRunId = null;
var testPollInterval = null;

function setTestButtons(state) {
  var startBtn = document.getElementById('test-start-btn');
  var stopBtn = document.getElementById('test-stop-btn');
  var cancelBtn = document.getElementById('test-cancel-btn');
  if (state === 'running') {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
  } else {
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
  }
}

async function triggerTestRun() {
  try {
    var { id } = await apiFetch('/run-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggeredBy: 'manual' }),
    });
    activeTestRunId = id;
    setTestButtons('running');
    await loadTestResults();
    if (id) pollTestRun(id);
  } catch (e) {
    console.error('Failed to trigger test run', e);
  }
}

async function stopTestRun() {
  if (!activeTestRunId) return;
  try {
    await apiFetch('/stop-tests/' + activeTestRunId, { method: 'POST' });
  } catch (e) {
    console.error('Failed to stop test run', e);
  }
  clearTestPoll();
  await loadTestResults();
}

async function cancelTestRun() {
  if (!activeTestRunId) return;
  try {
    await apiFetch('/cancel-tests/' + activeTestRunId, { method: 'POST' });
  } catch (e) {
    console.error('Failed to cancel test run', e);
  }
  clearTestPoll();
  await loadTestResults();
}

function clearTestPoll() {
  if (testPollInterval) clearInterval(testPollInterval);
  testPollInterval = null;
  activeTestRunId = null;
  setTestButtons('idle');
}

async function cleanupStaleRuns() {
  try {
    await apiFetch('/cleanup-test-runs', { method: 'POST' });
    document.getElementById('test-cleanup-btn').classList.add('hidden');
    await loadTestResults();
  } catch (e) {
    console.error('Failed to clean up stale runs', e);
  }
}

function pollTestRun(runId) {
  testPollInterval = setInterval(async function() {
    try {
      var { runs } = await apiFetch('/test-results?limit=1');
      if (runs[0] && runs[0].id === runId && runs[0].status !== 'running') {
        clearTestPoll();
        await loadTestResults();
      }
    } catch { clearTestPoll(); }
  }, 5000);
}
