"""
Interactive HTML report generator for Plumber — Code Hygiene & Slop Inspector.
"""
import html
import json
from plumber.core.models import ScanReport
from plumber.core.scoring import GRADE_COLORS


def render_html_report(report: ScanReport) -> str:
    slug = f"{report.owner}/{report.repo_name}" if report.owner else report.repo_name
    esc_slug = html.escape(slug)
    badge_color = GRADE_COLORS.get(report.grade, "#2B7A4B")
    badge_bg = f"{badge_color}18"
    report_json = json.dumps(report.to_dict())

    commit_link = (
        f'<a href="https://github.com/{esc_slug}/tree/{report.commit}" target="_blank" rel="noopener" class="commit-link">{report.commit[:7]}</a>'
        if report.commit else "default branch"
    )

    return f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plumber Report: {esc_slug}</title>
  <meta name="description" content="Inspection report for {esc_slug} — deterministic code leaks, clogs, and AI slop detection.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    /* ==========================================================================
       Plumber — Code Hygiene & Slop Inspector Design System
       ========================================================================== */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {{
      /* Warm Ivory Palette (Light Mode Default) */
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

      /* Window Control Dots */
      --dot-red: #EC6A5E;
      --dot-red-border: #D04F43;
      --dot-yellow: #F4BF4F;
      --dot-yellow-border: #D69F31;
      --dot-green: #62C554;
      --dot-green-border: #44A736;
      --mac-red: var(--dot-red);
      --mac-yellow: var(--dot-yellow);
      --mac-green: var(--dot-green);

      /* Severity Accents (Restrained & Informative) */
      --accent-red: #C83B3B;
      --accent-orange: #C06014;
      --accent-yellow: #A06800;
      --accent-blue: #2E5AAC;
      --accent-green: #2B7A4B;

      /* Tactile Shadows & Insets */
      --shadow-window: 0 10px 30px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04), 0 0 0 1px var(--border);
      --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.04), 0 0 0 1px var(--border);
      --shadow-btn: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.85);
      --shadow-btn-pressed: inset 0 1px 3px rgba(0, 0, 0, 0.15);
      --shadow-input: inset 0 1px 2px rgba(0, 0, 0, 0.06), 0 1px 0 rgba(255, 255, 255, 0.8);

      /* Typography */
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace;
    }}

    [data-theme="dark"] {{
      /* Dark Desktop Theme */
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
      --accent-green: #66BB6A;

      --shadow-window: 0 12px 36px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border);
      --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border);
      --shadow-btn: 0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      --shadow-btn-pressed: inset 0 2px 4px rgba(0, 0, 0, 0.4);
      --shadow-input: inset 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.05);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    html {{
      zoom: 1.25;
    }}

    @media (max-width: 680px) {{
      html {{
        zoom: 1;
      }}
    }}

    html, body {{
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      min-height: 100vh;
      overflow-x: hidden;
    }}

    a {{
      color: inherit;
      text-decoration: none;
    }}

    /* ==========================================================================
       Compact Top Navigation
       ========================================================================== */
    .top-bar {{
      position: sticky;
      top: 0;
      z-index: 100;
      background-color: rgba(244, 243, 239, 0.94);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
    }}

    [data-theme="dark"] .top-bar {{
      background-color: rgba(26, 26, 28, 0.94);
    }}

    .top-bar-inner {{
      max-width: 1320px;
      margin: 0 auto;
      padding: 0 20px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }}

    .top-bar-left {{
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }}

    .brand {{
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: -0.02em;
      color: var(--fg);
      flex-shrink: 0;
    }}

    .brand svg {{
      width: 17px;
      height: 17px;
      fill: currentColor;
    }}

    .brand-sep {{
      color: var(--border);
      font-weight: 300;
    }}

    .repo-link {{
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
      text-decoration: underline;
      text-underline-offset: 3px;
      text-decoration-color: var(--border);
      transition: text-decoration-color 0.15s ease;
    }}

    .repo-link:hover {{
      text-decoration-color: var(--fg);
    }}

    .meta-text {{
      color: var(--muted);
      font-size: 12px;
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
    }}

    .commit-link {{
      color: var(--fg);
      text-decoration: underline;
      text-underline-offset: 2px;
    }}

    .top-actions {{
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }}

    /* Utility Button */
    .btn-utility {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      font-family: var(--font-mono);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
      box-shadow: var(--shadow-btn);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.1s ease;
      text-decoration: none;
    }}

    .btn-utility:hover {{
      background: var(--surface-alt);
      border-color: var(--faint);
    }}

    .btn-utility:active {{
      box-shadow: var(--shadow-btn-pressed);
      transform: translateY(1px);
    }}

    .btn-utility.btn-primary {{
      background: var(--fg);
      color: var(--bg);
      border-color: var(--fg);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }}

    .btn-utility.btn-primary:hover {{
      opacity: 0.9;
    }}

    /* ==========================================================================
       Main Report Container
       ========================================================================== */
    .container {{
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px 20px 60px;
    }}

    /* ==========================================================================
       Inspection Report Header (Clean & Compact)
       ========================================================================== */
    .report-header {{
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }}

    .report-header-left {{
      max-width: 680px;
    }}

    .report-title {{
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--fg);
      margin-bottom: 4px;
    }}

    .report-desc {{
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
    }}

    /* Health Score Metric (Restrained typography, no oversized ring) */
    .report-header-right {{
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
    }}

    .metric-score {{
      display: flex;
      align-items: baseline;
      gap: 4px;
    }}

    .score-num {{
      font-family: var(--font-mono);
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.04em;
      color: var(--fg);
      line-height: 1;
    }}

    .score-denom {{
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--muted);
      font-weight: 500;
    }}

    .metric-label {{
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.06em;
      color: var(--muted);
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 6px;
    }}

    .grade-tag {{
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
      font-size: 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
    }}

    .grade-tag.grade-A {{ color: var(--accent-green); border-color: var(--accent-green); background: rgba(43, 122, 75, 0.08); }}
    .grade-tag.grade-B {{ color: var(--accent-blue); border-color: var(--accent-blue); background: rgba(46, 90, 172, 0.08); }}
    .grade-tag.grade-C {{ color: var(--accent-yellow); border-color: var(--accent-yellow); background: rgba(160, 104, 0, 0.08); }}
    .grade-tag.grade-D {{ color: var(--accent-orange); border-color: var(--accent-orange); background: rgba(192, 96, 20, 0.08); }}
    .grade-tag.grade-F {{ color: var(--accent-red); border-color: var(--accent-red); background: rgba(200, 59, 59, 0.08); }}

    /* ==========================================================================
       Filter and Action Toolbar
       ========================================================================== */
    .toolbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }}

    .toolbar-left {{
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      flex: 1;
      min-width: 280px;
    }}

    .toolbar-chips {{
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }}

    .sev-chip {{
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
      box-shadow: var(--shadow-btn);
      user-select: none;
      transition: all 0.1s ease;
    }}

    .sev-chip:hover {{
      background: var(--surface-alt);
      color: var(--fg);
    }}

    .sev-chip.active {{
      background: var(--surface);
      border-color: var(--fg);
      color: var(--fg);
      font-weight: 600;
    }}

    .sev-chip .dot {{
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }}

    .dot.sev-CRITICAL {{ background-color: var(--accent-red); }}
    .dot.sev-HIGH {{ background-color: var(--accent-orange); }}
    .dot.sev-MEDIUM {{ background-color: var(--accent-yellow); }}
    .dot.sev-LOW {{ background-color: var(--accent-blue); }}
    .dot.sev-INFO {{ background-color: var(--muted); }}

    .toolbar-right {{
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }}

    .select-utility, .search-utility {{
      height: 28px;
      padding: 0 8px;
      border-radius: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
      font-family: var(--font-mono);
      font-size: 12px;
      box-shadow: var(--shadow-input);
      outline: none;
      transition: border-color 0.15s ease;
    }}

    .select-utility:focus, .search-utility:focus {{
      border-color: var(--fg);
    }}

    .search-utility {{
      min-width: 220px;
      flex: 1;
      font-family: var(--font-sans);
    }}

    .search-utility::placeholder {{
      color: var(--faint);
    }}

    /* ==========================================================================
       Main Report Layout (Two Columns)
       ========================================================================== */
    .content-grid {{
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 20px;
      margin-top: 20px;
      align-items: start;
    }}

    /* Left Sidebar: Files */
    .files-sidebar {{
      position: sticky;
      top: 68px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: var(--shadow-card);
      overflow: hidden;
      max-height: calc(100vh - 90px);
      display: flex;
      flex-direction: column;
    }}

    .sidebar-head {{
      height: 30px;
      background: var(--titlebar);
      border-bottom: 1px solid var(--titlebar-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      letter-spacing: 0.04em;
    }}

    .sidebar-total-count {{
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
    }}

    .sidebar-list {{
      overflow-y: auto;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }}

    .file-item {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      cursor: pointer;
      text-decoration: none;
      border: 1px solid transparent;
      transition: all 0.1s ease;
      gap: 8px;
    }}

    .file-item:hover {{
      background: var(--surface-alt);
      color: var(--fg);
    }}

    .file-item.active {{
      background: var(--surface-alt);
      border-color: var(--border);
      color: var(--fg);
      font-weight: 600;
    }}

    .file-name {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}

    .count-badge {{
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--surface);
      border: 1px solid var(--border-light);
      color: var(--fg);
      flex-shrink: 0;
    }}

    /* Main Content: Findings */
    .findings-container {{
      display: flex;
      flex-direction: column;
      gap: 16px;
    }}

    .file-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: var(--shadow-card);
      overflow: hidden;
      scroll-margin-top: 70px;
    }}

    .file-card-header {{
      background: var(--titlebar);
      border-bottom: 1px solid var(--titlebar-border);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }}

    .file-card-title {{
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}

    .window-dots-mini,
    .mac-dots-mini {{
      display: flex;
      align-items: center;
      gap: 4px;
    }}

    .window-dot-mini,
    .mac-dot-mini {{
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }}

    .window-dot-mini.close, .mac-dot-mini.close {{ background: var(--dot-red); border: 1px solid var(--dot-red-border); }}
    .window-dot-mini.min, .mac-dot-mini.min {{ background: var(--dot-yellow); border: 1px solid var(--dot-yellow-border); }}
    .window-dot-mini.max, .mac-dot-mini.max {{ background: var(--dot-green); border: 1px solid var(--dot-green-border); }}

    .file-path {{
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}

    .file-card-body {{
      display: flex;
      flex-direction: column;
    }}

    .issue-item {{
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-light);
    }}

    .issue-item:last-child {{
      border-bottom: none;
    }}

    .issue-meta-row {{
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }}

    .line-badge {{
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
    }}

    .sev-badge {{
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      letter-spacing: 0.04em;
    }}

    .sev-badge.sev-CRITICAL {{
      background: rgba(200, 59, 59, 0.08);
      border: 1px solid rgba(200, 59, 59, 0.4);
      color: var(--accent-red);
    }}

    .sev-badge.sev-HIGH {{
      background: rgba(192, 96, 20, 0.08);
      border: 1px solid rgba(192, 96, 20, 0.4);
      color: var(--accent-orange);
    }}

    .sev-badge.sev-MEDIUM {{
      background: rgba(160, 104, 0, 0.08);
      border: 1px solid rgba(160, 104, 0, 0.4);
      color: var(--accent-yellow);
    }}

    .sev-badge.sev-LOW, .sev-badge.sev-INFO {{
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--muted);
    }}

    .issue-title {{
      font-size: 13px;
      font-weight: 600;
      color: var(--fg);
    }}

    .rule-id {{
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--faint);
    }}

    .issue-code {{
      background: var(--surface-alt);
      border: 1px solid var(--border-light);
      border-radius: 4px;
      padding: 8px 10px;
      margin: 8px 0;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      color: var(--fg);
      white-space: pre-wrap;
      overflow-x: auto;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.03);
    }}

    .issue-fix {{
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--muted);
      margin-top: 6px;
    }}

    .issue-fix strong {{
      color: var(--fg);
      font-weight: 600;
      margin-right: 4px;
    }}

    /* Clean / Empty State */
    .clean-state {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 48px 24px;
      text-align: center;
      box-shadow: var(--shadow-card);
    }}

    .clean-state-icon {{
      font-size: 28px;
      color: var(--accent-green);
      margin-bottom: 10px;
      font-family: var(--font-mono);
    }}

    .clean-state h3 {{
      font-size: 16px;
      font-weight: 700;
      color: var(--fg);
      margin-bottom: 6px;
    }}

    .clean-state p {{
      color: var(--muted);
      font-size: 13px;
    }}

    /* Toast Notification */
    .toast {{
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--fg);
      color: var(--bg);
      padding: 8px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-family: var(--font-mono);
      box-shadow: var(--shadow-window);
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.2s ease;
      pointer-events: none;
      z-index: 1000;
    }}

    .toast.show {{
      opacity: 1;
      transform: translateY(0);
    }}

    /* ==========================================================================
       Responsive Breakpoints
       ========================================================================== */
    @media (max-width: 960px) {{
      .content-grid {{
        grid-template-columns: 220px 1fr;
      }}
      .search-utility {{
        min-width: 160px;
      }}
    }}


    /* ==========================================================================
       Zone 1: Report Hero Zone (Pristine Clean Canvas, No Dots, No GIFs)
       ========================================================================== */
    .report-hero-zone {{
      position: relative;
      background-color: var(--bg);
      padding: 0 0 32px;
      overflow: hidden;
      border-bottom: none;
    }}

    .score-card-pill {{
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-card);
      border-radius: 12px;
      padding: 8px 16px 8px 12px;
    }}

    .score-badge-circle {{
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid;
      font-weight: 800;
      font-size: 18px;
      font-family: var(--font-mono);
      flex-shrink: 0;
    }}

    /* Aqua Capsule Button for Primary Actions */
    .btn-utility.btn-primary {{
      position: relative;
      overflow: hidden;
      border-radius: 9999px;
      padding: 5px 16px;
      font-weight: 600;
      color: #000000;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
      border: 1px solid #1c4fb8;
      background: linear-gradient(180deg, #7bbcfb 0%, #4ea4fd 48%, #1b80f8 50%, #469bfd 75%, #82c6fe 100%);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 1px 0.5px rgba(255, 255, 255, 0.95);
    }}

    .btn-utility.btn-primary:hover {{
      filter: brightness(1.04);
      opacity: 1;
    }}

    /* ==========================================================================
       Zone 2: Atmospheric Sky Zone with Viewport-Fixed Clouds & Smooth Fades
       ========================================================================== */
    .report-sky-zone {{
      position: relative;
      margin: 0 clamp(12px, 2.5vw, 32px) 32px;
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: 0 16px 40px rgba(0, 20, 60, 0.12);
      background-color: #2b77d9;
      background-image:
        image-set(
          url("/sky_bg.webp") type("image/webp"),
          url("/sky_bg.jpg") type("image/jpeg")
        );
      background-size: cover;
      background-position: center top;
      background-attachment: fixed;
      background-repeat: no-repeat;
      padding: 32px 0 80px;
      min-height: 85vh;
    }}

    /* Framer-Style Top Fade Transition (Hero Clean Canvas -> Sky) */
    .report-sky-zone::before {{
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 50px;
      background: linear-gradient(to bottom, var(--bg) 0%, rgba(244, 243, 239, 0) 100%);
      pointer-events: none;
      z-index: 5;
    }}

    /* Framer-Style Bottom Fade Transition (Sky -> Solid Plain Section) */
    .report-sky-zone::after {{
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 80px;
      background: linear-gradient(to bottom, rgba(244, 243, 239, 0) 0%, var(--surface-plain, #F4F3EF) 100%);
      pointer-events: none;
      z-index: 5;
    }}

    [data-theme="dark"] .report-sky-zone::before {{
      background: linear-gradient(to bottom, var(--bg) 0%, rgba(20, 20, 22, 0) 100%);
    }}

    [data-theme="dark"] .report-sky-zone::after {{
      background: linear-gradient(to bottom, rgba(20, 20, 22, 0) 0%, #141416 100%);
    }}

    [data-theme="dark"] .report-sky-zone {{
      background-color: #0d1726;
      background-image:
        linear-gradient(to bottom, rgba(13, 23, 38, 0.4), rgba(13, 23, 38, 0.5)),
        image-set(
          url("/sky_bg.webp") type("image/webp"),
          url("/sky_bg.jpg") type("image/jpeg")
        );
    }}

    /* Floating Frosted Pill Toolbar in Sky Zone */
    .report-sky-zone .toolbar {{
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.9);
      border-radius: 12px;
      box-shadow: 0 14px 34px rgba(0, 20, 60, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06);
      padding: 10px 16px;
      border-bottom: none;
      margin-bottom: 24px;
    }}

    [data-theme="dark"] .report-sky-zone .toolbar {{
      background: rgba(30, 30, 34, 0.92);
      border-color: rgba(255, 255, 255, 0.14);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
    }}

    /* Floating macOS Window Cards in Sky Zone */
    .report-sky-zone .file-card,
    .report-sky-zone .files-sidebar {{
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.14);
      border-radius: 10px;
      box-shadow: 0 18px 42px rgba(0, 20, 60, 0.22), 0 2px 6px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      color: #111111;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }}

    .report-sky-zone .file-card:hover {{
      transform: translateY(-2px);
      box-shadow: 0 22px 48px rgba(0, 20, 60, 0.28), 0 4px 10px rgba(0, 0, 0, 0.12);
    }}

    .report-sky-zone .file-card-header,
    .report-sky-zone .sidebar-head {{
      background: linear-gradient(180deg, #f7f7f7 0%, #ececec 50%, #e1e1e1 100%);
      border-bottom: 1px solid #d5d5d5;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }}

    /* Authentic 3D Gel Window Control Dots */
    .window-dots-mini {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }}

    .window-dot-mini {{
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      position: relative;
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
    }}

    .window-dot-mini.close {{
      background: radial-gradient(circle at 35% 30%, #ff837d 0%, #ff5f56 50%, #e0443e 100%);
      border: 1px solid #cf3c37;
    }}

    .window-dot-mini.min {{
      background: radial-gradient(circle at 35% 30%, #ffdf6d 0%, #ffbd2e 50%, #dea123 100%);
      border: 1px solid #cfa01f;
    }}

    .window-dot-mini.max {{
      background: radial-gradient(circle at 35% 30%, #6be375 0%, #27c93f 50%, #1eae33 100%);
      border: 1px solid #1a962b;
    }}

    .window-close-x {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1;
      color: #8c8c8c;
      cursor: default;
      user-select: none;
      transition: color 0.15s ease;
      padding: 0 2px;
    }}

    .window-close-x:hover {{
      color: #333333;
    }}

    /* Dark Mode Overrides for Sky Zone Cards */
    [data-theme="dark"] .report-sky-zone .file-card,
    [data-theme="dark"] .report-sky-zone .files-sidebar {{
      background: #1e1e22;
      border-color: rgba(255, 255, 255, 0.12);
      color: #ededed;
    }}

    [data-theme="dark"] .report-sky-zone .file-card-header,
    [data-theme="dark"] .report-sky-zone .sidebar-head {{
      background: linear-gradient(180deg, #2c2c32 0%, #24242a 100%);
      border-bottom-color: #38383e;
    }}

    [data-theme="dark"] .issue-code {{
      background: #141416;
      border-color: #34343a;
      color: #ededed;
    }}

    /* ==========================================================================
       Zone 3: Plain Calm Surface (No Dots, No Sky, Solid Background)
       ========================================================================== */
    .report-plain-zone {{
      position: relative;
      background-color: var(--surface-plain, #F4F3EF);
      padding: 32px 0 40px;
      box-sizing: border-box;
      border-top: none;
    }}

    [data-theme="dark"] .report-plain-zone {{
      background-color: #1A1A1C;
    }}

    .report-footer-inner {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }}

    @media (max-width: 820px) {{
      .content-grid {{
        grid-template-columns: 1fr;
      }}
      .files-sidebar {{
        position: static;
        max-height: 200px;
      }}
      .sidebar-list {{
        max-height: 150px;
        overflow-y: auto;
      }}
      .top-bar-inner {{
        height: auto;
        padding: 10px 14px;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }}
      .top-bar-left {{
        width: 100%;
        margin-bottom: 0;
        flex-wrap: wrap;
      }}
      .top-actions {{
        width: 100%;
        justify-content: flex-start;
        display: flex;
        gap: 6px;
      }}
      .top-actions .btn-utility {{
        flex: 1 1 0;
        justify-content: center;
        text-align: center;
        min-height: 34px;
      }}
      .report-header {{
        flex-direction: column;
        align-items: stretch;
        gap: 14px;
      }}
      .report-header-right {{
        align-items: flex-start;
      }}
      .score-card-pill {{
        width: 100%;
        justify-content: flex-start;
      }}
      .report-sky-zone {{
        background-attachment: scroll;
        margin: 0 6px 20px;
        border-radius: 14px;
        padding: 16px 0 32px;
        min-height: auto;
      }}
      .toolbar {{
        padding: 12px;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }}
      .toolbar-left, .toolbar-right {{
        width: 100%;
      }}
      .toolbar-chips {{
        overflow-x: auto;
        flex-wrap: nowrap;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 4px;
      }}
      .toolbar-chips .sev-chip {{
        flex-shrink: 0;
      }}
      .search-utility, .select-utility {{
        font-size: 16px;
      }}
    }}

    @media (max-width: 540px) {{
      .top-actions {{
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }}
      .top-actions .btn-utility.btn-primary {{
        grid-column: 1 / -1;
      }}
      .meta-text {{
        white-space: normal;
        display: block;
        margin-top: 2px;
        width: 100%;
      }}
      .toolbar-right {{
        display: flex;
        flex-direction: column;
        gap: 8px;
      }}
      .search-utility {{
        width: 100%;
      }}
      .select-utility {{
        width: 100%;
      }}
      .report-footer-inner {{
        flex-direction: column;
        align-items: stretch;
        text-align: center;
      }}
      .report-footer-inner > div {{
        justify-content: center;
      }}
    }}
  </style>
</head>
<body>

  <!-- Zone 1: Top Summary Stage -->
  <div class="report-hero-zone">
    <!-- Compact Top Navigation -->
    <header class="top-bar">
      <div class="top-bar-inner">
        <div class="top-bar-left">
          <a href="/" class="brand" title="Plumber Homepage">
            <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V19a1 1 0 0 1-2 0v-2.07A8.005 8.005 0 0 1 4.07 10H6a1 1 0 0 1 0-2H4.07A8.005 8.005 0 0 1 11 3.07V5a1 1 0 0 1 2 0V3.07A8.005 8.005 0 0 1 19.93 10H18a1 1 0 0 1 0 2h1.93A8.005 8.005 0 0 1 13 16.93zM12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5z"/></svg>
            plumber
          </a>
          <span class="brand-sep">/</span>
          <a href="https://github.com/{esc_slug}" target="_blank" rel="noopener" class="repo-link">{esc_slug}</a>
          <span class="meta-text">at {commit_link} &middot; {report.total_files} files &middot; {report.total_lines:,} lines &middot; {report.duration_seconds:.2f}s</span>
        </div>
        <div class="top-actions">
          <button class="btn-utility" type="button" id="copyBadgeBtn" data-badge="[![Plumber grade](https://{{host}}/badge/{esc_slug})](https://{{host}}/r/{esc_slug})">Copy Badge</button>
          <button class="btn-utility" type="button" id="themeToggleBtn">
            <span id="themeBtnText">Dark Mode</span>
          </button>
          <a href="/" class="btn-utility btn-primary">Scan Another Repo</a>
        </div>
      </div>
    </header>

    <div class="container" style="position:relative; z-index:10; padding-top:20px;">
      <!-- Inspection Report Header -->
      <header class="report-header">
        <div class="report-header-left">
          <h1 class="report-title">inspection report</h1>
          <p class="report-desc">Deterministic analysis of code leaks, dead clogs, and AI-generated residue.</p>
        </div>
        <div class="report-header-right">
          <div class="score-card-pill">
            <div class="score-badge-circle" style="background:{badge_bg}; border-color:{badge_color}; color:{badge_color};" aria-hidden="true">
              {report.grade}
            </div>
            <div>
              <div class="metric-score">
                <span class="score-num">{report.score:.1f}</span>
                <span class="score-denom">/ 100</span>
              </div>
              <div class="metric-label">
                HEALTH SCORE &middot; <span class="grade-tag grade-{report.grade}">GRADE {report.grade}</span>
              </div>
            </div>
          </div>
        </div>
      </header>
    </div>
  </div>

  <!-- Zone 2: Atmospheric Sky Zone with Findings -->
  <div class="report-sky-zone">
    <div class="container" style="position:relative; z-index:6;">
      <!-- Filter and Action Toolbar (Frosted Pill Capsule) -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="toolbar-chips" id="sevChips" role="group" aria-label="Severity filters"></div>
          <select class="select-utility" id="catFilter" aria-label="Category filter">
            <option value="">All Categories</option>
          </select>
        </div>
        <div class="toolbar-right">
          <input type="search" class="search-utility" id="searchFilter" placeholder="Filter by path, rule ID, or text..." autocomplete="off">
          <select class="select-utility" id="exportSelect" aria-label="Export format">
            <option value="">Export...</option>
            <option value="md">Markdown (.md)</option>
            <option value="json">JSON (.json)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="pdf">Print / PDF</option>
          </select>
          <button class="btn-utility" id="copyAllBriefBtn" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>Copy Fix Brief for AI Agent
          </button>
        </div>
      </div>

      <!-- Main Report Two-Column Layout -->
      <div class="content-grid">
        <!-- Left sidebar — Files -->
        <aside class="files-sidebar" id="filesSidebar" aria-label="Files with findings">
          <div class="sidebar-head">
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="window-dots-mini">
                <span class="window-dot-mini close"></span>
                <span class="window-dot-mini min"></span>
                <span class="window-dot-mini max"></span>
              </div>
              <span>FILES</span>
            </div>
            <span class="sidebar-total-count" id="filesCountBadge">0</span>
          </div>
          <div class="sidebar-list" id="sidebarList"></div>
        </aside>

        <!-- Main content — Findings -->
        <section class="findings-container" id="findingsList" aria-label="Findings list"></section>
      </div>
    </div>
  </div>

  <!-- Zone 3: Plain Calm Surface (No Dots, No Sky, Solid Background) -->
  <div class="report-plain-zone">
    <div class="container report-footer-inner">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="brand-title" style="font-weight:700;">plumber</span>
        <span class="meta-text">&middot; deterministic code leaks, clogs, and AI slop inspection</span>
      </div>
      <div style="display:flex; gap:16px; align-items:center;">
        <a href="/" class="btn-utility">Home</a>
        <a href="https://github.com/{esc_slug}" target="_blank" rel="noopener" class="btn-utility">GitHub Repo</a>
        <button class="btn-utility" type="button" onclick="window.scrollTo({{top:0, behavior:'smooth'}})">Back to Top &uarr;</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script id="data" type="application/json">{report_json}</script>
  <script>
    (() => {{
      const data = JSON.parse(document.getElementById("data").textContent);
      const SEVS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
      const activeSevs = new Set(SEVS);
      const $ = (id) => document.getElementById(id);

      // Theme Management (Synchronized with landing page)
      const savedTheme = localStorage.getItem("plumber-theme") || "light";
      document.documentElement.setAttribute("data-theme", savedTheme);

      const themeBtn = $("themeToggleBtn");
      const themeBtnText = $("themeBtnText");
      const updateThemeLabel = (t) => {{
        if (themeBtnText) {{
          themeBtnText.textContent = t === "light" ? "Dark Mode" : "Light Mode";
        }}
      }};
      updateThemeLabel(savedTheme);

      if (themeBtn) {{
        themeBtn.addEventListener("click", () => {{
          const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
          const next = cur === "light" ? "dark" : "light";
          document.documentElement.setAttribute("data-theme", next);
          localStorage.setItem("plumber-theme", next);
          updateThemeLabel(next);
        }});
      }}

      // Toast function
      let toastTimer;
      function showToast(msg) {{
        const t = $("toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
      }}

      // Badge copy
      const copyBadgeBtn = $("copyBadgeBtn");
      if (copyBadgeBtn) {{
        copyBadgeBtn.addEventListener("click", (e) => {{
          const snippet = e.currentTarget.dataset.badge.replaceAll("{{host}}", location.host);
          navigator.clipboard.writeText(snippet).then(() => showToast("Badge snippet copied!"));
        }});
      }}

      // Copy entire fix brief
      const copyAllBriefBtn = $("copyAllBriefBtn");
      if (copyAllBriefBtn) {{
        copyAllBriefBtn.addEventListener("click", () => {{
          navigator.clipboard.writeText(data.brief || "").then(() => showToast("AI Agent prompt copied to clipboard!"));
        }});
      }}

      // Render Severity Chips (e.g. HIGH · 3)
      const chipsEl = $("sevChips");
      SEVS.forEach((s) => {{
        const count = data.counts[s] || 0;
        if (count > 0) {{
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "sev-chip active";
          chip.innerHTML = `<span class="dot sev-${{s}}"></span>${{s}} &middot; ${{count}}`;
          chip.onclick = () => {{
            if (activeSevs.has(s)) {{
              activeSevs.delete(s);
              chip.classList.remove("active");
            }} else {{
              activeSevs.add(s);
              chip.classList.add("active");
            }}
            render();
          }};
          chipsEl.appendChild(chip);
        }}
      }});

      // Category filter options
      const catEl = $("catFilter");
      Object.keys(data.categories || {{}}).forEach((cat) => {{
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = `${{cat}} (${{data.categories[cat]}})`;
        catEl.appendChild(opt);
      }});
      catEl.onchange = render;
      $("searchFilter").oninput = render;

      // Filter function
      function filterIssues(issues, path) {{
        const cat = catEl.value;
        const q = $("searchFilter").value.trim().toLowerCase();
        return issues.filter((i) => {{
          if (!activeSevs.has(i.severity)) return false;
          if (cat && i.category !== cat) return false;
          if (q) {{
            const haystack = `${{path}} ${{i.rule_id}} ${{i.title}} ${{i.evidence}} ${{i.fix}}`.toLowerCase();
            if (!haystack.includes(q)) return false;
          }}
          return true;
        }});
      }}

      function render() {{
        const sidebarList = $("sidebarList");
        const countBadge = $("filesCountBadge");
        const list = $("findingsList");

        if (!data.files || data.files.length === 0) {{
          list.innerHTML = `
            <div class="clean-state">
              <div style="width:64px; height:64px; border-radius:50%; background:rgba(6,118,71,0.12); display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px; border:1.5px solid #067647;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#067647" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h3>No Leaks, Clogs, or AI Slop Found</h3>
              <p>This repository adheres to clean code standards and achieved Grade A (0.0 / 100).</p>
            </div>
          `;
          if (sidebarList) sidebarList.innerHTML = "";
          if (countBadge) countBadge.textContent = "0";
          return;
        }}

        if (sidebarList) sidebarList.innerHTML = "";
        list.innerHTML = "";
        let totalVisibleFiles = 0;
        let totalVisibleIssues = 0;

        data.files.forEach((file, idx) => {{
          const matched = filterIssues(file.issues, file.path);
          if (matched.length === 0) return;
          totalVisibleFiles += 1;
          totalVisibleIssues += matched.length;

          // Sidebar item
          const navItem = document.createElement("a");
          navItem.className = `file-item${{idx === 0 ? " active" : ""}}`;
          navItem.href = `#f-${{idx}}`;
          const baseName = file.path.split("/").pop();
          navItem.innerHTML = `<span class="file-name" title="${{escapeHtml(file.path)}}">${{escapeHtml(baseName)}}</span><span class="count-badge">${{matched.length}}</span>`;
          navItem.onclick = (e) => {{
            document.querySelectorAll(".file-item").forEach((el) => el.classList.remove("active"));
            navItem.classList.add("active");
          }};
          if (sidebarList) sidebarList.appendChild(navItem);

          // File Card
          const card = document.createElement("article");
          card.className = "file-card";
          card.id = `f-${{idx}}`;

          const header = document.createElement("div");
          header.className = "file-card-header";
          header.innerHTML = `
            <div class="file-card-title">
              <div class="window-dots-mini">
                <span class="window-dot-mini close"></span>
                <span class="window-dot-mini min"></span>
                <span class="window-dot-mini max"></span>
              </div>
              <span class="file-path" title="${{escapeHtml(file.path)}}">${{escapeHtml(file.path)}}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn-utility" type="button" data-copy-idx="${{idx}}">Copy File Fix</button>
              <span class="window-close-x" aria-hidden="true">&times;</span>
            </div>
          `;
          card.appendChild(header);

          const body = document.createElement("div");
          body.className = "file-card-body";

          matched.forEach((issue) => {{
            const item = document.createElement("div");
            item.className = "issue-item";
            item.innerHTML = `
              <div class="issue-meta-row">
                <span class="line-badge">L${{issue.line}}</span>
                <span class="sev-badge sev-${{issue.severity}}">${{issue.severity}}</span>
                <span class="issue-title">${{escapeHtml(issue.title)}}</span>
                <span class="rule-id">${{escapeHtml(issue.rule_id)}}</span>
              </div>
              ${{issue.evidence ? `<pre class="issue-code"><code>${{escapeHtml(issue.evidence)}}</code></pre>` : ""}}
              ${{issue.fix ? `<div class="issue-fix"><strong>Suggested Fix:</strong> ${{escapeHtml(issue.fix)}}</div>` : ""}}
            `;
            body.appendChild(item);
          }});

          card.appendChild(body);
          list.appendChild(card);
        }});

        if (countBadge) countBadge.textContent = String(totalVisibleFiles);

        if (totalVisibleIssues === 0) {{
          list.innerHTML = `
            <div class="clean-state">
              <h3>No Matching Findings</h3>
              <p>Try adjusting your search query, rule category, or severity filter.</p>
            </div>
          `;
        }}

        // Copy per-file prompt
        list.querySelectorAll("[data-copy-idx]").forEach((btn) => {{
          btn.onclick = () => {{
            const fIdx = btn.dataset.copyIdx;
            const file = data.files[fIdx];
            let prompt = `# Fix issues in ${{file.path}}\\n`;
            file.issues.forEach((i) => {{
              prompt += `- L${{i.line}} [${{i.severity}}] ${{i.title}} (${{i.rule_id}}): ${{i.fix}}\\n`;
            }});
            navigator.clipboard.writeText(prompt).then(() => showToast(`Fix prompt for ${{file.path}} copied!`));
          }};
        }});
      }}

      function escapeHtml(str) {{
        return String(str || "").replace(/[&<>"']/g, (c) => ({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}}[c]));
      }}

      // Export handlers
      $("exportSelect").onchange = (e) => {{
        const fmt = e.target.value;
        e.target.value = "";
        if (!fmt) return;
        if (fmt === "pdf") {{
          window.print();
        }} else {{
          location.href = `?format=${{fmt}}`;
        }}
      }};

      render();
    }})();
  </script>
</body>
</html>"""
