// Synthetic screenshots and page copies for the mock (no network; data: URLs only).

const ROWS: Array<[string, string]> = [
  ["Blue mug", "£8.00 · 2"],
  ["Tea towel", "£5.50 · 1"],
  ["Notebook", "£3.20 · 4"],
];

export type Shot = "apply" | "export" | "save";

export function shot(kind: Shot, opts: { marked: boolean; crop: boolean }): string {
  const W = 390;
  const H = 420;
  const target =
    kind === "export" ? { x: 270, y: 60, w: 90, h: 32 } : kind === "save" ? { x: 16, y: 360, w: 358, h: 44 } : { x: 262, y: 300, w: 112, h: 40 };
  let rows = "";
  let y = 120;
  for (const [a, b] of ROWS) {
    rows += `<rect x="16" y="${y}" width="358" height="44" fill="#fff" stroke="#dde3ea"/><text x="30" y="${y + 27}" font-size="14" fill="#1c2735">${a}</text><text x="360" y="${y + 27}" font-size="14" fill="#354150" text-anchor="end">${b}</text>`;
    y += 44;
  }
  const mark = opts.marked
    ? `<rect x="${target.x - 4}" y="${target.y - 4}" width="${target.w + 8}" height="${target.h + 8}" rx="10" fill="none" stroke="#b42318" stroke-width="3"/>`
    : "";
  const vb = opts.crop ? `${target.x - 48} ${target.y - 30} ${target.w + 96} ${target.h + 60}` : `0 0 ${W} ${H}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" font-family="Segoe UI, Arial, sans-serif">` +
    `<rect width="${W}" height="${H}" fill="#f7f8fb"/><rect width="${W}" height="48" fill="#24324a"/>` +
    `<text x="16" y="30" font-size="15" font-weight="600" fill="#fff">Acme Shop</text>` +
    `<text x="16" y="92" font-size="22" font-weight="600" fill="#1c2735">Your basket</text>` +
    `<rect x="270" y="60" width="90" height="32" rx="8" fill="#24324a"/><text x="315" y="81" font-size="13" font-weight="600" fill="#fff" text-anchor="middle">Export</text>` +
    rows +
    `<rect x="16" y="300" width="238" height="40" rx="8" fill="#fff" stroke="#c5ccd6"/><text x="28" y="325" font-size="14" fill="#5b6470">spring10</text>` +
    `<rect x="262" y="300" width="112" height="40" rx="8" fill="#e9edf3" stroke="#24324a"/><text x="318" y="325" font-size="14" font-weight="600" fill="#24324a" text-anchor="middle">Apply</text>` +
    `<rect x="16" y="360" width="358" height="44" rx="8" fill="#2f7d4f"/><text x="195" y="387" font-size="15" font-weight="600" fill="#fff" text-anchor="middle">Save and pay</text>` +
    mark +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export const PAGE_COPY = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=390"><style>body{margin:0;font:14px/20px system-ui,Segoe UI,Arial,sans-serif;background:#f7f8fb;color:#1c2735}header{height:48px;background:#24324a;color:#fff;display:flex;align-items:center;padding:0 16px;font-weight:600}main{padding:16px}h1{font-size:22px;margin:0 0 12px}.rows{background:#fff;border:1px solid #dde3ea;border-radius:8px}.r{display:flex;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #dde3ea;gap:12px}.code{display:flex;gap:8px;margin:16px 0}.code input{flex:1;min-height:36px;background:repeating-linear-gradient(45deg,#eee 0 6px,#fff 6px 12px)}[data-annotatie-target]{outline:3px solid #b42318;outline-offset:2px}button{min-height:40px}</style></head><body><header>Acme Shop</header><main><h1>Your basket</h1><div class="rows"><div class="r"><span>Blue mug</span><span>£8.00 · 2</span></div><div class="r"><span>Tea towel</span><span>£5.50 · 1</span></div><div class="r"><span>Notebook</span><span>£3.20 · 4</span></div></div><div class="code"><input type="text" value="" aria-label="Discount code (left blank)"><button type="button" data-annotatie-target>Apply</button></div><button type="button">Save and pay</button><script>alert("this must never run")</script></main></body></html>`;
