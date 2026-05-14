(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const IS_ENTERPRISE_HOST = window.location.hostname === 'enterprise.vaultproof.dev'
    || window.location.hostname.startsWith('enterprise.');
  const INIT_API = IS_ENTERPRISE_HOST
    ? `${window.location.origin}/api/v1/enterprise`
    : window.location.hostname.includes('dev.vaultproof')
      ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
      : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_PROJECT_REF = 'gwzkjiomemjlhtrdrlan';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let currentOrganizationId = null;
  let availableOrganizations = [];
  let archivedOrganizations = [];
  let currentOrgPayload = null;
  let currentMembersPayload = null;
  let currentOrgsPayload = null;
  let currentSsoPrep = {};
  let currentSsoStatus = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }
  function setMessage(id, text, tone) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = `form-msg${tone ? ` ${tone}` : ''}`;
  }
  function setExportMessage(text, tone) {
    const el = $('orgExportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `action-msg${tone ? ` ${tone}` : ''}`;
  }
  function setButtonState(button, disabled, label) {
    if (!button) return;
    button.disabled = Boolean(disabled);
    if (label) button.textContent = label;
  }
  function toast(message, tone) {
    if (!message || !window.VaultproofToast || typeof window.VaultproofToast.show !== 'function') return;
    window.VaultproofToast.show(message, tone || 'neutral', 'Org');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
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
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  function titleCaseWords(value) {
    return String(value || '')
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
  function slugify(value) {
    return String(value || 'org')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'org';
  }
  function normalizeDomain(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized : '';
  }
  function getSupabaseSsoMetadataUrl() {
    return `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/sso/saml/metadata`;
  }
  function getSupabaseSsoAcsUrl() {
    return `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/sso/saml/acs`;
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

  function unwrapPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (data.data && typeof data.data === 'object') return unwrapPayload(data.data);
    if (data.result && typeof data.result === 'object') return unwrapPayload(data.result);
    return data;
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
    params.delete('org');
    const next = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', next);
  }
  function chooseOrganization(orgs, activeOrganizationId) {
    const requestedId = getRequestedOrganizationId();
    const requested = orgs.find((org) => org.id === requestedId) || null;
    if (requested) return requested;
    const active = orgs.find((org) => org.id === activeOrganizationId) || null;
    if (active) return active;
    const shared = orgs.find((org) => org.kind && org.kind !== 'personal') || null;
    if (shared) return shared;
    return orgs[0] || null;
  }
  function renderOrganizationSelector() {
    const select = $('orgSelect');
    const status = $('orgSwitcherStatus');
    if (!select) return;
    if (!availableOrganizations.length) {
      select.innerHTML = '<option value="">No orgs available</option>';
      select.disabled = true;
      if (status) status.textContent = archivedOrganizations.length ? 'Active org unavailable · restore from archived list' : 'No org loaded';
      return;
    }
    select.innerHTML = availableOrganizations.map((org) => {
      const suffix = org.kind === 'personal' ? 'solo' : org.role;
      return `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)} · ${escapeHtml(suffix)}</option>`;
    }).join('');
    select.disabled = false;
    select.value = currentOrganizationId || availableOrganizations[0].id;
    const current = availableOrganizations.find((org) => org.id === select.value) || null;
    if (status) status.textContent = current ? `${current.kind === 'personal' ? 'solo workspace' : 'shared org'} · ${current.role}` : 'Org loading…';
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
      return { ok: res.ok, status: res.status, data };
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

  function renderUsageBox(orgPayload) {
    const organization = orgPayload?.organization || null;
    const used = Number(organization?.member_count || 0);
    const cap = organization?.kind === 'team' ? 25 : 5;
    const percent = Math.max(6, Math.min(100, cap ? (used / cap) * 100 : 0));
    setText('usagePlanLabel', organization?.kind === 'team' ? 'team governance' : 'workspace governance');
    setText('usageMetricLabel', 'members');
    setText('usageMetricValue', `${used}`);
    const bar = $('usageBarFill');
    if (bar) bar.style.width = `${percent}%`;
    setText('usageMetricNote', `${Number(organization?.project_count || 0)} active projects · ${archivedOrganizations.length} archived orgs`);
  }

  function renderBanner(orgPayload, membersPayload) {
    const organization = orgPayload?.organization || null;
    const owner = (membersPayload?.members || []).find((member) => member.role === 'owner') || null;
    setText('bannerTitle', organization ? `${organization.name} governance` : 'Shared workspace governance');
    setText(
      'bannerCopy',
      organization
        ? `${organization.kind === 'team' ? 'This team workspace' : 'This personal workspace'} is managed from the live dashboard. Use this page to rename the org, hand off ownership, and control archive or recovery behavior without touching the raw database.`
        : 'Load an organization to manage its governance controls.',
    );
    const notes = [];
    notes.push(`Owner · ${owner?.email || owner?.user_id || 'unavailable'}`);
    notes.push(`Created · ${formatTimestamp(organization?.created_at)}`);
    notes.push(`Updated · ${formatTimestamp(organization?.updated_at)}`);
    notes.push(`Archived orgs you can restore · ${archivedOrganizations.length}`);
    const noteEl = $('bannerNote');
    if (noteEl) {
      noteEl.innerHTML = notes.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
    }
  }

  function renderKpis(orgPayload) {
    const organization = orgPayload?.organization || null;
    setText('pageMeta', organization ? `/ ${organization.name}` : '/ org');
    setText('kpi-org-name', organization?.name || '—');
    setText('kpi-org-kind', organization ? `${organization.kind} workspace · slug ${organization.slug || 'none'}` : 'organization unavailable');
    setText('kpi-role', organization?.role || '—');
    setText('kpi-role-sub', organization ? `${organization.can_archive ? 'archive enabled' : 'archive restricted'} · ${organization.can_transfer_ownership ? 'ownership transfer enabled' : 'ownership transfer restricted'}` : 'loading…');
    setText('kpi-members', formatNum(organization?.member_count || 0));
    setText('kpi-members-sub', organization ? 'current organization members' : 'loading…');
    setText('kpi-projects', formatNum(organization?.project_count || 0));
    setText('kpi-projects-sub', organization ? 'active non-revoked projects' : 'loading…');
  }

  function renderProfile(orgPayload) {
    const organization = orgPayload?.organization || null;
    const canEdit = Boolean(organization && (organization.role === 'owner' || organization.role === 'admin'));
    const nameInput = $('orgNameInput');
    const slugInput = $('orgSlugInput');
    const saveBtn = $('saveOrgBtn');
    if (nameInput) nameInput.value = organization?.name || '';
    if (slugInput) slugInput.value = organization?.slug || '';
    if (nameInput) nameInput.disabled = !canEdit;
    if (slugInput) slugInput.disabled = !canEdit;
    setButtonState(saveBtn, !canEdit, 'save changes');
    setText('profileStatus', canEdit ? 'editable' : 'read only');
    setText('profileHint', canEdit ? 'Admins and owners can update the organization name and slug.' : 'Only admins and owners can update the organization profile.');
  }

  function renderTransfer(orgPayload, membersPayload) {
    const organization = orgPayload?.organization || null;
    const members = membersPayload?.members || [];
    const canTransfer = Boolean(organization?.can_transfer_ownership);
    const owner = members.find((member) => member.role === 'owner') || null;
    const candidates = members.filter((member) => member.user_id && member.user_id !== user.id && member.role !== 'owner');
    const select = $('transferTargetSelect');
    if (select) {
      select.innerHTML = ['<option value="">Select a member</option>'].concat(
        candidates.map((member) => `<option value="${escapeHtml(member.user_id)}">${escapeHtml(member.email || member.user_id)} · ${escapeHtml(member.role)}</option>`),
      ).join('');
      select.disabled = !canTransfer || !candidates.length;
    }
    setButtonState($('transferOwnershipBtn'), !canTransfer || !candidates.length, 'transfer ownership');
    setText('transferStatus', canTransfer ? `${candidates.length} eligible members` : 'restricted');
    setText('transferHint', canTransfer ? 'Only the current owner can transfer ownership to another joined member.' : 'Ownership transfer is only available to the current team owner.');
    setText('currentOwnerCard', owner ? `${owner.email || owner.user_id} · owner` : 'Owner unavailable');
  }

  function renderArchive(orgPayload) {
    const organization = orgPayload?.organization || null;
    const canArchive = Boolean(organization?.can_archive);
    const button = $('archiveOrgBtn');
    const input = $('archiveConfirmInput');
    if (input) {
      input.placeholder = organization ? `Type ${organization.name} exactly` : 'Type org name exactly';
      if (!canArchive) input.value = '';
      input.disabled = !canArchive;
    }
    setButtonState(button, !canArchive, 'archive organization');
    setText('archiveStatus', canArchive ? 'owner action' : 'restricted');
    setText('archiveHint', canArchive ? 'Archive preserves projects, members, alerts, and audit history for later restore.' : 'Only team-org owners can archive from this page.');
  }

  function renderCreateOrg(orgPayload) {
    const organization = orgPayload?.organization || null;
    const currentKind = organization?.kind || null;
    setText('createOrgStatus', currentKind === 'team' ? 'ready for another org' : 'ready');
    setText(
      'createOrgHint',
      currentKind === 'team'
        ? 'Create another shared org if you need a separate customer, workspace, or business unit.'
        : 'This creates a shared team workspace and makes you the owner.',
    );
  }

  function renderPosture(orgPayload, membersPayload) {
    const organization = orgPayload?.organization || null;
    const owner = (membersPayload?.members || []).find((member) => member.role === 'owner') || null;
    const rows = [
      { title: 'Workspace type', sub: `${organization?.kind || 'unknown'} workspace`, meta: organization?.kind === 'team' ? 'shared' : 'personal' },
      { title: 'Current owner', sub: owner ? `${owner.email || owner.user_id}` : 'Owner unavailable', meta: owner ? relTime(owner.created_at) : '—' },
      { title: 'Your permissions', sub: `Role ${organization?.role || 'unknown'}`, meta: organization?.can_archive ? 'sensitive controls enabled' : 'limited' },
      { title: 'Archive recovery', sub: archivedOrganizations.length ? `${archivedOrganizations.length} archived workspaces available to restore` : 'No archived workspaces', meta: archivedOrganizations.length ? 'recovery ready' : 'clean' },
    ];
    const list = $('postureList');
    if (!list) return;
    list.innerHTML = rows.map((row, index) => `
      <div class="list-row">
        <div class="list-rank">0${index + 1}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(row.title)}</div>
          <div class="list-sub">${escapeHtml(row.sub)}</div>
        </div>
        <div class="list-meta"><span class="pill neutral">${escapeHtml(row.meta)}</span></div>
      </div>
    `).join('');
    setText('postureStatus', organization ? 'live' : 'unavailable');
  }

  function buildOrgChecklistItems() {
    const organization = currentOrgPayload?.organization || {};
    const members = currentMembersPayload?.members || [];
    const owner = members.find((member) => member.role === 'owner') || null;
    const ssoDomain = normalizeDomain(currentSsoPrep?.company_domain || '');
    const ssoProvider = String(currentSsoPrep?.sso_provider || '').trim();
    const ssoStatus = String(currentSsoPrep?.status || '').trim();
    const ssoLoginMode = String(currentSsoPrep?.login_mode || '').trim();

    return [
      {
        done: organization.kind === 'team',
        label: organization.kind === 'team'
          ? `Shared org ${organization.name || 'workspace'} is active.`
          : 'Create or switch into a shared org before starting enterprise rollout.',
      },
      {
        done: Boolean(organization.slug),
        label: organization.slug
          ? `Workspace slug is set to ${organization.slug}.`
          : 'Set a stable workspace slug before sharing setup docs with the customer team.',
      },
      {
        done: members.length >= 2,
        label: members.length >= 2
          ? `${members.length} joined members are in the org.`
          : 'Invite at least one additional admin or teammate into the org.',
      },
      {
        done: Boolean(owner),
        label: owner
          ? `Owner is set to ${owner.email || owner.user_id}.`
          : 'Confirm the intended owner before handing the org to a customer team.',
      },
      {
        done: Number(organization.project_count || 0) > 0,
        label: Number(organization.project_count || 0) > 0
          ? `${organization.project_count} active projects are attached to the org.`
          : 'Create the first shared project before handing the workspace to a team.',
      },
      {
        done: organization.role === 'owner' || organization.role === 'admin',
        label: organization.role === 'owner' || organization.role === 'admin'
          ? `An admin-capable user is active in the workspace as ${organization.role}.`
          : 'Confirm an owner or admin is driving rollout before sharing the org broadly.',
      },
      {
        done: Boolean(ssoDomain && ssoProvider && ssoStatus === 'configured'),
        label: ssoDomain && ssoProvider
          ? (ssoStatus === 'configured'
              ? `Supabase SSO is configured for ${ssoDomain} via ${ssoProvider}.`
              : `Supabase SSO prep is staged for ${ssoDomain} via ${ssoProvider}; switch status to configured after the SAML connection is live.`)
          : 'Capture the company domain and identity provider before turning on Supabase SAML SSO.',
      },
    ];
  }

  function renderPilotKit() {
    const organization = currentOrgPayload?.organization || null;
    const resourcesEl = $('pilotKitResources');
    const checklistEl = $('pilotChecklistList');
    const items = buildOrgChecklistItems();
    const completed = items.filter((item) => item.done).length;
    const resources = [
      {
        title: 'Enterprise demo',
        copy: 'Use the enterprise demo for buyer walkthroughs while the org is being provisioned.',
        href: '/enterprise-demo',
        label: 'open enterprise demo',
      },
      {
        title: 'Docs',
        copy: 'Share the product docs while the customer team is wiring their first protected project.',
        href: '/docs',
        label: 'open docs',
      },
      {
        title: 'Security',
        copy: 'Send the security page during vendor review and governance conversations.',
        href: '/security',
        label: 'open security',
      },
    ];

    setText('pilotKitStatus', `${completed}/${items.length} org checks done`);

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

    if (organization) {
      setText('pageMeta', `/ ${organization.name} · org`);
    }
  }

  function renderArchivedOrganizations() {
    const list = $('archivedList');
    setText('archivedStatus', `${archivedOrganizations.length} archived`);
    if (!list) return;
    if (!archivedOrganizations.length) {
      list.innerHTML = '<div class="empty">No archived workspaces to restore.</div>';
      return;
    }
    list.innerHTML = archivedOrganizations.map((org, index) => `
      <div class="list-row">
        <div class="list-rank">0${index + 1}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(org.name)}</div>
          <div class="list-sub">archived ${relTime(org.archived_at)} · ${escapeHtml(org.kind)} workspace</div>
        </div>
        <div class="list-meta">
          <button type="button" class="btn-outline" data-restore-org="${escapeHtml(org.id)}">restore</button>
        </div>
      </div>
    `).join('');
  }

  function buildOrgReport() {
    const organization = currentOrgPayload?.organization || {};
    const members = currentMembersPayload?.members || [];
    const owner = members.find((member) => member.role === 'owner') || null;
    return [
      'VaultProof Org Report',
      `Organization: ${organization.name || 'Unknown org'}`,
      `Kind: ${organization.kind || 'unknown'}`,
      `My role: ${organization.role || 'unknown'}`,
      `Owner: ${owner?.email || owner?.user_id || 'unavailable'}`,
      `Members: ${organization.member_count || 0}`,
      `Projects: ${organization.project_count || 0}`,
      `Archive enabled: ${organization.can_archive ? 'yes' : 'no'}`,
      `Ownership transfer enabled: ${organization.can_transfer_ownership ? 'yes' : 'no'}`,
      `Archived workspaces available: ${archivedOrganizations.length}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
    ].join('\n');
  }
  function buildOrgPilotBrief() {
    const organization = currentOrgPayload?.organization || {};
    const checklistItems = buildOrgChecklistItems();
    const ssoDomain = normalizeDomain(currentSsoPrep?.company_domain || '');
    const ssoProvider = String(currentSsoPrep?.sso_provider || '').trim();
    const ssoStatus = String(currentSsoPrep?.status || '').trim();
    return [
      'VaultProof Org Setup Brief',
      `Organization: ${organization.name || 'Unknown org'}`,
      `Workspace type: ${organization.kind || 'unknown'}`,
      `Role: ${organization.role || 'unknown'}`,
      `Slug: ${organization.slug || 'unset'}`,
      `SSO domain: ${ssoDomain || 'not captured'}`,
      `SSO provider: ${ssoProvider || 'not captured'}`,
      `SSO status: ${ssoStatus || 'not captured'}`,
      `SSO login mode: ${ssoLoginMode || 'not captured'}`,
      `Provider health: ${currentSsoStatus?.provider_status || 'not_started'}`,
      `Last SSO attempt: ${currentSsoStatus?.last_started_sso_login_at ? `${formatTimestamp(currentSsoStatus.last_started_sso_login_at)}${currentSsoStatus?.last_started_sso_login_email ? ` by ${currentSsoStatus.last_started_sso_login_email}` : ''}` : 'not recorded'}`,
      `Last successful SSO login: ${currentSsoStatus?.last_successful_sso_login_at ? `${formatTimestamp(currentSsoStatus.last_successful_sso_login_at)}${currentSsoStatus?.last_successful_sso_login_email ? ` by ${currentSsoStatus.last_successful_sso_login_email}` : ''}` : 'not recorded'}`,
      `Last membership resolution: ${currentSsoStatus?.last_membership_resolution_at ? `${formatTimestamp(currentSsoStatus.last_membership_resolution_at)}${currentSsoStatus?.last_membership_resolution ? ` · ${titleCaseWords(currentSsoStatus.last_membership_resolution)}` : ''}${currentSsoStatus?.last_membership_resolution_email ? ` · ${currentSsoStatus.last_membership_resolution_email}` : ''}` : 'not recorded'}`,
      `Supabase metadata URL: ${getSupabaseSsoMetadataUrl()}`,
      `Supabase ACS URL: ${getSupabaseSsoAcsUrl()}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      '',
      'Org rollout checklist',
      ...checklistItems.map((item) => `- ${item.done ? '[x]' : '[ ]'} ${item.label}`),
      '',
      'Reference links',
      '- Enterprise demo: /enterprise-demo',
      '- Docs: /docs',
      '- Security: /security',
    ].join('\n');
  }
  function buildOrgJson() {
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      organizations: currentOrgsPayload || {},
      current_organization: currentOrgPayload || {},
      members: currentMembersPayload || {},
    }, null, 2);
  }
  function getOrgExportBaseName() {
    return `${slugify(currentOrgPayload?.organization?.name || 'vaultproof')}-org`;
  }
  function renderSsoPrep(orgPayload) {
    const organization = orgPayload?.organization || null;
    const canManage = Boolean(organization && organization.kind === 'team' && (organization.role === 'owner' || organization.role === 'admin'));
    currentSsoPrep = orgPayload?.sso_settings || {};
    currentSsoStatus = orgPayload?.sso_status || null;
    const domainInput = $('ssoPrepDomainInput');
    const providerSelect = $('ssoPrepProviderSelect');
    const statusSelect = $('ssoPrepStatusSelect');
    const loginModeSelect = $('ssoPrepLoginModeSelect');
    if (domainInput && document.activeElement !== domainInput) domainInput.value = currentSsoPrep?.company_domain || '';
    if (providerSelect && document.activeElement !== providerSelect) providerSelect.value = currentSsoPrep?.sso_provider || '';
    if (statusSelect && document.activeElement !== statusSelect) statusSelect.value = currentSsoPrep?.status || 'requested';
    if (loginModeSelect && document.activeElement !== loginModeSelect) loginModeSelect.value = currentSsoPrep?.login_mode || 'sso-first';
    if (domainInput) domainInput.disabled = !canManage;
    if (providerSelect) providerSelect.disabled = !canManage;
    if (statusSelect) statusSelect.disabled = !canManage;
    if (loginModeSelect) loginModeSelect.disabled = !canManage;
    setButtonState($('saveSsoPrepBtn'), !canManage, 'save sso prep');
    setButtonState($('copySsoPrepBriefBtn'), !organization, 'copy sso brief');
    setButtonState($('copySsoMetadataBtn'), !organization, 'copy metadata url');
    setButtonState($('copySsoAcsBtn'), !organization, 'copy acs url');
    if ($('ssoMetadataUrlInput')) $('ssoMetadataUrlInput').value = getSupabaseSsoMetadataUrl();
    if ($('ssoAcsUrlInput')) $('ssoAcsUrlInput').value = getSupabaseSsoAcsUrl();
    const domain = normalizeDomain(currentSsoPrep?.company_domain || '');
    const provider = String(currentSsoPrep?.sso_provider || '').trim();
    const status = String(currentSsoPrep?.status || '').trim();
    const loginMode = String(currentSsoPrep?.login_mode || '').trim() || 'sso-first';
    setText('ssoPrepStatus', status || (domain && provider ? 'requested' : 'prep needed'));
    setText(
      'ssoPrepHint',
      canManage
        ? (domain && provider
            ? (status === 'configured'
                ? `Supabase SSO is configured for ${domain} via ${provider} with ${loginMode} mode. Matching SSO logins can resolve into existing org access.`
                : `Supabase SSO rollout is staged for ${domain} via ${provider}. Keep this in requested mode until the SAML connection is live in Supabase.`)
            : 'Capture the company domain and IdP here before turning on SAML in Supabase.')
        : 'Only team-org admins and owners can manage Supabase SSO rollout prep here.',
    );
    const providerHealth = currentSsoStatus?.provider_status || 'not_started';
    setText('ssoProviderStatusCard', providerHealth === 'configured'
      ? `Configured and ready for live shared-workspace sign-in${domain ? ` for ${domain}` : ''}.`
      : providerHealth === 'requested'
        ? `Requested / staging${domain ? ` for ${domain}` : ''}. Keep this in setup mode until the Supabase SAML connection is live.`
        : 'No Supabase SSO rollout is active for this workspace yet.');
    setText('ssoLastStartedCard', currentSsoStatus?.last_started_sso_login_at
      ? `${formatTimestamp(currentSsoStatus.last_started_sso_login_at)}${currentSsoStatus?.last_started_sso_login_email ? ` · ${currentSsoStatus.last_started_sso_login_email}` : ''}`
      : 'No SSO attempt recorded yet.');
    setText('ssoLastLoginCard', currentSsoStatus?.last_successful_sso_login_at
      ? `${formatTimestamp(currentSsoStatus.last_successful_sso_login_at)}${currentSsoStatus?.last_successful_sso_login_email ? ` · ${currentSsoStatus.last_successful_sso_login_email}` : ''}`
      : 'No successful SSO login recorded yet.');
    setText('ssoResolutionCard', currentSsoStatus?.last_membership_resolution_at
      ? `${formatTimestamp(currentSsoStatus.last_membership_resolution_at)}${currentSsoStatus?.last_membership_resolution ? ` · ${titleCaseWords(currentSsoStatus.last_membership_resolution)}` : ''}${currentSsoStatus?.last_membership_resolution_email ? ` · ${currentSsoStatus.last_membership_resolution_email}` : ''}`
      : 'No SSO membership resolution recorded yet.');
  }
  function buildSsoPrepBrief() {
    const organization = currentOrgPayload?.organization || {};
    const domain = normalizeDomain(currentSsoPrep?.company_domain || '');
    const provider = String(currentSsoPrep?.sso_provider || '').trim();
    const status = String(currentSsoPrep?.status || '').trim();
    const loginMode = String(currentSsoPrep?.login_mode || '').trim();
    return [
      'VaultProof Supabase SSO Setup Brief',
      `Organization: ${organization.name || 'Unknown org'}`,
      `Workspace slug: ${organization.slug || 'unset'}`,
      `Company domain: ${domain || 'not captured'}`,
      `Identity provider: ${provider || 'not captured'}`,
      `Rollout status: ${status || 'not captured'}`,
      `Login mode: ${loginMode || 'not captured'}`,
      `Supabase metadata URL: ${getSupabaseSsoMetadataUrl()}`,
      `Supabase ACS URL: ${getSupabaseSsoAcsUrl()}`,
      '',
      'Next steps:',
      '- Enable SAML SSO on the Supabase project',
      '- Register the customer IdP metadata in Supabase',
      '- Map the customer domain to the SSO provider',
      '- Switch the rollout status to configured after the SAML connection is live',
      '- Test the shared-workspace SSO path from /app/login',
    ].join('\n');
  }
  async function copyOrgReport() {
    try {
      const copied = await copyText(buildOrgReport());
      setExportMessage(copied ? 'Org report copied.' : 'Could not copy org report.', copied ? 'ok' : 'danger');
      toast(copied ? 'Org report copied.' : 'Could not copy org report.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy org report.', 'danger');
      toast('Could not copy org report.', 'danger');
    }
  }
  async function copyOrgPilotBrief() {
    try {
      const copied = await copyText(buildOrgPilotBrief());
      setExportMessage(copied ? 'Org setup brief copied.' : 'Could not copy org setup brief.', copied ? 'ok' : 'danger');
      toast(copied ? 'Org setup brief copied.' : 'Could not copy org setup brief.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy org setup brief.', 'danger');
      toast('Could not copy org setup brief.', 'danger');
    }
  }
  function downloadOrgJson() {
    downloadTextFile(`${getOrgExportBaseName()}-snapshot.json`, buildOrgJson(), 'application/json;charset=utf-8');
    setExportMessage('Org JSON downloaded.', 'ok');
    toast('Org JSON downloaded.', 'ok');
  }
  async function saveSsoPrep() {
    const domain = normalizeDomain($('ssoPrepDomainInput')?.value || '');
    const provider = String($('ssoPrepProviderSelect')?.value || '').trim();
    const status = String($('ssoPrepStatusSelect')?.value || '').trim() || 'requested';
    const loginMode = String($('ssoPrepLoginModeSelect')?.value || '').trim() || 'sso-first';
    if (!domain) {
      setMessage('ssoPrepMsg', 'Enter a valid company domain before saving SSO prep.', 'warn');
      toast('Enter a valid company domain before saving SSO prep.', 'warn');
      return;
    }
    if (!provider) {
      setMessage('ssoPrepMsg', 'Choose the identity provider before saving SSO prep.', 'warn');
      toast('Choose the identity provider before saving SSO prep.', 'warn');
      return;
    }
    setButtonState($('saveSsoPrepBtn'), true, 'saving…');
    const res = await apiFetch(INIT_API, '/orgs/current/sso-settings', {
      method: 'PUT',
      body: {
        company_domain: domain,
        sso_provider: provider,
        status: status === 'configured' ? 'configured' : 'requested',
        login_mode: loginMode === 'assisted' ? 'assisted' : 'sso-first',
      },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState($('saveSsoPrepBtn'), false, 'save sso prep');
      setMessage('ssoPrepMsg', payload?.error || 'Could not save Supabase SSO rollout info.', 'danger');
      toast(payload?.error || 'Could not save Supabase SSO rollout info.', 'danger');
      return;
    }
    currentSsoPrep = payload?.sso_settings || {};
    currentSsoStatus = payload?.sso_status || currentSsoStatus;
    currentOrgPayload = { ...(currentOrgPayload || {}), sso_settings: currentSsoPrep, sso_status: currentSsoStatus };
    renderSsoPrep(currentOrgPayload);
    renderPilotKit();
    setMessage('ssoPrepMsg', status === 'configured'
      ? `Supabase SSO is marked configured for this workspace with ${loginMode}.`
      : 'Supabase SSO rollout info saved for this workspace.', 'ok');
    toast(status === 'configured'
      ? `Supabase SSO marked configured (${loginMode}).`
      : 'Supabase SSO rollout info saved.', 'ok');
    setButtonState($('saveSsoPrepBtn'), false, 'save sso prep');
  }
  async function copySsoPrepBrief() {
    try {
      const copied = await copyText(buildSsoPrepBrief());
      setMessage('ssoPrepMsg', copied ? 'Supabase SSO setup brief copied.' : 'Could not copy the SSO setup brief.', copied ? 'ok' : 'danger');
      toast(copied ? 'Supabase SSO setup brief copied.' : 'Could not copy the SSO setup brief.', copied ? 'ok' : 'danger');
    } catch {
      setMessage('ssoPrepMsg', 'Could not copy the SSO setup brief.', 'danger');
      toast('Could not copy the SSO setup brief.', 'danger');
    }
  }
  async function copySsoMetadataUrl() {
    try {
      const copied = await copyText(getSupabaseSsoMetadataUrl());
      setMessage('ssoPrepMsg', copied ? 'Supabase metadata URL copied.' : 'Could not copy metadata URL.', copied ? 'ok' : 'danger');
      toast(copied ? 'Supabase metadata URL copied.' : 'Could not copy metadata URL.', copied ? 'ok' : 'danger');
    } catch {
      setMessage('ssoPrepMsg', 'Could not copy metadata URL.', 'danger');
      toast('Could not copy metadata URL.', 'danger');
    }
  }
  async function copySsoAcsUrl() {
    try {
      const copied = await copyText(getSupabaseSsoAcsUrl());
      setMessage('ssoPrepMsg', copied ? 'Supabase ACS URL copied.' : 'Could not copy ACS URL.', copied ? 'ok' : 'danger');
      toast(copied ? 'Supabase ACS URL copied.' : 'Could not copy ACS URL.', copied ? 'ok' : 'danger');
    } catch {
      setMessage('ssoPrepMsg', 'Could not copy ACS URL.', 'danger');
      toast('Could not copy ACS URL.', 'danger');
    }
  }

  async function createOrganization() {
    const name = $('createOrgNameInput')?.value?.trim() || '';
    const slug = $('createOrgSlugInput')?.value?.trim() || '';
    if (name.length < 2) {
      setMessage('createOrgMsg', 'Organization name must be at least 2 characters.', 'warn');
      toast('Organization name must be at least 2 characters.', 'warn');
      return;
    }

    setButtonState($('createOrgBtn'), true, 'creating…');
    const res = await apiFetch(INIT_API, '/orgs', {
      method: 'POST',
      includeOrganization: false,
      body: {
        name,
        slug: slug || null,
      },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState($('createOrgBtn'), false, 'create team org');
      setMessage('createOrgMsg', payload?.error || 'Failed to create team organization.', 'danger');
      toast(payload?.error || 'Failed to create team organization.', 'danger');
      return;
    }

    const organization = payload?.organization || null;
    if ($('createOrgNameInput')) $('createOrgNameInput').value = '';
    if ($('createOrgSlugInput')) $('createOrgSlugInput').value = '';
    setMessage('createOrgMsg', 'Team organization created. Switching now…', 'ok');
    toast('Team organization created.', 'ok');
    if (organization?.id) {
      persistOrganizationSelection(organization.id);
      syncOrganizationUrl(organization.id);
    }
    await load({ preferFreshSelection: false });
    setButtonState($('createOrgBtn'), false, 'create team org');
  }

  async function saveOrganizationProfile() {
    const organization = currentOrgPayload?.organization || null;
    if (!organization) return;
    setButtonState($('saveOrgBtn'), true, 'saving…');
    const res = await apiFetch(INIT_API, '/orgs/current', {
      method: 'PUT',
      body: {
        name: $('orgNameInput')?.value || '',
        slug: $('orgSlugInput')?.value || '',
      },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState($('saveOrgBtn'), false, 'save changes');
      setMessage('profileMsg', payload?.error || 'Failed to update organization.', 'danger');
      toast(payload?.error || 'Failed to update organization.', 'danger');
      return;
    }
    setMessage('profileMsg', 'Organization profile updated.', 'ok');
    toast('Organization profile updated.', 'ok');
    await load();
  }

  async function transferOwnership() {
    const select = $('transferTargetSelect');
    if (!select || !select.value) {
      setMessage('transferMsg', 'Choose a member to transfer ownership to.', 'warn');
      toast('Choose a member to transfer ownership to.', 'warn');
      return;
    }
    setButtonState($('transferOwnershipBtn'), true, 'transferring…');
    const res = await apiFetch(INIT_API, '/orgs/current/transfer-ownership', {
      method: 'POST',
      body: { target_user_id: select.value },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState($('transferOwnershipBtn'), false, 'transfer ownership');
      setMessage('transferMsg', payload?.error || 'Failed to transfer ownership.', 'danger');
      toast(payload?.error || 'Failed to transfer ownership.', 'danger');
      return;
    }
    setMessage('transferMsg', 'Ownership transferred. Your role is now admin.', 'ok');
    toast('Ownership transferred.', 'ok');
    await load();
  }

  async function archiveOrganization() {
    const organization = currentOrgPayload?.organization || null;
    const confirmationName = $('archiveConfirmInput')?.value || '';
    if (!organization) return;
    if (confirmationName !== organization.name) {
      setMessage('archiveMsg', 'Type the organization name exactly to confirm archive.', 'warn');
      toast('Type the organization name exactly to confirm archive.', 'warn');
      return;
    }
    setButtonState($('archiveOrgBtn'), true, 'archiving…');
    const res = await apiFetch(INIT_API, '/orgs/current/archive', {
      method: 'POST',
      body: { confirmation_name: confirmationName },
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState($('archiveOrgBtn'), false, 'archive organization');
      setMessage('archiveMsg', payload?.error || 'Failed to archive organization.', 'danger');
      toast(payload?.error || 'Failed to archive organization.', 'danger');
      return;
    }
    setMessage('archiveMsg', 'Organization archived. Switching to another workspace…', 'ok');
    toast('Organization archived.', 'ok');
    persistOrganizationSelection(null);
    await load({ preferFreshSelection: true, redirectOnMissingOrg: true });
  }

  async function restoreArchivedOrganization(orgId) {
    const button = document.querySelector(`[data-restore-org="${CSS.escape(orgId)}"]`);
    setButtonState(button, true, 'restoring…');
    const res = await apiFetch(INIT_API, `/orgs/${encodeURIComponent(orgId)}/unarchive`, {
      method: 'POST',
      includeOrganization: false,
    });
    const payload = unwrapPayload(res?.data) || {};
    if (!res?.ok) {
      setButtonState(button, false, 'restore');
      setExportMessage(payload?.error || 'Failed to restore organization.', 'danger');
      toast(payload?.error || 'Failed to restore organization.', 'danger');
      return;
    }
    setExportMessage('Archived organization restored.', 'ok');
    toast('Archived organization restored.', 'ok');
    await load({ preferFreshSelection: false });
  }

  async function load(options) {
    const opts = options || {};
    const orgsRes = await apiFetch(INIT_API, '/orgs', { includeOrganization: false });
    const orgsPayload = unwrapPayload(orgsRes?.data) || {};
    currentOrgsPayload = orgsPayload;
    availableOrganizations = Array.isArray(orgsPayload.organizations) ? orgsPayload.organizations : [];
    archivedOrganizations = Array.isArray(orgsPayload.archived_organizations) ? orgsPayload.archived_organizations : [];

    const chosen = chooseOrganization(availableOrganizations, orgsPayload.active_organization_id);
    if (opts.preferFreshSelection || !currentOrganizationId || !availableOrganizations.some((org) => org.id === currentOrganizationId)) {
      persistOrganizationSelection(chosen?.id || null);
    }
    syncOrganizationUrl(currentOrganizationId);
    renderOrganizationSelector();

    if (!currentOrganizationId) {
      currentOrgPayload = null;
      currentMembersPayload = null;
      renderBanner(null, null);
      renderKpis(null);
      renderProfile(null);
      renderTransfer(null, null);
      renderArchive(null);
      renderCreateOrg(null);
      renderSsoPrep(null);
      renderPilotKit();
      renderPosture(null, null);
      renderArchivedOrganizations();
      setText('profileStatus', 'unavailable');
      setText('transferStatus', 'unavailable');
      setText('archiveStatus', 'unavailable');
      setText('pageMeta', '/ org');
      setText('bannerCopy', archivedOrganizations.length ? 'No active org is selected. Restore an archived workspace below or switch back to the solo dashboard.' : 'No active organization is available for this session.');
      setText('bannerTitle', 'Organization controls unavailable');
      setText('profileHint', 'Create or join an organization to manage org settings here.');
      setText('createOrgStatus', 'ready');
      renderUsageBox(null);
      if (opts.redirectOnMissingOrg) {
        window.location.href = '/app/';
      }
      return;
    }

    const [currentRes, membersRes] = await Promise.all([
      apiFetch(INIT_API, '/orgs/current'),
      apiFetch(INIT_API, '/members'),
    ]);

    currentOrgPayload = unwrapPayload(currentRes?.data) || {};
    currentMembersPayload = unwrapPayload(membersRes?.data) || {};

    renderBanner(currentOrgPayload, currentMembersPayload);
    renderKpis(currentOrgPayload);
    renderProfile(currentOrgPayload);
    renderTransfer(currentOrgPayload, currentMembersPayload);
    renderArchive(currentOrgPayload);
    renderCreateOrg(currentOrgPayload);
    renderSsoPrep(currentOrgPayload);
    renderPilotKit();
    renderPosture(currentOrgPayload, currentMembersPayload);
    renderArchivedOrganizations();
    renderUsageBox(currentOrgPayload);
  }

  function bind() {
    $('signOutBtn')?.addEventListener('click', logout);
    $('refreshBtn')?.addEventListener('click', () => load());
    $('copyOrgReportBtn')?.addEventListener('click', copyOrgReport);
    $('copyOrgReportInlineBtn')?.addEventListener('click', copyOrgReport);
    $('downloadOrgJsonBtn')?.addEventListener('click', downloadOrgJson);
    $('downloadOrgJsonInlineBtn')?.addEventListener('click', downloadOrgJson);
    $('copyOrgPilotBriefBtn')?.addEventListener('click', copyOrgPilotBrief);
    $('saveSsoPrepBtn')?.addEventListener('click', saveSsoPrep);
    $('copySsoPrepBriefBtn')?.addEventListener('click', copySsoPrepBrief);
    $('copySsoMetadataBtn')?.addEventListener('click', copySsoMetadataUrl);
    $('copySsoAcsBtn')?.addEventListener('click', copySsoAcsUrl);
    $('createOrgBtn')?.addEventListener('click', createOrganization);
    $('saveOrgBtn')?.addEventListener('click', saveOrganizationProfile);
    $('transferOwnershipBtn')?.addEventListener('click', transferOwnership);
    $('archiveOrgBtn')?.addEventListener('click', archiveOrganization);
    $('orgSelect')?.addEventListener('change', async (event) => {
      const nextId = event.target.value || null;
      persistOrganizationSelection(nextId);
      syncOrganizationUrl(nextId);
      await load();
    });
    document.addEventListener('click', async (event) => {
      const restoreButton = event.target.closest('[data-restore-org]');
      if (restoreButton) {
        const orgId = restoreButton.getAttribute('data-restore-org');
        if (orgId) await restoreArchivedOrganization(orgId);
      }
    });
  }

  function hydrateUser() {
    setText('user-email', user.email || 'unknown');
    setText('user-avatar', (user.email || 'VP').slice(0, 2).toUpperCase());
  }

  bind();
  hydrateUser();
  load();
})();
