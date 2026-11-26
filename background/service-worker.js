/**
 * Background Service Worker (Manifest V3)
 * Keeps zero state in memory; persists all configuration, stats, and logs
 * in chrome.storage.local.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  buttonMode: 'allow_once_first',
  clickDelayMs: 300,
  safeMode: true,
  blockedKeywords: [
    'payment',
    'purchase',
    'checkout',
    'credit card',
    'bank',
    'transfer',
    'buy now',
    'delete account',
    'permanently delete',
    'password',
    'pembayaran',
    'beli',
    'kartu kredit',
    'hapus akun',
    'hapus permanen',
    'kata sandi'
  ],
  customAllowLabels: [],
  showToast: true,
  customOrigins: []
};

const DEFAULT_STATS = {
  totalClicks: 0,
  todayClicks: 0,
  blockedCount: 0,
  countDate: ''
};

const MAX_LOG_ENTRIES = 25;
const CUSTOM_SCRIPT_ID = 'muse-auto-allow-custom-origins';

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getStats() {
  const { stats } = await chrome.storage.local.get('stats');
  const merged = { ...DEFAULT_STATS, ...(stats || {}) };
  const today = getTodayDateString();
  if (merged.countDate !== today) {
    merged.todayClicks = 0;
    merged.countDate = today;
  }
  return merged;
}

async function updateBadge() {
  try {
    const [settings, stats] = await Promise.all([getSettings(), getStats()]);

    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#64748B' });
      await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
      return;
    }

    const badgeText =
      stats.todayClicks > 0
        ? stats.todayClicks > 99
          ? '99+'
          : String(stats.todayClicks)
        : 'ON';

    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: '#16A34A' });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  } catch (err) {
    console.error('[Muse Auto-Allow] Gagal memperbarui badge:', err);
  }
}

async function syncCustomOriginScripts(origins) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CUSTOM_SCRIPT_ID]
    });

    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: [CUSTOM_SCRIPT_ID]
      });
    }

    const validOrigins = [];
    for (const originPattern of origins || []) {
      const hasPermission = await chrome.permissions.contains({
        origins: [originPattern]
      });
      if (hasPermission) {
        validOrigins.push(originPattern);
      }
    }

    if (validOrigins.length > 0) {
      await chrome.scripting.registerContentScripts([
        {
          id: CUSTOM_SCRIPT_ID,
          matches: validOrigins,
          js: ['shared/matcher.js', 'content/content.js'],
          runAt: 'document_idle',
          allFrames: true,
          persistAcrossSessions: true
        }
      ]);
    }
  } catch (err) {
    console.error('[Muse Auto-Allow] Gagal menyinkronkan skrip domain kustom:', err);
  }
}

async function recordEvent(payload, sender) {
  const stats = await getStats();
  const { activityLog = [] } = await chrome.storage.local.get('activityLog');

  const eventType = payload.eventType === 'blocked' ? 'blocked' : 'clicked';

  if (eventType === 'clicked') {
    stats.totalClicks += 1;
    stats.todayClicks += 1;
  } else {
    stats.blockedCount += 1;
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    type: eventType,
    label: payload.label || 'Allow',
    keyword: payload.keyword || '',
    snippet: payload.snippet || '',
    url: payload.url || sender?.tab?.url || ''
  };

  const nextLog = [entry, ...activityLog].slice(0, MAX_LOG_ENTRIES);

  await chrome.storage.local.set({
    stats,
    activityLog: nextLog
  });

  await updateBadge();
  return { stats, entry };
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const { settings, stats, activityLog } = await chrome.storage.local.get([
      'settings',
      'stats',
      'activityLog'
    ]);

    const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const mergedStats = {
      ...DEFAULT_STATS,
      ...(stats || {}),
      countDate: stats?.countDate || getTodayDateString()
    };

    await chrome.storage.local.set({
      settings: mergedSettings,
      stats: mergedStats,
      activityLog: Array.isArray(activityLog) ? activityLog : []
    });

    await syncCustomOriginScripts(mergedSettings.customOrigins);
    await updateBadge();
  } catch (err) {
    console.error('[Muse Auto-Allow] Gagal inisialisasi ekstensi:', err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await syncCustomOriginScripts(settings.customOrigins);
  await updateBadge();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.settings) {
    const nextOrigins = changes.settings.newValue?.customOrigins || [];
    const prevOrigins = changes.settings.oldValue?.customOrigins || [];
    if (JSON.stringify(nextOrigins) !== JSON.stringify(prevOrigins)) {
      await syncCustomOriginScripts(nextOrigins);
    }
    await updateBadge();
  } else if (changes.stats) {
    await updateBadge();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  (async () => {
    try {
      if (message.type === 'RECORD_EVENT') {
        const result = await recordEvent(message.payload || {}, sender);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message.type === 'RESET_STATS') {
        const resetStats = {
          ...DEFAULT_STATS,
          countDate: getTodayDateString()
        };
        await chrome.storage.local.set({
          stats: resetStats,
          activityLog: []
        });
        await updateBadge();
        sendResponse({ ok: true, stats: resetStats });
        return;
      }

      if (message.type === 'SYNC_CUSTOM_SCRIPTS') {
        const settings = await getSettings();
        await syncCustomOriginScripts(settings.customOrigins);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      console.error('[Muse Auto-Allow] Message handler error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
