(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let currentOrganizationId = null;
  let availableOrganizations = [];
  let currentMembersPayload = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function setMessage(id, text, tone) {
    const el = $(id);
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.className = 'form-msg hidden';
      return;
    }
    el.textContent = text;
    el.className = `form-msg ${tone || ''}`.trim();
  }
  function setExportMessage(text, tone) {
    const el = $('membersExportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `action-msg${tone ? ` ${tone}` : ''}`;
  }
  function toast(message, tone) {
    if (!message || !window.VaultproofToast || typeof window.VaultproofToast.show !== 'function') return;
    const mappedTone = tone === 'success' ? 'ok' : tone === 'error' ? 'danger' : (tone || 'neutral');
    window.VaultproofToast.show(message, mappedTone, 'Members');
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function formatNum(value) {
    const num = Number(value || 0);
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}k`;
    return num.toLocaleString('en-US');
  }
  function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  function relTime(value) {
    if (!value) return '—';
    const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  function unwrapPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (data.data && typeof data.data === 'object') return unwrapPayload(data.data);
    if (data.result && typeof data.result === 'object') return unwrapPayload(data.result);
    return data;
  }
  function slugify(value) {
    return String(value || 'members')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'members';
  }
  function csvEscape(value) {
    const stringValue = String(value == null ? '' : value);
    return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  }
  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  async function copyText(content) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  }
  function extractRefreshToken(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try { return extractRefreshToken(JSON.parse(value)); } catch { return null; }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = extractRefreshToken(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === 'object') {
      if (typeof value.refresh_token === 'string' && value.refresh_token) return value.refresh_token;
      for (const key in value) {
        const found = extractRefreshToken(value[key]);
        if (found) return found;
      }
    }
    return null;
  }
  function getStoredRefreshToken() {
    return localStorage.getItem('vaultproof_refresh_token') || extractRefreshToken(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  }
  async function tryRefreshToken() {
    if (refreshPromise) return refreshPromise;
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return false;

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => null);
        if (!data?.token) return false;
        token = data.token;
        localStorage.setItem('vaultproof_token', data.token);
        if (data.refreshToken) localStorage.setItem('vaultproof_refresh_token', data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }
  function getRequestedOrganizationId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('org') || localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
  }
  function persistOrganizationSelection(orgId) {
    currentOrganizationId = orgId || null;
    if (currentOrganizationId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrganizationId);
    else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  }
  function syncOrganizationUrl(orgId) {
    const params = new URLSearchParams(window.location.search);
    if (orgId) params.set('org', orgId);
    else params.delete('org');
    const next = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', next);
  }
  function chooseOrganization(orgs, activeOrganizationId) {
    const requestedId = getRequestedOrganizationId();
    const requested = orgs.find((org) => org.id === requestedId) || null;
    if (requested) return requested;
    const active = orgs.find((org) => org.id === activeOrganizationId) || null;
    if (active && active.kind !== 'personal') return active;
    const shared = orgs.find((org) => org.kind && org.kind !== 'personal') || null;
    if (shared) return shared;
    return active || orgs[0] || null;
  }
  function renderOrganizationSelector() {
    const select = $('orgSelect');
    const status = $('orgSwitcherStatus');
    if (!select) return;
    if (!availableOrganizations.length) {
      select.innerHTML = '<option value="">No orgs available</option>';
      select.disabled = true;
      if (status) status.textContent = 'No org loaded';
      return;
    }
    select.innerHTML = availableOrganizations.map((org) => {
      const suffix = org.kind === 'personal' ? 'solo' : org.role;
      return `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)} · ${escapeHtml(suffix)}</option>`;
    }).join('');
    select.disabled = false;
    select.value = currentOrganizationId || availableOrganizations[0].id;
    const current = availableOrganizations.find((org) => org.id === select.value) || null;
    if (status) status.textContent = current ? `${current.kind === 'personal' ? 'solo workspace' : 'shared org'}` : 'Org loading…';
  }
  async function apiFetch(base, path, options) {
    const opts = options || {};
    try {
      const res = await fetch(`${base}${path}`, {
        cache: 'no-store',
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(opts.includeOrganization !== false && currentOrganizationId ? { 'x-vaultproof-organization': currentOrganizationId } : {}),
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      });
      if (res.status === 401) {
        if (!refreshAttempted) {
          refreshAttempted = true;
          const refreshed = await tryRefreshToken();
          if (refreshed) return apiFetch(base, path, opts);
        }
        refreshAttempted = false;
        window.location.href = 'login';
        return null;
      }
      refreshAttempted = false;
      const data = await res.json().catch(() => null);
      return {
        ok: res.ok,
        status: res.status,
        data,
      };
    } catch {
      return null;
    }
  }
  function logout() {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('vaultproof_') || key.startsWith('sb-') || key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
    window.location.replace('/app/login?logout=1');
  }
  function renderUsageBox(membersPayload) {
    const members = membersPayload?.members || [];
    const org = membersPayload?.organization || null;
    const used = members.length;
    const cap = org?.kind === 'team' ? 25 : 5;
    const percent = Math.max(6, Math.min(100, cap ? (used / cap) * 100 : 0));
    setText('usagePlanLabel', org?.kind === 'team' ? 'team access' : 'solo access');
    setText('usageMetricLabel', 'members');
    setText('usageMetricValue', `${used}`);
    const bar = $('usageBarFill');
    if (bar) bar.style.width = `${percent}%`;
    setText('usageMetricNote', `${(membersPayload?.projects || []).length} project scopes available`);
  }
  function setManageVisibility(membersPayload) {
    const canManage = Boolean(membersPayload?.organization?.can_manage_members);
    const invitePanel = $('invitePanel');
    if (invitePanel) invitePanel.classList.toggle('hidden', !canManage);
  }
  function renderKpis(membersPayload) {
    const org = membersPayload?.organization || null;
    const members = membersPayload?.members || [];
    const invites = membersPayload?.invitations || [];
    const admins = members.filter((member) => member.role === 'admin' || member.role === 'owner');
    setText('pageMeta', org ? `/ ${org.name}` : '/ members');
    setText('kpi-org', org?.name || '—');
    setText('kpi-org-sub', org ? `${org.kind} · role ${org.current_role}` : 'organization unavailable');
    setText('kpi-members', formatNum(members.length));
    setText('kpi-members-sub', `${members.filter((member) => member.project_access?.length).length} with project access`);
    setText('kpi-admins', formatNum(admins.length));
    setText('kpi-admins-sub', admins.length ? 'can manage org or project policy' : 'no admins yet');
    setText('kpi-invites', formatNum(invites.filter((invite) => invite.status === 'pending').length));
    setText('kpi-invites-sub', invites.length ? 'pending invitations' : 'no invites pending');
  }
  function renderMembers(membersPayload) {
    const members = membersPayload?.members || [];
    const canManage = Boolean(membersPayload?.organization?.can_manage_members);
    const projects = membersPayload?.projects || [];
    const list = $('membersList');
    setText('membersStatus', `${members.length} joined`);
    if (!list) return;
    if (!members.length) {
      list.innerHTML = '<div class="empty">No team members yet.</div>';
      return;
    }
    list.innerHTML = members.map((member) => {
      const projectBadges = (member.project_access || []).slice(0, 6).map((project) => (
        `<span class="member-project">${escapeHtml(project.project_name || project.vp_proj_id)} · ${escapeHtml(project.role)}${canManage ? ` <button type="button" class="action-btn danger" data-project-remove="${escapeHtml(member.user_id)}" data-project-id="${escapeHtml(project.project_id)}">remove</button>` : ''}</span>`
      )).join('');
      const assignOptions = projects
        .filter((project) => !(member.project_access || []).some((access) => access.project_id === project.id))
        .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || project.vp_proj_id)}</option>`)
        .join('');
      const glyph = escapeHtml((member.email || 'VP').charAt(0).toUpperCase());
      return `
        <div class="member-row">
          <div class="member-avatar">${glyph}</div>
          <div class="member-main">
            <div class="member-email">${escapeHtml(member.email || member.user_id)}</div>
            <div class="member-meta">${escapeHtml(member.role)} · joined ${relTime(member.created_at)}</div>
            <div class="member-projects">${projectBadges || '<span class="member-project">no project access yet</span>'}</div>
            ${canManage ? `
              <div class="member-projects">
                <div class="member-actions">
                  <select class="role-select" data-role-select="${escapeHtml(member.user_id)}" ${member.role === 'owner' || member.user_id === user.id ? 'disabled' : ''}>
                    <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>admin</option>
                    <option value="member" ${member.role === 'member' ? 'selected' : ''}>member</option>
                    <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>viewer</option>
                  </select>
                  <button type="button" class="action-btn" data-role-save="${escapeHtml(member.user_id)}" ${member.role === 'owner' || member.user_id === user.id ? 'disabled' : ''}>save role</button>
                  <button type="button" class="action-btn danger" data-member-remove="${escapeHtml(member.user_id)}" ${member.role === 'owner' || member.user_id === user.id ? 'disabled' : ''}>remove</button>
                </div>
                <div class="assign-grid">
                  <select class="role-select" data-project-select="${escapeHtml(member.user_id)}" ${assignOptions ? '' : 'disabled'}>
                    <option value="">select project</option>
                    ${assignOptions}
                  </select>
                  <select class="role-select" data-project-role="${escapeHtml(member.user_id)}" ${assignOptions ? '' : 'disabled'}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button type="button" class="action-btn" data-project-assign="${escapeHtml(member.user_id)}" ${assignOptions ? '' : 'disabled'}>assign project</button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
  function renderInvites(membersPayload) {
    const invites = (membersPayload?.invitations || []).filter((invite) => invite.status === 'pending');
    const canManage = Boolean(membersPayload?.organization?.can_manage_members);
    const list = $('inviteList');
    setText('invitesStatus', `${invites.length} pending`);
    if (!list) return;
    if (!invites.length) {
      list.innerHTML = '<div class="empty">No pending invites.</div>';
      return;
    }
    list.innerHTML = invites.map((invite, index) => `
      <div class="list-row">
        <div class="list-rank">0${index + 1}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(invite.email)}</div>
          <div class="list-sub">${escapeHtml(invite.role)} · invited ${relTime(invite.created_at)}</div>
        </div>
        <div class="list-meta">
          <span class="pill warn">pending</span>
          ${canManage ? `<button type="button" class="action-btn danger" data-invite-revoke="${escapeHtml(invite.id)}">revoke</button>` : ''}
        </div>
      </div>
    `).join('');
  }
  function renderCoverage(membersPayload) {
    const projects = membersPayload?.projects || [];
    const members = membersPayload?.members || [];
    const list = $('coverageList');
    setText('coverageStatus', `${projects.length} projects`);
    if (!list) return;
    if (!projects.length) {
      list.innerHTML = '<div class="empty">No project scopes yet.</div>';
      return;
    }
    const coverageCounts = new Map();
    members.forEach((member) => {
      (member.project_access || []).forEach((access) => {
        coverageCounts.set(access.project_id, (coverageCounts.get(access.project_id) || 0) + 1);
      });
    });
    list.innerHTML = projects.slice(0, 8).map((project, index) => {
      const assigned = Number(coverageCounts.get(project.id) || 0);
      const tone = assigned >= 4 ? 'ok' : assigned >= 2 ? 'warn' : 'danger';
      return `
        <div class="list-row">
          <div class="list-rank">0${index + 1}</div>
          <div class="list-main">
            <div class="list-title">${escapeHtml(project.name || project.vp_proj_id)}</div>
            <div class="list-sub">${escapeHtml(project.vp_proj_id)} · created ${relTime(project.created_at)}</div>
          </div>
          <div class="list-meta"><span class="pill ${tone}">${escapeHtml(String(assigned))} members</span></div>
        </div>
      `;
    }).join('');
  }
  function buildMembersChecklistItems() {
    const payload = currentMembersPayload || {};
    const org = payload.organization || {};
    const members = payload.members || [];
    const invites = (payload.invitations || []).filter((invite) => invite.status === 'pending');
    const projects = payload.projects || [];
    const membersWithAccess = members.filter((member) => (member.project_access || []).length > 0);
    const admins = members.filter((member) => member.role === 'admin' || member.role === 'owner');

    return [
      {
        done: org.kind && org.kind !== 'personal',
        label: org.kind && org.kind !== 'personal'
          ? `Shared workspace ${org.name || 'org'} is active.`
          : 'Move team access into a shared org before presenting the business rollout.',
      },
      {
        done: members.length >= 2,
        label: members.length >= 2
          ? `${members.length} joined members are in the workspace.`
          : 'Invite at least one additional teammate into the shared workspace.',
      },
      {
        done: admins.length >= 1,
        label: admins.length >= 1
          ? `${admins.length} admin/owner seat${admins.length === 1 ? '' : 's'} assigned.`
          : 'Ensure at least one admin or owner can manage invites and policy.',
      },
      {
        done: membersWithAccess.length >= 1,
        label: membersWithAccess.length >= 1
          ? `${membersWithAccess.length} member${membersWithAccess.length === 1 ? ' has' : 's have'} project access.`
          : 'Assign project access so the pilot reflects real shared usage.',
      },
      {
        done: invites.length === 0,
        label: invites.length === 0
          ? 'No pending invites are blocking rollout.'
          : `${invites.length} pending invite${invites.length === 1 ? '' : 's'} still need follow-up.`,
      },
      {
        done: projects.length > 0,
        label: projects.length > 0
          ? `${projects.length} project scope${projects.length === 1 ? '' : 's'} available for assignment.`
          : 'Create a shared project before assigning access across the team.',
      },
    ];
  }
  function renderAccessKit() {
    const resourcesEl = $('accessKitResources');
    const checklistEl = $('accessChecklistList');
    const items = buildMembersChecklistItems();
    const completed = items.filter((item) => item.done).length;
    const resources = [
      { title: 'Control dashboard', copy: 'Use Control for rollout summary, project policy, and pilot posture.', href: currentOrganizationId ? `/app/control?org=${encodeURIComponent(currentOrganizationId)}` : '/app/control', label: 'open control' },
      { title: 'Org settings', copy: 'Return to Org for ownership, archive controls, and workspace-level setup.', href: currentOrganizationId ? `/app/org?org=${encodeURIComponent(currentOrganizationId)}` : '/app/org', label: 'open org' },
      { title: 'Docs', copy: 'Share docs while teammates are connecting their first protected workflows.', href: '/docs', label: 'open docs' },
      { title: 'Security', copy: 'Use the security page when buyers ask how shared access and policy work.', href: '/security', label: 'open security' },
    ];

    setText('accessKitStatus', `${completed}/${items.length} access checks done`);
    if (resourcesEl) {
      resourcesEl.innerHTML = resources.map((resource) => `
        <div class="resource-card">
          <div class="resource-title">${escapeHtml(resource.title)}</div>
          <div class="resource-copy">${escapeHtml(resource.copy)}</div>
          <a class="resource-link" href="${escapeHtml(resource.href)}">${escapeHtml(resource.label)}</a>
        </div>
      `).join('');
    }
    if (checklistEl) {
      checklistEl.innerHTML = items.map((item) => `
        <div class="checklist-item">
          <span class="checklist-mark ${item.done ? 'done' : 'todo'}">${item.done ? '[x]' : '[ ]'}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join('');
    }
  }
  function buildMembersReport() {
    const payload = currentMembersPayload || {};
    const org = payload.organization || {};
    const members = payload.members || [];
    const invites = (payload.invitations || []).filter((invite) => invite.status === 'pending');
    const projects = payload.projects || [];
    return [
      'VaultProof Members Report',
      `Organization: ${org.name || 'Unknown org'}`,
      `Workspace: ${org.kind || 'unknown'} · role ${org.current_role || 'unknown'}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      '',
      'Summary',
      `- Joined members: ${members.length}`,
      `- Admins/owners: ${members.filter((member) => member.role === 'admin' || member.role === 'owner').length}`,
      `- Pending invites: ${invites.length}`,
      `- Projects: ${projects.length}`,
      '',
      'Members',
      ...(members.length ? members.map((member) => `- ${member.email || member.user_id} · ${member.role} · ${(member.project_access || []).length} project scopes`) : ['- none']),
      '',
      'Pending invites',
      ...(invites.length ? invites.map((invite) => `- ${invite.email} · ${invite.role} · invited ${formatTimestamp(invite.created_at)}`) : ['- none']),
    ].join('\n');
  }
  function buildMembersChecklist() {
    const payload = currentMembersPayload || {};
    const org = payload.organization || {};
    return [
      'VaultProof Member Access Checklist',
      `Organization: ${org.name || 'Unknown org'}`,
      `Workspace type: ${org.kind || 'unknown'} · role ${org.current_role || 'unknown'}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      '',
      'Member rollout checklist',
      ...buildMembersChecklistItems().map((item) => `- ${item.done ? '[x]' : '[ ]'} ${item.label}`),
      '',
      'Reference links',
      '- Control dashboard: /app/control',
      '- Org settings: /app/org',
      '- Docs: /docs',
      '- Security: /security',
    ].join('\n');
  }
  function buildMembersCsv() {
    const rows = [
      ['email', 'user_id', 'role', 'created_at', 'project_count', 'project_access'],
      ...((currentMembersPayload?.members || []).map((member) => [
        member.email,
        member.user_id,
        member.role,
        member.created_at,
        (member.project_access || []).length,
        (member.project_access || []).map((project) => `${project.project_name || project.vp_proj_id}:${project.role}`).join(' | '),
      ])),
    ];
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  }
  function buildMembersJson() {
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      members: currentMembersPayload || {},
    }, null, 2);
  }
  function getMembersExportBaseName() {
    return `${slugify(currentMembersPayload?.organization?.name || 'vaultproof')}-members`;
  }
  async function copyMembersReport() {
    try {
      const copied = await copyText(buildMembersReport());
      setExportMessage(copied ? 'Members report copied.' : 'Could not copy members report.', copied ? 'ok' : 'danger');
      toast(copied ? 'Members report copied.' : 'Could not copy members report.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy members report.', 'danger');
      toast('Could not copy members report.', 'danger');
    }
  }
  async function copyMembersChecklist() {
    try {
      const copied = await copyText(buildMembersChecklist());
      setExportMessage(copied ? 'Member access checklist copied.' : 'Could not copy member access checklist.', copied ? 'ok' : 'danger');
      toast(copied ? 'Member access checklist copied.' : 'Could not copy member access checklist.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy member access checklist.', 'danger');
      toast('Could not copy member access checklist.', 'danger');
    }
  }
  function downloadMembersReport() {
    downloadTextFile(`${getMembersExportBaseName()}-report.txt`, buildMembersReport(), 'text/plain;charset=utf-8');
    setExportMessage('Members report downloaded.', 'ok');
    toast('Members report downloaded.', 'ok');
  }
  function downloadMembersCsv() {
    downloadTextFile(`${getMembersExportBaseName()}-access.csv`, buildMembersCsv(), 'text/csv;charset=utf-8');
    setExportMessage('Members CSV downloaded.', 'ok');
    toast('Members CSV downloaded.', 'ok');
  }
  function downloadMembersJson() {
    downloadTextFile(`${getMembersExportBaseName()}-snapshot.json`, buildMembersJson(), 'application/json;charset=utf-8');
    setExportMessage('Members JSON downloaded.', 'ok');
    toast('Members JSON downloaded.', 'ok');
  }
  async function updateMemberRole(userId) {
    const select = document.querySelector(`[data-role-select="${CSS.escape(userId)}"]`);
    if (!select) return;
    const role = select.value;
    const res = await apiFetch(INIT_API, `/members/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: { role },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to update member role.', 'error');
      toast(payload?.error || 'Failed to update member role.', 'error');
      return;
    }
    setMessage('inviteMsg', 'Member role updated.', 'success');
    await load();
    toast('Member role updated.', 'success');
  }
  async function removeMember(userId) {
    const res = await apiFetch(INIT_API, `/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to remove member.', 'error');
      toast(payload?.error || 'Failed to remove member.', 'error');
      return;
    }
    setMessage('inviteMsg', 'Member removed from the organization.', 'success');
    await load();
    toast('Member removed from the organization.', 'success');
  }
  async function revokeInvite(inviteId) {
    const res = await apiFetch(INIT_API, `/members/invitations/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to revoke invite.', 'error');
      toast(payload?.error || 'Failed to revoke invite.', 'error');
      return;
    }
    setMessage('inviteMsg', 'Invitation revoked.', 'success');
    await load();
    toast('Invitation revoked.', 'success');
  }
  async function assignProjectAccess(userId) {
    const projectSelect = document.querySelector(`[data-project-select="${CSS.escape(userId)}"]`);
    const roleSelect = document.querySelector(`[data-project-role="${CSS.escape(userId)}"]`);
    if (!projectSelect || !roleSelect) return;
    const projectId = projectSelect.value;
    const role = roleSelect.value || 'member';
    if (!projectId) {
      setMessage('inviteMsg', 'Choose a project before assigning access.', 'error');
      toast('Choose a project before assigning access.', 'error');
      return;
    }
    const res = await apiFetch(INIT_API, `/projects/${encodeURIComponent(projectId)}/members`, {
      method: 'POST',
      body: { user_id: userId, role },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to assign project access.', 'error');
      toast(payload?.error || 'Failed to assign project access.', 'error');
      return;
    }
    setMessage('inviteMsg', 'Project access updated.', 'success');
    await load();
    toast('Project access updated.', 'success');
  }
  async function removeProjectAccess(userId, projectId) {
    const res = await apiFetch(INIT_API, `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to remove project access.', 'error');
      toast(payload?.error || 'Failed to remove project access.', 'error');
      return;
    }
    setMessage('inviteMsg', 'Project access removed.', 'success');
    await load();
    toast('Project access removed.', 'success');
  }
  async function sendInvite() {
    const email = ($('inviteEmail')?.value || '').trim();
    const role = $('inviteRole')?.value || 'member';
    setMessage('inviteMsg', '');
    const res = await apiFetch(INIT_API, '/members/invitations', {
      method: 'POST',
      body: { email, role },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setMessage('inviteMsg', payload?.error || 'Failed to send invitation.', 'error');
      toast(payload?.error || 'Failed to send invitation.', 'error');
      return;
    }
    if ($('inviteEmail')) $('inviteEmail').value = '';
    if ($('inviteRole')) $('inviteRole').value = 'member';
    setMessage('inviteMsg', 'Invitation sent.', 'success');
    await load();
    toast('Invitation sent.', 'success');
  }
  async function load() {
    setText('user-email', user.email || 'loading...');
    const avatar = $('user-avatar');
    if (avatar) avatar.textContent = (user.email || 'VP').charAt(0).toUpperCase();

    const orgsResponse = await apiFetch(INIT_API, '/orgs', { includeOrganization: false });
    const orgsData = unwrapPayload(orgsResponse?.data) || {};
    availableOrganizations = Array.isArray(orgsData.organizations) ? orgsData.organizations : [];
    const selected = chooseOrganization(availableOrganizations, orgsData.active_organization_id || null);
    persistOrganizationSelection(selected?.id || null);
    syncOrganizationUrl(currentOrganizationId);
    renderOrganizationSelector();

    const membersResponse = await apiFetch(INIT_API, '/members');
    const membersData = unwrapPayload(membersResponse?.data) || {};
    currentMembersPayload = membersData;

    setManageVisibility(membersData);
    renderUsageBox(membersData);
    renderKpis(membersData);
    renderMembers(membersData);
    renderInvites(membersData);
    renderCoverage(membersData);
    renderAccessKit();
  }
  function bind() {
    const signOutBtn = $('signOutBtn');
    const refreshBtn = $('refreshBtn');
    const orgSelect = $('orgSelect');
    const inviteBtn = $('inviteBtn');
    const copyMembersReportBtn = $('copyMembersReportBtn');
    const copyMembersChecklistBtn = $('copyMembersChecklistBtn');
    const downloadMembersReportBtn = $('downloadMembersReportBtn');
    const downloadMembersCsvBtn = $('downloadMembersCsvBtn');
    const downloadMembersJsonBtn = $('downloadMembersJsonBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);
    if (refreshBtn) refreshBtn.addEventListener('click', function() { load(); });
    if (inviteBtn) inviteBtn.addEventListener('click', function() { sendInvite(); });
    if (copyMembersReportBtn) copyMembersReportBtn.addEventListener('click', function() { copyMembersReport(); });
    if (copyMembersChecklistBtn) copyMembersChecklistBtn.addEventListener('click', function() { copyMembersChecklist(); });
    if (downloadMembersReportBtn) downloadMembersReportBtn.addEventListener('click', function() { downloadMembersReport(); });
    if (downloadMembersCsvBtn) downloadMembersCsvBtn.addEventListener('click', function() { downloadMembersCsv(); });
    if (downloadMembersJsonBtn) downloadMembersJsonBtn.addEventListener('click', function() { downloadMembersJson(); });
    if (orgSelect) {
      orgSelect.addEventListener('change', function(event) {
        persistOrganizationSelection(event.target.value || '');
        syncOrganizationUrl(currentOrganizationId);
        renderOrganizationSelector();
        load();
      });
    }
    document.addEventListener('click', function(event) {
      const roleSave = event.target.closest('[data-role-save]');
      if (roleSave) {
        updateMemberRole(roleSave.getAttribute('data-role-save'));
        return;
      }

      const removeBtn = event.target.closest('[data-member-remove]');
      if (removeBtn) {
        removeMember(removeBtn.getAttribute('data-member-remove'));
        return;
      }

      const revokeBtn = event.target.closest('[data-invite-revoke]');
      if (revokeBtn) {
        revokeInvite(revokeBtn.getAttribute('data-invite-revoke'));
        return;
      }

      const assignBtn = event.target.closest('[data-project-assign]');
      if (assignBtn) {
        assignProjectAccess(assignBtn.getAttribute('data-project-assign'));
        return;
      }

      const removeProjectBtn = event.target.closest('[data-project-remove]');
      if (removeProjectBtn) {
        removeProjectAccess(
          removeProjectBtn.getAttribute('data-project-remove'),
          removeProjectBtn.getAttribute('data-project-id'),
        );
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { bind(); load(); });
  } else {
    bind();
    load();
  }
})();
