// ==UserScript==
// @name         Chaoxing Page Snapshot And Practice Random Picker
// @namespace    https://github.com/Thorndikecat/QiandaoBot
// @version      1.3
// @description  Captures Chaoxing sign/practice page structure and randomly selects one practice option.
// @match        *://chaoxing.com/*
// @match        *://*.chaoxing.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const SNAPSHOT_URL = 'http://localhost:5000/debug/page-snapshot';
  const AUTO_SUBMIT = true;
  const MAX_WAIT_MS = 15000;
  const CHECK_INTERVAL_MS = 500;
  const UNKNOWN_PAGE_SNAPSHOT_DELAY_MS = 5000;
  const MAX_HTML_CHARS = 700000;
  const MAX_TEXT_CHARS = 300;
  const MAX_ITEMS = 120;

  const observedRequests = [];
  let snapshotSent = false;

  const optionSelectors = [
    'input[type="radio"]',
    'input[type="checkbox"]',
    '[role="radio"]',
    '[role="checkbox"]',
    'label',
    '.option',
    '.answer',
    '.choice',
    '.select',
    'li',
  ];

  const submitSelectors = [
    'button',
    'a',
    '[role="button"]',
    '[onclick*="submit" i]',
    '[class*="submit" i]',
    '[id*="submit" i]',
  ];

  const submitTextPattern = /submit|finish|\u63d0\u4ea4|\u786e\u5b9a|\u5b8c\u6210|\u6295\u7968|\u4ea4\u5377/i;
  const nonOptionTextPattern = /submit|finish|back|\u63d0\u4ea4|\u786e\u5b9a|\u5b8c\u6210|\u8fd4\u56de|\u67e5\u770b|\u91cd\u505a/i;

  const clip = (value, max = MAX_TEXT_CHARS) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}...[clipped ${text.length - max}]` : text;
  };

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const getUrlFromFetchInput = (input) => {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return String(input || '');
  };

  const recordRequest = (method, url) => {
    const value = String(url || '');
    if (!value || observedRequests.length >= MAX_ITEMS) return;
    observedRequests.push({
      method: String(method || 'GET').toUpperCase(),
      url: value,
      at: new Date().toISOString(),
    });
  };

  const installNetworkHooks = () => {
    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch;
      window.fetch = function patchedFetch(input, init) {
        recordRequest(init?.method || 'GET', getUrlFromFetchInput(input));
        return originalFetch.apply(this, arguments);
      };
    }

    if (window.XMLHttpRequest?.prototype?.open) {
      const originalOpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
        recordRequest(method, url);
        return originalOpen.apply(this, arguments);
      };
    }
  };

  const isVisible = (element) => {
    if (!element || element.disabled) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const escapeCssIdent = (value) => {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  };

  const findClickableLabel = (input) => {
    if (input.id) {
      const label = document.querySelector(`label[for="${escapeCssIdent(input.id)}"]`);
      if (label && isVisible(label)) return label;
    }
    return input.closest('label') || input;
  };

  const isOptionText = (text) => {
    if (!text) return false;
    if (text.length > 180) return false;
    if (nonOptionTextPattern.test(text)) return false;
    return true;
  };

  const findOptions = () => {
    const candidates = [];
    const seen = new Set();

    for (const element of document.querySelectorAll(optionSelectors.join(','))) {
      if (!isVisible(element)) continue;

      let clickable = element;
      let text = normalizeText(element.innerText || element.textContent || element.value);

      if (element.matches('input[type="radio"], input[type="checkbox"]')) {
        clickable = findClickableLabel(element);
        text = normalizeText(clickable.innerText || clickable.textContent || element.value);
      }

      if (!isVisible(clickable) || !isOptionText(text)) continue;

      const rect = clickable.getBoundingClientRect();
      const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${text}`;
      if (seen.has(key)) continue;

      seen.add(key);
      candidates.push({
        clickable,
        text,
        tag: clickable.tagName,
        id: clickable.id || '',
        className: String(clickable.className || ''),
      });
    }

    return candidates;
  };

  const findSubmitButton = () => {
    for (const element of document.querySelectorAll(submitSelectors.join(','))) {
      if (!isVisible(element)) continue;
      const text = normalizeText(element.innerText || element.textContent || element.value);
      if (submitTextPattern.test(text)) return element;
    }
    return null;
  };

  const getQueryParams = () => {
    const params = {};
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      params[key] = value;
    }
    return params;
  };

  const detectKind = () => {
    const text = `${window.location.pathname} ${document.title}`.toLowerCase();
    if (/ppttestpaper|vote|practice|question|quiz|work|pcvote/.test(text)) return 'practice';
    if (/sign/.test(text)) return 'signin';
    return 'browser';
  };

  const collectApiUrls = (html) => {
    const urls = new Set();
    const absolutePattern = /https?:\/\/[^"'\s<>\\)]+/g;
    const relativePattern = /["'](\/(?:v2\/apis|pptSign|newsign|sign|widget|api)[^"']*)["']/gi;
    const apiAssignmentPattern = /\b(?:url|api|action)\s*[:=]\s*["']([^"']{1,500})["']/gi;

    for (const match of html.matchAll(absolutePattern)) urls.add(match[0]);
    for (const match of html.matchAll(relativePattern)) urls.add(match[1]);
    for (const match of html.matchAll(apiAssignmentPattern)) urls.add(match[1]);

    return Array.from(urls).slice(0, MAX_ITEMS);
  };

  const collectForms = () => Array.from(document.forms).slice(0, 20).map((form) => ({
    action: form.action,
    method: form.method,
    id: form.id || '',
    className: String(form.className || ''),
    inputs: Array.from(form.elements).slice(0, MAX_ITEMS).map((element) => ({
      tag: element.tagName,
      type: element.type || '',
      name: element.name || '',
      id: element.id || '',
      value: clip(element.value),
      placeholder: clip(element.placeholder),
      checked: Boolean(element.checked),
    })),
  }));

  const collectStructure = (html) => ({
    query: getQueryParams(),
    forms: collectForms(),
    scripts: Array.from(document.scripts).slice(0, MAX_ITEMS).map((script) => ({
      src: script.src || '',
      type: script.type || '',
      inlineText: script.src ? '' : clip(script.textContent, 1000),
    })),
    buttons: Array.from(document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'))
      .slice(0, MAX_ITEMS)
      .map((element) => ({
        tag: element.tagName,
        id: element.id || '',
        className: String(element.className || ''),
        text: clip(element.innerText || element.textContent || element.value),
        href: element.href || '',
        onclick: clip(element.getAttribute('onclick')),
      })),
    options: findOptions().slice(0, MAX_ITEMS).map(({ text, tag, id, className }) => ({
      text: clip(text),
      tag,
      id,
      className: clip(className),
    })),
    apiUrls: collectApiUrls(html),
    observedRequests: observedRequests.slice(0, MAX_ITEMS),
  });

  const sendSnapshotOnce = async (reason) => {
    if (snapshotSent || !document.documentElement) return;
    snapshotSent = true;

    const html = document.documentElement.outerHTML || '';
    const query = getQueryParams();
    const payload = {
      capturedBy: 'tampermonkey',
      kind: detectKind(),
      activeId: query.activeId || query.activePrimaryId || query.aid || query.id || '',
      url: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      html: clip(html, MAX_HTML_CHARS),
      structure: {
        reason,
        ...collectStructure(html),
      },
    };

    try {
      await fetch(SNAPSHOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[QiandaoBot] Page snapshot saved.');
    } catch (error) {
      console.log('[QiandaoBot] Page snapshot was not saved. Is local server running on port 5000?', error);
    }
  };

  const clickRandomOption = () => {
    const options = findOptions();
    if (!options.length) return false;

    void sendSnapshotOnce('practice-options-found');

    const selected = options[Math.floor(Math.random() * options.length)];
    selected.clickable.click();
    selected.clickable.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[QiandaoBot] Random practice option selected:', selected.text);

    if (AUTO_SUBMIT) {
      setTimeout(() => {
        const submitButton = findSubmitButton();
        if (submitButton) {
          submitButton.click();
          console.log('[QiandaoBot] Practice submitted.');
        } else {
          console.log('[QiandaoBot] Submit button was not found.');
        }
      }, 500);
    }

    return true;
  };

  installNetworkHooks();

  const isMobileLearnPage = () => window.location.hostname === 'mobilelearn.chaoxing.com';

  const start = () => {
    const kind = detectKind();
    if (kind === 'practice' && isMobileLearnPage()) {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (clickRandomOption() || Date.now() - startedAt > MAX_WAIT_MS) {
          window.clearInterval(timer);
          void sendSnapshotOnce('practice-timeout-or-finished');
        }
      }, CHECK_INTERVAL_MS);
    } else if (kind === 'practice') {
      window.setTimeout(() => {
        void sendSnapshotOnce('practice-page-ready-no-autosubmit');
      }, 3000);
    } else if (kind === 'signin') {
      window.setTimeout(() => {
        void sendSnapshotOnce('signin-page-ready');
      }, 3000);
    } else {
      window.setTimeout(() => {
        void sendSnapshotOnce('unknown-page-ready');
      }, UNKNOWN_PAGE_SNAPSHOT_DELAY_MS);
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
