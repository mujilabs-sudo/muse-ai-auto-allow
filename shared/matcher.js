/**
 * Pure matching logic for detecting Muse AI approval pop-ups and selecting
 * the right "Allow" button safely without false positives.
 *
 * Works both in Chrome content scripts (globalThis.MuseAutoAllowMatcher)
 * and in Node.js tests (module.exports).
 */
(function initMuseAutoAllowMatcher(root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    buttonMode: 'allow_once_first', // 'allow_once_first' | 'always_allow_first'
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

  const STANDARD_ALLOW_LABELS = [
    'allow',
    'allow once',
    'allow for this task',
    'allow for this site',
    'allow this time',
    'approve',
    'izinkan',
    'izinkan sekali',
    'izinkan untuk tugas ini',
    'setujui'
  ];

  const ALWAYS_ALLOW_LABELS = [
    'always allow',
    'allow always',
    'selalu izinkan'
  ];

  const REJECT_LABELS = new Set([
    'deny',
    'decline',
    'reject',
    'cancel',
    'block',
    "don't allow",
    'do not allow',
    'not now',
    'disallow',
    'tolak',
    'batal',
    'jangan izinkan'
  ]);

  const APPROVAL_CONTEXT_RE =
    /\b(muse|allow|permission|approve|approval|confirm|access|wants to|action|connector|tool|izin|izinkan|setuju|akses|konfirmasi)\b/i;

  const MUSE_BRAND_RE = /\bmuse\b/i;

  const COOKIE_BANNER_RE =
    /\b(cookie policy|cookie preferences|cookie settings|accept all cookies|essential cookies|use cookies)\b/i;

  const DIALOG_ATTR_RE = /(approval|permission|consent|confirm|modal|dialog|popover|prompt)/i;

  const BUTTON_SELECTOR =
    'button, [role="button"], input[type="button"], input[type="submit"]';

  function normalizeText(value) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isMuseHost(hostname) {
    const host = normalizeText(hostname);
    if (!host) return false;
    return (
      host === 'muse.ai' ||
      host.endsWith('.muse.ai') ||
      host === 'muse.meta.com' ||
      host.endsWith('.muse.meta.com') ||
      host === 'meta.ai' ||
      host.endsWith('.meta.ai')
    );
  }

  function getElementLabel(el) {
    if (!el) return '';
    if (el.tagName && el.tagName.toUpperCase() === 'INPUT') {
      return normalizeText(el.value || el.getAttribute?.('aria-label') || '');
    }
    const text = normalizeText(el.innerText || el.textContent || '');
    if (text) return text;
    return normalizeText(el.getAttribute?.('aria-label') || '');
  }

  function getOrderedAllowLabels(settings = DEFAULT_SETTINGS) {
    const custom = Array.isArray(settings.customAllowLabels)
      ? settings.customAllowLabels.map(normalizeText).filter(Boolean)
      : [];

    const ordered =
      settings.buttonMode === 'always_allow_first'
        ? [...ALWAYS_ALLOW_LABELS, ...STANDARD_ALLOW_LABELS, ...custom]
        : [...STANDARD_ALLOW_LABELS, ...custom];

    return [...new Set(ordered)];
  }

  function isElementInteractable(el, win) {
    if (!el) return false;
    if (el.disabled === true) return false;
    if (el.hidden === true) return false;
    if (el.getAttribute?.('aria-disabled') === 'true') return false;
    if (el.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof el.closest === 'function' && el.closest('[hidden], [inert], [aria-hidden="true"]')) {
      return false;
    }

    if (win && typeof win.getComputedStyle === 'function') {
      const style = win.getComputedStyle(el);
      if (style) {
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.pointerEvents === 'none' ||
          parseFloat(style.opacity) === 0
        ) {
          return false;
        }
      }
    }

    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect && rect.width === 0 && rect.height === 0) {
        return false;
      }
    }

    return true;
  }

  function collectInteractiveButtons(rootNode) {
    const buttons = [];
    const shadowRoots = [];
    const visited = new Set();

    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);

      if (typeof node.querySelectorAll === 'function') {
        const matched = node.querySelectorAll(BUTTON_SELECTOR);
        for (const el of matched) {
          buttons.push(el);
        }

        const allElements = node.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) {
            shadowRoots.push(el.shadowRoot);
            walk(el.shadowRoot);
          }
        }
      }
    }

    walk(rootNode);
    return { buttons, shadowRoots };
  }

  function getParentAcrossShadow(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const rootNode = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    if (rootNode && rootNode.host && rootNode.host !== el) {
      return rootNode.host;
    }
    return null;
  }

  function isExplicitDialogElement(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'DIALOG' && el.hasAttribute?.('open')) return true;

    const role = normalizeText(el.getAttribute?.('role') || '');
    if (role === 'dialog' || role === 'alertdialog') return true;
    if (el.getAttribute?.('aria-modal') === 'true') return true;

    const testId = el.getAttribute?.('data-testid') || '';
    const id = el.id || '';
    const className = typeof el.className === 'string' ? el.className : '';
    if (DIALOG_ATTR_RE.test(`${testId} ${id} ${className}`)) {
      return true;
    }
    return false;
  }

  function containerHasRejectButton(container, excludeButton) {
    if (!container || typeof container.querySelectorAll !== 'function') return false;
    const controls = container.querySelectorAll(BUTTON_SELECTOR);
    for (const control of controls) {
      if (control === excludeButton) continue;
      const label = getElementLabel(control);
      if (REJECT_LABELS.has(label)) {
        return true;
      }
    }
    return false;
  }

  function getContainerMetadataText(container) {
    if (!container) return '';
    const parts = [
      container.id || '',
      typeof container.className === 'string' ? container.className : '',
      container.getAttribute?.('data-testid') || '',
      container.getAttribute?.('aria-label') || ''
    ];
    const rootNode = typeof container.getRootNode === 'function' ? container.getRootNode() : null;
    if (rootNode && rootNode.host) {
      parts.push(
        rootNode.host.tagName || '',
        rootNode.host.id || '',
        typeof rootNode.host.className === 'string' ? rootNode.host.className : '',
        rootNode.host.getAttribute?.('data-testid') || ''
      );
    }
    return parts.join(' ');
  }

  function findApprovalContainer(button) {
    let current = getParentAcrossShadow(button);
    let depth = 0;
    let bestFallback = null;

    while (current && depth < 8) {
      const tag = current.tagName ? current.tagName.toUpperCase() : '';
      if (tag === 'BODY' || tag === 'HTML') break;

      const hasReject = containerHasRejectButton(current, button);
      const isDialog = isExplicitDialogElement(current);

      if (isDialog && hasReject) {
        return { container: current, hasReject: true, isDialog: true };
      }

      if (hasReject && !bestFallback) {
        bestFallback = { container: current, hasReject: true, isDialog };
      } else if (isDialog && !bestFallback) {
        bestFallback = { container: current, hasReject: false, isDialog: true };
      }

      current = getParentAcrossShadow(current);
      depth += 1;
    }

    return bestFallback;
  }

  function findBlockedKeyword(text, blockedKeywords) {
    if (!text || !Array.isArray(blockedKeywords) || blockedKeywords.length === 0) {
      return null;
    }
    const lower = normalizeText(text);
    for (const rawKeyword of blockedKeywords) {
      const keyword = normalizeText(rawKeyword);
      if (!keyword) continue;
      if (lower.includes(keyword)) {
        return rawKeyword;
      }
    }
    return null;
  }

  function createSnippet(text, maxLength = 120) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength - 1)}…`;
  }

  /**
   * Finds the highest-priority valid Muse AI approval candidate in the document.
   *
   * @param {Document|Element} rootNode
   * @param {object} userSettings
   * @param {object} [options]
   * @param {string} [options.hostname]
   * @param {Window} [options.win]
   * @param {function(Element): boolean} [options.isIgnoredButton]
   */
  function findApprovalCandidate(rootNode, userSettings = {}, options = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...userSettings };
    if (!settings.enabled) return null;

    const win = options.win || (typeof window !== 'undefined' ? window : null);
    const hostname = options.hostname ?? win?.location?.hostname ?? '';
    const onMuseDomain = isMuseHost(hostname);
    const orderedLabels = getOrderedAllowLabels(settings);
    const labelPriority = new Map(orderedLabels.map((label, idx) => [label, idx]));

    const { buttons, shadowRoots } = collectInteractiveButtons(rootNode);
    const candidates = [];

    for (const button of buttons) {
      if (typeof options.isIgnoredButton === 'function' && options.isIgnoredButton(button)) {
        continue;
      }

      const label = getElementLabel(button);
      if (!labelPriority.has(label)) continue;
      if (!isElementInteractable(button, win)) continue;

      const context = findApprovalContainer(button);
      if (!context || !context.container) continue;

      const containerText = normalizeText(
        context.container.innerText || context.container.textContent || ''
      );
      const containerMeta = getContainerMetadataText(context.container);
      const mentionsMuse = MUSE_BRAND_RE.test(containerText) || MUSE_BRAND_RE.test(containerMeta);

      // Avoid generic cookie banners that are not Muse AI agent approval prompts.
      if (COOKIE_BANNER_RE.test(containerText) && !mentionsMuse) {
        continue;
      }

      if (onMuseDomain) {
        // On official Muse domains, require either a paired reject button or an explicit dialog with approval context.
        const hasValidContext =
          context.hasReject || (context.isDialog && APPROVAL_CONTEXT_RE.test(containerText));
        if (!hasValidContext) continue;
      } else {
        // On custom non-Muse domains, require explicit Muse mention + approval structure.
        const hasValidContext =
          mentionsMuse &&
          (context.hasReject || (context.isDialog && APPROVAL_CONTEXT_RE.test(containerText)));
        if (!hasValidContext) continue;
      }

      candidates.push({
        button,
        label,
        priority: labelPriority.get(label),
        container: context.container,
        containerText,
        rawText: context.container.innerText || context.container.textContent || ''
      });
    }

    if (candidates.length === 0) {
      return { action: 'none', shadowRoots };
    }

    // Prefer highest-priority button label (e.g., "Always allow" in always_allow_first mode,
    // or "Allow" / "Allow once" in allow_once_first mode).
    candidates.sort((a, b) => a.priority - b.priority);
    const chosen = candidates[0];

    if (settings.safeMode) {
      const blockedKeyword = findBlockedKeyword(chosen.containerText, settings.blockedKeywords);
      if (blockedKeyword) {
        return {
          action: 'blocked',
          button: chosen.button,
          label: chosen.label,
          keyword: blockedKeyword,
          snippet: createSnippet(chosen.rawText),
          shadowRoots
        };
      }
    }

    return {
      action: 'click',
      button: chosen.button,
      label: chosen.label,
      snippet: createSnippet(chosen.rawText),
      shadowRoots
    };
  }

  const api = {
    DEFAULT_SETTINGS,
    STANDARD_ALLOW_LABELS,
    ALWAYS_ALLOW_LABELS,
    REJECT_LABELS,
    normalizeText,
    isMuseHost,
    getOrderedAllowLabels,
    findBlockedKeyword,
    findApprovalCandidate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MuseAutoAllowMatcher = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
