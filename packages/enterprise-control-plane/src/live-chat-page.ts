type ChatIconName =
  | 'alert'
  | 'barChart'
  | 'bell'
  | 'book'
  | 'bot'
  | 'building'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'clock'
  | 'home'
  | 'inbox'
  | 'mail'
  | 'message'
  | 'more'
  | 'paperclip'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'sliders'
  | 'smile'
  | 'sparkles'
  | 'tag'
  | 'user'
  | 'zap';

type MessagingPageName = 'inbox' | 'knowledge' | 'reports' | 'outbound' | 'contacts';

function chatIcon(name: ChatIconName, className = 'chat-icon'): string {
  const paths: Record<ChatIconName, string> = {
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    barChart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    building: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
    check: '<path d="M21.8 10A10 10 0 1 1 17 3.34"/><path d="m9 11 3 3L22 4"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
    sparkles: '<path d="m12 3-1.9 5.8L4 11l6.1 2.2L12 19l1.9-5.8L20 11l-6.1-2.2Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.58 8.58a2 2 0 0 0 2.83 0L21.17 14a2 2 0 0 0 0-2.83z"/><path d="M7 7h.01"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46L12 9h8a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46L12 14z"/>',
  };

  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function renderEnterpriseLiveChatPage(activePage: MessagingPageName = 'inbox'): string {
  const navItems: Array<{ icon: ChatIconName; label: string; href: string; page?: MessagingPageName }> = [
    { icon: 'inbox', label: 'Inbox', href: '/app/inbox', page: 'inbox' },
    { icon: 'book', label: 'Knowledge', href: '/app/knowledge', page: 'knowledge' },
    { icon: 'barChart', label: 'Reports', href: '/app/reports', page: 'reports' },
    { icon: 'send', label: 'Outbound', href: '/app/outbound', page: 'outbound' },
    { icon: 'user', label: 'Contacts', href: '/app/contacts', page: 'contacts' },
    { icon: 'settings', label: 'Settings', href: '/app/settings' },
  ];
  const activeLabel = navItems.find((item) => item.page === activePage)?.label || 'Inbox';
  const activeStreamLabel = activeLabel.toLowerCase();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${activeLabel} - VaultProof Enterprise</title>
  <style>
    :root {
      color-scheme: light;
      --intercom-blue: #0057FF;
      --intercom-navy: #081D34;
      --intercom-bg: #F1F1F1;
      --intercom-surface: #FFFFFF;
      --intercom-border: #E5E7EB;
      --intercom-border-soft: rgba(229, 231, 235, 0.72);
      --intercom-text: #081D34;
      --intercom-muted: #5F6B7A;
      --intercom-timestamp: #94A3B8;
      --intercom-received: #F3F4F6;
      --intercom-sla: #C4E0FD;
      --intercom-online: #DCFCE7;
      --intercom-amber: #FEF3C7;
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      overflow: hidden;
      background: var(--intercom-bg);
      color: var(--intercom-text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    a { color: inherit; text-decoration: none; }
    button, input, textarea {
      font: inherit;
      color: inherit;
    }
    button { cursor: pointer; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible {
      outline: 2px solid var(--intercom-blue);
      outline-offset: 2px;
    }
    .chat-dashboard {
      height: 100vh;
      display: grid;
      grid-template-columns: 64px 360px minmax(0, 1fr) 336px;
      background: var(--intercom-bg);
      color: var(--intercom-text);
    }
    .chat-icon { width: 16px; height: 16px; display: block; }
    .primary-nav {
      width: 64px;
      background: var(--intercom-navy);
      border-right: 1px solid rgba(255,255,255,.08);
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 12px 9px;
      min-height: 0;
    }
    .nav-mark {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      color: #fff;
      background: var(--intercom-blue);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      margin-bottom: 7px;
    }
    .nav-button {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: rgba(255,255,255,.78);
      background: transparent;
      border: 1px solid transparent;
      transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    }
    .nav-button:hover, .nav-button.active {
      color: #fff;
      background: rgba(255,255,255,.11);
      border-color: rgba(255,255,255,.1);
    }
    .nav-spacer { flex: 1; }
    .agent-dot {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: #fff;
      color: var(--intercom-navy);
      font-size: 11px;
      font-weight: 700;
      box-shadow: inset 0 0 0 2px rgba(0,87,255,.12);
      position: relative;
    }
    .agent-dot::after {
      content: "";
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #22C55E;
      border: 2px solid var(--intercom-navy);
    }
    .inbox-stream {
      min-width: 0;
      background: var(--intercom-surface);
      border-right: 1px solid var(--intercom-border);
      display: flex;
      flex-direction: column;
      min-height: 0;
      transition-property: width, min-width, max-width, opacity;
      transition-duration: 300ms;
      transition-timing-function: ease;
    }
    .transition-all { transition-property: all; }
    .duration-300 { transition-duration: 300ms; }
    .stream-header {
      padding: 14px 14px 12px;
      border-bottom: 1px solid var(--intercom-border-soft);
      display: grid;
      gap: 10px;
    }
    .stream-title-row, .conversation-top, .details-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .stream-title {
      margin: 0;
      color: var(--intercom-text);
      font-size: 14px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: 0;
    }
    .stream-meta {
      color: var(--intercom-muted);
      font-size: 11px;
      margin-top: 3px;
    }
    .icon-button {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 1px solid var(--intercom-border);
      border-radius: 10px;
      background: #fff;
      color: var(--intercom-muted);
      box-shadow: 0 1px 2px rgba(8,29,52,.04);
    }
    .icon-button:hover {
      color: var(--intercom-blue);
      border-color: rgba(0,87,255,.24);
      background: #F8FAFC;
    }
    .search-wrap {
      height: 36px;
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      border: 1px solid var(--intercom-border);
      border-radius: 12px;
      background: #F9FAFB;
      padding: 0 10px;
      color: var(--intercom-muted);
    }
    .search-wrap input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--intercom-text);
      font-size: 12px;
    }
    .search-wrap input::placeholder {
      color: #94A3B8;
    }
    .filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .filter-row::-webkit-scrollbar { display: none; }
    .filter-pill {
      border: 1px solid var(--intercom-border);
      background: #fff;
      color: var(--intercom-muted);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
    }
    .filter-pill.active {
      color: #fff;
      border-color: var(--intercom-blue);
      background: var(--intercom-blue);
    }
    .thread-list {
      min-height: 0;
      overflow: auto;
      padding: 6px;
      display: grid;
      gap: 4px;
    }
    .thread-card {
      width: 100%;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 9px;
      align-items: start;
      border: 1px solid transparent;
      border-radius: 12px;
      background: #fff;
      padding: 10px;
      text-align: left;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .thread-card:hover { background: #F9FAFB; }
    .thread-card.active {
      background: #EEF5FF;
      border-color: rgba(0,87,255,.24);
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: var(--intercom-received);
      color: var(--intercom-text);
      font-size: 11px;
      font-weight: 650;
      position: relative;
      flex: 0 0 auto;
    }
    .avatar.online::after {
      content: "";
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #16A34A;
      border: 2px solid #fff;
    }
    .thread-body { min-width: 0; }
    .thread-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: baseline;
    }
    .thread-name {
      color: var(--intercom-text);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .thread-time {
      color: var(--intercom-timestamp);
      font-size: 11px;
      white-space: nowrap;
    }
    .thread-snippet {
      margin-top: 3px;
      color: var(--intercom-muted);
      font-size: 12px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .thread-tags {
      margin-top: 7px;
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 20px;
      border-radius: 999px;
      padding: 3px 7px;
      color: #0F3A66;
      background: var(--intercom-sla);
      font-size: 10px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }
    .badge.green { color: #166534; background: var(--intercom-online); }
    .badge.amber { color: #92400E; background: var(--intercom-amber); }
    .badge.gray { color: #475569; background: #F1F5F9; }
    .conversation {
      min-width: 0;
      min-height: 0;
      background: var(--intercom-surface);
      border-right: 1px solid var(--intercom-border);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
    .conversation-header {
      min-height: 62px;
      padding: 13px 18px;
      border-bottom: 1px solid var(--intercom-border-soft);
      background: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }
    .conversation-title { min-width: 0; }
    .conversation-title h1 {
      margin: 0;
      color: var(--intercom-text);
      font-size: 14px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .conversation-title p {
      margin: 4px 0 0;
      color: var(--intercom-muted);
      font-size: 12px;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .assign-button {
      min-height: 32px;
      border: 1px solid var(--intercom-border);
      border-radius: 10px;
      background: #fff;
      color: var(--intercom-text);
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(8,29,52,.04);
    }
    .message-scroll {
      min-height: 0;
      overflow: auto;
      background:
        linear-gradient(180deg, rgba(255,255,255,.96), rgba(255,255,255,.96)),
        radial-gradient(circle at 80% 0, rgba(196,224,253,.38), transparent 28%);
      padding: 18px 18px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .day-divider {
      align-self: center;
      color: var(--intercom-timestamp);
      background: #F8FAFC;
      border: 1px solid var(--intercom-border-soft);
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 11px;
    }
    .message-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      max-width: min(680px, 82%);
    }
    .message-row.agent {
      margin-left: auto;
      flex-direction: row-reverse;
    }
    .message-row.agent .avatar {
      background: var(--intercom-blue);
      color: #fff;
    }
    .bubble {
      border-radius: 16px;
      padding: 9px 11px;
      background: var(--intercom-received);
      color: var(--intercom-text);
      font-size: 12px;
      line-height: 1.45;
      box-shadow: 0 1px 2px rgba(8,29,52,.04);
    }
    .message-row.agent .bubble {
      background: var(--intercom-blue);
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .message-row.customer .bubble {
      border-bottom-left-radius: 6px;
    }
    .message-meta {
      color: var(--intercom-timestamp);
      font-size: 10px;
      margin-top: 4px;
    }
    .system-note {
      align-self: center;
      max-width: 560px;
      color: #475569;
      background: #F8FAFC;
      border: 1px solid var(--intercom-border-soft);
      border-radius: 12px;
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.4;
      text-align: center;
    }
    .editor-shell {
      padding: 14px 18px 18px;
      border-top: 1px solid var(--intercom-border-soft);
      background: #fff;
    }
    .editor {
      border: 1px solid var(--intercom-border);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 2px 10px rgba(8,29,52,.06);
      overflow: hidden;
    }
    .editor textarea {
      width: 100%;
      min-height: 72px;
      max-height: 150px;
      resize: vertical;
      border: 0;
      outline: 0;
      padding: 12px 13px;
      color: var(--intercom-text);
      background: transparent;
      font-size: 12px;
      line-height: 1.45;
    }
    .editor textarea::placeholder { color: #94A3B8; }
    .editor-tools {
      min-height: 42px;
      border-top: 1px solid var(--intercom-border-soft);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px;
      background: #F9FAFB;
    }
    .utility-icons, .send-actions {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .utility-button {
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--intercom-muted);
      display: grid;
      place-items: center;
    }
    .utility-button:hover {
      background: #EEF5FF;
      color: var(--intercom-blue);
    }
    .send-button {
      height: 30px;
      border: 0;
      border-radius: 9px;
      background: var(--intercom-blue);
      color: #fff;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 650;
      font-size: 12px;
    }
    .details-panel {
      min-width: 0;
      background: #fff;
      display: flex;
      flex-direction: column;
      min-height: 0;
      transition-property: width, min-width, max-width, opacity;
      transition-duration: 300ms;
      transition-timing-function: ease;
    }
    .details-header {
      padding: 14px;
      border-bottom: 1px solid var(--intercom-border-soft);
      display: grid;
      gap: 11px;
    }
    .profile-card {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .profile-card .avatar {
      width: 42px;
      height: 42px;
      font-size: 13px;
    }
    .profile-name {
      color: var(--intercom-text);
      font-size: 14px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-sub {
      margin-top: 3px;
      color: var(--intercom-muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .details-scroll {
      min-height: 0;
      overflow: auto;
      padding: 12px 14px 16px;
      display: grid;
      gap: 12px;
    }
    .detail-card {
      border: 1px solid var(--intercom-border-soft);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(8,29,52,.04);
      padding: 12px;
    }
    .detail-card h2 {
      margin: 0 0 10px;
      color: var(--intercom-text);
      font-size: 13px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: 0;
    }
    .definition-list {
      display: grid;
      gap: 8px;
      margin: 0;
    }
    .definition-row {
      display: grid;
      grid-template-columns: minmax(84px, .7fr) minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 0 0 8px;
      border-bottom: 1px solid var(--intercom-border-soft);
    }
    .definition-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .definition-list dt {
      color: var(--intercom-muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .definition-list dd {
      margin: 0;
      color: var(--intercom-text);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      text-align: right;
    }
    .tag-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .collapsed-rail {
      display: none;
      width: 56px;
      min-width: 56px;
      border-right: 1px solid var(--intercom-border);
      background: #fff;
      align-items: center;
      flex-direction: column;
      gap: 10px;
      padding: 12px 8px;
      color: var(--intercom-muted);
    }
    .collapsed-rail strong {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      color: var(--intercom-text);
      font-size: 11px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    body.inbox-collapsed .chat-dashboard {
      grid-template-columns: 64px 56px minmax(0, 1fr) 336px;
    }
    body.inbox-collapsed .inbox-stream > *:not(.collapsed-rail) {
      display: none;
    }
    body.inbox-collapsed .inbox-stream .collapsed-rail {
      display: flex;
    }
    body.details-collapsed .chat-dashboard {
      grid-template-columns: 64px 360px minmax(0, 1fr) 56px;
    }
    body.inbox-collapsed.details-collapsed .chat-dashboard {
      grid-template-columns: 64px 56px minmax(0, 1fr) 56px;
    }
    body.details-collapsed .details-panel > *:not(.collapsed-rail) {
      display: none;
    }
    body.details-collapsed .details-panel {
      width: 56px !important;
      min-width: 56px;
      max-width: 56px;
    }
    body.details-collapsed .details-panel .collapsed-rail {
      display: flex;
      border-right: 0;
      border-left: 1px solid var(--intercom-border);
    }
    @media (max-width: 1180px) {
      .chat-dashboard,
      body.inbox-collapsed .chat-dashboard,
      body.details-collapsed .chat-dashboard,
      body.inbox-collapsed.details-collapsed .chat-dashboard {
        grid-template-columns: 64px minmax(280px, 330px) minmax(0, 1fr);
      }
      .details-panel {
        position: fixed;
        inset: 0 0 0 auto;
        width: min(360px, calc(100vw - 64px));
        z-index: 20;
        border-left: 1px solid var(--intercom-border);
        box-shadow: -12px 0 28px rgba(8,29,52,.12);
      }
      body.details-collapsed .details-panel { width: 56px !important; min-width: 56px; max-width: 56px; }
    }
    @media (max-width: 820px) {
      body { overflow: auto; }
      .chat-dashboard,
      body.inbox-collapsed .chat-dashboard,
      body.details-collapsed .chat-dashboard,
      body.inbox-collapsed.details-collapsed .chat-dashboard {
        min-height: 100vh;
        height: auto;
        grid-template-columns: 56px minmax(0, 1fr);
      }
      .primary-nav { width: 56px; padding: 10px 7px; position: sticky; top: 0; height: 100vh; }
      .inbox-stream { min-height: 42vh; border-bottom: 1px solid var(--intercom-border); }
      body.inbox-collapsed .chat-dashboard,
      body.inbox-collapsed.details-collapsed .chat-dashboard {
        grid-template-columns: 56px 56px minmax(0, 1fr);
      }
      body.inbox-collapsed .inbox-stream {
        display: flex;
        grid-column: 2;
        grid-row: 1;
        min-height: 100vh;
        border-bottom: 0;
      }
      .conversation {
        grid-column: 2;
        min-height: 100vh;
        border-right: 0;
      }
      body.inbox-collapsed .conversation {
        grid-column: 3;
        grid-row: 1;
      }
      .message-row { max-width: 94%; }
      .details-panel { width: min(340px, calc(100vw - 56px)); }
      body.details-collapsed .details-panel { width: 56px !important; min-width: 56px; max-width: 56px; }
      .conversation-header { align-items: flex-start; }
      .header-actions { flex-wrap: wrap; justify-content: flex-end; }
      .assign-button span { display: none; }
    }
    @media (max-width: 560px) {
      .chat-dashboard,
      body.details-collapsed .chat-dashboard {
        grid-template-columns: 1fr;
      }
      .primary-nav {
        width: 100%;
        height: 54px;
        min-height: 54px;
        flex-direction: row;
        position: sticky;
        z-index: 10;
        top: 0;
        border-right: 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .nav-mark, .nav-spacer, .agent-dot { display: none; }
      .nav-button { width: 36px; height: 36px; }
      .inbox-stream, .conversation { grid-column: 1; }
      .conversation { min-height: calc(100vh - 54px); }
      .details-panel {
        width: 100%;
        inset: 54px 0 0 0;
      }
      body.details-collapsed .details-panel { width: 52px !important; min-width: 52px; max-width: 52px; left: auto; }
      body.inbox-collapsed .inbox-stream { display: none; }
      body.inbox-collapsed .conversation { grid-column: 1; grid-row: auto; }
      .conversation-header { padding: 12px; }
      .message-scroll { padding: 14px 12px; }
      .editor-shell { padding: 12px; }
    }
  </style>
</head>
<body data-chat-dashboard="vaultproof-enterprise-inbox">
  <div class="chat-dashboard enterprise-live-chat-dashboard">
    <nav class="primary-nav" aria-label="Primary navigation">
      <a class="nav-mark" href="/app/dashboard" title="VaultProof">VP</a>
      ${navItems.map((item) => `<a class="nav-button${item.page === activePage ? ' active' : ''}" href="${item.href}" title="${item.label}" aria-label="${item.label}">${chatIcon(item.icon)}</a>`).join('')}
      <div class="nav-spacer"></div>
      <a class="nav-button" href="/app/docs" title="Docs" aria-label="Docs">${chatIcon('book')}</a>
      <a class="agent-dot" href="/app/members" title="Agent profile" aria-label="Agent profile">VP</a>
    </nav>

    <aside class="inbox-stream transition-all duration-300" aria-label="${activeStreamLabel} stream">
      <div class="collapsed-rail">
        <button id="expandInboxBtn" class="icon-button" type="button" aria-label="Expand ${activeStreamLabel} stream" title="Expand ${activeStreamLabel} stream">${chatIcon('chevronRight')}</button>
        <strong>${activeLabel}</strong>
      </div>
      <div class="stream-header">
        <div class="stream-title-row">
          <div>
            <h2 class="stream-title">${activeLabel}</h2>
            <div class="stream-meta"><span id="threadCount">6</span> conversations</div>
          </div>
          <button id="collapseInboxBtn" class="icon-button" type="button" aria-label="Collapse ${activeStreamLabel} stream" title="Collapse ${activeStreamLabel} stream">${chatIcon('chevronLeft')}</button>
        </div>
        <label class="search-wrap" for="chatSearch">
          ${chatIcon('search')}
          <input id="chatSearch" type="search" autocomplete="off" placeholder="Search conversations" />
        </label>
        <div class="filter-row" role="tablist" aria-label="${activeStreamLabel} filters">
          <button class="filter-pill active" type="button" data-filter="all">All</button>
          <button class="filter-pill" type="button" data-filter="unassigned">Unassigned</button>
          <button class="filter-pill" type="button" data-filter="mine">Mine</button>
          <button class="filter-pill" type="button" data-filter="sla">SLA</button>
          <button class="filter-pill" type="button" data-filter="snoozed">Snoozed</button>
        </div>
      </div>
      <div id="chatThreadList" class="thread-list" aria-live="polite"></div>
    </aside>

    <main class="conversation" aria-label="Active chat">
      <header class="conversation-header">
        <div class="conversation-title">
          <h1 id="conversationTitle">Loading conversation</h1>
          <p id="conversationSubtitle">Customer thread</p>
        </div>
        <div class="header-actions">
          <span id="slaBadge" class="badge">Active SLA</span>
          <button class="assign-button" type="button">${chatIcon('user')}<span>Assign</span></button>
          <button class="icon-button" type="button" aria-label="More actions" title="More actions">${chatIcon('more')}</button>
          <button id="toggleDetailsBtn" class="icon-button" type="button" aria-label="Collapse customer details" title="Collapse customer details">${chatIcon('chevronRight')}</button>
        </div>
      </header>

      <section id="messageScroll" class="message-scroll"></section>

      <section class="editor-shell" aria-label="Reply editor">
        <div class="editor">
          <textarea id="replyEditor" placeholder="Reply to the customer..."></textarea>
          <div class="editor-tools">
            <div class="utility-icons" aria-label="Composer utilities">
              <button class="utility-button" type="button" title="Articles" aria-label="Articles utility">${chatIcon('book')}</button>
              <button class="utility-button" type="button" title="Emoji" aria-label="Emoji picker">${chatIcon('smile')}</button>
              <button class="utility-button" type="button" title="AI expansion assistant" aria-label="AI expansion assistant">${chatIcon('sparkles')}</button>
              <button class="utility-button" type="button" title="Attach file" aria-label="Attach file">${chatIcon('paperclip')}</button>
            </div>
            <div class="send-actions">
              <span class="badge gray">Ctrl Enter</span>
              <button class="send-button" type="button">${chatIcon('send')}Send</button>
            </div>
          </div>
        </div>
      </section>
    </main>

    <aside class="details-panel transition-all duration-300" aria-label="Customer details">
      <div class="collapsed-rail">
        <button id="expandDetailsBtn" class="icon-button" type="button" aria-label="Expand customer details" title="Expand customer details">${chatIcon('chevronLeft')}</button>
        <strong>Details</strong>
      </div>
      <div class="details-header">
        <div class="details-title-row">
          <div class="stream-title">Customer details</div>
          <button id="collapseDetailsBtn" class="icon-button" type="button" aria-label="Collapse customer details" title="Collapse customer details">${chatIcon('chevronRight')}</button>
        </div>
        <div class="profile-card">
          <div id="detailAvatar" class="avatar online">AR</div>
          <div>
            <div id="detailName" class="profile-name">Customer</div>
            <div id="detailCompany" class="profile-sub">Company</div>
          </div>
        </div>
      </div>
      <div class="details-scroll">
        <section class="detail-card">
          <h2>CRM attributes</h2>
          <dl id="crmAttributes" class="definition-list"></dl>
        </section>
        <section class="detail-card">
          <h2>Contact</h2>
          <dl id="contactAttributes" class="definition-list"></dl>
        </section>
        <section class="detail-card">
          <h2>Tracking</h2>
          <dl id="trackingAttributes" class="definition-list"></dl>
        </section>
        <section class="detail-card">
          <h2>Tags</h2>
          <div id="tagCloud" class="tag-cloud"></div>
        </section>
      </div>
    </aside>
  </div>
  <script>
    (function() {
      var threads = [
        {
          id: 'acme-kms',
          customer: 'Ari Ramos',
          initials: 'AR',
          company: 'Acme Robotics',
          subject: 'AWS KMS policy validation',
          email: 'ari@acmerobotics.com',
          status: 'mine',
          priority: 'Active SLA',
          time: '2m',
          online: true,
          snippet: 'We added the role ARN, but the dry-run still says decrypt is denied.',
          tags: ['sla', 'aws-kms', 'enterprise'],
          owner: 'Nelson',
          plan: 'Enterprise',
          arr: '$48K',
          health: 'Launch blocker',
          lastSeen: 'Now',
          location: 'San Francisco, CA',
          tracking: { product: 'Provider slots', firstSeen: '21 days ago', sessions: '18', lastPage: '/app/keys', source: 'Guided onboarding' },
          messages: [
            { from: 'system', body: 'Ari opened the AWS KMS setup thread from Provider slots.' },
            { from: 'customer', time: '9:41 AM', body: 'We added the role ARN, but the dry-run still says decrypt is denied. Can you check what we are missing?' },
            { from: 'agent', time: '9:43 AM', body: 'Yes. The role looks present, but the key policy still needs kms:Decrypt for the external ID condition. I can send the exact statement to your platform owner.' },
            { from: 'customer', time: '9:46 AM', body: 'Please do. We want to keep this scoped to the production vault only.' },
            { from: 'agent', time: '9:48 AM', body: 'Good call. I will keep it scoped to the production key ARN and the VaultProof tenant external ID.' }
          ]
        },
        {
          id: 'northwind-sso',
          customer: 'Mina Patel',
          initials: 'MP',
          company: 'Northwind Health',
          subject: 'SSO redirect test',
          email: 'mina@northwindhealth.com',
          status: 'unassigned',
          priority: 'Unassigned',
          time: '11m',
          online: false,
          snippet: 'Our Entra test user gets redirected back to login after approving access.',
          tags: ['unassigned', 'sso', 'healthcare'],
          owner: 'Unassigned',
          plan: 'Enterprise',
          arr: '$72K',
          health: 'Needs triage',
          lastSeen: '11m ago',
          location: 'Boston, MA',
          tracking: { product: 'SSO', firstSeen: '34 days ago', sessions: '24', lastPage: '/app/login', source: 'Security review' },
          messages: [
            { from: 'system', body: 'Conversation routed from SSO setup.' },
            { from: 'customer', time: '9:29 AM', body: 'Our Entra test user gets redirected back to login after approving access.' },
            { from: 'customer', time: '9:30 AM', body: 'The browser shows the enterprise host, not the root site, so I think the redirect URL is right.' }
          ]
        },
        {
          id: 'atlas-denied',
          customer: 'Jordan Lee',
          initials: 'JL',
          company: 'Atlas Commerce',
          subject: 'Policy denied checkout calls',
          email: 'jordan@atlascommerce.com',
          status: 'mine',
          priority: 'Active SLA',
          time: '18m',
          online: true,
          snippet: 'Checkout calls are blocked after we enabled strict origin.',
          tags: ['sla', 'policy', 'checkout'],
          owner: 'Max',
          plan: 'Pilot',
          arr: '$18K',
          health: 'Policy review',
          lastSeen: 'Now',
          location: 'Austin, TX',
          tracking: { product: 'Control', firstSeen: '12 days ago', sessions: '11', lastPage: '/app/control', source: 'Paid pilot' },
          messages: [
            { from: 'customer', time: '9:18 AM', body: 'Checkout calls are blocked after we enabled strict origin.' },
            { from: 'agent', time: '9:20 AM', body: 'I see the allowlist has staging only. Add the production origin and keep the method list to POST for checkout.' }
          ]
        },
        {
          id: 'zenith-snoozed',
          customer: 'Elena Moore',
          initials: 'EM',
          company: 'Zenith AI',
          subject: 'Renewal evidence packet',
          email: 'elena@zenith.ai',
          status: 'snoozed',
          priority: 'Snoozed',
          time: '1h',
          online: false,
          snippet: 'Following up tomorrow after procurement reviews the evidence export.',
          tags: ['snoozed', 'evidence', 'renewal'],
          owner: 'Nelson',
          plan: 'Enterprise',
          arr: '$96K',
          health: 'Healthy',
          lastSeen: '1h ago',
          location: 'New York, NY',
          tracking: { product: 'Evidence packet', firstSeen: '48 days ago', sessions: '31', lastPage: '/app/evidence', source: 'Expansion review' },
          messages: [
            { from: 'system', body: 'Snoozed until tomorrow at 9:00 AM.' },
            { from: 'customer', time: '8:44 AM', body: 'Procurement has the evidence export. We should know tomorrow if they need anything else.' }
          ]
        },
        {
          id: 'orbit-alerts',
          customer: 'Noah Chen',
          initials: 'NC',
          company: 'Orbit Finance',
          subject: 'Slack alert destination',
          email: 'noah@orbitfinance.com',
          status: 'unassigned',
          priority: 'Unassigned',
          time: '2h',
          online: false,
          snippet: 'Can someone verify the alert destination before our tabletop?',
          tags: ['unassigned', 'alerts', 'finance'],
          owner: 'Unassigned',
          plan: 'Enterprise',
          arr: '$64K',
          health: 'Waiting',
          lastSeen: '2h ago',
          location: 'Chicago, IL',
          tracking: { product: 'Alerts', firstSeen: '27 days ago', sessions: '16', lastPage: '/app/alerts', source: 'Tabletop prep' },
          messages: [
            { from: 'customer', time: '7:54 AM', body: 'Can someone verify the alert destination before our tabletop?' },
            { from: 'customer', time: '7:55 AM', body: 'We need the policy denial alert and key exposure alert in the same Slack channel.' }
          ]
        },
        {
          id: 'bluepeak-rollout',
          customer: 'Sam Wilson',
          initials: 'SW',
          company: 'BluePeak Labs',
          subject: 'Canary rollout status',
          email: 'sam@bluepeaklabs.com',
          status: 'mine',
          priority: 'Active SLA',
          time: '3h',
          online: true,
          snippet: 'The canary is at 25 percent and latency looks stable.',
          tags: ['sla', 'rollout', 'canary'],
          owner: 'Max',
          plan: 'Pilot',
          arr: '$24K',
          health: 'On track',
          lastSeen: 'Now',
          location: 'Seattle, WA',
          tracking: { product: 'Rollout Manager', firstSeen: '15 days ago', sessions: '19', lastPage: '/app/rollout', source: 'Customer launch' },
          messages: [
            { from: 'customer', time: '6:43 AM', body: 'The canary is at 25 percent and latency looks stable.' },
            { from: 'agent', time: '6:48 AM', body: 'Great. Keep it there until the 30-minute error window closes, then move to 50 percent.' }
          ]
        }
      ];
      var activeId = threads[0].id;
      var activeFilter = 'all';

      function byId(id) { return document.getElementById(id); }
      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }
      function iconNameForTag(tag) {
        if (tag === 'snoozed') return 'amber';
        if (tag === 'unassigned') return 'gray';
        if (tag === 'sla') return '';
        return 'green';
      }
      function threadMatches(thread, query) {
        if (activeFilter !== 'all') {
          if (activeFilter === 'sla' && thread.tags.indexOf('sla') === -1) return false;
          else if (activeFilter !== 'sla' && thread.status !== activeFilter) return false;
        }
        if (!query) return true;
        var haystack = [thread.customer, thread.company, thread.subject, thread.snippet, thread.email, thread.tags.join(' ')].join(' ').toLowerCase();
        return haystack.indexOf(query.toLowerCase()) !== -1;
      }
      function badge(label, tone) {
        return '<span class="badge ' + escapeHtml(tone || '') + '">' + escapeHtml(label) + '</span>';
      }
      function renderThreads() {
        var query = byId('chatSearch') ? byId('chatSearch').value.trim() : '';
        var rows = threads.filter(function(thread) { return threadMatches(thread, query); });
        byId('threadCount').textContent = String(rows.length);
        byId('chatThreadList').innerHTML = rows.length ? rows.map(function(thread) {
          var tagHtml = thread.tags.slice(0, 3).map(function(tag) { return badge(tag, iconNameForTag(tag)); }).join('');
          return '<button class="thread-card ' + (thread.id === activeId ? 'active' : '') + '" type="button" data-thread-id="' + escapeHtml(thread.id) + '">'
            + '<span class="avatar ' + (thread.online ? 'online' : '') + '">' + escapeHtml(thread.initials) + '</span>'
            + '<span class="thread-body">'
            + '<span class="thread-head"><span class="thread-name">' + escapeHtml(thread.customer) + '</span><span class="thread-time">' + escapeHtml(thread.time) + '</span></span>'
            + '<span class="thread-snippet">' + escapeHtml(thread.subject) + ' - ' + escapeHtml(thread.snippet) + '</span>'
            + '<span class="thread-tags">' + tagHtml + '</span>'
            + '</span>'
            + '</button>';
        }).join('') : '<div class="system-note">No conversations match this view.</div>';
      }
      function definitionRow(term, value) {
        return '<div class="definition-row"><dt>' + escapeHtml(term) + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
      }
      function activeThread() {
        return threads.find(function(thread) { return thread.id === activeId; }) || threads[0];
      }
      function renderConversation() {
        var thread = activeThread();
        byId('conversationTitle').textContent = thread.subject;
        byId('conversationSubtitle').textContent = thread.customer + ' at ' + thread.company + ' - ' + thread.owner;
        byId('slaBadge').textContent = thread.priority;
        byId('slaBadge').className = 'badge ' + (thread.priority === 'Snoozed' ? 'amber' : thread.priority === 'Unassigned' ? 'gray' : '');
        byId('messageScroll').innerHTML = '<div class="day-divider">Today</div>' + thread.messages.map(function(message) {
          if (message.from === 'system') {
            return '<div class="system-note">' + escapeHtml(message.body) + '</div>';
          }
          var isAgent = message.from === 'agent';
          return '<div class="message-row ' + (isAgent ? 'agent' : 'customer') + '">'
            + '<div class="avatar ' + (!isAgent && thread.online ? 'online' : '') + '">' + (isAgent ? 'VP' : escapeHtml(thread.initials)) + '</div>'
            + '<div><div class="bubble">' + escapeHtml(message.body) + '</div><div class="message-meta">' + escapeHtml(message.time || '') + '</div></div>'
            + '</div>';
        }).join('');
        byId('detailAvatar').textContent = thread.initials;
        byId('detailAvatar').className = 'avatar ' + (thread.online ? 'online' : '');
        byId('detailName').textContent = thread.customer;
        byId('detailCompany').textContent = thread.company;
        byId('crmAttributes').innerHTML = [
          definitionRow('Company', thread.company),
          definitionRow('Plan', thread.plan),
          definitionRow('ARR', thread.arr),
          definitionRow('Owner', thread.owner),
          definitionRow('Health', thread.health)
        ].join('');
        byId('contactAttributes').innerHTML = [
          definitionRow('Email', thread.email),
          definitionRow('Location', thread.location),
          definitionRow('Last seen', thread.lastSeen)
        ].join('');
        byId('trackingAttributes').innerHTML = [
          definitionRow('Product', thread.tracking.product),
          definitionRow('First seen', thread.tracking.firstSeen),
          definitionRow('Sessions', thread.tracking.sessions),
          definitionRow('Last page', thread.tracking.lastPage),
          definitionRow('Source', thread.tracking.source)
        ].join('');
        byId('tagCloud').innerHTML = thread.tags.map(function(tag) { return badge(tag, iconNameForTag(tag)); }).join('');
      }
      function selectThread(id) {
        activeId = id;
        renderThreads();
        renderConversation();
      }
      byId('chatThreadList').addEventListener('click', function(event) {
        var button = event.target.closest('[data-thread-id]');
        if (button) selectThread(button.getAttribute('data-thread-id'));
      });
      byId('chatSearch').addEventListener('input', renderThreads);
      Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function(button) {
        button.addEventListener('click', function() {
          activeFilter = button.getAttribute('data-filter') || 'all';
          Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function(filterButton) {
            filterButton.classList.toggle('active', filterButton === button);
          });
          renderThreads();
        });
      });
      byId('collapseInboxBtn').addEventListener('click', function() { document.body.classList.add('inbox-collapsed'); });
      byId('expandInboxBtn').addEventListener('click', function() { document.body.classList.remove('inbox-collapsed'); });
      byId('collapseDetailsBtn').addEventListener('click', function() { document.body.classList.add('details-collapsed'); });
      byId('toggleDetailsBtn').addEventListener('click', function() { document.body.classList.toggle('details-collapsed'); });
      byId('expandDetailsBtn').addEventListener('click', function() { document.body.classList.remove('details-collapsed'); });
      function syncResponsivePanels() {
        if (window.innerWidth <= 1180) document.body.classList.add('details-collapsed');
        if (window.innerWidth <= 820) document.body.classList.add('inbox-collapsed');
        if (window.innerWidth <= 560) document.body.classList.add('inbox-collapsed');
      }
      window.addEventListener('resize', syncResponsivePanels);
      byId('replyEditor').addEventListener('keydown', function(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          byId('replyEditor').value = '';
        }
      });
      syncResponsivePanels();
      renderThreads();
      renderConversation();
    })();
  </script>
</body>
</html>`;
}
