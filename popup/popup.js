/**
 * Popup control panel logic for Muse AI Auto-Allow.
 */
(function initPopup() {
  'use strict';

  const matcher = globalThis.MuseAutoAllowMatcher;
  const DEFAULT_SETTINGS = matcher.DEFAULT_SETTINGS;

  // Feature-detect native <input type="checkbox" switch> (Safari 17.4+).
  // In Chrome, apply styled switch fallback and explicit role="switch".
  if (!('switch' in HTMLInputElement.prototype)) {
    document.documentElement.classList.add('no-native-switch');
    for (const input of document.querySelectorAll('input[type="checkbox"][switch]')) {
      input.setAttribute('role', 'switch');
    }
  }

  const els = {
    enabledToggle: document.getElementById('enabledToggle'),
    statusSubtitle: document.getElementById('statusSubtitle'),
    siteDot: document.getElementById('siteDot'),
    siteStatusText: document.getElementById('siteStatusText'),
    enableSiteBtn: document.getElementById('enableSiteBtn'),
    todayClicks: document.getElementById('todayClicks'),
    totalClicks: document.getElementById('totalClicks'),
    blockedCount: document.getElementById('blockedCount'),
    buttonMode: document.getElementById('buttonMode'),
    clickDelayMs: document.getElementById('clickDelayMs'),
    safeModeToggle: document.getElementById('safeModeToggle'),
    toastToggle: document.getElementById('toastToggle'),
    blockedKeywordsInput: document.getElementById('blockedKeywordsInput'),
    customLabelsInput: document.getElementById('customLabelsInput'),
    saveAdvancedBtn: document.getElementById('saveAdvancedBtn'),
    saveFeedback: document.getElementById('saveFeedback'),
    activityList: document.getElementById('activityList'),
    emptyLogText: document.getElementById('emptyLogText'),
    resetStatsBtn: document.getElementById('resetStatsBtn')
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  let activeTabInfo = null;

  function parseCsvList(raw) {
    return raw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '';
    }
  }

  function renderSettings(settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...settings };
    els.enabledToggle.checked = Boolean(currentSettings.enabled);
    els.statusSubtitle.textContent = currentSettings.enabled
      ? 'Aktif memantau pop-up Muse AI'
      : 'Sedang dijeda (nonaktif)';
    els.buttonMode.value = currentSettings.buttonMode || 'allow_once_first';
    els.clickDelayMs.value = String(currentSettings.clickDelayMs ?? 300);
    els.safeModeToggle.checked = Boolean(currentSettings.safeMode);
    els.toastToggle.checked = Boolean(currentSettings.showToast);
    els.blockedKeywordsInput.value = (currentSettings.blockedKeywords || []).join(', ');
    els.customLabelsInput.value = (currentSettings.customAllowLabels || []).join(', ');
  }

  function renderStats(stats) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayClicks = stats?.countDate === todayStr ? (stats.todayClicks || 0) : 0;

    els.todayClicks.textContent = String(todayClicks);
    els.totalClicks.textContent = String(stats?.totalClicks || 0);
    els.blockedCount.textContent = String(stats?.blockedCount || 0);
  }

  function renderActivityLog(entries) {
    els.activityList.textContent = '';

    if (!Array.isArray(entries) || entries.length === 0) {
      els.emptyLogText.hidden = false;
      return;
    }

    els.emptyLogText.hidden = true;
    const fragment = document.createDocumentFragment();

    for (const item of entries.slice(0, 12)) {
      const li = document.createElement('li');
      li.className = 'activity-item';

      const top = document.createElement('div');
      top.className = 'activity-top';

      const badge = document.createElement('span');
      badge.className = item.type === 'blocked' ? 'activity-badge blocked' : 'activity-badge';
      badge.textContent =
        item.type === 'blocked'
          ? `Dilewati (${item.keyword || 'Aman'})`
          : `Klik "${item.label || 'Allow'}"`;

      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = formatTime(item.timestamp);

      top.append(badge, time);
      li.append(top);

      if (item.snippet) {
        const snippet = document.createElement('p');
        snippet.className = 'activity-snippet';
        snippet.textContent = item.snippet;
        snippet.title = item.snippet;
        li.append(snippet);
      }

      fragment.append(li);
    }

    els.activityList.append(fragment);
  }

  async function savePartialSettings(patch) {
    const { settings } = await chrome.storage.local.get('settings');
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}), ...patch };
    await chrome.storage.local.set({ settings: merged });
    renderSettings(merged);
  }

  async function inspectActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        els.siteDot.className = 'status-dot';
        els.siteStatusText.textContent = 'Tab sistem Chrome';
        els.enableSiteBtn.hidden = true;
        return;
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(tab.url);
      } catch {
        els.siteDot.className = 'status-dot';
        els.siteStatusText.textContent = 'Halaman internal browser';
        els.enableSiteBtn.hidden = true;
        return;
      }

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        els.siteDot.className = 'status-dot';
        els.siteStatusText.textContent = 'Halaman internal browser';
        els.enableSiteBtn.hidden = true;
        return;
      }

      const originPattern = `${parsedUrl.origin}/*`;
      activeTabInfo = { tabId: tab.id, hostname: parsedUrl.hostname, originPattern };

      if (matcher.isMuseHost(parsedUrl.hostname)) {
        els.siteDot.className = 'status-dot active';
        els.siteStatusText.textContent = `Aktif di ${parsedUrl.hostname} (Muse AI)`;
        els.enableSiteBtn.hidden = true;
        return;
      }

      const hasOriginPermission = await chrome.permissions.contains({
        origins: [originPattern]
      });
      const isSavedCustom = (currentSettings.customOrigins || []).includes(originPattern);

      if (hasOriginPermission && isSavedCustom) {
        els.siteDot.className = 'status-dot active';
        els.siteStatusText.textContent = `Aktif (kustom) di ${parsedUrl.hostname}`;
        els.enableSiteBtn.hidden = true;
      } else {
        els.siteDot.className = 'status-dot standby';
        els.siteStatusText.textContent = `Bukan domain Muse (${parsedUrl.hostname})`;
        els.enableSiteBtn.hidden = false;
      }
    } catch (err) {
      console.error('[Muse Auto-Allow] Gagal memeriksa tab:', err);
    }
  }

  async function handleEnableCurrentSite() {
    if (!activeTabInfo) return;
    const { tabId, originPattern, hostname } = activeTabInfo;

    try {
      // Request optional host permission directly within the user gesture (no await before it).
      const granted = await chrome.permissions.request({
        origins: [originPattern]
      });

      if (!granted) return;

      const existingOrigins = Array.isArray(currentSettings.customOrigins)
        ? currentSettings.customOrigins
        : [];
      const nextOrigins = [...new Set([...existingOrigins, originPattern])];

      await savePartialSettings({ customOrigins: nextOrigins });
      await chrome.runtime.sendMessage({ type: 'SYNC_CUSTOM_SCRIPTS' });

      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['shared/matcher.js', 'content/content.js']
        });
      } catch (injectErr) {
        console.warn('[Muse Auto-Allow] Injeksi langsung dilewati:', injectErr.message);
      }

      els.siteDot.className = 'status-dot active';
      els.siteStatusText.textContent = `Aktif (kustom) di ${hostname}`;
      els.enableSiteBtn.hidden = true;
    } catch (err) {
      console.error('[Muse Auto-Allow] Gagal mengaktifkan domain kustom:', err);
    }
  }

  async function loadInitialState() {
    try {
      const data = await chrome.storage.local.get(['settings', 'stats', 'activityLog']);
      renderSettings(data.settings || DEFAULT_SETTINGS);
      renderStats(data.stats);
      renderActivityLog(data.activityLog || []);
      await inspectActiveTab();
    } catch (err) {
      console.error('[Muse Auto-Allow] Gagal memuat state popup:', err);
    }
  }

  els.enabledToggle.addEventListener('change', async () => {
    await savePartialSettings({ enabled: els.enabledToggle.checked });
  });

  els.buttonMode.addEventListener('change', async () => {
    await savePartialSettings({ buttonMode: els.buttonMode.value });
  });

  els.clickDelayMs.addEventListener('change', async () => {
    const raw = parseInt(els.clickDelayMs.value, 10);
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(5000, raw)) : 300;
    els.clickDelayMs.value = String(clamped);
    await savePartialSettings({ clickDelayMs: clamped });
  });

  els.safeModeToggle.addEventListener('change', async () => {
    await savePartialSettings({ safeMode: els.safeModeToggle.checked });
  });

  els.toastToggle.addEventListener('change', async () => {
    await savePartialSettings({ showToast: els.toastToggle.checked });
  });

  els.saveAdvancedBtn.addEventListener('click', async () => {
    const blockedKeywords = parseCsvList(els.blockedKeywordsInput.value);
    const customAllowLabels = parseCsvList(els.customLabelsInput.value);
    await savePartialSettings({ blockedKeywords, customAllowLabels });
    els.saveFeedback.textContent = 'Tersimpan!';
    setTimeout(() => {
      els.saveFeedback.textContent = '';
    }, 2000);
  });

  els.enableSiteBtn.addEventListener('click', () => {
    void handleEnableCurrentSite();
  });

  els.resetStatsBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
    } catch (err) {
      console.error('[Muse Auto-Allow] Gagal mereset statistik:', err);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.settings?.newValue) {
      renderSettings(changes.settings.newValue);
    }
    if (changes.stats?.newValue) {
      renderStats(changes.stats.newValue);
    }
    if (changes.activityLog?.newValue) {
      renderActivityLog(changes.activityLog.newValue);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    void loadInitialState();
  });
})();
