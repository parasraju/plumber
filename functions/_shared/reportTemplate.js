/**
 * HTML Report Template Renderer for Plumber on Cloudflare Pages
 */
import { GRADE_COLORS } from "./engine.js";

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function renderHtmlReport(report) {
  const slug = report.owner ? `${report.owner}/${report.repo_name}` : report.repo_name;
  const escSlug = escapeHtml(slug);
  const badgeColor = GRADE_COLORS[report.grade] || "#067647";
  const badgeBg = `${badgeColor}18`;
  const reportJson = JSON.stringify(report);

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plumber Report: ${escSlug}</title>
  <meta name="description" content="Inspection report for ${escSlug} — deterministic code leaks, clogs, and AI slop detection.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="prefetch" href="/night_sky_bg_v2.webp" as="image">
  <style>
    :root {
      --bg: #F4F3EF;
      --dot: #D6D4CD;
      --fg: #111111;
      --muted: #858585;
      --faint: #A8A7A2;
      --border: #C9C8C3;
      --border-light: #E0DFDA;
      --surface: #FFFFFF;
      --surface-alt: #F8F7F3;
      --titlebar: #E8E7E2;
      --titlebar-border: #D3D2CC;
      --dot-red: #EC6A5E;
      --dot-red-border: #D04F43;
      --dot-yellow: #F4BF4F;
      --dot-yellow-border: #D69F31;
      --dot-green: #62C554;
      --dot-green-border: #44A736;
      --accent-red: #C83B3B;
      --accent-orange: #C06014;
      --accent-yellow: #A06800;
      --accent-blue: #2E5AAC;
      --accent-green: #2B7A4B;
      --shadow-window: 0 10px 30px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04), 0 0 0 1px var(--border);
      --shadow-card: 0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px var(--border);
      --shadow-btn: 0 1px 2px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.85);
      --shadow-btn-pressed: inset 0 1px 3px rgba(0,0,0,0.15);
      --shadow-input: inset 0 1px 2px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
    }
    [data-theme="dark"] {
      --bg: #1A1A1C;
      --dot: #2D2D31;
      --fg: #EDEDED;
      --muted: #9E9E9E;
      --faint: #606064;
      --border: #3A3A3E;
      --border-light: #2C2C30;
      --surface: #222226;
      --surface-alt: #1E1E22;
      --titlebar: #2B2B30;
      --titlebar-border: #38383D;
      --accent-red: #EF5350;
      --accent-orange: #FFA726;
      --accent-yellow: #FBC02D;
      --accent-blue: #42A5F5;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    html, body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      width: 100%;
    }
    .top-bar {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .top-bar-inner {
      max-width: 1320px;
      margin: 0 auto;
      padding: 0 20px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 13px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      color: var(--fg);
      text-decoration: none;
    }
    .brand svg { width: 16px; height: 16px; fill: currentColor; }
    .brand-sep { color: var(--border); }
    .repo-link {
      color: var(--fg);
      text-decoration: underline;
      font-weight: 600;
    }
    .meta-text { color: var(--muted); font-size: 12px; }
    .top-actions { display: flex; align-items: center; gap: 8px; }
    .btn-utility {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      font-family: var(--font-mono);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
      box-shadow: var(--shadow-btn);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.1s ease;
    }
    .btn-utility:hover { background: var(--surface-alt); }
    .btn-utility.btn-primary {
      background: linear-gradient(180deg, #7bbcfb 0%, #4ea4fd 48%, #1b80f8 50%, #469bfd 75%, #82c6fe 100%);
      color: #000;
      border: 1px solid #1c4fb8;
      border-radius: 9999px;
      font-weight: 600;
    }
    .container {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }
    .report-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .report-title {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
      text-transform: lowercase;
    }
    .report-desc { color: var(--muted); font-size: 13px; }
    .score-card-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-card);
      border-radius: 12px;
      padding: 8px 16px 8px 12px;
    }
    .score-badge-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid;
      font-weight: 800;
      font-size: 20px;
      font-family: var(--font-mono);
    }
    .metric-score { display: flex; align-items: baseline; gap: 4px; }
    .score-num { font-family: var(--font-mono); font-size: 28px; font-weight: 800; line-height: 1; }
    .score-denom { font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
    .metric-label { font-family: var(--font-mono); font-size: 11px; color: var(--muted); text-transform: uppercase; }

    /* Sky Zone with Curved Side Edges */
    .report-sky-zone {
      position: relative;
      margin: 0 clamp(12px, 2.5vw, 32px) 32px;
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: 0 16px 40px rgba(0, 20, 60, 0.12);
      background-color: #2b77d9;
      background-image: image-set(url("/sky_bg.webp") type("image/webp"), url("/sky_bg.jpg") type("image/jpeg"));
      background-size: cover;
      background-position: center top;
      background-attachment: fixed;
      padding: 32px 0 80px;
      min-height: 75vh;
    }
    [data-theme="dark"] .report-sky-zone {
      border-color: rgba(255, 255, 255, 0.12);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      background-color: #070b14 !important;
      background-image: url("/night_sky_bg_v2.jpg") !important;
      background-image: image-set(url("/night_sky_bg_v2.webp") type("image/webp"), url("/night_sky_bg_v2.jpg") type("image/jpeg")) !important;
    }
    @media (max-width: 640px) {
      .report-sky-zone {
        margin: 0 8px 20px;
        border-radius: 14px;
      }
    }
    .toolbar {
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.9);
      border-radius: 12px;
      box-shadow: 0 14px 34px rgba(0, 20, 60, 0.18);
      padding: 10px 16px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    [data-theme="dark"] .toolbar {
      background: rgba(30, 30, 34, 0.92);
      border-color: rgba(255, 255, 255, 0.14);
    }
    .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .toolbar-chips { display: flex; align-items: center; gap: 6px; }
    .sev-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      cursor: pointer;
    }
    .sev-chip.active { background: var(--surface); border-color: var(--fg); color: var(--fg); font-weight: 600; }
    .sev-chip .dot { width: 7px; height: 7px; border-radius: 50%; }
    .dot.sev-CRITICAL { background: var(--accent-red); }
    .dot.sev-HIGH { background: var(--accent-orange); }
    .dot.sev-MEDIUM { background: var(--accent-yellow); }
    .dot.sev-LOW { background: var(--accent-blue); }
    .dot.sev-INFO { background: var(--muted); }
    .select-utility, .search-utility {
      height: 30px;
      padding: 0 10px;
      border-radius: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
      font-family: var(--font-mono);
      font-size: 12px;
      outline: none;
    }
    .search-utility { min-width: 220px; font-family: var(--font-sans); }

    .content-grid {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 20px;
      align-items: start;
    }
    .files-sidebar, .file-card {
      background: #fff;
      border-radius: 10px;
      border: 1px solid rgba(0, 0, 0, 0.14);
      box-shadow: 0 18px 42px rgba(0, 20, 60, 0.22);
      overflow: hidden;
      scroll-margin-top: 16px;
    }
    [data-theme="dark"] .files-sidebar, [data-theme="dark"] .file-card {
      background: #1e1e22;
      border-color: rgba(255, 255, 255, 0.12);
      color: #ededed;
    }
    .sidebar-head, .file-card-header {
      background: linear-gradient(180deg, #f7f7f7 0%, #ececec 50%, #e1e1e1 100%);
      border-bottom: 1px solid #d5d5d5;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
    }
    [data-theme="dark"] .sidebar-head, [data-theme="dark"] .file-card-header {
      background: linear-gradient(180deg, #2c2c32 0%, #24242a 100%);
      border-bottom-color: #38383e;
    }
    .file-path-title {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      word-break: break-word;
    }
    .window-dots-mini { display: inline-flex; align-items: center; gap: 5px; }
    .window-dot-mini { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .window-dot-mini.close { background: #ff5f56; border: 1px solid #cf3c37; }
    .window-dot-mini.min { background: #ffbd2e; border: 1px solid #cfa01f; }
    .window-dot-mini.max { background: #27c93f; border: 1px solid #1a962b; }

    .sidebar-list { padding: 6px; display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 120px); overflow-y: auto; }
    .file-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      text-decoration: none;
    }
    .file-item:hover, .file-item.active { background: var(--surface-alt); color: var(--fg); font-weight: 600; }
    .count-badge { font-size: 11px; padding: 1px 5px; border-radius: 3px; background: var(--surface); border: 1px solid var(--border-light); }

    .findings-container { display: flex; flex-direction: column; gap: 16px; }
    .issue-item { padding: 12px 14px; border-bottom: 1px solid var(--border-light); }
    .issue-item:last-child { border-bottom: none; }
    .issue-meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
    .line-badge { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
    .sev-badge {
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .sev-badge.sev-CRITICAL { background: rgba(200, 59, 59, 0.1); color: var(--accent-red); border: 1px solid rgba(200, 59, 59, 0.4); }
    .sev-badge.sev-HIGH { background: rgba(192, 96, 20, 0.1); color: var(--accent-orange); border: 1px solid rgba(192, 96, 20, 0.4); }
    .sev-badge.sev-MEDIUM { background: rgba(160, 104, 0, 0.1); color: var(--accent-yellow); border: 1px solid rgba(160, 104, 0, 0.4); }
    .sev-badge.sev-LOW, .sev-badge.sev-INFO { background: var(--surface-alt); color: var(--muted); border: 1px solid var(--border); }
    .issue-title { font-size: 13px; font-weight: 600; color: var(--fg); word-break: break-word; }
    .rule-id { font-family: var(--font-mono); font-size: 11px; color: var(--faint); word-break: break-all; }
    .issue-code {
      background: var(--surface-alt);
      border: 1px solid var(--border-light);
      border-radius: 4px;
      padding: 8px 10px;
      margin: 8px 0;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--fg);
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    [data-theme="dark"] .issue-code { background: #141416; border-color: #34343a; color: #ededed; }
    .issue-fix { font-size: 12.5px; color: var(--muted); word-break: break-word; }
    .issue-fix strong { color: var(--fg); }

    .clean-state {
      background: #fff;
      border-radius: 10px;
      padding: 48px 24px;
      text-align: center;
      border: 1px solid rgba(0, 0, 0, 0.14);
      box-shadow: 0 18px 42px rgba(0, 20, 60, 0.22);
    }
    [data-theme="dark"] .clean-state { background: #1e1e22; border-color: rgba(255, 255, 255, 0.12); }
    .clean-state h3 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
    .clean-state p { color: var(--muted); }

    .report-plain-zone {
      background: var(--bg);
      padding: 32px 0;
      border-top: 1px solid var(--border);
    }
    .report-footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--fg);
      color: var(--bg);
      padding: 8px 16px;
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      box-shadow: var(--shadow-window);
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.2s ease;
      pointer-events: none;
      z-index: 1000;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    @media (max-width: 820px) {
      .content-grid {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      .files-sidebar {
        max-height: 220px;
        display: flex;
        flex-direction: column;
      }
      .sidebar-list {
        max-height: 165px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
    }

    @media (max-width: 768px) {
      .top-bar-inner {
        height: auto;
        padding: 10px 14px;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .top-bar-left {
        flex-wrap: wrap;
        gap: 6px 8px;
        font-size: 12px;
        line-height: 1.4;
      }
      .meta-text {
        width: 100%;
        margin-top: 2px;
        font-size: 11px;
        display: block;
      }
      .top-actions {
        display: flex;
        width: 100%;
        gap: 6px;
      }
      .top-actions .btn-utility {
        flex: 1 1 0;
        justify-content: center;
        text-align: center;
        padding: 7px 8px;
        font-size: 11px;
        white-space: nowrap;
        min-height: 34px;
      }
      .container {
        padding: 16px 12px 28px;
      }
      .report-header {
        flex-direction: column;
        align-items: stretch;
        gap: 14px;
        padding-bottom: 16px;
      }
      .report-title {
        font-size: 20px;
      }
      .report-desc {
        font-size: 12px;
      }
      .score-card-pill {
        width: 100%;
        justify-content: flex-start;
        padding: 10px 14px;
        gap: 12px;
      }
      .report-sky-zone {
        background-attachment: scroll;
        margin: 0 6px 20px;
        border-radius: 14px;
        padding: 16px 0 32px;
        min-height: auto;
      }
      .report-sky-zone .container {
        padding: 0 6px;
      }
      .toolbar {
        padding: 12px;
        margin-bottom: 16px;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        border-radius: 10px;
      }
      .toolbar-left {
        width: 100%;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }
      .toolbar-chips {
        width: 100%;
        overflow-x: auto;
        flex-wrap: nowrap;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 4px;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .toolbar-chips::-webkit-scrollbar {
        display: none;
      }
      .sev-chip {
        flex-shrink: 0;
        min-height: 30px;
        font-size: 11px;
        padding: 4px 9px;
      }
      .toolbar-right {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .search-utility {
        grid-column: 1 / -1;
        width: 100%;
        min-width: 0;
        height: 36px;
        font-size: 16px; /* Avoid iOS Safari unwanted zoom */
      }
      .toolbar-right .select-utility,
      .toolbar-left .select-utility {
        width: 100%;
        height: 36px;
        font-size: 16px; /* Avoid iOS Safari unwanted zoom */
      }
      #copyAllBriefBtn {
        width: 100%;
        justify-content: center;
        min-height: 36px;
        font-size: 11.5px;
        padding: 0 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .file-card-header {
        flex-wrap: wrap;
        gap: 8px;
      }
      .issue-code {
        font-size: 11px;
      }
      .toast {
        bottom: 16px;
        right: 16px;
        left: 16px;
        text-align: center;
      }
    }

    @media (max-width: 520px) {
      .top-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .top-actions .btn-utility.btn-primary {
        grid-column: 1 / -1;
      }
      .toolbar-right {
        display: flex;
        flex-direction: column;
      }
      #copyAllBriefBtn {
        font-size: 12px;
      }
      .file-card-header {
        flex-direction: column;
        align-items: stretch;
      }
      .file-card-header .btn-utility {
        width: 100%;
        justify-content: center;
        min-height: 32px;
      }
      .report-footer-inner {
        flex-direction: column;
        align-items: stretch;
        text-align: center;
        gap: 14px;
      }
      .report-footer-inner > div {
        justify-content: center;
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="top-bar-inner">
      <div class="top-bar-left">
        <a href="/" class="brand" title="Plumber Homepage">
          <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V19a1 1 0 0 1-2 0v-2.07A8.005 8.005 0 0 1 4.07 10H6a1 1 0 0 1 0-2H4.07A8.005 8.005 0 0 1 11 3.07V5a1 1 0 0 1 2 0V3.07A8.005 8.005 0 0 1 19.93 10H18a1 1 0 0 1 0 2h1.93A8.005 8.005 0 0 1 13 16.93zM12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5z"/></svg>
          plumber
        </a>
        <span class="brand-sep">/</span>
        <a href="https://github.com/${escSlug}" target="_blank" rel="noopener" class="repo-link">${escSlug}</a>
        <span class="meta-text">&middot; ${report.total_files} files &middot; ${report.total_lines.toLocaleString()} lines &middot; ${report.duration_seconds}s</span>
      </div>
      <div class="top-actions">
        <button class="btn-utility" type="button" id="copyBadgeBtn">Copy Badge</button>
        <button class="btn-utility" type="button" id="themeToggleBtn"><span id="themeBtnText">Dark Mode</span></button>
        <a href="/" class="btn-utility btn-primary">Scan Another Repo</a>
      </div>
    </div>
  </div>

  <div class="container">
    <header class="report-header">
      <div>
        <h1 class="report-title">inspection report</h1>
        <p class="report-desc">Deterministic analysis of code leaks, dead clogs, and AI-generated residue.</p>
      </div>
      <div class="score-card-pill">
        <div class="score-badge-circle" style="background:${badgeBg}; border-color:${badgeColor}; color:${badgeColor};">
          ${report.grade}
        </div>
        <div>
          <div class="metric-score">
            <span class="score-num">${report.score.toFixed(1)}</span>
            <span class="score-denom">/ 100</span>
          </div>
          <div class="metric-label">Health Score &middot; Grade ${report.grade}</div>
        </div>
      </div>
    </header>
  </div>

  <div class="report-sky-zone">
    <div class="container">
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="toolbar-chips" id="sevChips"></div>
          <select class="select-utility" id="catFilter">
            <option value="">All Categories</option>
          </select>
        </div>
        <div class="toolbar-right">
          <input type="search" class="search-utility" id="searchFilter" placeholder="Filter findings..." autocomplete="off">
          <select class="select-utility" id="exportSelect">
            <option value="">Export...</option>
            <option value="md">Markdown (.md)</option>
            <option value="json">JSON (.json)</option>
            <option value="pdf">Print / PDF</option>
          </select>
          <button class="btn-utility" id="copyAllBriefBtn" type="button">Copy Fix Brief for AI</button>
        </div>
      </div>

      <div class="content-grid">
        <aside class="files-sidebar">
          <div class="sidebar-head">
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="window-dots-mini">
                <span class="window-dot-mini close"></span>
                <span class="window-dot-mini min"></span>
                <span class="window-dot-mini max"></span>
              </div>
              <span>FILES</span>
            </div>
            <span class="count-badge" id="filesCountBadge">0</span>
          </div>
          <div class="sidebar-list" id="sidebarList"></div>
        </aside>

        <section class="findings-container" id="findingsList"></section>
      </div>
    </div>
  </div>

  <div class="report-plain-zone">
    <div class="container report-footer-inner">
      <div style="display:flex; align-items:center; gap:8px;">
        <strong>plumber</strong>
        <span class="meta-text">&middot; deterministic code quality & anti-slop engine</span>
      </div>
      <div style="display:flex; gap:12px; align-items:center;">
        <a href="/" class="btn-utility">Home</a>
        <a href="https://github.com/${escSlug}" target="_blank" rel="noopener" class="btn-utility">GitHub Repo</a>
        <button class="btn-utility" type="button" onclick="window.scrollTo({top:0, behavior:'smooth'})">Back to Top &uarr;</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script id="data" type="application/json">${reportJson}</script>
  <script>
    (() => {
      const data = JSON.parse(document.getElementById("data").textContent);
      const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
      const activeSevs = new Set(SEVS);
      const $ = (id) => document.getElementById(id);

      const savedTheme = localStorage.getItem("plumber-theme") || "light";
      document.documentElement.setAttribute("data-theme", savedTheme);
      const themeBtnText = $("themeBtnText");
      if (themeBtnText) themeBtnText.textContent = savedTheme === "light" ? "Dark Mode" : "Light Mode";

      $("themeToggleBtn")?.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = cur === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("plumber-theme", next);
        if (themeBtnText) themeBtnText.textContent = next === "light" ? "Dark Mode" : "Light Mode";
      });

      let toastTimer;
      function showToast(msg) {
        const t = $("toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
      }

      $("copyBadgeBtn")?.addEventListener("click", () => {
        const snippet = \`[![Plumber grade](\${location.origin}/badge/\${data.owner}/\${data.repo_name})](\${location.origin}/r/\${data.owner}/\${data.repo_name})\`;
        navigator.clipboard.writeText(snippet).then(() => showToast("Badge snippet copied to clipboard!"));
      });

      $("copyAllBriefBtn")?.addEventListener("click", () => {
        navigator.clipboard.writeText(data.brief || "").then(() => showToast("AI Agent prompt copied to clipboard!"));
      });

      const chipsEl = $("sevChips");
      SEVS.forEach((s) => {
        const count = data.counts[s] || 0;
        if (count > 0) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "sev-chip active";
          chip.innerHTML = \`<span class="dot sev-\${s}"></span>\${s} &middot; \${count}\`;
          chip.onclick = () => {
            if (activeSevs.has(s)) {
              activeSevs.delete(s);
              chip.classList.remove("active");
            } else {
              activeSevs.add(s);
              chip.classList.add("active");
            }
            render();
          };
          chipsEl.appendChild(chip);
        }
      });

      const catEl = $("catFilter");
      Object.keys(data.categories || {}).forEach((cat) => {
        if (data.categories[cat] > 0) {
          const opt = document.createElement("option");
          opt.value = cat;
          opt.textContent = \`\${cat} (\${data.categories[cat]})\`;
          catEl.appendChild(opt);
        }
      });
      catEl.onchange = render;
      $("searchFilter").oninput = render;

      function escapeText(str) {
        return String(str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }

      function filterIssues(issues, path) {
        const cat = catEl.value;
        const q = $("searchFilter").value.trim().toLowerCase();
        return issues.filter((i) => {
          if (!activeSevs.has(i.severity)) return false;
          if (cat && i.category !== cat) return false;
          if (q) {
            const h = \`\${path} \${i.rule_id} \${i.title} \${i.evidence} \${i.fix}\`.toLowerCase();
            if (!h.includes(q)) return false;
          }
          return true;
        });
      }

      function render() {
        const sidebarList = $("sidebarList");
        const countBadge = $("filesCountBadge");
        const list = $("findingsList");

        if (!data.files || data.files.length === 0) {
          list.innerHTML = \`
            <div class="clean-state">
              <div style="width:56px; height:56px; border-radius:50%; background:rgba(6,118,71,0.12); display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px; border:2px solid #067647; color:#067647; font-size:24px; font-weight:800;">✓</div>
              <h3>Pristine Codebase</h3>
              <p>No leaks, clogs, or AI slop detected! Repository achieved Grade A (\${data.score.toFixed(1)} / 100).</p>
            </div>
          \`;
          if (sidebarList) sidebarList.innerHTML = "";
          if (countBadge) countBadge.textContent = "0";
          return;
        }

        sidebarList.innerHTML = "";
        list.innerHTML = "";
        let visibleFiles = 0;
        let visibleIssues = 0;

        data.files.forEach((file, idx) => {
          const matched = filterIssues(file.issues, file.path);
          if (matched.length === 0) return;
          visibleFiles++;
          visibleIssues += matched.length;

          const navItem = document.createElement("a");
          navItem.className = \`file-item\${visibleFiles === 1 ? " active" : ""}\`;
          navItem.href = \`#f-\${idx}\`;
          const baseName = file.path.split("/").pop();
          navItem.innerHTML = \`<span class="file-name" title="\${escapeText(file.path)}">\${escapeText(baseName)}</span><span class="count-badge">\${matched.length}</span>\`;
          navItem.onclick = () => {
            document.querySelectorAll(".file-item").forEach(el => el.classList.remove("active"));
            navItem.classList.add("active");
          };
          sidebarList.appendChild(navItem);

          const card = document.createElement("article");
          card.className = "file-card";
          card.id = \`f-\${idx}\`;

          const header = document.createElement("div");
          header.className = "file-card-header";
          header.innerHTML = \`
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 auto;">
              <div class="window-dots-mini" style="flex-shrink:0;">
                <span class="window-dot-mini close"></span>
                <span class="window-dot-mini min"></span>
                <span class="window-dot-mini max"></span>
              </div>
              <span class="file-path-title" title="\${escapeText(file.path)}">\${escapeText(file.path)}</span>
            </div>
            <button class="btn-utility" type="button" data-copy-idx="\${idx}">Copy Fix</button>
          \`;
          card.appendChild(header);

          const body = document.createElement("div");
          matched.forEach(i => {
            const item = document.createElement("div");
            item.className = "issue-item";
            item.innerHTML = \`
              <div class="issue-meta-row">
                <span class="line-badge">L\${i.line}</span>
                <span class="sev-badge sev-\${i.severity}">\${i.severity}</span>
                <span class="issue-title">\${escapeText(i.title)}</span>
                <span class="rule-id">\${escapeText(i.rule_id)}</span>
              </div>
              \${i.evidence ? \`<pre class="issue-code"><code>\${escapeText(i.evidence)}</code></pre>\` : ""}
              \${i.fix ? \`<div class="issue-fix"><strong>Suggested Fix:</strong> \${escapeText(i.fix)}</div>\` : ""}
            \`;
            body.appendChild(item);
          });
          card.appendChild(body);
          list.appendChild(card);
        });

        if (countBadge) countBadge.textContent = String(visibleFiles);

        if (visibleIssues === 0) {
          list.innerHTML = \`
            <div class="clean-state">
              <h3>No Matching Findings</h3>
              <p>Try clearing your search query or enabling more severity filters.</p>
            </div>
          \`;
        }

        list.querySelectorAll("[data-copy-idx]").forEach(btn => {
          btn.onclick = () => {
            const f = data.files[btn.dataset.copyIdx];
            let prompt = \`# Fix issues in \${f.path}\\n\`;
            f.issues.forEach(i => {
              prompt += \`- L\${i.line} [\${i.severity}] \${i.title} (\${i.rule_id}): \${i.fix}\\n\`;
            });
            navigator.clipboard.writeText(prompt).then(() => showToast(\`Fix prompt for \${f.path} copied!\`));
          };
        });
      }

      $("exportSelect").onchange = (e) => {
        const fmt = e.target.value;
        e.target.value = "";
        if (!fmt) return;
        if (fmt === "pdf") {
          window.print();
        } else {
          location.href = \`?format=\${fmt}\`;
        }
      };

      render();
    })();
  </script>
</body>
</html>`;
}
