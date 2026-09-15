# GitHub LaTeX Renderer

Chrome extension (Manifest V3) that renders LaTeX math found in GitHub PR
diffs, using a locally bundled [KaTeX](https://katex.org/). Built for reviewing
PRs whose source/docstrings contain LaTeX (e.g. quantum compilation docs with
`$U_t$`, `$$F_d = |\mathrm{Tr}(U_d^\dagger U_t)| / \dim(U_t)$$`).

## What it renders

- Inline `$...$` inside a diff line
- Display `$$...$$` inside a diff line
- Display `$$...$$` spanning **multiple consecutive diff lines** (common in
  Python docstrings) — rendered into the opening line; continuation rows are
  blanked but kept so diff line numbers stay aligned

Rendering runs in the content-script isolated world with bundled KaTeX assets,
so GitHub's CSP does not block it and it works offline.

## Install (one-time setup)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. Open the PR "Files changed" page — math renders automatically
   (lazy-loaded diffs are handled via MutationObserver)

Toggle on/off via the extension icon in the toolbar; turning it off restores
the original page without a reload.

## Limitations (v0.2)

- Markdown comments are untouched (GitHub already renders math there).
- Under heavy virtualization in the React diff UI, lines re-mount on scroll and
  are re-rendered automatically by the MutationObserver.

## Supported markup

- Classic diff: `td.blob-code.js-file-line`
- React diff UI (2025+): `td.diff-text-cell > code.diff-text`, unified and
  split view (each side processed as its own line column)
- Rendering preserves syntax highlighting and +/− markers — only the text
  nodes containing math are replaced.

## Files

- `manifest.json` — MV3 manifest
- `content.js` — scanner/renderer
- `popup.html`, `popup.js` — on/off toggle
- `katex/` — KaTeX 0.16.22 (js/css + woff2 fonts)
