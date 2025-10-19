// /functions/search.js — Pages Function: searches the catalog stored in KV (PRODUCTS)
// + optional external sources (OpenFoodFacts, FoodRepo, OpenSupplementDB) merged in.
// Optional secret: FOODREPO_TOKEN in Cloudflare → Settings → Functions → Secrets.

export async function onRequest({ request, env }) {
  const url = new URL(request.url);

  // ── Inputs: query + filters + sort ───────────────────────────────────────────
  const qRaw   = (url.searchParams.get("q") || "").trim();
  const typeQ  = normalize(url.searchParams.get("type") || "");   // e.g., "whey", "isolate", "vegan"
  const sortQ  = normalize(url.searchParams.get("sort") || "");   // "price" | "protein" | "calories"
  const useExt = url.searchParams.get("external") === "1";        // add &external=1 to blend external results
  const stats = url.searchParams.get("stats") === "1";

  const q = normalize(qRaw);

  // 1) Load catalog from KV (written by your Worker)
  const json = await env.PRODUCTS.get("products.json");
  const catalog = json ? safeParse(json) : [];

  // Default limit: if client doesn't specify, return the full catalog (up to a generous cap).
  // This makes the UI show all available brands without the client needing to pass a large `limit`.
  const defaultLimit = Math.max(500, Array.isArray(catalog) ? catalog.length : 500);
  const limit = clampInt(url.searchParams.get("limit"), defaultLimit, 1, Math.max(10000, defaultLimit));

  // (Optional) Seed / merge a small curated list to ensure popular brands exist.
  const MERGE_CURATED = false;
  if (MERGE_CURATED) mergeCurated(catalog);

  // If no query, we still want to support type filter + sort (KV only)
  if (!q) {
    let results = catalog.slice();

    if (typeQ) {
      results = results.filter(p => normalize(p.type || "").includes(typeQ));
    }

    results = applySorting(results, sortQ);

    // Ensure origin key exists (undefined → null) for UI stability
    return jsonResponse({ results: results.slice(0, limit).map(fillMissing) });
  }

  // 2) Alias expansion for common abbreviations
  const expanded = aliasExpand(q);
  const tokens = expanded.split(/\s+/).filter(Boolean);

  // 3) Score + match (robust, forgiving) over KV
  const scored = catalog.map(p => {
    const hay = normalize([p.brand, p.product, p.type].filter(Boolean).join(" "));
    const fields = {
      brand: normalize(String(p.brand || "")),
      product: normalize(String(p.product || "")),
      type: normalize(String(p.type || "")),
    };

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

  // 4) Primary KV results: score > 0
  let resultsKV = scored
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.p);

  // 5) Fallback: if nothing matched, try very forgiving brand/product substring
  if (resultsKV.length === 0) {
    const loose = catalog.filter(p => {
      const b = normalize(String(p.brand || ""));
      const pr = normalize(String(p.product || ""));
      return b.includes(expanded) || pr.includes(expanded);
    });
    resultsKV = loose;
  }

  // 6) Apply type filter + sorting on KV
  if (typeQ) {
    resultsKV = resultsKV.filter(p => normalize(p.type || "").includes(typeQ));
  }
  resultsKV = applySorting(resultsKV, sortQ);

  // ── External blend (optional or auto-fallback) ───────────────────────────────
  let results = resultsKV.slice();

  const shouldCallExternal = useExt || resultsKV.length === 0;
  if (shouldCallExternal) {
    // Fetch in parallel with timeouts; fail-soft (never crash your route)
    const [off, fr, osd] = await Promise.allSettled([
      searchOpenFoodFacts(qRaw),
      searchFoodRepo(qRaw, env.FOODREPO_TOKEN),
      searchOpenSupplementDB(qRaw)
    ]);

    const ext = []
      .concat(off.status === "fulfilled" ? off.value : [])
      .concat(fr.status  === "fulfilled" ? fr.value  : [])
      .concat(osd.status === "fulfilled" ? osd.value : []);

    // Filter by type if provided (after mapping)
    const extFiltered = typeQ
      ? ext.filter(p => normalize(p.type || "").includes(typeQ))
      : ext;

    // Deduplicate with KV by key (brand|product) and prefer KV over external
    const seen = new Set(results.map(keyBP));
    for (const e of extFiltered) {
      const k = keyBP(e);
      if (!seen.has(k)) {
        seen.add(k);
        results.push(e);
      }
    }

    // Apply your same sort
    results = applySorting(results, sortQ);
  }

  // 7) Limit + return (and ensure origin exists)
  return jsonResponse({ results: results.slice(0, limit).map(fillMissing) });
}

/* ---------------- external sources (mapped to your schema) ---------------- */

async function searchOpenFoodFacts(query) {
  // Public search API. We'll do a name/brand style query.
  const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=30`;
  const res = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 900 } });
  if (!res.ok) return [];
  const json = await res.json();
  const items = Array.isArray(json.products) ? json.products : [];

  return items
    .map(p => {
      // Normalize numbers where available
      const protein = toNum(p?.nutriments?.proteins_100g);
      const kcal = toNum(p?.nutriments?.energy_kcal_100g ?? kJtoKcal(p?.nutriments?.energy_100g));
      return {
        id: p.id || p.code || undefined,
        brand: pickFirst(p.brands) || unknown(p.brand_owner),
        product: p.product_name || p.generic_name || "Unknown product",
        type: guessTypeFromText(`${p.product_name ?? ""} ${p.categories ?? ""}`),
        proteinPer100g: isFiniteNum(protein) ? protein : null,
        caloriesPer100g: isFiniteNum(kcal) ? kcal : null,
        pricePerKg: null, // OFF doesn't have reliable pricing
        origin: p.countries || p.origins || null,
        source: "OpenFoodFacts",
        url: p.url || (p.code ? `https://world.openfoodfacts.org/product/${p.code}` : null)
      };
    })
    .filter(hasBrandOrProduct);
}

async function searchFoodRepo(query, token) {
  // FoodRepo v3 (REST). If you have a token, we add it; otherwise we try public.
  // Search across name/brand; barcode-only endpoints miss many items for plain text queries.
  const url = `https://www.foodrepo.org/api/v3/products?search=${encodeURIComponent(query)}&page[size]=30`;
  const headers = token ? { Authorization: `Token ${token}` } : {};
  const res = await fetch(url, { headers, cf: { cacheEverything: true, cacheTtl: 900 } });
  if (!res.ok) return [];
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];

  return data.map(p => {
    const nutrients = p?.nutrients || {};
    const protein = toNum(nutrients.proteins_100g ?? nutrients.proteins);
    const kcal = toNum(nutrients.energy_kcal_100g ?? nutrients.energy_kcal);
    // origin can be e.g. "Switzerland" or arrays in some records
    const origin =
      p.origins_from_imported_ingredients ||
      p.origins ||
      p.countries_of_origin ||
      null;

    return {
      id: p.id,
      brand: p.brand || pickFirst(p.brands),
      product: p.name_translations?.en || p.name || "Unknown product",
      type: guessTypeFromText(`${p.name ?? ""} ${p.categories ?? ""}`),
      proteinPer100g: isFiniteNum(protein) ? protein : null,
      caloriesPer100g: isFiniteNum(kcal) ? kcal : null,
      pricePerKg: null,
      origin,
      source: "FoodRepo",
      url: p.website || null
    };
  }).filter(hasBrandOrProduct);
}

async function searchOpenSupplementDB(query) {
  // Community JSON (GitHub raw). We fetch once per request; CF caches it.
  const url = "https://raw.githubusercontent.com/opensupplementdb/data/main/supplements.json";
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 1800 } });
  if (!res.ok) return [];
  const arr = await res.json();
  const q = query.toLowerCase();

  return (Array.isArray(arr) ? arr : [])
    .filter(p =>
      `${p.name} ${p.brand} ${p.type}`.toLowerCase().includes(q)
    )
    .map(p => ({
      id: p.id || undefined,
      brand: p.brand || null,
      product: p.name || "Unknown product",
      type: p.type || guessTypeFromText(`${p.name} ${p.category || ""}`),
      proteinPer100g: isFiniteNum(toNum(p.proteinPer100g ?? p.protein_content)) ? toNum(p.proteinPer100g ?? p.protein_content) : null,
      caloriesPer100g: isFiniteNum(toNum(p.caloriesPer100g ?? p.calorie_content)) ? toNum(p.caloriesPer100g ?? p.calorie_content) : null,
      pricePerKg: isFiniteNum(toNum(p.pricePerKg)) ? toNum(p.pricePerKg) : null,
      origin: p.country || p.origin || null,
      source: "OpenSupplementDB",
      url: p.url || null
    }))
    .filter(hasBrandOrProduct);
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
    { id:"mp-impact-whey", brand:"MyProtein", product:"Impact Whey", type:"Whey", pricePerKg:25, servingSizeG:30, proteinPer100g:82, origin:"United Kingdom" },
    { id:"on-gold-standard", brand:"Optimum Nutrition", product:"Gold Standard Whey", type:"Whey", pricePerKg:32, servingSizeG:30, proteinPer100g:79, origin:"USA" },
    { id:"bulk-vegan", brand:"Bulk", product:"Vegan Protein Powder", type:"Vegan", pricePerKg:28, servingSizeG:35, proteinPer100g:77, origin:"United Kingdom" },
    { id:"dym-iso100", brand:"Dymatize", product:"ISO100", type:"Isolate", pricePerKg:40, servingSizeG:30, proteinPer100g:84, origin:"USA" },
    { id:"rule1-whey", brand:"Rule One", product:"R1 Whey Blend", type:"Whey", pricePerKg:31, servingSizeG:30, proteinPer100g:79, origin:"USA" }
  ];
  const key = (x) => `${normalize(x.brand)}|${normalize(x.product)}`;
  const seen = new Set(list.map(x => key(x)));
  for (const c of curated) if (!seen.has(key(c))) list.push(c);
}

// Sorting helper for "price" | "protein" | "calories"
function applySorting(items, sortQ) {
  const arr = items.slice();
  if (!sortQ) return arr;

  const val = (x, k) => {
    const v = x?.[k];
    return (v == null || Number.isNaN(Number(v))) ? null : Number(v);
  };

  if (sortQ === "price") {
    // Lowest price first (nulls last)
    arr.sort((a, b) => compareNumericAsc(val(a, "pricePerKg"), val(b, "pricePerKg")));
  } else if (sortQ === "protein") {
    // Highest protein first (nulls last)
    arr.sort((a, b) => compareNumericDesc(val(a, "proteinPer100g"), val(b, "proteinPer100g")));
  } else if (sortQ === "calories") {
    // Lowest calories first (nulls last)
    arr.sort((a, b) => compareNumericAsc(val(a, "caloriesPer100g"), val(b, "caloriesPer100g")));
  }
  return arr;
}

function compareNumericAsc(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last
  if (b == null) return -1;
  return a - b;
}

function compareNumericDesc(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // nulls last
  if (b == null) return -1;
  return b - a;
}

function keyBP(x) {
  return `${normalize(x.brand || "")}|${normalize(x.product || "")}`;
}

function hasBrandOrProduct(x) {
  return Boolean((x.brand && String(x.brand).trim()) || (x.product && String(x.product).trim()));
}

function fillMissing(x) {
  // make sure "origin" always exists for UI
  if (!("origin" in x)) x.origin = null;
  return x;
}

function kJtoKcal(kj) {
  const n = toNum(kj);
  return isFiniteNum(n) ? n * 0.239006 : null;
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// naive type inference for external data
function guessTypeFromText(t) {
  const s = normalize(t);
  if (/\biso(100|late)\b/.test(s)) return "Isolate";
  if (/\bcasein\b/.test(s)) return "Casein";
  if (/\bvegan\b|\bpea\b|\bsoy\b|\brice\b/.test(s)) return "Vegan";
  if (/\bwhey\b/.test(s)) return "Whey";
  return "";
}

function pickFirst(str) {
  if (!str) return null;
  // OFF brands/countries can be "Brand1, Brand2"
  return String(str).split(",")[0].trim() || null;
}
