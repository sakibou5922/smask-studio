// Serves the decrypted site (stored in Cache Storage by the lock page) under <scope>/app/.
// On every page load it checks version.json; if a newer version was published, the old copy is dropped
// and the visitor is sent back to the password screen to open the new one.
const PREFIX = "smask-site-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname + "app/")) return;
  e.respondWith(serve(url, e.request, scope));
});

async function latestVersion(scope) {
  try {
    const r = await fetch(new URL("version.json", scope), { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()).id || null;
  } catch {
    return null; // offline: keep using what this device has
  }
}

// Videos ask for byte ranges (Safari will not play without them), so answer those with 206 slices.
async function withRange(res, req) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (!range) return res;
  const blob = await res.blob();
  const size = blob.size;
  let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
  let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response("", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

async function serve(url, req, scope) {
  let names = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
  if (req.mode === "navigate") {
    const latest = await latestVersion(scope);
    if (latest) {
      const stale = names.filter((k) => k !== PREFIX + latest);
      await Promise.all(stale.map((k) => caches.delete(k)));
      names = names.filter((k) => k === PREFIX + latest);
    }
  }
  const candidates = [url.pathname];
  if (url.pathname.endsWith("/")) candidates.push(url.pathname + "index.html");
  else if (!/\.[a-z0-9]+$/i.test(url.pathname)) candidates.push(url.pathname + "/index.html");
  for (const name of names) {
    const cache = await caches.open(name);
    for (const p of candidates) {
      const hit = await cache.match(url.origin + p, { ignoreSearch: true });
      if (hit) return withRange(hit, req);
    }
  }
  // not unlocked on this device (or an older version): back to the password screen
  if (req.mode === "navigate") return Response.redirect(scope.href, 302);
  return new Response("", { status: 404 });
}
