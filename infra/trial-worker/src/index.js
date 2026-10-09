const HOST_PATTERN = /^maven-trial-([0-9a-f]{32})$/i;
const MIME_TYPES = {
  html: "text/html; charset=UTF-8",
  css: "text/css; charset=UTF-8",
  js: "text/javascript; charset=UTF-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
};

function contentType(pathname) {
  const ext = pathname.split(".").pop().toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function safePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("..") || decoded.includes("\\")) return null;
  return decoded.replace(/^\/+/, "") || "index.html";
}

function uuidFromCompact(compact) {
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export default {
  async fetch(request, env) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const label = url.hostname.toLowerCase().split(".")[0];
    const match = label.match(HOST_PATTERN);
    if (!match) return new Response("Not Found", { status: 404 });

    const path = safePath(url.pathname);
    if (!path) return new Response("Bad Request", { status: 400 });

    const trialId = uuidFromCompact(match[1]);
    let objectPath = path;
    let object = await env.TRIAL_BUCKET.get(`trials/${trialId}/${objectPath}`);
    // Generated pages link to "/contact" while the renderer stores "contact.html".
    if (!object && !objectPath.split("/").pop().includes(".")) {
      objectPath = `${objectPath.replace(/\/+$/, "")}.html`;
      object = await env.TRIAL_BUCKET.get(`trials/${trialId}/${objectPath}`);
    }
    if (!object) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", contentType(objectPath));
    headers.set("Cache-Control", objectPath === "index.html" ? "no-cache" : "public, max-age=300");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
