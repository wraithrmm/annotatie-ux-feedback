// The fixture host: a tiny "client site" with the Annotatie widget on it, for the Playwright specs and
// for an end-to-end check against a real deployment.
//
//   node packages/sdk-browser/e2e/fixture-host/server.mjs
//
// Env:
//   PORT                       4310
//   ANNOTATIE_BASE             Annotatie's origin (default the e2e mock, http://127.0.0.1:4311)
//   ANNOTATIE_SITE_ID          the site id registered in the portal (default site_fixture)
//   ANNOTATIE_KID              the site key's id
//   ANNOTATIE_PRIVATE_KEY_PEM  the site key (PKCS#8 PEM). Without it an ephemeral key is made and its
//                              public JWK printed, to register in the portal (or hand to the mock).
//   ANNOTATIE_THEME            neutral | race-officials
//   FIXTURE_USER_ID / FIXTURE_USER_NAME   who the fixture says is signed in
//
// The token route runs behind the fixture's own "session": the page sets a cookie, and
// /annotatie/token answers 403 without it, as a real host's session check would.
import { createServer } from "node:http";
import { annotatieTag, createTokenHandler, generateSiteKey, publicJwkFor, thumbprint } from "@annotatie/sdk-server-node";

const PORT = Number(process.env.PORT ?? 4310);
const BASE = (process.env.ANNOTATIE_BASE ?? "http://127.0.0.1:4311").replace(/\/+$/, "");
const SITE = process.env.ANNOTATIE_SITE_ID ?? "site_fixture";
let pem = process.env.ANNOTATIE_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
let kid = process.env.ANNOTATIE_KID;
if (!pem) {
  const key = generateSiteKey();
  pem = key.privateKeyPem;
  kid = key.kid;
  console.log(`fixture host: no ANNOTATIE_PRIVATE_KEY_PEM, using an ephemeral key. Public JWK: ${JSON.stringify(key.publicKeyJwk)}`);
}
kid ??= thumbprint(publicJwkFor(pem));
const USER = { id: process.env.FIXTURE_USER_ID ?? "u-ellis", name: process.env.FIXTURE_USER_NAME ?? "Ellis Varnholt" };

const tokenHandler = createTokenHandler({
  base: BASE,
  siteId: SITE,
  kid,
  privateKey: pem,
  getUser: (req) => (/(?:^|;\s*)fixture_session=signed-in(?:;|$)/.test(req.headers.cookie ?? "") ? USER : null),
});

const tag = annotatieTag({ base: BASE, siteId: SITE, tokenUrl: "/annotatie/token", theme: process.env.ANNOTATIE_THEME === "race-officials" ? "race-officials" : "neutral", buildId: "fixture-1" });

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32" viewBox="0 0 96 32"><rect width="96" height="32" rx="6" fill="#0b3d63"/><text x="48" y="21" font-family="Arial" font-size="13" fill="#fff" text-anchor="middle">Fixture</text></svg>`;

const ROWS = [
  ["Ngaio Rewiti-Ashcombe", "NZLX901", "International Umpire", "Expiring"],
  ["Uzoamaka Ndibenwa", "NGRX904", "International Judge", "Current"],
  ["Niamh Tullavin", "IRLX906", "International Umpire", "Current"],
  ["Cormac Brannaway", "IRLX910", "International Race Officer", "Lapsed"],
];

const register = `
  <h1>Officials register</h1>
  <p class="lead">Every official's positions, with their status and reapply date.</p>
  <div class="acts"><button type="button" id="export">Export this list</button><button type="button" id="views">Saved views</button></div>
  <p class="resline">Showing 1 to 4 of 757 positions (743 people).</p>
  <div class="tscroll"><table><caption>Officials register: 4 of 757 positions shown</caption>
    <thead><tr><th scope="col">Name</th><th scope="col">Member ID</th><th scope="col">Position</th><th scope="col">Status</th></tr></thead>
    <tbody>${ROWS.map((r) => `<tr><td><a href="#">${r[0]}</a></td><td>${r[1]}</td><td>${r[2]}</td><td><span class="tag">${r[3]}</span></td></tr>`).join("")}</tbody>
  </table></div>
  <form id="contact" onsubmit="event.preventDefault(); document.getElementById('saved').hidden = false;">
    <h2>Contact details</h2>
    <label for="name">Name</label><input id="name" name="name" value="Ellis Varnholt">
    <label for="email">Email</label><input id="email" name="email" type="email" value="ellis@example.test">
    <label for="password">Password</label><input id="password" name="password" type="password" value="hunter2-fixture">
    <div class="private" data-annotatie-mask><span>Account number</span> <strong id="acct">GB00 FIXT 1234 5678</strong></div>
    <label><input type="checkbox" id="agree" checked> Send me reminders</label>
    <button type="submit">Save</button> <p id="saved" hidden>Saved.</p>
  </form>
  <p><img src="/logo.svg" alt="Fixture logo" width="96" height="32"> <a href="/settings" data-spa>Settings (single-page link)</a></p>`;

const settings = `
  <h1>Settings</h1>
  <p class="lead">A second view, reached without reloading the page.</p>
  <div class="acts"><button type="button" id="notify">Notification settings</button></div>
  <p><a href="/" data-spa>Back to the register</a></p>`;

const page = (path) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${path === "/settings" ? "Settings" : "Officials register"} – Fixture</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #1c2735; background: #f7faff; }
  header { height: 56px; background: #0b3d63; color: #fff; display: flex; align-items: center; padding: 0 16px; gap: 16px; }
  header a { color: #fff; }
  main { padding: 160px 24px 120px; max-width: 64rem; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
  button { min-height: 40px; padding: 8px 14px; border: 1px solid #808d9f; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; }
  .tscroll { overflow-x: auto; background: #fff; border: 1px solid #d9e8fb; border-radius: 12px; }
  table { border-collapse: collapse; width: 100%; min-width: 36rem; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #d9e8fb; }
  .tag { background: #fcf2e3; color: #855903; border-radius: 999px; padding: 2px 10px; font-size: 13px; }
  .tag::before { content: "• "; }
  form { display: grid; gap: 6px; max-width: 26rem; margin-top: 24px; }
  input:not([type=checkbox]) { min-height: 36px; padding: 4px 8px; border: 1px solid #808d9f; border-radius: 6px; font: inherit; }
  .private { padding: 8px; background: #fff5e8; border-radius: 6px; }
  @media (max-width: 639px) { main { padding: 150px 16px 120px; } }
</style></head>
<body><header><strong>Fixture site</strong><nav><a href="/" data-spa>Register</a> · <a href="/settings" data-spa>Settings</a></nav></header>
<main id="main">${path === "/settings" ? settings : register}</main>
<script>
  // A minimal single-page router: data-spa links swap the main content with history.pushState.
  const views = { "/": ${JSON.stringify(register)}, "/settings": ${JSON.stringify(settings)} };
  const titles = { "/": "Officials register – Fixture", "/settings": "Settings – Fixture" };
  function show(path) { document.getElementById("main").innerHTML = views[path] || views["/"]; document.title = titles[path] || titles["/"]; }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-spa]");
    if (!a) return;
    e.preventDefault();
    history.pushState({}, "", a.getAttribute("href"));
    show(location.pathname);
  });
  window.addEventListener("popstate", () => show(location.pathname));
  window.fixtureClicks = 0;
  document.addEventListener("click", () => { window.fixtureClicks++; });
</script>
${tag}
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/annotatie/token") return void tokenHandler(req, res);
  if (url.pathname === "/logo.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=60" });
    return res.end(LOGO);
  }
  if (url.pathname === "/" || url.pathname === "/settings") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The fixture's "session": a real host signs the user in; here every visitor is signed in.
      "set-cookie": "fixture_session=signed-in; Path=/; HttpOnly; SameSite=Lax",
      "cache-control": "no-store",
    });
    return res.end(page(url.pathname));
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`fixture host on http://127.0.0.1:${PORT} (Annotatie at ${BASE}, site ${SITE})`));
