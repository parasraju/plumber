/**
 * Plumber Inspection Engine for Cloudflare Pages Functions
 * Pure JavaScript, zero external dependencies.
 */

export const RULES = [
  { id: "leak/api-key", cat: "Leaks & Secrets", sev: "CRITICAL", title: "Leaked API Key or Private Access Token", fix: "Extract secret to an environment variable immediately." },
  { id: "leak/committed-env", cat: "Leaks & Secrets", sev: "CRITICAL", title: "Production Secret Committed in Environment File", fix: "Remove sensitive values and use .env.example." },
  { id: "leak/hardcoded-secret", cat: "Leaks & Secrets", sev: "HIGH", title: "Hardcoded Password or Database Credential", fix: "Replace with process.env / os.environ reference." },
  { id: "sec/raw-html", cat: "Leaks & Secrets", sev: "MEDIUM", title: "Raw HTML Injection (XSS Risk)", fix: "Use textContent or safe DOM templating." },
  { id: "clog/elided-code", cat: "Clogs & Dead Code", sev: "HIGH", title: "AI-Elided Code Snippet Left in File", fix: "Restore the complete code implementation." },
  { id: "clog/swallowed-error", cat: "Clogs & Dead Code", sev: "HIGH", title: "Swallowed Exception (Silent Failure)", fix: "Log the error or properly re-raise/handle it." },
  { id: "clog/stub-function", cat: "Clogs & Dead Code", sev: "MEDIUM", title: "Unimplemented Stub Function", fix: "Complete missing logic or remove placeholder." },
  { id: "clog/step-comments", cat: "Clogs & Dead Code", sev: "LOW", title: "Robotic AI Step Comments Left Behind", fix: "Clean up AI instructional comments." },
  { id: "clog/dead-code", cat: "Clogs & Dead Code", sev: "HIGH", title: "Unreachable Dead Code", fix: "Delete unreachable lines or run plumber clean --write." },
  { id: "slop/pointless-wrapper", cat: "Clogs & Dead Code", sev: "LOW", title: "Function That Only Forwards Arguments", fix: "Call underlying function directly." },
  { id: "joint/icon-button", cat: "Joints & Accessibility", sev: "HIGH", title: "Icon Button Without Accessible Name", fix: "Add aria-label attribute to button element." },
  { id: "joint/clickable-div", cat: "Joints & Accessibility", sev: "HIGH", title: "Non-Semantic Clickable Element", fix: "Use native <button type='button'> instead." },
  { id: "joint/empty-test", cat: "Joints & Accessibility", sev: "HIGH", title: "Empty Test with No Assertions", fix: "Add assert statements or verification logic." },
  { id: "joint/focus-removed", cat: "Joints & Accessibility", sev: "MEDIUM", title: "Focus Outline Removed Without Replacement", fix: "Provide a visible :focus-visible style." },
  { id: "pipe/phantom-import", cat: "Pipes & Dependencies", sev: "HIGH", title: "Plausible but Hallucinated Package Import", fix: "Check package registry or use official package." },
  { id: "pipe/dead-link", cat: "Pipes & Dependencies", sev: "MEDIUM", title: "Broken or Null Link in Navigation", fix: "Use a <button> for actions or valid route for href." },
  { id: "slop/ai-gradient", cat: "AI Slop Tells", sev: "MEDIUM", title: "Purple / Violet AI Default Gradient", fix: "Use clean brand tokens or neutral surface." },
  { id: "slop/chatbot-residue", cat: "AI Slop Tells", sev: "MEDIUM", title: "Pasted Chatbot Conversational Residue", fix: "Delete conversational intro/outro boilerplate." },
  { id: "slop/neon-glow", cat: "AI Slop Tells", sev: "LOW", title: "Colored Neon Glow Shadow", fix: "Replace with subtle crisp 1px borders." },
  { id: "slop/gradient-text", cat: "AI Slop Tells", sev: "LOW", title: "Gradient-Clipped Headline Text", fix: "Use solid, high-contrast typography." },
  { id: "ui/important-abuse", cat: "AI Slop Tells", sev: "LOW", title: "!important Overrides in Stylesheet", fix: "Structure CSS cascade cleanly without !important." },
  { id: "pipe/docker-unpinned", cat: "Pipes & Dependencies", sev: "MEDIUM", title: "Unpinned Docker Image (Missing Tag or :latest)", fix: "Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine)." },
  { id: "sec/curl-pipe-shell", cat: "Leaks & Secrets", sev: "CRITICAL", title: "Remote Script Piped Directly to Shell (curl | bash)", fix: "Download script first, verify its SHA256 checksum or signature, then execute it." },
  { id: "sec/permissions-write-all", cat: "Leaks & Secrets", sev: "HIGH", title: "Overly Broad Workflow Write Permissions", fix: "Use least-privilege permissions (e.g., permissions: { contents: read })." },
  { id: "leak/slack-webhook", cat: "Leaks & Secrets", sev: "CRITICAL", title: "Hardcoded Slack or Tokenized Webhook URL", fix: "Move webhook URL to CI/CD encrypted secrets (e.g., ${{ secrets.SLACK_WEBHOOK_URL }})." },
  { id: "pipe/npm-unpinned", cat: "Pipes & Dependencies", sev: "MEDIUM", title: "Unpinned npm Install in CI Without Lockfile Enforcement", fix: "Use npm ci to enforce lockfile versions or pass --save-exact when adding packages." }
];

export const GRADE_COLORS = {
  "A": "#067647",
  "B": "#4d7c0f",
  "C": "#a15c07",
  "D": "#c4320a",
  "F": "#b42318"
};

const SEVERITY_WEIGHTS = {
  "CRITICAL": 10.0,
  "HIGH": 5.0,
  "MEDIUM": 2.0,
  "LOW": 0.75,
  "INFO": 0.1
};

export function parseRepoSlug(text) {
  const clean = (text || "").trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  let [owner = "", repo = ""] = clean.split(/[/#?]/);
  repo = repo.replace(/\.git$/i, "");
  const ownerRe = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const repoRe = /^[A-Za-z0-9._-]{1,100}$/;
  if (ownerRe.test(owner) && repoRe.test(repo) && repo !== "." && repo !== "..") {
    return [owner, repo];
  }
  return null;
}

export function parseTar(buffer) {
  const files = [];
  let offset = 0;
  const dec = new TextDecoder();
  const maxFiles = 300;
  const scannableExts = new Set([".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".env", ".yml", ".yaml", ".sh"]);
  const skipParts = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "venv", "__pycache__"]);

  while (offset + 512 <= buffer.length && files.length < maxFiles) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header[0] === 0) {
      let allZero = true;
      for (let i = 0; i < 512; i++) {
        if (header[i] !== 0) { allZero = false; break; }
      }
      if (allZero) break;
    }

    let name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, "").trim();
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/, "").trim();
    if (prefix) name = prefix + "/" + name;

    const sizeStr = dec.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);

    if ((typeFlag === "0" || typeFlag === "\0" || typeFlag === "") && size > 0 && size < 1024 * 1024) {
      const slashIdx = name.indexOf("/");
      const relPath = slashIdx !== -1 ? name.slice(slashIdx + 1) : name;
      const parts = relPath.split("/");
      const hasSkip = parts.some(p => skipParts.has(p));
      const ext = ("." + (relPath.split(".").pop() || "")).toLowerCase();
      const baseName = parts[parts.length - 1];

      const isDockerfile = baseName === "Dockerfile" || baseName.startsWith("Dockerfile.");
      const isGitlabCi = baseName === ".gitlab-ci.yml" || baseName === ".gitlab-ci.yaml";
      if (!hasSkip && (scannableExts.has(ext) || baseName.startsWith(".env") || isDockerfile || isGitlabCi)) {
        const contentBuf = buffer.subarray(offset, offset + size);
        try {
          const content = dec.decode(contentBuf);
          files.push({ path: relPath, content, size });
        } catch (err) {
          console.warn("[Plumber] Failed to decode " + relPath + ":", err);
        }
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

export function inspectFile(relPath, content) {
  const issues = [];
  const lines = content.split("\n");
  const ext = ("." + (relPath.split(".").pop() || "")).toLowerCase();
  const lower = content.toLowerCase();
  const isTest = relPath.toLowerCase().includes("test") || relPath.toLowerCase().includes("spec");

  // 1. Clog: Elided code
  const elidedRe = /(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:existing\s+code|rest\s+of\s+code|remaining\s+code|code\s+remains|code\s+unchanged)/i;
  if (elidedRe.test(content)) {
    lines.forEach((l, idx) => {
      if (elidedRe.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Clogs & Dead Code",
          rule_id: "clog/elided-code",
          title: "AI-Elided Code Snippet Left in File",
          evidence: l.trim().slice(0, 100),
          fix: "Restore the complete code implementation."
        });
      }
    });
  }

  // 2. Clog: Swallowed exceptions (bare except: pass or except Exception: pass only)
  if (lower.includes("except") || lower.includes("catch")) {
    lines.forEach((l, idx) => {
      const clean = l.trim();
      if (clean.startsWith("#") || clean.startsWith("//") || clean.startsWith("/*")) return;
      const nextClean = (lines[idx + 1] || "").trim();
      const isPySwallowed = /except(?:\s+(?:\(\s*)?(?:Exception|BaseException)(?:\s*\))?)?\s*:\s*(?:pass|\.\.\.)/.test(clean) ||
        (/^except(?:\s+(?:\(\s*)?(?:Exception|BaseException)(?:\s*\))?)?\s*:$/.test(clean) && (nextClean === "pass" || nextClean === "..."));
      if (isPySwallowed) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Clogs & Dead Code",
          rule_id: "clog/swallowed-error",
          title: "Swallowed Exception (Silent Failure)",
          evidence: clean + (nextClean ? " " + nextClean : ""),
          fix: "Log the error or properly re-raise/handle it."
        });
      } else if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(clean)) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Clogs & Dead Code",
          rule_id: "clog/swallowed-error",
          title: "Swallowed Exception (Silent Failure)",
          evidence: clean,
          fix: "Log error to console or error reporter."
        });
      }
    });
  }

  // 3. Leaks: API Keys
  if (!isTest && (content.includes("sk-") || content.includes("ghp_") || content.includes("AKIA") || lower.includes("secret") || lower.includes("api_key"))) {
    lines.forEach((l, idx) => {
      const lLower = l.toLowerCase();
      if (["example", "dummy", "placeholder", "fake", "redact", "mask", "assert", "<key>"].some(w => lLower.includes(w))) return;
      // Skip OpenSSH security key types and certificate identifiers
      if (lLower.includes("@openssh") || lLower.includes("sk-ssh-") || lLower.includes("sk-ecdsa-")) return;

      const mOpenAI = l.match(/\b(sk-(?:live|test|proj|admin)?[a-zA-Z0-9_-]{20,})\b/);
      if (mOpenAI && !mOpenAI[1].includes("ssh") && !mOpenAI[1].includes("ecdsa")) {
        issues.push({
          line: idx + 1,
          severity: "CRITICAL",
          category: "Leaks & Secrets",
          rule_id: "leak/api-key",
          title: "Leaked OpenAI / Model API Key",
          evidence: l.trim().slice(0, 75),
          fix: "Extract secret to .env file immediately and revoke token."
        });
      }
      const mGh = l.match(/\b(ghp_[a-zA-Z0-9]{36})\b/);
      if (mGh) {
        issues.push({
          line: idx + 1,
          severity: "CRITICAL",
          category: "Leaks & Secrets",
          rule_id: "leak/api-key",
          title: "Leaked GitHub Personal Access Token",
          evidence: l.trim().slice(0, 75),
          fix: "Revoke token and store in repository secrets."
        });
      }
      const mAws = l.match(/\b((?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16})\b/);
      if (mAws) {
        issues.push({
          line: idx + 1,
          severity: "CRITICAL",
          category: "Leaks & Secrets",
          rule_id: "leak/api-key",
          title: "Leaked AWS Access Key ID",
          evidence: l.trim().slice(0, 75),
          fix: "Store in AWS Secrets Manager or IAM role."
        });
      }
    });
  }

  // 4. Committed .env with secrets
  if (relPath.endsWith(".env") && !relPath.includes(".example") && !relPath.includes(".template")) {
    lines.forEach((l, idx) => {
      const clean = l.trim();
      if (clean && !clean.startsWith("#") && clean.includes("=")) {
        const [k, v] = clean.split("=", 2);
        if (v && v.trim().length > 4 && !["true", "false", "development", "test", "production", "localhost", "none", '""', "''"].includes(v.toLowerCase())) {
          issues.push({
            line: idx + 1,
            severity: "CRITICAL",
            category: "Leaks & Secrets",
            rule_id: "leak/committed-env",
            title: "Production Secret Committed in Environment File",
            evidence: `${k.trim()}=*****`,
            fix: "Move .env to .gitignore and provide .env.example with empty values."
          });
        }
      }
    });
  }

  // 5. Raw HTML / XSS Risk
  if (lower.includes("innerhtml") || lower.includes("dangerouslysetinnerhtml") || lower.includes("document.write")) {
    lines.forEach((l, idx) => {
      if (/\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\(/.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "MEDIUM",
          category: "Leaks & Secrets",
          rule_id: "sec/raw-html",
          title: "Raw HTML Injection (XSS Risk)",
          evidence: l.trim().slice(0, 85),
          fix: "Use textContent or safe DOM templating."
        });
      }
    });
  }

  // 6. Joint: Clickable div without button/role
  if ((ext === ".html" || ext === ".jsx" || ext === ".tsx") && lower.includes("<div") && lower.includes("onclick")) {
    lines.forEach((l, idx) => {
      if (/<(?:div|span)\b(?![^>]*role=)[^>]*(?:onClick|onclick)=/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Joints & Accessibility",
          rule_id: "joint/clickable-div",
          title: "Non-Semantic Clickable Element",
          evidence: l.trim().slice(0, 85),
          fix: "Use native <button type='button'> instead."
        });
      }
    });
  }

  // 7. Joint: Icon button without aria-label
  if ((ext === ".html" || ext === ".jsx" || ext === ".tsx") && lower.includes("<button")) {
    lines.forEach((l, idx) => {
      if (/<button(?![^>]*aria-label)[^>]*>\s*(?:<svg[^>]*>.*?<\/svg>|<i\b[^>]*>\s*<\/i>)\s*<\/button>/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Joints & Accessibility",
          rule_id: "joint/icon-button",
          title: "Icon Button Without Accessible Name",
          evidence: l.trim().slice(0, 85),
          fix: "Add aria-label attribute to button element."
        });
      }
    });
  }

  // 8. Slop: AI default purple gradient
  if ((ext === ".html" || ext === ".jsx" || ext === ".tsx" || ext === ".css") && (lower.includes("purple") || lower.includes("violet") || lower.includes("#667eea"))) {
    lines.forEach((l, idx) => {
      if (/\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b/.test(l) || /linear-gradient\([^)]*(?:#667eea|#764ba2|purple|violet)/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "MEDIUM",
          category: "AI Slop Tells",
          rule_id: "slop/ai-gradient",
          title: "Generic Purple / Violet AI Default Gradient",
          evidence: l.trim().slice(0, 85),
          fix: "Use clean brand tokens or neutral surface."
        });
      }
    });
  }

  // 9. Slop: Chatbot conversational residue
  if (lower.includes("certainly") || lower.includes("here is the") || lower.includes("hope this helps") || lower.includes("language model")) {
    lines.forEach((l, idx) => {
      if (/(?:as\s+an\s+ai\s+language\s+model|here\s+is\s+the\s+(?:updated|complete|fixed)\s+code|certainly!\s+here\s+is|hope\s+this\s+helps!)/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "MEDIUM",
          category: "AI Slop Tells",
          rule_id: "slop/chatbot-residue",
          title: "Pasted Chatbot Conversational Residue",
          evidence: l.trim().slice(0, 85),
          fix: "Delete conversational intro/outro boilerplate."
        });
      }
    });
  }

  // 10. Pipe: Dead links
  if ((ext === ".html" || ext === ".jsx" || ext === ".tsx") && lower.includes('href="#"')) {
    lines.forEach((l, idx) => {
      if (/<a\s+[^>]*href=["'](?:#|javascript:void\(0\);?)["']/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "MEDIUM",
          category: "Pipes & Dependencies",
          rule_id: "pipe/dead-link",
          title: "Broken or Null Link in Navigation",
          evidence: l.trim().slice(0, 85),
          fix: "Use a <button> for actions or valid route for href."
        });
      }
    });
  }

  // 11. Clog: Unreachable dead code
  for (const dead of findDeadCode(content, ext)) {
    issues.push({
      line: dead.line,
      severity: "HIGH",
      category: "Clogs & Dead Code",
      rule_id: "clog/dead-code",
      title: "Unreachable Dead Code",
      evidence: dead.evidence.slice(0, 100),
      fix: dead.removable ? "Delete this unreachable line." : "Remove the constant-false branch and its body."
    });
  }

  const base = relPath.split("/").pop() || "";
  const isYaml = ext === ".yml" || ext === ".yaml";
  const isDockerfile = base === "Dockerfile" || base.startsWith("Dockerfile.");
  const isShell = ext === ".sh";

  // 12. Docker unpinned (pipe/docker-unpinned)
  if (isYaml || isDockerfile) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith("#")) return;
      let img = null;
      if (isDockerfile) {
        const m = /^FROM\s+(?:--platform=\S+\s+)?([^\s#]+)/i.exec(trim);
        if (m && m[1].toLowerCase() !== "scratch" && !m[1].startsWith("$")) img = m[1];
      } else if (isYaml) {
        const m = /^image:\s*['"]?([^\s'"#]+)['"]?/i.exec(trim);
        if (m && !m[1].startsWith("$")) img = m[1];
        const dm = /\bdocker:\/\/([^\s'"#]+)/i.exec(trim);
        if (dm && !dm[1].startsWith("$")) img = dm[1];
      }
      if (img) {
        const hasDigest = img.includes("@sha256:");
        const lastSlash = img.lastIndexOf("/");
        const tagPart = img.slice(lastSlash + 1);
        const colonIdx = tagPart.indexOf(":");
        const tag = colonIdx !== -1 ? tagPart.slice(colonIdx + 1) : "";
        if (!hasDigest && (colonIdx === -1 || tag.toLowerCase() === "latest")) {
          issues.push({
            line: idx + 1,
            severity: "MEDIUM",
            category: "Pipes & Dependencies",
            rule_id: "pipe/docker-unpinned",
            title: "Unpinned Docker Image (Missing Tag or :latest)",
            evidence: trim.slice(0, 90),
            fix: "Pin image to an explicit version tag or SHA256 digest (e.g., node:20.11-alpine)."
          });
        }
      }
    });
  }

  // 13. curl piped to shell (sec/curl-pipe-shell)
  if (!isTest && (isYaml || isDockerfile || isShell)) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith("#") || trim.startsWith("//")) return;
      if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "CRITICAL",
          category: "Leaks & Secrets",
          rule_id: "sec/curl-pipe-shell",
          title: "Remote Script Piped Directly to Shell (curl | bash)",
          evidence: trim.slice(0, 90),
          fix: "Download script first, verify its SHA256 checksum or signature, then execute it."
        });
      }
    });
  }

  // 14. Permissions write-all (sec/permissions-write-all)
  if (isYaml) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith("#")) return;
      if (/^permissions:\s*['"]?write-all['"]?\s*(?:#.*)?$/i.test(trim) || /^contents:\s*['"]?write['"]?\s*(?:#.*)?$/i.test(trim)) {
        issues.push({
          line: idx + 1,
          severity: "HIGH",
          category: "Leaks & Secrets",
          rule_id: "sec/permissions-write-all",
          title: "Overly Broad Workflow Write Permissions",
          evidence: trim.slice(0, 90),
          fix: "Use least-privilege permissions (e.g., permissions: { contents: read })."
        });
      }
    });
  }

  // 15. Slack webhook secret (leak/slack-webhook)
  if (!isTest && (content.includes("hooks.slack.com/") || content.includes("discord.com/api/webhooks/") || content.includes("discordapp.com/api/webhooks/"))) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith("#") || trim.startsWith("//")) return;
      if (/https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/.test(l) ||
          /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "CRITICAL",
          category: "Leaks & Secrets",
          rule_id: "leak/slack-webhook",
          title: "Hardcoded Slack or Tokenized Webhook URL",
          evidence: trim.slice(0, 90),
          fix: "Move webhook URL to CI/CD encrypted secrets (e.g., ${{ secrets.SLACK_WEBHOOK_URL }})."
        });
      }
    });
  }

  // 16. npm install without --save-exact (pipe/npm-unpinned)
  if (isYaml || isDockerfile || isShell) {
    lines.forEach((l, idx) => {
      const trim = l.trim();
      if (!trim || trim.startsWith("#")) return;
      if (/\bnpm\s+(?:install|i)\b/.test(l) && !/--save-exact\b|\s-E\b|--package-lock-only\b/.test(l)) {
        issues.push({
          line: idx + 1,
          severity: "MEDIUM",
          category: "Pipes & Dependencies",
          rule_id: "pipe/npm-unpinned",
          title: "Unpinned npm Install in CI Without Lockfile Enforcement",
          evidence: trim.slice(0, 90),
          fix: "Use npm ci to enforce lockfile versions or pass --save-exact when adding packages."
        });
      }
    });
  }

  return issues;
}

function findDeadCode(content, ext) {
  if (![".py", ".js", ".jsx", ".ts", ".tsx"].includes(ext)) return [];
  const lines = content.split("\n");
  const skip = new Set();
  markMultilineStrings(lines, skip, ext === ".py" ? ['"""', "'''"] : ["`"]);

  const found = [];
  const indentOf = (line) => line.length - line.replace(/^[ \t]+/, "").length;
  const termRe = ext === ".py" ? /^(return|raise|break|continue)\b/ : /^(return|throw|break|continue)\b/;
  const unsafeTail = ["\\", "(", "[", "{", ",", ":", "+", "-", "*", "/", "%", "&", "|", "=", "?", ">"];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const clean = line.trim();
    if (skip.has(idx) || !clean || clean.startsWith("#") || clean.startsWith("//") || clean.startsWith("/*") || clean.startsWith("*")) continue;

    const isPy = ext === ".py";
    const deadBranch = isPy ? /^(?:if|while)\s+(?:False|0)\s*:/.test(clean) : /^(?:if|while)\s*\(\s*(?:false|0)\s*\)/.test(clean);
    if (deadBranch) {
      found.push({ line: idx + 1, reason: "Dead branch: condition is always false", evidence: clean, removable: false });
      continue;
    }

    const terminator = termRe.exec(clean);
    if (!terminator || unsafeTail.some((t) => clean.endsWith(t))) continue;

    const target = findUnreachable(lines, idx, indentOf(line), skip, isPy);
    if (target !== null) {
      found.push({ line: target + 1, reason: `Unreachable statement after '${terminator[1]}'`, evidence: lines[target].trim(), removable: true });
    }
  }
  return found;
}

function markMultilineStrings(lines, skip, quotes) {
  let inside = null;
  for (let idx = 0; idx < lines.length; idx++) {
    if (inside !== null) skip.add(idx);
    for (const quote of quotes) {
      const count = lines[idx].split(quote).length - 1;
      if (count === 0) continue;
      if (inside === quote) {
        if (count % 2 === 1) inside = null;
      } else if (inside === null && count % 2 === 1) {
        inside = quote;
      }
    }
  }
}

function findUnreachable(lines, start, indent, skip, isPy) {
  const closers = ["else:", "elif ", "except", "finally:", "case ", "default:"];
  for (let j = start + 1; j < lines.length; j++) {
    const raw = lines[j];
    const clean = raw.trim();
    if (skip.has(j) || !clean || clean.startsWith("#") || clean.startsWith("//") || clean.startsWith("/*") || clean.startsWith("*")) continue;
    if ((raw.length - raw.replace(/^[ \t]+/, "").length) < indent) return null;
    if (isPy ? closers.some((p) => clean.startsWith(p)) : /^(?:\}|else\b|catch\b|finally\b|case\b|default\b)/.test(clean)) return null;
    if (/^[\)\]\}\.,:?+\-*\/%&|]/.test(clean)) continue;
    return j;
  }
  return null;
}

export function runInspection(files, owner, repo) {
  const started = Date.now();
  const fileReports = [];
  const allIssues = [];
  let totalLines = 0;

  for (const f of files) {
    const issues = inspectFile(f.path, f.content);
    const lineCount = f.content.split("\n").length;
    totalLines += lineCount;
    if (issues.length > 0) {
      fileReports.push({ path: f.path, line_count: lineCount, issues });
      allIssues.push(...issues);
    }
  }

  const durationSeconds = Math.round((Date.now() - started) / 10) / 100;
  const score = calculateScore(allIssues, totalLines);
  const grade = calculateGrade(score, allIssues);
  const counts = { "CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0 };
  const categories = {
    "Leaks & Secrets": 0,
    "Clogs & Dead Code": 0,
    "Joints & Accessibility": 0,
    "Pipes & Dependencies": 0,
    "AI Slop Tells": 0
  };

  for (const i of allIssues) {
    if (counts[i.severity] !== undefined) counts[i.severity]++;
    if (categories[i.category] !== undefined) categories[i.category]++;
  }

  const slug = `${owner}/${repo}`;
  const brief = generateAgentBrief(slug, score, grade, fileReports);

  return {
    owner,
    repo_name: repo,
    commit: "HEAD",
    grade,
    score,
    total_files: files.length,
    total_lines: totalLines,
    duration_seconds: durationSeconds,
    counts,
    categories,
    issues: allIssues,
    file_reports: fileReports,
    files: fileReports,
    brief
  };
}

export function calculateScore(issues, totalLines) {
  if (!issues || issues.length === 0) return 100.0;
  const weight = issues.reduce((acc, i) => acc + (SEVERITY_WEIGHTS[i.severity] || 1.0), 0);
  const density = ((weight / Math.max(totalLines, 200)) * 1000.0) * 0.8463;
  const penalty = 100.0 * (1.0 - Math.exp(-density / 40.0));
  const healthScore = Math.max(0, 100.0 - penalty);
  return Math.round(healthScore * 10) / 10;
}

export function calculateGrade(score, issues = []) {
  let grade;
  if (score >= 90.0) grade = "A";
  else if (score >= 75.0) grade = "B";
  else if (score >= 55.0) grade = "C";
  else if (score >= 35.0) grade = "D";
  else grade = "F";

  // Critical leak override: if active critical leaks exist, grade cannot exceed C
  if (issues && issues.some(i => i.severity === "CRITICAL")) {
    if (grade === "A" || grade === "B") grade = "C";
  }
  return grade;
}

export function generateAgentBrief(slug, score, grade, fileReports) {
  if (!fileReports || fileReports.length === 0) {
    return `# Plumber Inspection Brief for ${slug}\n\nNo leaks, clogs, or slop found! Repository scored 100.0/100 (Grade A).\n`;
  }
  const lines = [
    `# Plumber Inspection Brief: ${slug}`,
    `**Health Score:** ${score.toFixed(1)}/100 | **Grade:** ${grade} | **Files with Issues:** ${fileReports.length}`,
    "",
    "## Agent Instructions",
    "Please fix the following detected code leaks, clogs, dead code, and AI slop tells. Follow each specific fix instruction carefully while preserving functional behavior.",
    ""
  ];
  for (const f of fileReports) {
    lines.push(`### \`${f.path}\` (${f.issues.length} issues)`);
    for (const i of f.issues) {
      lines.push(`- **L${i.line} [${i.severity}] ${i.title}** (\`${i.rule_id}\`)`);
      if (i.evidence) lines.push(`  - **Found:** \`${i.evidence.slice(0, 120)}\``);
      if (i.fix) lines.push(`  - **Fix:** ${i.fix}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function generateBadgeSvg(label, value, grade) {
  const color = GRADE_COLORS[grade] || "#6b7280";
  const leftW = Math.round(label.length * 6.8 + 14);
  const rightW = Math.round(value.length * 6.8 + 14);
  const totalW = leftW + rightW;
  const escLabel = label.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const escVal = value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" viewBox="0 0 ${totalW} 20" role="img" aria-label="${escLabel}: ${escVal}">
  <title>${escLabel}: ${escVal}</title>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="20" fill="#18181b"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="${color}"/>
  </g>
  <g fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="500" font-size="11">
    <text x="${leftW / 2}" y="14">${escLabel}</text>
    <text x="${leftW + rightW / 2}" y="14">${escVal}</text>
  </g>
</svg>`;
}

export function exportMarkdown(report) {
  const slug = report.owner ? `${report.owner}/${report.repo_name}` : report.repo_name;
  const lines = [
    `# Plumber Health Report: ${slug}`,
    `**Grade: ${report.grade}** | **Score: ${report.score.toFixed(1)}/100** | **Issues Found: ${report.issues.length}**`,
    `*Scanned ${report.total_files} files (${report.total_lines.toLocaleString()} lines) in ${report.duration_seconds.toFixed(2)}s*`,
    "",
    "## Severity Breakdown",
    `- Critical: ${report.counts.CRITICAL || 0}`,
    `- High: ${report.counts.HIGH || 0}`,
    `- Medium: ${report.counts.MEDIUM || 0}`,
    `- Low: ${report.counts.LOW || 0}`,
    `- Info: ${report.counts.INFO || 0}`,
    "",
    "## Detailed Findings"
  ];
  for (const f of report.file_reports || []) {
    lines.push(`### \`${f.path}\` (${f.issues.length} issues)`);
    for (const i of f.issues) {
      lines.push(`- **L${i.line}** \`[${i.severity}]\` ${i.title} (\`${i.rule_id}\`)`);
      if (i.evidence) lines.push(`  - \`${i.evidence.slice(0, 100)}\``);
      if (i.fix) lines.push(`  - Fix: ${i.fix}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
