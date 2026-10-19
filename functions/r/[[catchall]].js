/**
 * Cloudflare Pages Function: /r/:owner/:repo
 */
import { parseRepoSlug, parseTar, runInspection, exportMarkdown } from "../_shared/engine.js";
import { renderHtmlReport } from "../_shared/reportTemplate.js";

// In-memory cache in worker runtime
const cache = new Map();

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const match = path.match(/^\/r\/([^/?#]+)\/([^/?#]+)/);

  if (!match) {
    return new Response("Invalid repository path. Use /r/:owner/:repo", { status: 400 });
  }

  const [_, rawOwner, rawRepo] = match;
  const slugParsed = parseRepoSlug(`${rawOwner}/${rawRepo}`);
  if (!slugParsed) {
    return new Response("Invalid GitHub repository format.", { status: 400 });
  }

  const [owner, repo] = slugParsed;
  const slug = `${owner}/${repo}`;
  const format = (url.searchParams.get("format") || "html").toLowerCase();

  try {
    let report = cache.get(slug);

    if (!report) {
      // Stream tarball directly from GitHub CDN
      const tarUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/HEAD`;
      const ghResp = await fetch(tarUrl, {
        headers: { "User-Agent": "Plumber-Worker/1.0" }
      });

      if (ghResp.status === 404) {
        const errorHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Repository Not Found — Plumber</title>
<style>body{font-family:sans-serif;background:#F4F3EF;color:#111;padding:40px;display:flex;justify-content:center;align-items:center;min-height:70vh;}
.box{background:#fff;border:1px solid #C9C8C3;border-radius:8px;padding:30px;max-width:480px;box-shadow:0 10px 30px rgba(0,0,0,0.06);}
h2{margin-bottom:10px;}p{color:#666;line-height:1.5;margin-bottom:16px;}
a{color:#111;text-decoration:underline;}
</style></head>
<body><div class="box"><h2>Repository Not Found</h2>
<p>Could not find GitHub repository <strong>${owner}/${repo}</strong>. Ensure it is public and spelled correctly.</p>
<p><a href="/">← Return to Plumber Homepage</a></p></div></body></html>`;

        return new Response(errorHtml, {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Plumber-Error": JSON.stringify({ message: `Repository ${slug} not found on GitHub.` })
          }
        });
      }

      if (!ghResp.ok) {
        return new Response(`GitHub download failed with status ${ghResp.status}`, {
          status: 502,
          headers: {
            "X-Plumber-Error": JSON.stringify({ message: `GitHub returned status ${ghResp.status}` })
          }
        });
      }

      // Decompress gzip stream
      const decompressedStream = ghResp.body.pipeThrough(new DecompressionStream("gzip"));
      const buffer = new Uint8Array(await new Response(decompressedStream).arrayBuffer());

      // Parse and inspect
      const files = parseTar(buffer);
      report = runInspection(files, owner, repo);

      // Keep cache small
      if (cache.size > 200) cache.clear();
      cache.set(slug, report);
    }

    if (format === "json") {
      return new Response(JSON.stringify(report, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=600",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (format === "md") {
      return new Response(exportMarkdown(report), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="plumber-${owner}-${repo}.md"`,
          "Cache-Control": "public, max-age=600"
        }
      });
    }

    const html = renderHtmlReport(report);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=600"
      }
    });

  } catch (err) {
    return new Response(`Inspection error: ${err.message}`, {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
        "X-Plumber-Error": JSON.stringify({ message: err.message })
      }
    });
  }
}
