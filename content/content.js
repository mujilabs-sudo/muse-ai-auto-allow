/**
 * Content script for Muse AI Auto-Allow.
 * Watches the page DOM (and open Shadow DOMs) for Muse AI approval pop-ups
 * and automatically clicks the matching "Allow" button according to user settings.
 */
(function initMuseAutoAllowContent() {
  'use strict';

  // Prevent double injection when registered both statically and programmatically.
  if (window.__museAutoAllowInitialized) return;
  window.__museAutoAllowInitialized = true;

  const matcher = globalThis.MuseAutoAllowMatcher;
  if (!matcher) {
    console.warn('[Muse Auto-Allow] Matcher module not loaded.');
    return;
  }

  const CLICK_COOLDOWN_MS = 4000;
  const BLOCKED_COOLDOWN_MS = 10000;
  const FALLBACK_POLL_MS = 1500;
  const SCAN_DEBOUNCE_MS = 120;

  let currentSettings = { ...matcher.DEFAULT_SETTINGS };
  let scanTimer = null;
  let fallbackInterval = null;
  let toastDismissTimer = null;

  const pendingTimers = new WeakMap();
  const recentClicks = new WeakMap();
  const recentBlocks = new WeakMap();
  const observedRoots = new WeakSet();

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  function observeRoot(targetRoot) {
    if (!targetRoot || observedRoots.has(targetRoot)) return;
    try {
      observer.observe(targetRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'disabled', 'aria-hidden', 'aria-disabled', 'class', 'style']
      });
      observedRoots.add(targetRoot);
    } catch (err) {
      console.debug('[Muse Auto-Allow] Tidak dapat mengobservasi node:', err);
    }
  }

  function isButtonOnCooldown(button) {
    if (pendingTimers.has(button)) return true;

    const now = Date.now();
    const lastClicked = recentClicks.get(button);
    if (lastClicked && now - lastClicked < CLICK_COOLDOWN_MS) {
      return true;
    }

    const lastBlocked = recentBlocks.get(button);
    if (lastBlocked && now - lastBlocked < BLOCKED_COOLDOWN_MS) {
      return true;
    }

    return false;
  }

  function ensureToastHost() {
    let host = document.getElementById('muse-auto-allow-toast-host');
    if (host) return host;

    host = document.createElement('div');
    host.id = 'muse-auto-allow-toast-host';
    host.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        color-scheme: light dark;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 320px;
        padding: 10px 14px;
        border-radius: 10px;
        font: 500 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.28);
        box-shadow: 0 10px 25px rgba(2, 6, 23, 0.35);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 160ms ease, transform 160ms ease;
      }
      .toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        flex: 0 0 auto;
        background: #22c55e;
      }
      .toast.warn .dot {
        background: #f59e0b;
      }
      @media (prefers-reduced-motion: reduce) {
        .toast {
          transition: none;
          transform: none;
        }
      }
    `;

    const box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');

    const dot = document.createElement('span');
    dot.className = 'dot';

    const msg = document.createElement('span');
    msg.className = 'msg';

    box.append(dot, msg);
    shadow.append(style, box);
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  function showPageToast(message, variant = 'success') {
    if (!currentSettings.showToast) return;
    if (window.top !== window) return; // Show toast in top frame only to prevent duplicates.

    requestAnimationFrame(() => {
      const host = ensureToastHost();
      const box = host.shadowRoot?.querySelector('.toast');
      const msgEl = host.shadowRoot?.querySelector('.msg');
      if (!box || !msgEl) return;

      box.classList.toggle('warn', variant === 'warn');
      msgEl.textContent = message;
      box.classList.add('visible');

      if (toastDismissTimer) clearTimeout(toastDismissTimer);
      toastDismissTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          box.classList.remove('visible');
        });
      }, 2800);
    });
  }

  async function notifyBackground(eventType, details) {
    try {
      await chrome.runtime.sendMessage({
        type: 'RECORD_EVENT',
        payload: {
          eventType,
          label: details.label,
          keyword: details.keyword || '',
          snippet: details.snippet || '',
          url: window.location.href
        }
      });
    } catch {
      // Extension context may be invalidated after an update/reload.
    }
  }

  function executeClick(candidate) {
    const { button, label, snippet } = candidate;
    if (!currentSettings.enabled) return;
    if (!button || !button.isConnected) return;

    recentClicks.set(button, Date.now());

    try {
      button.focus?.({ preventScroll: true });
      button.click();
    } catch (err) {
      console.warn('[Muse Auto-Allow] Gagal mengklik tombol:', err);
      return;
    }

    showPageToast(`Muse Auto-Allow: Klik "${label}"`);
    void notifyBackground('clicked', { label, snippet });
  }

  function scanForPopups() {
    if (!currentSettings.enabled) return;

    const result = matcher.findApprovalCandidate(document, currentSettings, {
      hostname: window.location.hostname,
      win: window,
      isIgnoredButton: isButtonOnCooldown
    });

    if (!result) return;

    // Observe any newly discovered open Shadow DOM roots for future mutations.
    if (Array.isArray(result.shadowRoots)) {
      for (const shadowRoot of result.shadowRoots) {
        observeRoot(shadowRoot);
      }
    }

    if (result.action === 'blocked') {
      recentBlocks.set(result.button, Date.now());
      showPageToast(
        `Muse Auto-Allow: Dilewati (Mode Aman: "${result.keyword}")`,
        'warn'
      );
      void notifyBackground('blocked', result);
      return;
    }

    if (result.action === 'click' && result.button) {
      const delayMs = Math.max(0, Math.min(5000, Number(currentSettings.clickDelayMs) || 0));

      if (delayMs === 0) {
        executeClick(result);
      } else {
        const timerId = setTimeout(() => {
          pendingTimers.delete(result.button);
          executeClick(result);
        }, delayMs);
        pendingTimers.set(result.button, timerId);
      }
    }
  }

  function scheduleScan() {
    if (!currentSettings.enabled) return;
    if (scanTimer !== null) return;

    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (document.hidden) {
        scanForPopups();
      } else {
        requestAnimationFrame(() => scanForPopups());
      }
    }, SCAN_DEBOUNCE_MS);
  }

  function startWatching() {
    if (!currentSettings.enabled) return;
    observeRoot(document.documentElement);
    scanForPopups();

    if (fallbackInterval === null) {
      fallbackInterval = setInterval(() => {
        if (currentSettings.enabled) {
          scanForPopups();
        }
      }, FALLBACK_POLL_MS);
    }
  }

  function stopWatching() {
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (fallbackInterval !== null) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
  }

  async function loadSettingsAndStart() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      currentSettings = { ...matcher.DEFAULT_SETTINGS, ...(settings || {}) };
      if (currentSettings.enabled) {
        startWatching();
      } else {
        stopWatching();
      }
    } catch (err) {
      console.warn('[Muse Auto-Allow] Gagal membaca pengaturan:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    currentSettings = {
      ...matcher.DEFAULT_SETTINGS,
      ...(changes.settings.newValue || {})
    };
    if (currentSettings.enabled) {
      startWatching();
    } else {
      stopWatching();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'PING_CONTENT') {
      sendResponse({
        ok: true,
        enabled: currentSettings.enabled,
        hostname: window.location.hostname
      });
      return;
    }

    if (message.type === 'SCAN_NOW') {
      scanForPopups();
      sendResponse({ ok: true });
    }
  });

  void loadSettingsAndStart();
})();
