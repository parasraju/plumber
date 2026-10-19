/**
 * Cloudflare Pages Function: /api/report?repo=owner/repo
 */
import { parseRepoSlug, parseTar, runInspection, exportMarkdown } from "../_shared/engine.js";
import { renderHtmlReport } from "../_shared/reportTemplate.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const repoParam = url.searchParams.get("repo") || "";
  const format = (url.searchParams.get("format") || "html").toLowerCase();
  const slugParsed = parseRepoSlug(repoParam);

  if (!slugParsed) {
    return new Response(JSON.stringify({ error: "Invalid repository format. Expected owner/repo." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const [owner, repo] = slugParsed;
  try {
    const tarUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/HEAD`;
    const ghResp = await fetch(tarUrl, { headers: { "User-Agent": "Plumber-Worker/1.0" } });
    if (!ghResp.ok) {
      return new Response(JSON.stringify({ error: `GitHub error ${ghResp.status}` }), {
        status: ghResp.status,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const decompressedStream = ghResp.body.pipeThrough(new DecompressionStream("gzip"));
    const buffer = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
    const files = parseTar(buffer);
    const report = runInspection(files, owner, repo);

    if (format === "json") {
      return new Response(JSON.stringify(report, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (format === "md") {
      return new Response(exportMarkdown(report), {
        headers: { "Content-Type": "text/markdown; charset=utf-8" }
      });
    }

    return new Response(renderHtmlReport(report), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
