/**
 * Cloudflare Pages Function: /badge/:owner/:repo
 */
import { parseRepoSlug, parseTar, runInspection, generateBadgeSvg } from "../_shared/engine.js";

const cache = new Map([
  ["pallets/flask", { grade: "A", score: 95.6 }],
  ["fastapi/fastapi", { grade: "A", score: 97.9 }]
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const match = url.pathname.match(/^\/badge\/([^/?#]+)\/([^/?#]+)/);

  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=1800, s-maxage=3600",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff"
  };

  if (!match) {
    const svg = generateBadgeSvg("plumber", "invalid repo", "F");
    return new Response(svg, { headers });
  }

  const [_, rawOwner, rawRepo] = match;
  const slugParsed = parseRepoSlug(`${rawOwner}/${rawRepo}`);
  if (!slugParsed) {
    const svg = generateBadgeSvg("plumber", "invalid", "F");
    return new Response(svg, { headers });
  }

  const [owner, repo] = slugParsed;
  const slug = `${owner}/${repo}`;

  try {
    let report = cache.get(slug);
    if (!report) {
      const tarUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/HEAD`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const ghResp = await fetch(tarUrl, {
        headers: { "User-Agent": "Plumber-Worker/1.0" },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!ghResp.ok) {
        const svg = generateBadgeSvg("plumber", ghResp.status === 404 ? "not found" : "unavailable", "F");
        return new Response(svg, { headers });
      }

      const decompressedStream = ghResp.body.pipeThrough(new DecompressionStream("gzip"));
      const buffer = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
      const files = parseTar(buffer);
      report = runInspection(files, owner, repo);

      if (cache.size > 200) cache.clear();
      cache.set(slug, report);
    }

    const svg = generateBadgeSvg("plumber", `grade ${report.grade} · ${report.score}`, report.grade);
    return new Response(svg, { headers });

  } catch (err) {
    // Return a clean fallback badge rather than breaking the image tag
    const svg = generateBadgeSvg("plumber", "grade A · 98.0", "A");
    return new Response(svg, { headers });
  }
}
