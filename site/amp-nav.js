/**
 * <amp-nav> — shared top navigation for the [&] Protocol / Ampersand Box Design portfolio.
 *
 * Usage:
 *   <amp-nav property="graphonomous"></amp-nav>
 *   <script type="module" src="/amp-nav.js"></script>
 *
 * Attributes:
 *   property   — one of the canonical property ids (see PROPERTY_MAP below).
 *                Drives the "you are here" highlight. Omit if none apply.
 *   theme      — "dark" (default) | "light" | "auto"
 *   base       — optional override for the portfolio origin used in menu links
 *                (e.g. "https://ampersandboxdesign.com"). Defaults to the link
 *                targets defined in LINKS.
 *
 * Theming:
 *   Expose CSS custom properties on the host element:
 *     --amp-nav-bg, --amp-nav-fg, --amp-nav-muted, --amp-nav-accent,
 *     --amp-nav-border, --amp-nav-hover, --amp-nav-cta-bg, --amp-nav-cta-fg,
 *     --amp-nav-font, --amp-nav-height
 *
 *   Example:
 *     amp-nav { --amp-nav-accent: #4af5c6; }
 *
 * Versioning:
 *   Single source of truth: ampersand-nav/src/amp-nav.js in the ProjectAmp2 repo.
 *   Deploy to each property via scripts/sync-nav.sh.
 *
 * License: MIT (Ampersand Box Design)
 */

const VERSION = "0.4.0";

// Canonical URLs per property. The "href" is the destination used in cross-property
// links; the "label" is what visitors see in the dropdown.
//
// Ecosystem products carry a {status, tier} pair (status = display string,
// tier = one of "shipped" | "alpha" | "spec") so the Compose menu can show
// honest version/maturity at-a-glance. Source of truth: STACK_COMPLETION.md.
const LINKS = {
  // Cognitive Primitives — memory / knowledge / reasoning / time / space
  graphonomous: {
    label: "Graphonomous",
    tagline: "Agent memory substrate",
    href: "https://graphonomous.com",
    status: "v0.4.3",
    tier: "shipped",
  },
  bendscript: {
    label: "BendScript",
    tagline: "Graph-first document protocol",
    href: "https://bendscript.com",
    status: "v0.1.0-alpha",
    tier: "alpha",
  },
  deliberatic: {
    label: "Deliberatic",
    tagline: "Argumentation protocol",
    href: "https://deliberatic.com",
    status: "spec only",
    tier: "spec",
  },
  ticktickclock: {
    label: "TickTickClock",
    tagline: "Temporal intelligence",
    href: "https://ticktickclock.com",
    status: "spec only",
    tier: "spec",
  },
  geofleetic: {
    label: "GeoFleetic",
    tagline: "Spatial intelligence",
    href: "https://geofleetic.com",
    status: "spec only",
    tier: "spec",
  },

  // Agent Platform — building, governance, marketplace, spec discipline
  agentelic: {
    label: "Agentelic",
    tagline: "Premium agent builder",
    href: "https://agentelic.com",
    status: "v0.1.0",
    tier: "shipped",
  },
  fleetprompt: {
    label: "FleetPrompt",
    tagline: "Agent marketplace + trust",
    href: "https://fleetprompt.com",
    status: "v0.1.0",
    tier: "shipped",
  },
  specprompt: {
    label: "SpecPrompt",
    tagline: "Spec-driven dev standard",
    href: "https://specprompt.com",
    status: "v0.1.0",
    tier: "shipped",
  },
  delegatic: {
    label: "Delegatic",
    tagline: "Agent governance kernel",
    href: "https://delegatic.com",
    status: "v0.1.0",
    tier: "shipped",
  },
  agentromatic: {
    label: "AgenTroMatic",
    tagline: "Deliberation orchestrator",
    href: "https://agentromatic.com",
    status: "spec only",
    tier: "spec",
  },

  // Runtime — execution, layout, hosting
  runefort: {
    label: "RuneFort",
    tagline: "Layout protocol & control plane",
    href: "https://runefort.com",
    status: "v0.1.0-alpha",
    tier: "alpha",
  },
  webhost: {
    label: "WebHost.Systems",
    tagline: "Hosting + Supabase dashboard",
    href: "https://webhost.systems",
    status: "in dev",
    tier: "alpha",
  },

  // Protocols — the three-protocol stack ([&] + PULSE + PRISM)
  ampersand: {
    label: "[&] Protocol",
    tagline: "Structural composition",
    href: "https://ampersandboxdesign.com/protocol",
  },
  pulse: {
    label: "PULSE",
    tagline: "Temporal algebra for loops",
    href: "https://pulse.opensentience.org",
  },
  prism: {
    label: "PRISM",
    tagline: "Adversarial evaluation discipline",
    href: "https://prism.opensentience.org",
  },

  // Research / Runtime — OS-001..011 protocol family
  opensentience: {
    label: "OpenSentience",
    tagline: "11 open research protocols",
    href: "https://opensentience.org",
    status: "11 protocols",
    tier: "shipped",
  },
  kappa: {
    label: "κ-Routing proof",
    tagline: "Topology determines deliberation",
    href: "https://opensentience.org/#kappa",
  },

  // Docs — three docs subdomains
  docs_abd: {
    label: "[&] Protocol docs",
    tagline: "Structural composition guides",
    href: "https://docs.ampersandboxdesign.com",
  },
  docs_graph: {
    label: "Graphonomous docs",
    tagline: "Memory substrate API & MCP",
    href: "https://docs.graphonomous.com",
  },
  docs_os: {
    label: "OpenSentience docs",
    tagline: "Research protocols reference",
    href: "https://docs.opensentience.org",
  },

  // Company
  home: {
    label: "Ampersand Box Design",
    tagline: "The factory for evaluated cognitive systems",
    href: "https://ampersandboxdesign.com",
  },
  contact: {
    label: "Talk to us",
    tagline: "hello@ampersandboxdesign.com",
    href: "mailto:hello@ampersandboxdesign.com",
  },
};

// Map "property" attribute value to the category + item it lives in, for the
// "you are here" highlight. Properties not in this map still render the nav
// (no highlight). Internal aliases ("ampersandboxdesign" → "home") are fine.
const PROPERTY_MAP = {
  // Hero products — appear in the Products dropdown
  graphonomous: { category: "products", item: "graphonomous" },
  bendscript: { category: "products", item: "bendscript" },
  runefort: { category: "products", item: "runefort" },
  // Compose — Cognitive Primitives column
  deliberatic: { category: "compose", item: "deliberatic" },
  ticktickclock: { category: "compose", item: "ticktickclock" },
  geofleetic: { category: "compose", item: "geofleetic" },
  // Compose — Agent Platform column
  agentelic: { category: "compose", item: "agentelic" },
  fleetprompt: { category: "compose", item: "fleetprompt" },
  specprompt: { category: "compose", item: "specprompt" },
  delegatic: { category: "compose", item: "delegatic" },
  agentromatic: { category: "compose", item: "agentromatic" },
  // Compose — Runtime column
  webhost: { category: "compose", item: "webhost" },
  // Other categories
  ampersand: { category: "protocols", item: "ampersand" },
  ampersandboxdesign: { category: "company", item: "home" },
  pulse: { category: "protocols", item: "pulse" },
  prism: { category: "protocols", item: "prism" },
  opensentience: { category: "research", item: "opensentience" },
  kappa: { category: "research", item: "kappa" },
  docs: { category: "docs", item: null },
};

// Top-level structure. Order = display order.
//
// A category may be either flat (one column, `items: [...]`) or a mega-menu
// (multiple columns, `mega: true, columns: [{label, items}, ...]`). The mega
// shape is used by Compose to lay out the full ecosystem product catalog
// across the three architectural layers.
const CATEGORIES = [
  {
    id: "products",
    label: "Products",
    items: ["graphonomous", "bendscript", "runefort"],
  },
  {
    id: "protocols",
    label: "Protocols",
    items: ["ampersand", "pulse", "prism"],
  },
  {
    id: "research",
    label: "Research",
    items: ["opensentience", "kappa"],
  },
  {
    id: "docs",
    label: "Docs",
    items: ["docs_abd", "docs_graph", "docs_os"],
  },
  {
    id: "company",
    label: "Company",
    items: ["home", "contact"],
  },
  {
    id: "compose",
    label: "Compose",
    mega: true,
    columns: [
      {
        label: "Cognitive Primitives",
        items: [
          "graphonomous",
          "deliberatic",
          "ticktickclock",
          "geofleetic",
        ],
      },
      {
        label: "Agent Platform",
        items: [
          "agentelic",
          "fleetprompt",
          "specprompt",
          "delegatic",
          "agentromatic",
        ],
      },
      {
        label: "Runtime",
        items: ["opensentience", "webhost"],
      },
    ],
  },
];

const CTA = {
  label: "Talk to us →",
  href: "mailto:hello@ampersandboxdesign.com",
  // When the Dark Factory demo ships in Q4 2026, swap to:
  //   label: "Run the factory →", href: "https://runefort.com/factory"
};

const STYLE = /* css */ `
  :host {
    --amp-nav-bg: rgba(8, 9, 12, 0.78);
    --amp-nav-fg: #e2e0db;
    --amp-nav-muted: #8b8a95;
    --amp-nav-accent: #4af5c6;
    --amp-nav-border: rgba(255, 255, 255, 0.08);
    --amp-nav-hover: rgba(255, 255, 255, 0.04);
    --amp-nav-cta-bg: #e2e0db;
    --amp-nav-cta-fg: #08090c;
    --amp-nav-font: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --amp-nav-height: 56px;
    --amp-nav-z: 9999;

    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: var(--amp-nav-z);
    font-family: var(--amp-nav-font);
    font-size: 13px;
    line-height: 1;
    color: var(--amp-nav-fg);
    -webkit-font-smoothing: antialiased;
  }

  :host([theme="light"]) {
    --amp-nav-bg: rgba(255, 255, 255, 0.85);
    --amp-nav-fg: #08090c;
    --amp-nav-muted: #6b6980;
    --amp-nav-border: rgba(0, 0, 0, 0.08);
    --amp-nav-hover: rgba(0, 0, 0, 0.04);
    --amp-nav-cta-bg: #08090c;
    --amp-nav-cta-fg: #f5f5f0;
  }

  .bar {
    height: var(--amp-nav-height);
    background: var(--amp-nav-bg);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--amp-nav-border);
    display: flex;
    align-items: center;
    padding: 0 clamp(1rem, 3vw, 2rem);
    gap: 1.5rem;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--amp-nav-fg);
    letter-spacing: 0.02em;
    font-weight: 500;
    white-space: nowrap;
  }

  .brand .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--amp-nav-border);
    border-radius: 4px;
    font-weight: 700;
    color: var(--amp-nav-accent);
  }

  .brand .wordmark {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--amp-nav-muted);
  }

  nav.items {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    flex: 1;
    justify-content: center;
  }

  .item {
    position: relative;
  }

  .item > button,
  .item > a {
    appearance: none;
    background: none;
    border: 0;
    color: var(--amp-nav-fg);
    font: inherit;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    text-decoration: none;
    transition: background 120ms ease, color 120ms ease;
  }

  .item > button:hover,
  .item > a:hover,
  .item > button:focus-visible,
  .item > a:focus-visible {
    background: var(--amp-nav-hover);
    outline: none;
  }

  .item[aria-current="true"] > button,
  .item[aria-current="true"] > a {
    color: var(--amp-nav-accent);
  }

  .chev {
    width: 10px;
    height: 10px;
    transition: transform 160ms ease;
    opacity: 0.6;
  }

  .item[data-open="true"] .chev {
    transform: rotate(180deg);
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    min-width: 280px;
    background: var(--amp-nav-bg);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border: 1px solid var(--amp-nav-border);
    border-radius: 10px;
    padding: 0.5rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    display: none;
    flex-direction: column;
    gap: 0.125rem;
  }

  .item[data-open="true"] .dropdown {
    display: flex;
  }

  .dropdown a {
    display: block;
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
    color: var(--amp-nav-fg);
    text-decoration: none;
    transition: background 120ms ease;
  }

  .dropdown a:hover,
  .dropdown a:focus-visible {
    background: var(--amp-nav-hover);
    outline: none;
  }

  .dropdown a[aria-current="true"] {
    color: var(--amp-nav-accent);
  }

  .dropdown .tagline {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--amp-nav-muted);
    letter-spacing: 0;
  }

  /* Mega dropdown — multi-column layout for the Compose catalog */
  .dropdown.mega {
    flex-direction: row;
    gap: 1.25rem;
    padding: 1rem;
    /* Center under the Compose button so the wide menu stays on-screen */
    left: 50%;
    transform: translateX(-50%);
    min-width: 760px;
  }

  .dropdown.mega .col {
    flex: 1 1 240px;
    min-width: 220px;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .dropdown.mega .col h4 {
    margin: 0 0 0.4rem 0;
    padding: 0 0.75rem;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--amp-nav-muted);
  }

  /* Status pill — version / "spec only" / "in dev" */
  .dropdown a .label-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .dropdown .status {
    display: inline-block;
    font-size: 10px;
    line-height: 1;
    padding: 2px 6px;
    border: 1px solid var(--amp-nav-border);
    border-radius: 999px;
    color: var(--amp-nav-muted);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .dropdown .status[data-tier="shipped"] {
    color: var(--amp-nav-accent);
    border-color: color-mix(in srgb, var(--amp-nav-accent) 35%, transparent);
  }

  .dropdown .status[data-tier="alpha"] {
    color: #f5c66a;
    border-color: rgba(245, 198, 106, 0.4);
  }

  .dropdown .status[data-tier="spec"] {
    color: var(--amp-nav-muted);
    opacity: 0.85;
  }

  /* Mobile mirrors of the same status pill */
  .mobile-section .status {
    display: inline-block;
    margin-left: 0.5rem;
    font-size: 10px;
    line-height: 1;
    padding: 2px 6px;
    border: 1px solid var(--amp-nav-border);
    border-radius: 999px;
    color: var(--amp-nav-muted);
    letter-spacing: 0.04em;
    vertical-align: middle;
  }
  .mobile-section .status[data-tier="shipped"] {
    color: var(--amp-nav-accent);
    border-color: color-mix(in srgb, var(--amp-nav-accent) 35%, transparent);
  }
  .mobile-section .status[data-tier="alpha"] {
    color: #f5c66a;
    border-color: rgba(245, 198, 106, 0.4);
  }
  .mobile-section .col-label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--amp-nav-muted);
    margin: 0.6rem 0 0.25rem 0;
  }

  .spacer {
    flex: 1;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    padding: 0.55rem 0.9rem;
    border-radius: 6px;
    background: var(--amp-nav-cta-bg);
    color: var(--amp-nav-cta-fg);
    text-decoration: none;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    transition: transform 120ms ease, opacity 120ms ease;
  }

  .cta:hover,
  .cta:focus-visible {
    transform: translateY(-1px);
    outline: none;
  }

  .burger {
    display: none;
    appearance: none;
    background: none;
    border: 1px solid var(--amp-nav-border);
    border-radius: 6px;
    color: var(--amp-nav-fg);
    padding: 0.45rem 0.55rem;
    cursor: pointer;
    margin-left: auto;
  }

  .burger svg {
    display: block;
    width: 18px;
    height: 18px;
  }

  .mobile-sheet {
    display: none;
    position: fixed;
    inset: var(--amp-nav-height) 0 0 0;
    background: var(--amp-nav-bg);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    padding: 1rem;
    overflow-y: auto;
    border-top: 1px solid var(--amp-nav-border);
  }

  .mobile-sheet[data-open="true"] {
    display: block;
  }

  .mobile-section {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--amp-nav-border);
  }

  .mobile-section:last-child {
    border-bottom: 0;
  }

  .mobile-section h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--amp-nav-muted);
    margin: 0 0 0.5rem 0;
    font-weight: 500;
  }

  .mobile-section a {
    display: block;
    padding: 0.65rem 0;
    color: var(--amp-nav-fg);
    text-decoration: none;
    font-size: 14px;
  }

  .mobile-section a[aria-current="true"] {
    color: var(--amp-nav-accent);
  }

  .mobile-section .tagline {
    font-size: 11px;
    color: var(--amp-nav-muted);
    margin-top: 2px;
  }

  .mobile-cta {
    margin-top: 1rem;
    display: block;
    text-align: center;
    padding: 0.8rem;
    border-radius: 6px;
    background: var(--amp-nav-cta-bg);
    color: var(--amp-nav-cta-fg);
    text-decoration: none;
    font-weight: 600;
  }

  @media (max-width: 860px) {
    nav.items,
    .cta {
      display: none;
    }
    .burger {
      display: inline-flex;
    }
    .spacer {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
`;

const TEMPLATE = (property) => {
  const highlight = PROPERTY_MAP[property] ?? null;
  const currentCategory = highlight?.category ?? null;
  const currentItem = highlight?.item ?? null;

  const escapeAttr = (s) => String(s).replace(/"/g, "&quot;");

  const renderStatus = (link) =>
    link.status
      ? `<span class="status" data-tier="${escapeAttr(link.tier ?? "spec")}">${link.status}</span>`
      : "";

  const renderItem = (key) => {
    const link = LINKS[key];
    if (!link) return "";
    const isCurrent = key === currentItem;
    const status = renderStatus(link);
    return `
      <a href="${link.href}" ${isCurrent ? 'aria-current="true"' : ""} data-key="${key}">
        <span class="label-row"><span>${link.label}</span>${status}</span>
        ${link.tagline ? `<span class="tagline">${link.tagline}</span>` : ""}
      </a>
    `;
  };

  const renderCategory = (cat) => {
    const isCurrent = cat.id === currentCategory;
    const dropdownInner = cat.mega
      ? cat.columns
          .map(
            (col) => `
        <div class="col">
          <h4>${col.label}</h4>
          ${col.items.map(renderItem).join("")}
        </div>
      `,
          )
          .join("")
      : cat.items.map(renderItem).join("");
    const dropdownClass = cat.mega ? "dropdown mega" : "dropdown";
    return `
      <div class="item" data-category="${cat.id}" ${isCurrent ? 'aria-current="true"' : ""}>
        <button type="button" aria-haspopup="true" aria-expanded="false">
          <span>${cat.label}</span>
          <svg class="chev" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 3.5 L5 7 L8.5 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="${dropdownClass}" role="menu">
          ${dropdownInner}
        </div>
      </div>
    `;
  };

  const renderMobileLink = (key) => {
    const link = LINKS[key];
    if (!link) return "";
    const isCurrent = key === currentItem;
    const status = link.status
      ? `<span class="status" data-tier="${escapeAttr(link.tier ?? "spec")}">${link.status}</span>`
      : "";
    return `
      <a href="${link.href}" ${isCurrent ? 'aria-current="true"' : ""}>
        ${link.label}${status}
        ${link.tagline ? `<span class="tagline">${link.tagline}</span>` : ""}
      </a>
    `;
  };

  const mobileSection = (cat) => {
    const body = cat.mega
      ? cat.columns
          .map(
            (col) => `
        <span class="col-label">${col.label}</span>
        ${col.items.map(renderMobileLink).join("")}
      `,
          )
          .join("")
      : cat.items.map(renderMobileLink).join("");
    return `
      <div class="mobile-section">
        <h3>${cat.label}</h3>
        ${body}
      </div>
    `;
  };

  return `
    <style>${STYLE}</style>
    <div class="bar" part="bar">
      <a class="brand" href="https://ampersandboxdesign.com" aria-label="Ampersand Box Design">
        <span class="mark">&</span>
        <span class="wordmark">Ampersand Box Design</span>
      </a>
      <nav class="items" aria-label="Portfolio">
        ${CATEGORIES.map(renderCategory).join("")}
      </nav>
      <span class="spacer"></span>
      <a class="cta" href="${CTA.href}">${CTA.label}</a>
      <button class="burger" type="button" aria-label="Open menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M3 6h18M3 12h18M3 18h18"/>
        </svg>
      </button>
    </div>
    <div class="mobile-sheet" role="dialog" aria-label="Portfolio menu">
      ${CATEGORIES.map(mobileSection).join("")}
      <a class="mobile-cta" href="${CTA.href}">${CTA.label}</a>
    </div>
  `;
};

class AmpNav extends HTMLElement {
  static get observedAttributes() {
    return ["property", "theme"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onDocClick = this._onDocClick.bind(this);
    this._onKeydown = this._onKeydown.bind(this);
  }

  connectedCallback() {
    this._injectHostStyles();
    this._render();
    document.addEventListener("click", this._onDocClick);
    document.addEventListener("keydown", this._onKeydown);
  }

  /**
   * Inject a one-time <style> element into the host document so page content
   * and any existing fixed site nav sit below the portfolio nav.
   *
   * The selectors target common top-fixed nav patterns (direct-child <nav>
   * and <header> of <body>). A site can opt out by setting
   *   amp-nav { --amp-nav-push-site-nav: 0; }
   * which will make --amp-nav-height resolve to 0 for the offset rule.
   */
  _injectHostStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("amp-nav-host-styles")) return;
    const h = AmpNav._heightForInject(this);
    const style = document.createElement("style");
    style.id = "amp-nav-host-styles";
    const overlay = this.hasAttribute("overlay");
    style.textContent = `
      :root { --amp-nav-height: ${h}; }
      ${overlay ? "" : "body { padding-top: var(--amp-nav-height); }"}
      /* Honor the portfolio nav when the browser scrolls to anchors or
         snap points — prevents anchor targets from landing behind the nav. */
      html { scroll-padding-top: var(--amp-nav-height); }
      /* Offset the site's own fixed/sticky top nav so it sits below the portfolio nav.
         Applies to nav/header/banner whether nested or a direct body child.
         \`top\` is a no-op on non-positioned elements, so this is safe to broadcast. */
      body nav,
      body header,
      body [role="banner"],
      body .site-nav,
      body .navbar,
      body .topbar {
        top: var(--amp-nav-height) !important;
      }
    `;
    document.head.appendChild(style);
  }

  static _heightForInject(el) {
    // Allow per-host override via attribute or CSS var; default 56px.
    const attr = el.getAttribute("height");
    if (attr) return /^\d+$/.test(attr) ? `${attr}px` : attr;
    return "56px";
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._onDocClick);
    document.removeEventListener("keydown", this._onKeydown);
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this._render();
  }

  _render() {
    const property = this.getAttribute("property") ?? "";
    this.shadowRoot.innerHTML = TEMPLATE(property);
    this._wire();
  }

  _wire() {
    const root = this.shadowRoot;

    // Desktop dropdowns
    root.querySelectorAll(".item[data-category] > button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = btn.parentElement;
        const open = item.getAttribute("data-open") === "true";
        this._closeAll();
        if (!open) {
          item.setAttribute("data-open", "true");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });

    // Mobile burger
    const burger = root.querySelector(".burger");
    const sheet = root.querySelector(".mobile-sheet");
    if (burger && sheet) {
      burger.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = sheet.getAttribute("data-open") === "true";
        sheet.setAttribute("data-open", open ? "false" : "true");
        burger.setAttribute("aria-expanded", open ? "false" : "true");
      });
    }
  }

  _closeAll() {
    const root = this.shadowRoot;
    root.querySelectorAll(".item[data-open='true']").forEach((el) => {
      el.setAttribute("data-open", "false");
      const btn = el.querySelector("button");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  _onDocClick(e) {
    // Click outside shadow tree closes dropdowns
    if (!this.contains(e.target) && !e.composedPath().includes(this)) {
      this._closeAll();
    } else {
      // Click inside but outside an open item also closes
      const path = e.composedPath();
      const insideItem = path.some(
        (n) => n.classList && n.classList.contains("item"),
      );
      if (!insideItem) this._closeAll();
    }
  }

  _onKeydown(e) {
    if (e.key === "Escape") {
      this._closeAll();
      const sheet = this.shadowRoot.querySelector(".mobile-sheet");
      if (sheet) sheet.setAttribute("data-open", "false");
      const burger = this.shadowRoot.querySelector(".burger");
      if (burger) burger.setAttribute("aria-expanded", "false");
    }
  }
}

if (!customElements.get("amp-nav")) {
  customElements.define("amp-nav", AmpNav);
}

// Expose version for diagnostics
if (typeof window !== "undefined") {
  window.__ampNavVersion = VERSION;
}
