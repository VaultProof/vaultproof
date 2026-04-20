(function() {
  if (window.VaultproofToast) return;

  const STYLE_ID = 'vp-toast-style';
  const ROOT_ID = 'vp-toast-root';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 1000;
        display: grid;
        gap: 10px;
        max-width: min(360px, calc(100vw - 32px));
        pointer-events: none;
      }
      .vp-toast {
        border: 1px solid #e7e5de;
        border-left-width: 4px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 40px rgba(23, 23, 23, 0.12);
        padding: 12px 14px;
        color: #171717;
        font-family: Inter, system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 160ms ease, transform 160ms ease;
      }
      .vp-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .vp-toast.ok { border-left-color: #15803d; }
      .vp-toast.warn { border-left-color: #b45309; }
      .vp-toast.danger { border-left-color: #b91c1c; }
      .vp-toast.neutral { border-left-color: #8a8a82; }
      .vp-toast-title {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.7px;
        text-transform: uppercase;
        color: #8a8a82;
        margin-bottom: 4px;
      }
      .vp-toast-body {
        white-space: pre-wrap;
        word-break: break-word;
      }
      @media (max-width: 680px) {
        #${ROOT_ID} {
          right: 12px;
          left: 12px;
          bottom: 12px;
          max-width: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    return root;
  }

  function show(message, tone, title, duration) {
    if (!message) return;
    ensureStyle();
    const root = ensureRoot();
    const toast = document.createElement('div');
    const resolvedTone = tone || 'neutral';
    toast.className = `vp-toast ${resolvedTone}`;
    toast.innerHTML = `
      <div class="vp-toast-title">${title || 'VaultProof'}</div>
      <div class="vp-toast-body"></div>
    `;
    const body = toast.querySelector('.vp-toast-body');
    if (body) body.textContent = message;
    root.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('is-visible');
    });

    const timeoutMs = typeof duration === 'number' ? duration : 3200;
    const remove = function() {
      toast.classList.remove('is-visible');
      window.setTimeout(function() {
        toast.remove();
      }, 180);
    };

    const timer = window.setTimeout(remove, timeoutMs);
    toast.addEventListener('click', function() {
      window.clearTimeout(timer);
      remove();
    });
  }

  window.VaultproofToast = { show };
})();
