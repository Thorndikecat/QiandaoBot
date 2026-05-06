// ==UserScript==
// @name         Chaoxing Practice Random Picker
// @namespace    https://github.com/Thorndikecat/QiandaoBot
// @version      1.1
// @description  Randomly selects one visible option on Chaoxing practice/vote pages.
// @match        *://mobilelearn.chaoxing.com/widget/pcvote/*
// @match        *://mobilelearn.chaoxing.com/widget/vote/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const AUTO_SUBMIT = true;
  const MAX_WAIT_MS = 15000;
  const CHECK_INTERVAL_MS = 500;

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

  const isVisible = (element) => {
    if (!element || element.disabled) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const findClickableLabel = (input) => {
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && isVisible(label)) return label;
    }
    return input.closest('label') || input;
  };

  const isOptionText = (text) => {
    if (!text) return false;
    if (text.length > 180) return false;
    if (/提交|确定|完成|返回|查看|重做|submit|finish|back/i.test(text)) return false;
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
      candidates.push({ clickable, text });
    }

    return candidates;
  };

  const findSubmitButton = () => {
    for (const element of document.querySelectorAll(submitSelectors.join(','))) {
      if (!isVisible(element)) continue;
      const text = normalizeText(element.innerText || element.textContent || element.value);
      if (/提交|确定|完成|投票|交卷|submit|finish/i.test(text)) {
        return element;
      }
    }
    return null;
  };

  const clickRandomOption = () => {
    const options = findOptions();
    if (!options.length) return false;

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

  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (clickRandomOption() || Date.now() - startedAt > MAX_WAIT_MS) {
      window.clearInterval(timer);
    }
  }, CHECK_INTERVAL_MS);
})();
