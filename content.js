/* GitHub LaTeX Renderer — content script.
 *
 * Scans GitHub PR diff hunks (classic `td.blob-code.js-file-line` markup) for
 * LaTeX math and renders it with KaTeX (bundled locally, runs in the isolated
 * content-script world so GitHub's CSP doesn't matter).
 *
 * Handles:
 *   - inline $...$ within a single diff line
 *   - display $$...$$ within a single line
 *   - display $$...$$ spanning MULTIPLE consecutive diff lines (common in
 *     docstrings) — rendered into the opening line, continuation lines blanked
 *     (rows kept so diff line numbers stay aligned)
 *
 * Toggle via the extension popup; originals are kept on the element so
 * disabling restores the page without a reload.
 */

(function () {
  'use strict';

  const DONE = 'ghlrDone';
  const HIDDEN = 'ghlrHidden';
  let enabled = true;
  let cssInjected = false;

  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('katex/katex.min.css');
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .ghlr-math { color: inherit; }
      .ghlr-math.ghlr-display { display: block; padding: 6px 0 6px 12px; overflow-x: auto; }
      .ghlr-math .katex { font-size: 1.02em; color: inherit; }
      .ghlr-error { color: #cf222e; }
    `;
    document.head.appendChild(style);
  }

  function renderMath(tex, displayMode) {
    const span = document.createElement('span');
    span.className = 'ghlr-math' + (displayMode ? ' ghlr-display' : '');
    try {
      span.innerHTML = katex.renderToString(tex, {
        displayMode,
        throwOnError: true,
        strict: 'ignore',
      });
    } catch (e) {
      span.classList.add('ghlr-error');
      span.textContent = (displayMode ? '$$' : '$') + tex + (displayMode ? '$$' : '$');
    }
    return span;
  }

  // Replace the content of `el` with: plain-text prefix, rendered math, plain-text suffix.
  function replaceInLine(el, start, end, tex, displayMode) {
    const text = el.textContent;
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(text.slice(0, start)));
    frag.appendChild(renderMath(tex, displayMode));
    frag.appendChild(document.createTextNode(text.slice(end)));
    el.textContent = '';
    el.appendChild(frag);
  }

  // Find all $...$ / $$...$$ spans in a single-line string. Returns [{start,end,tex,display}].
  function findMathInLine(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '$' || text[i - 1] === '\\') { i++; continue; }
      const dbl = text[i + 1] === '$';
      const openEnd = i + (dbl ? 2 : 1);
      const close = dbl ? text.indexOf('$$', openEnd) : text.indexOf('$', openEnd);
      if (close === -1) break;
      const tex = text.slice(openEnd, close);
      // Guards against currency / false positives: non-empty, no leading/trailing
      // space for single-$, and not immediately followed by a digit (price-like).
      const ok = tex.length > 0 &&
        (dbl || (tex[0] !== ' ' && tex[tex.length - 1] !== ' ' && !/\d/.test(text[close + 1] || '')));
      if (ok) out.push({ start: i, end: close + (dbl ? 2 : 1), tex, display: dbl });
      i = close + (dbl ? 2 : 1);
    }
    return out;
  }

  // Process one hunk (tbody): handles multi-line $$ blocks first, then per-line inline math.
  function processHunk(tbody) {
    const cells = [...tbody.querySelectorAll('td.blob-code.js-file-line')]
      .filter(td => !td.dataset[DONE] && !td.dataset[HIDDEN])
      .map(td => ({ td, el: td.querySelector('.blob-code-inner') || td, text: '' }));
    cells.forEach(c => { c.text = c.el.textContent; });
    if (!cells.length) return;

    // --- pass 1: multi-line $$ ... $$ blocks ---
    const joined = cells.map(c => c.text).join('\n');
    const lineStart = [];
    let off = 0;
    cells.forEach(c => { lineStart.push(off); off += c.text.length + 1; });

    // Index of the line containing absolute offset `pos` in `joined`.
    function lineOf(pos) {
      for (let i = cells.length - 1; i >= 0; i--) {
        if (pos >= lineStart[i]) return i;
      }
      return -1;
    }

    const consumed = new Set();
    const re = /\$\$([\s\S]*?)\$\$/g;
    let m;
    while ((m = re.exec(joined)) !== null) {
      const startLine = lineOf(m.index);
      const closeStart = m.index + 2 + m[1].length; // index of closing $$
      const endLine = lineOf(closeStart);
      if (startLine === -1 || endLine === -1 || startLine === endLine) continue;
      // Render into start line, hide continuation lines.
      const c0 = cells[startLine];
      const localStart = m.index - lineStart[startLine];
      const block = document.createElement('span');
      block.appendChild(document.createTextNode(c0.text.slice(0, localStart)));
      block.appendChild(renderMath(m[1], true));
      c0.td._ghlrOrig = c0.el.innerHTML;
      c0.el.textContent = '';
      c0.el.appendChild(block);
      c0.td.dataset[DONE] = '1';
      for (let i = startLine + 1; i <= endLine; i++) {
        const ci = cells[i];
        const localEnd = closeStart + 2 - lineStart[i];
        const trailing = i === endLine ? ci.text.slice(localEnd) : '';
        ci.td._ghlrOrig = ci.el.innerHTML;
        ci.el.textContent = trailing; // keep any text after closing $$
        ci.td.dataset[DONE] = '1';
        if (!trailing.trim()) ci.td.dataset[HIDDEN] = '1';
        consumed.add(i);
      }
      consumed.add(startLine);
    }

    // --- pass 2: single-line math in unconsumed lines ---
    cells.forEach((c, idx) => {
      if (consumed.has(idx)) return;
      const matches = findMathInLine(c.text);
      if (!matches.length) { c.td.dataset[DONE] = '1'; return; }
      c.td._ghlrOrig = c.el.innerHTML;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const mm of matches) {
        frag.appendChild(document.createTextNode(c.text.slice(pos, mm.start)));
        frag.appendChild(renderMath(mm.tex, mm.display));
        pos = mm.end;
      }
      frag.appendChild(document.createTextNode(c.text.slice(pos)));
      c.el.textContent = '';
      c.el.appendChild(frag);
      c.td.dataset[DONE] = '1';
    });
  }

  function scan() {
    if (!enabled || typeof katex === 'undefined') return;
    injectCSS();
    document.querySelectorAll('tbody').forEach(tbody => {
      if (tbody.querySelector('td.blob-code.js-file-line:not([data-ghlr-done])')) {
        processHunk(tbody);
      }
    });
  }

  function restore() {
    document.querySelectorAll(`td[data-ghlr-done]`).forEach(td => {
      const el = td.querySelector('.blob-code-inner') || td;
      if (td._ghlrOrig !== undefined) {
        el.innerHTML = td._ghlrOrig;
        delete td._ghlrOrig;
      }
      delete td.dataset[DONE];
      delete td.dataset[HIDDEN];
    });
  }

  // --- boot / toggle / navigation wiring ---
  chrome.storage.sync.get({ enabled: true }, ({ enabled: e }) => {
    enabled = e;
    if (enabled) scan();
  });
  chrome.storage.onChanged.addListener(changes => {
    if (!changes.enabled) return;
    enabled = changes.enabled.newValue;
    if (enabled) scan(); else restore();
  });

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(); }, 300);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
