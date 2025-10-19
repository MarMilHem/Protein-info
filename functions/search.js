// /functions/search.js — Pages Function: searches the catalog stored in KV (PRODUCTS)
// Make sure your Pages project has a KV binding named PRODUCTS in Settings → Functions.

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 500, 1, 500);
  const q = normalize(qRaw);

  // 1) Load catalog from KV (written by your Worker)
  const json = await env.PRODUCTS.get("products.json");
  const catalog = json ? safeParse(json) : [];

  // (Optional) Seed / merge a small curated list to ensure popular brands exist.
  // Toggle this to true if you want to guarantee these entries are searchable.
  const MERGE_CURATED = false;
  if (MERGE_CURATED) mergeCurated(catalog);

  if (!q) {
    // Return all when no query given
    return jsonResponse({ results: catalog.slice(0, limit) });
  }

  // 2) Alias expansion for common abbreviations
  const expanded = aliasExpand(q);
  const tokens = expanded.split(/\s+/).filter(Boolean);

  // 3) Score + match (robust, forgiving)
  const scored = catalog.map(p => {
    const hay = normalize([p.brand, p.product, p.type].filter(Boolean).join(" "));
    const fields = {
      brand: normalize(String(p.brand || "")),
      product: normalize(String(p.product || "")),
      type: normalize(String(p.type || "")),
    };

    // token OR matching
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;               // any field contains token
      if (fields.brand.startsWith(t)) score += 2;    // brand prefix boost
      if (fields.product.includes(t)) score += 1;    // product substring
      if (fields.type.includes(t)) score += 1;       // type substring
    }

    // exact-ish phrase boost
    if (expanded.length >= 3 && hay.includes(expanded)) score += 3;

    // short queries like "on", "mp" — give brand-only boost
    if (tokens.length === 1 && fields.brand.includes(tokens[0])) score += 2;

    return { p, s: score };
  });

  // 4) Primary results: score > 0
  let results = scored.filter(x => x.s > 0)
                      .sort((a,b) => b.s - a.s)
                      .map(x => x.p);

  // 5) Fallback: if nothing matched, try very forgiving brand/product substring
  if (results.length === 0) {
    const loose = catalog.filter(p => {
      const b = normalize(String(p.brand || ""));
      const pr = normalize(String(p.product || ""));
      return b.includes(expanded) || pr.includes(expanded);
    });
    results = loose;
  }

  // 6) Limit + return
  return jsonResponse({ results: results.slice(0, limit) });
}

/* ---------------- helpers ---------------- */

function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function safeParse(j) { try { return JSON.parse(j); } catch { return []; } }

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

// Normalize strings: lowercase + strip diacritics + collapse spaces
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Expand common abbreviations/aliases
function aliasExpand(s) {
  const ALIASES = {
    "on": "optimum nutrition",
    "optimum": "optimum nutrition",
    "mp": "myprotein",
    "dym": "dymatize",
    "iso 100": "iso100",
    "iso-100": "iso100",
    "r1": "rule one",
    "bulkpowders": "bulk",
    "gs whey": "gold standard whey",
  };
  let out = s;
  for (const [k, v] of Object.entries(ALIASES)) {
    out = out.replace(new RegExp(`\\b${escapeRegex(k)}\\b`, "g"), v);
  }
  return out;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Optional curated merge to guarantee common brands
function mergeCurated(list) {
  const curated = [
    { id:"mp-impact-whey", brand:"MyProtein", product:"Impact Whey", type:"Whey", pricePerKg:25, servingSizeG:30, proteinPer100g:82 },
    { id:"on-gold-standard", brand:"Optimum Nutrition", product:"Gold Standard Whey", type:"Whey", pricePerKg:32, servingSizeG:30, proteinPer100g:79 },
    { id:"bulk-vegan", brand:"Bulk", product:"Vegan Protein Powder", type:"Vegan", pricePerKg:28, servingSizeG:35, proteinPer100g:77 },
    { id:"dym-iso100", brand:"Dymatize", product:"ISO100", type:"Isolate", pricePerKg:40, servingSizeG:30, proteinPer100g:84 },
    { id:"rule1-whey", brand:"Rule One", product:"R1 Whey Blend", type:"Whey", pricePerKg:31, servingSizeG:30, proteinPer100g:79 }
  ];
  const key = (x) => `${normalize(x.brand)}|${normalize(x.product)}`;
  const seen = new Set(list.map(x => key(x)));
  for (const c of curated) if (!seen.has(key(c))) list.push(c);
}
