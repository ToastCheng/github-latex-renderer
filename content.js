/* GitHub LaTeX Renderer — content script.
 *
 * Renders LaTeX math ($...$, $$...$$) in GitHub PR diff code lines using
 * bundled KaTeX (isolated content-script world — GitHub CSP doesn't apply).
 *
 * Supports both diff UIs:
 *   - classic: tr > td.blob-code.js-file-line > .blob-code-inner
 *   - React (2025+): tr.diff-line-row > td.diff-text-cell > code.diff-text
 *     (unified and split view — split is handled by processing each side as
 *     its own column of lines)
 *
 * Math spanning multiple consecutive diff lines (docstring $$...$$ blocks) is
 * rendered into the opening line; continuation lines keep their row/line
 * number but their text is blanked.
 *
 * Rendering preserves the existing DOM (syntax-highlight spans, diff markers):
 * only the text nodes containing math are replaced. Originals are kept on the
 * element so the popup toggle restores the page without a reload.
 */

(function () {
  'use strict';

  const DONE = 'ghlrDone';
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
      .ghlr-math { color: inherit; white-space: normal; }
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

  // All text nodes under el, in document order.
  function textNodesOf(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // Find $...$ / $$...$$ spans in a single-line string. -> [{start,end,tex,display}]
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
      const ok = tex.length > 0 &&
        (dbl || (tex[0] !== ' ' && tex[tex.length - 1] !== ' ' && !/\d/.test(text[close + 1] || '')));
      if (ok) out.push({ start: i, end: close + (dbl ? 2 : 1), tex, display: dbl });
      i = close + (dbl ? 2 : 1);
    }
    return out;
  }

  // Map an absolute offset in the joined line text to {node, offset}.
  function locate(nodes, starts, pos) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (pos >= starts[i]) return { node: nodes[i], offset: pos - starts[i], index: i };
    }
    return null;
  }

  // Replace the text range [start, end) of a line's text with `span`,
  // preserving all non-text DOM (highlight spans, markers).
  function replaceRange(line, start, end, span) {
    const { el, nodes, starts, text } = line;
    if (!line.origSaved) { line.td._ghlrOrig = el.innerHTML; line.origSaved = true; }
    const s = locate(nodes, starts, start);
    const e = locate(nodes, starts, Math.max(start, end - 1)); // end is exclusive
    if (!s || !e) return;
    if (s.index === e.index) {
      const before = s.node.data.slice(0, s.offset);
      const after = s.node.data.slice(e.offset + 1);
      s.node.data = before;
      s.node.parentNode.insertBefore(span, s.node.nextSibling);
      if (after) s.node.parentNode.insertBefore(document.createTextNode(after), span.nextSibling);
    } else {
      s.node.data = s.node.data.slice(0, s.offset);
      s.node.parentNode.insertBefore(span, s.node.nextSibling);
      for (let i = s.index + 1; i < e.index; i++) nodes[i].data = '';
      const eNode = e.node;
      const trailing = eNode.data.slice(e.offset + 1);
      eNode.data = trailing;
    }
  }

  // Blank all text in a line (keeps row/markers/highlight elements).
  function clearLine(line) {
    if (!line.origSaved) { line.td._ghlrOrig = line.el.innerHTML; line.origSaved = true; }
    line.nodes.forEach(n => { n.data = ''; });
  }

  // Process one column of consecutive code lines (one side of a hunk).
  function processColumn(col) {
    // Refresh per-line state; skip lines already rendered or marked done+unchanged.
    const lines = [];
    for (const c of col) {
      const nodes = textNodesOf(c.el);
      const text = nodes.map(n => n.data).join('');
      if (c.el.querySelector('.ghlr-math')) continue;            // already rendered
      if (c.td.dataset[DONE] && c.td._ghlrSeen === text) continue; // no math last time, unchanged
      delete c.td.dataset[DONE];
      const starts = [];
      let off = 0;
      nodes.forEach(n => { starts.push(off); off += n.data.length; });
      lines.push({ td: c.td, el: c.el, nodes, starts, text, origSaved: false });
    }
    if (!lines.length) return;

    // --- pass 1: multi-line $$ ... $$ blocks across consecutive lines ---
    const joined = lines.map(l => l.text).join('\n');
    const lineStart = [];
    let off = 0;
    lines.forEach(l => { lineStart.push(off); off += l.text.length + 1; });
    const lineOf = pos => {
      for (let i = lines.length - 1; i >= 0; i--) if (pos >= lineStart[i]) return i;
      return -1;
    };

    const consumed = new Set();
    const re = /\$\$([\s\S]*?)\$\$/g;
    let m;
    while ((m = re.exec(joined)) !== null) {
      const startLine = lineOf(m.index);
      const closeStart = m.index + 2 + m[1].length;
      const endLine = lineOf(closeStart);
      if (startLine === -1 || endLine === -1 || startLine === endLine) continue;
      const l0 = lines[startLine];
      replaceRange(l0, m.index - lineStart[startLine], l0.text.length, renderMath(m[1], true));
      for (let i = startLine + 1; i < endLine; i++) clearLine(lines[i]);
      const le = lines[endLine];
      const trailingStart = closeStart + 2 - lineStart[endLine];
      if (trailingStart > 0) {
        // clear up to and including closing $$, keep trailing text
        const e = locate(le.nodes, le.starts, trailingStart - 1);
        if (e) {
          if (!le.origSaved) { le.td._ghlrOrig = le.el.innerHTML; le.origSaved = true; }
          for (let i = 0; i < e.index; i++) le.nodes[i].data = '';
          e.node.data = e.node.data.slice(e.offset + 1);
        }
      }
      for (let i = startLine; i <= endLine; i++) consumed.add(i);
    }

    // --- pass 2: single-line math ---
    lines.forEach((line, idx) => {
      if (consumed.has(idx)) return;
      const matches = findMathInLine(line.text);
      if (!matches.length) {
        line.td.dataset[DONE] = '1';
        line.td._ghlrSeen = line.text;
        return;
      }
      // Apply matches right-to-left so offsets stay valid.
      for (let k = matches.length - 1; k >= 0; k--) {
        const mm = matches[k];
        replaceRange(line, mm.start, mm.end, renderMath(mm.tex, mm.display));
        // refresh node map after each mutation
        line.nodes = textNodesOf(line.el);
        const starts = [];
        let o = 0;
        line.nodes.forEach(n => { starts.push(o); o += n.data.length; });
        line.starts = starts;
      }
    });
  }

  // Collect columns of code lines from a tbody (handles classic + React markup,
  // unified + split view).
  function collectColumns(tbody) {
    const react = !!tbody.querySelector('td.diff-text-cell');
    const columns = new Map();
    tbody.querySelectorAll('tr').forEach(row => {
      const cells = react
        ? [...row.querySelectorAll('td.diff-text-cell')]
        : [...row.querySelectorAll('td.blob-code.js-file-line')];
      cells.forEach((td, i) => {
        const el = react
          ? td.querySelector('code.diff-text')
          : (td.querySelector('.blob-code-inner') || td);
        if (!el) return;
        if (!columns.has(i)) columns.set(i, []);
        columns.get(i).push({ td, el });
      });
    });
    return [...columns.values()];
  }

  function scan() {
    if (!enabled || typeof katex === 'undefined') return;
    injectCSS();
    document.querySelectorAll('tbody').forEach(tbody => {
      collectColumns(tbody).forEach(processColumn);
    });
  }

  function restore() {
    document.querySelectorAll('td[data-ghlr-done], td.diff-text-cell, td.blob-code').forEach(td => {
      const el = td.querySelector('code.diff-text') || td.querySelector('.blob-code-inner') || td;
      if (td._ghlrOrig !== undefined) {
        el.innerHTML = td._ghlrOrig;
        delete td._ghlrOrig;
      }
      delete td.dataset[DONE];
      delete td._ghlrSeen;
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
