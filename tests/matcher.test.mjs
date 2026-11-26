import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const matcher = require('../shared/matcher.js');

/**
 * Lightweight mock DOM builder to exercise Shadow DOM traversal,
 * approval card context detection, button priority, and Safe Mode filtering.
 */
function createMockElement(tagName, props = {}) {
  const attrs = new Map(Object.entries(props.attrs || {}));
  const children = [];
  let shadowRoot = null;

  const el = {
    tagName: tagName.toUpperCase(),
    id: props.id || '',
    className: props.className || '',
    disabled: Boolean(props.disabled),
    hidden: Boolean(props.hidden),
    value: props.value || '',
    textContent: props.text || '',
    innerText: props.text || '',
    parentElement: null,
    children,
    get shadowRoot() {
      return shadowRoot;
    },
    attachShadowMock(sr) {
      shadowRoot = sr;
      sr.host = el;
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    getRootNode() {
      let cur = el;
      while (cur.parentElement) cur = cur.parentElement;
      return cur._rootNode || cur;
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (matchesSimpleSelector(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    getBoundingClientRect() {
      return props.rect || { width: 100, height: 36 };
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = el;
        children.push(node);
      }
      refreshText(el);
    },
    querySelectorAll(selector) {
      const results = [];
      const selectors = selector.split(',').map((s) => s.trim());
      function walk(node) {
        for (const child of node.children) {
          if (selectors.some((sel) => matchesSimpleSelector(child, sel))) {
            results.push(child);
          }
          walk(child);
        }
      }
      walk(el);
      return results;
    }
  };

  return el;
}

function createMockShadowRoot() {
  const sr = createMockElement('SHADOW-ROOT');
  sr._rootNode = sr;
  sr.append = (...nodes) => {
    for (const node of nodes) {
      node._rootNode = sr;
      sr.children.push(node);
    }
  };
  return sr;
}

function refreshText(el) {
  let cur = el;
  while (cur) {
    if (cur.children.length > 0) {
      const joined = [
        cur._ownText || '',
        ...cur.children.map((c) => c.innerText || c.textContent || '')
      ]
        .filter(Boolean)
        .join(' ');
      cur.textContent = joined;
      cur.innerText = joined;
    }
    cur = cur.parentElement;
  }
}

function matchesSimpleSelector(el, selector) {
  if (selector === '*') return true;
  if (selector === 'button') return el.tagName === 'BUTTON';
  if (selector === '[role="button"]') return el.getAttribute('role') === 'button';
  if (selector === 'input[type="button"]') {
    return el.tagName === 'INPUT' && el.getAttribute('type') === 'button';
  }
  if (selector === 'input[type="submit"]') {
    return el.tagName === 'INPUT' && el.getAttribute('type') === 'submit';
  }
  if (selector.includes('[hidden]')) {
    return el.hidden || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true';
  }
  return false;
}

function createDoc(...nodes) {
  const body = createMockElement('body');
  body.append(...nodes);
  return body;
}

test('clicks "Allow" on a standard Muse AI approval card on muse.ai', () => {
  const card = createMockElement('div', { attrs: { role: 'dialog', 'aria-modal': 'true' } });
  const msg = createMockElement('p', { text: 'Muse wants to open github.com and read repository files.' });
  const denyBtn = createMockElement('button', { text: 'Deny' });
  const allowBtn = createMockElement('button', { text: 'Allow' });
  card.append(msg, denyBtn, allowBtn);

  const doc = createDoc(card);
  const res = matcher.findApprovalCandidate(doc, matcher.DEFAULT_SETTINGS, {
    hostname: 'muse.ai'
  });

  assert.equal(res.action, 'click');
  assert.equal(res.button, allowBtn);
  assert.equal(res.label, 'allow');
});

test('prefers "Allow once" in allow_once_first mode and "Always allow" in always_allow_first mode', () => {
  const card = createMockElement('div', { attrs: { 'data-testid': 'approval-card' } });
  const msg = createMockElement('p', { text: 'Muse wants to run a scheduled task.' });
  const denyBtn = createMockElement('button', { text: 'Deny' });
  const alwaysBtn = createMockElement('button', { text: 'Always allow' });
  const onceBtn = createMockElement('button', { text: 'Allow once' });
  card.append(msg, denyBtn, alwaysBtn, onceBtn);

  const doc = createDoc(card);

  const resOnce = matcher.findApprovalCandidate(
    doc,
    { ...matcher.DEFAULT_SETTINGS, buttonMode: 'allow_once_first' },
    { hostname: 'muse.meta.com' }
  );
  assert.equal(resOnce.action, 'click');
  assert.equal(resOnce.button, onceBtn);

  const resAlways = matcher.findApprovalCandidate(
    doc,
    { ...matcher.DEFAULT_SETTINGS, buttonMode: 'always_allow_first' },
    { hostname: 'muse.meta.com' }
  );
  assert.equal(resAlways.action, 'click');
  assert.equal(resAlways.button, alwaysBtn);
});

test('supports Indonesian button labels (Izinkan / Tolak)', () => {
  const card = createMockElement('div', { attrs: { role: 'dialog' } });
  const msg = createMockElement('p', { text: 'Muse ingin mengakses dokumen Anda.' });
  const rejectBtn = createMockElement('button', { text: 'Tolak' });
  const allowBtn = createMockElement('button', { text: 'Izinkan' });
  card.append(msg, rejectBtn, allowBtn);

  const doc = createDoc(card);
  const res = matcher.findApprovalCandidate(doc, matcher.DEFAULT_SETTINGS, {
    hostname: 'meta.ai'
  });

  assert.equal(res.action, 'click');
  assert.equal(res.button, allowBtn);
  assert.equal(res.label, 'izinkan');
});

test('blocks sensitive payment popups when Safe Mode is enabled', () => {
  const card = createMockElement('div', { attrs: { role: 'dialog' } });
  const msg = createMockElement('p', { text: 'Muse wants to complete payment and checkout $99.' });
  const denyBtn = createMockElement('button', { text: 'Deny' });
  const allowBtn = createMockElement('button', { text: 'Allow' });
  card.append(msg, denyBtn, allowBtn);

  const doc = createDoc(card);

  const resSafe = matcher.findApprovalCandidate(
    doc,
    { ...matcher.DEFAULT_SETTINGS, safeMode: true },
    { hostname: 'muse.ai' }
  );
  assert.equal(resSafe.action, 'blocked');
  assert.equal(resSafe.keyword, 'payment');

  const resUnsafe = matcher.findApprovalCandidate(
    doc,
    { ...matcher.DEFAULT_SETTINGS, safeMode: false },
    { hostname: 'muse.ai' }
  );
  assert.equal(resUnsafe.action, 'click');
  assert.equal(resUnsafe.button, allowBtn);
});

test('detects Muse AI approval popups inside Shadow DOM on custom domains', () => {
  const host = createMockElement('div', { id: 'muse-agent-overlay' });
  const sr = createMockShadowRoot();
  host.attachShadowMock(sr);

  const dialog = createMockElement('div', { attrs: { role: 'dialog' } });
  const text = createMockElement('p', { text: 'Muse AI wants permission to click submit.' });
  const denyBtn = createMockElement('button', { text: 'Deny' });
  const allowBtn = createMockElement('button', { text: 'Allow' });
  dialog.append(text, denyBtn, allowBtn);
  sr.append(dialog);

  const doc = createDoc(host);
  const res = matcher.findApprovalCandidate(doc, matcher.DEFAULT_SETTINGS, {
    hostname: 'example.com'
  });

  assert.equal(res.action, 'click');
  assert.equal(res.button, allowBtn);
  assert.equal(res.shadowRoots.length, 1);
});

test('ignores unrelated dialogs on non-Muse custom domains and generic cookie banners', () => {
  const cookieModal = createMockElement('div', { attrs: { role: 'dialog' } });
  const cookieText = createMockElement('p', { text: 'We use cookies. Manage cookie preferences.' });
  const declineBtn = createMockElement('button', { text: 'Decline' });
  const allowBtn = createMockElement('button', { text: 'Allow' });
  cookieModal.append(cookieText, declineBtn, allowBtn);

  const doc1 = createDoc(cookieModal);
  const res1 = matcher.findApprovalCandidate(doc1, matcher.DEFAULT_SETTINGS, {
    hostname: 'muse.ai'
  });
  assert.equal(res1.action, 'none');

  const randomModal = createMockElement('div', { attrs: { role: 'dialog' } });
  const randomText = createMockElement('p', { text: 'Allow notifications from News Site?' });
  const cancelBtn = createMockElement('button', { text: 'Cancel' });
  const okBtn = createMockElement('button', { text: 'Allow' });
  randomModal.append(randomText, cancelBtn, okBtn);

  const doc2 = createDoc(randomModal);
  const res2 = matcher.findApprovalCandidate(doc2, matcher.DEFAULT_SETTINGS, {
    hostname: 'news.example.com'
  });
  assert.equal(res2.action, 'none');
});
