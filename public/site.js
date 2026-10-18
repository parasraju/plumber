/**
 * Plumber Frontend Logic: Navigation, Form, Tabs, Theme, and Badge Generator
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };

  // 1. Theme Management (defaults to light mode warm ivory)
  const savedTheme = store.get("plumber-theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);

  const themeBtn = $("themeToggleBtn");
  const updateThemeLabel = (theme) => {
    if (!themeBtn) return;
    const labelSpan = themeBtn.querySelector("span");
    if (labelSpan) {
      labelSpan.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
    }
  };
  updateThemeLabel(savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      store.set("plumber-theme", next);
      updateThemeLabel(next);
    });
  }

  // 1b. Mobile Navigation Drawer
  const mobileToggle = $("mobileNavToggle");
  const navLinks = $("navLinks");

  if (mobileToggle && navLinks) {
    const setNavState = (open) => {
      navLinks.classList.toggle("mobile-open", open);
      mobileToggle.setAttribute("aria-expanded", String(open));
    };

    mobileToggle.addEventListener("click", () => {
      const isOpen = navLinks.classList.contains("mobile-open");
      setNavState(!isOpen);
    });

    // Close when tapping any link or action inside
    navLinks.addEventListener("click", (e) => {
      if (e.target.closest(".nav-link") || e.target.closest("#themeToggleBtn")) {
        setNavState(false);
      }
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".site-nav") && navLinks.classList.contains("mobile-open")) {
        setNavState(false);
      }
    });

    // Close on Escape
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navLinks.classList.contains("mobile-open")) {
        setNavState(false);
      }
    });
  }

  // 2. Modals (About & Changelog)
  function setupModal(triggerId, modalId, closeIds) {
    const trigger = $(triggerId);
    const modal = $(modalId);
    if (!trigger || !modal) return;

    const openModal = () => modal.classList.add("open");
    const closeModal = () => modal.classList.remove("open");

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal();
      }
    });

    closeIds.forEach((id) => {
      const btn = $(id);
      if (btn) btn.addEventListener("click", closeModal);
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Single global Escape listener for all open dialogs
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open, .retro-modal-backdrop.open").forEach((m) => m.classList.remove("open"));
    }
  });

  setupModal("aboutTrigger", "aboutModal", ["closeAboutBtn", "confirmAboutBtn"]);
  setupModal("changelogTrigger", "changelogModal", ["closeChangelogBtn", "confirmChangelogBtn"]);

  // 3. Toast Notifications
  let toastTimer;
  function showToast(message) {
    const t = $("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // 4. Copy Buttons on All Code Snippets
  document.querySelectorAll(".code-block").forEach((block) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-utility copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code snippet to clipboard");
    btn.addEventListener("click", async () => {
      const text = block.querySelector("pre")?.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard");
      } catch {
        showToast("Select text manually to copy");
      }
    });
    block.appendChild(btn);
  });

  // 5. Tab Navigation (WAI-ARIA accessible pattern)
  document.querySelectorAll("[data-tabs]").forEach((container) => {
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const selectTab = (tab) => {
      tabs.forEach((t) => {
        const isSelected = t === tab;
        t.setAttribute("aria-selected", String(isSelected));
        t.tabIndex = isSelected ? 0 : -1;
        const panelId = t.getAttribute("aria-controls");
        const panel = $(panelId);
        if (panel) panel.hidden = !isSelected;
      });
      tab.focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          selectTab(tabs[(index + 1) % tabs.length]);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          selectTab(tabs[(index - 1 + tabs.length) % tabs.length]);
        }
      });
    });
  });

  // 6. GitHub Repository Parser
  const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

  function parseRepo(text) {
    const clean = text.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
    let [owner = "", repo = ""] = clean.split(/[/#?]/);
    repo = repo.replace(/\.git$/i, "");
    if (OWNER_RE.test(owner) && REPO_RE.test(repo) && repo !== "." && repo !== "..") {
      return `${owner}/${repo}`;
    }
    return null;
  }

  // 7. Dynamic Badge Snippet Generator
  function updateBadgeSnippet(slug) {
    const origin = location.origin;
    const preview = $("badgePreview");
    const code = $("badgeCode");
    const label = $("badgeRepoLabel");

    if (preview) {
      preview.src = `/badge/${slug}`;
      preview.alt = `Plumber grade for ${slug}`;
    }
    if (label) label.textContent = slug;
    if (code) {
      code.textContent = `[![Plumber grade](${origin}/badge/${slug})](${origin}/r/${slug})`;
    }
  }

  const lastScanned = store.get("plumber-last-repo") || "pallets/flask";
  updateBadgeSnippet(lastScanned);

  // 8. Scan Form Handler
  const form = $("scanForm");
  const input = $("repoInput");
  const statusArea = $("statusArea");
  const scanBtn = $("scanBtn");
  let isScanning = false;

  async function triggerScan(slug) {
    if (isScanning) return;
    isScanning = true;
    if (scanBtn) scanBtn.disabled = true;

    const started = Date.now();
    statusArea.innerHTML = `
      <div class="status-pill retro-status-pill">
        <picture class="media-frame">
          <source type="image/webp" srcset="/gifs/popcat.webp">
          <img src="/gifs/popcat.gif" class="ticker-gif" alt="Inspecting code" width="24" height="24" decoding="async">
        </picture>
        <span class="spinner retro-spinner" aria-hidden="true"></span>
        <span id="scanTimerLabel">Connecting to GitHub CDN... 0s</span>
      </div>
    `;

    const timerLabel = $("scanTimerLabel");
    const interval = setInterval(() => {
      const secs = Math.round((Date.now() - started) / 1000);
      const stage = secs < 3 ? "Streaming repository tarball..." : secs < 6 ? "Sandboxed extraction..." : "Inspecting code leaks & slop...";
      if (timerLabel) {
        timerLabel.textContent = `${stage} (${slug}) ${secs}s`;
      }
    }, 1000);

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 65000);

    try {
      const response = await fetch(`/r/${slug}`, { signal: controller.signal });
      if (!response.ok) {
        let errData = {};
        try { errData = JSON.parse(response.headers.get("X-Plumber-Error") || "{}"); } catch {}
        throw new Error(errData.message || `Scan failed with HTTP ${response.status}`);
      }

      store.set("plumber-last-repo", slug);
      // Route to the cached report
      location.href = `/r/${slug}`;
    } catch (err) {
      clearInterval(interval);
      clearTimeout(abortTimeout);
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;

      const msg = err.name === "AbortError" ? "Scan timed out (over 65s)." : err.message;
      statusArea.innerHTML = `
        <div class="error-pill retro-error-pill">
          <b>Unable to complete scan:</b> ${msg}<br>
          <span style="font-size:11px;opacity:0.85">Very large repositories can be scanned locally with the Plumber CLI.</span>
        </div>
      `;
    }
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const slug = parseRepo(input.value);
      if (!slug) {
        statusArea.innerHTML = `
          <div class="error-pill retro-error-pill">
            <b>Invalid repository format:</b> Please enter 'owner/repo' or paste a GitHub URL.
          </div>
        `;
        input.focus();
        return;
      }
      triggerScan(slug);
    });
  }

  // 9. Sample Repository Chips Click Handler (populates repository input)
  document.querySelectorAll("[data-sample]").forEach((pill) => {
    pill.addEventListener("click", () => {
      const slug = pill.dataset.sample;
      if (input) {
        input.value = slug;
        input.focus();
      }
      if (statusArea) statusArea.innerHTML = "";
    });
  });
})();
