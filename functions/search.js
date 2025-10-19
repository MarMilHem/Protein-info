// /functions/search.js  — Pages Function that searches your KV catalog
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  // read live catalog from KV (written by your Worker)
  const json = await env.PRODUCTS.get("products.json");
  const CATALOG = json ? JSON.parse(json) : [];

  // alias/abbreviation help
  const ALIASES = {
    "on": "optimum nutrition", "optimum": "optimum nutrition",
    "mp": "myprotein", "dym": "dymatize",
    "iso 100": "iso100", "iso-100": "iso100",
    "r1": "rule one"
  };
  const aliasExpand = (s) => {
    let out = s;
    for (const [k, v] of Object.entries(ALIASES)) {
      out = out.replace(new RegExp(`\\b${k}\\b`, "gi"), v);
    }
    return out;
  };

  const tokens = aliasExpand(q).split(/\s+/).filter(Boolean);

  const score = (p) => {
    const hay = aliasExpand(`${p.brand} ${p.product} ${p.type}`.toLowerCase());
    let s = 0;
    for (const t of tokens) if (hay.includes(t)) s++;
    return s;
  };

  const results = tokens.length
    ? CATALOG.map(p => ({ p, s: score(p) }))
        .filter(x => x.s > 0)
        .sort((a,b)=> b.s - a.s)
        .map(x => x.p)
    : CATALOG;

  return new Response(JSON.stringify({ results }), {
    headers: { "content-type": "application/json" }
  });
}
