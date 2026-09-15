# Chrome Web Store listing — GitHub LaTeX Renderer

Package: `~/dev/github-latex-renderer.zip` (built from the repo, excludes test/ and .git/)

## Name
GitHub LaTeX Renderer

## Short description (132 chars max)
Renders LaTeX math ($...$, $$...$$) inside GitHub PR diffs with KaTeX — including multi-line display math in docstrings.

## Detailed description
Reviewing a pull request full of LaTeX in the source? This extension renders
TeX math notation directly inside GitHub's "Files changed" diff view, so
docstrings like

    $$F_d = |\mathrm{Tr}(U_d^\dagger U_t)| / \dim(U_t)$$

appear as properly typeset math instead of raw source.

Features:
- Renders inline `$...$` and display `$$...$$` math in PR diff lines
- Handles display math spanning multiple consecutive diff lines (common in
  docstrings); diff line numbers stay aligned
- KaTeX is bundled with the extension: fast, works offline, and unaffected
  by GitHub's Content-Security-Policy
- On/off toggle in the toolbar popup; disabling restores the original code
  instantly, no page reload needed
- Currency-like text such as "$5" is left untouched
- No tracking, no network requests, no data collection

Perfect for reviewing scientific code: quantum computing, ML papers-as-code,
numerical libraries, and any repo whose docstrings contain LaTeX.

## Category
Developer Tools

## Language
English

## Assets
- Icons: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` (already in the zip)
- Screenshot 1 (1280x800 or 640x400): `test/screenshot-pr8273.png`
  (real render on quantumlib/Cirq#8273 — U3 gate matrix in a docstring)

## Privacy practice answers (dashboard form)
- Single purpose: renders LaTeX math in GitHub diff pages.
- Permission justifications:
  - `storage`: remembers the on/off toggle.
  - Host access `https://github.com/*`: required to read and render math in
    diff code lines on GitHub.
- Data usage: collects/transmits NO user data.

## Upload steps (manual, ~5 min)
1. Register a developer account at https://chrome.google.com/webstore/devconsole
   (one-time $5 fee) if you haven't.
2. Items → New item → upload `github-latex-renderer.zip`.
3. Fill in the listing fields from this file, add the screenshot, save, submit
   for review (typically approved within a few days).
