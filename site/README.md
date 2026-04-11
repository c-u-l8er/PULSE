# PULSE marketing site

Static, single-page marketing site for OS-010 PULSE. No build step.

## Local preview

```bash
# from repo root
python3 -m http.server 8091 --directory PULSE/site
# → http://localhost:8091
```

Or via the Claude Code launch config: `preview_start name="pulse-site"`.

## Deploy options

PULSE is a Node-based MCP server (`os-pulse`), not an HTTP server, so the
site is hosted independently of the runtime. Anywhere that serves static
files works:

- **Cloudflare Pages** — point at `PULSE/site/`, no build command, output
  directory `.`. Free tier is more than enough.
- **Fly static** — `fly launch --no-deploy` from `PULSE/site/`, then a
  one-line `fly.toml` with `[[statics]] guest_path = "/site"`.
- **GitHub Pages** — push `PULSE/site/` to a `gh-pages` branch or set
  `Pages source = /PULSE/site` in repo settings.
- **Vercel / Netlify** — drag-and-drop `PULSE/site/`, no config needed.

## Files

- `index.html` — full single-page site (inline CSS, no JS, no fonts beyond
  Google Fonts CDN). Designed independently of `graphonomous.com/` and the
  PRISM Phoenix site — distinct teal/cyan oscillation theme.

## Editing

The whole site lives in `index.html` so it can be edited in one pass.
Section markers in the file:

- `.hero` — headline + lede + CTAs + waveform decoration
- `#phases` — the five canonical PULSE phase kinds
- `#manifest` — `*.pulse.json` example
- `#tokens` — five canonical cross-loop signal tokens
- `#nesting` — triple-loop concentric ring diagram
- `#install` — `os-pulse` install snippet
