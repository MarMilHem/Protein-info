(function () {
  const STORAGE_KEY = 'protein_compare_v1';
  const MAX_ITEMS = 5;

  const state = {
    items: [],
    // Match the table’s columns: Serving → Price/serving → Protein/serving...
    sort: { key: 'pricePerServing', dir: 'asc' },
  };

  // ───────────────── Public API ─────────────────
  window.Compare = {
    add(item) {
      const normalized = normalizeItem(item);
      if (!normalized.id) { console.warn('Compare.add: item.id is required'); return; }

      const existing = state.items.find(p => p.id === normalized.id);
      if (existing) { toast('Already in comparison'); return; }

      if (state.items.length >= MAX_ITEMS) { toast(`Max ${MAX_ITEMS} items`); return; }

      state.items.push(computeDerived(normalized));
      persist(); render(); toast('Added to comparison');
    },
    remove(id) {
      state.items = state.items.filter(p => p.id !== id);
      persist(); render();
    },
    list() { return [...state.items]; },
    clear() { state.items = []; persist(); render(); },
  };

  // ───────────────── DOM helpers ─────────────────
  const bodyEl  = () => document.getElementById('compareBody');
  const countEl = () => document.getElementById('compare-count');
  const emptyEl = () => document.getElementById('compare-empty');
  const tableEl = () => document.getElementById('compareTable');

  // ───────────────── Init ─────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Top controls
    document.getElementById('clearBtn')?.addEventListener('click', () => window.Compare.clear());
    document.getElementById('shareBtn')?.addEventListener('click', shareLink);
    document.getElementById('loadExamplesBtn')?.addEventListener('click', loadDemo);

    // Click-to-sort on table headers (only those with data-key)
    tableEl()?.querySelectorAll('thead th[data-key]')?.forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        const dir = (state.sort.key === key && state.sort.dir === 'asc') ? 'desc' : 'asc';
        state.sort = { key, dir };
        persist(); render();
      });
    });

    hydrateFromUrlOrStorage();
    render();
  });

  // ───────────────── Render ─────────────────
  function render() {
    const body  = bodyEl();
    const count = countEl();
    const empty = emptyEl();

    const visible = [...state.items];
    applySort(visible);

    const metrics = computeHighlights(visible);

    body.innerHTML = '';
    visible.forEach(p => {
      const tr = document.createElement('tr');

      tr.appendChild(tdText(p.brand ?? '—'));
      tr.appendChild(tdText(p.product ?? '—'));

      tr.appendChild(tdNum(numOrDash(p.servingSizeG, 0)));

      // Price / serving: highlight min
      tr.appendChild(tdNum(
        formatMoney(p.pricePerServing),
        eqNum(metrics.bestPricePerServing, p.pricePerServing) ? 'best' : ''
      ));

      // Protein / serving: highlight max (class 'ok' to keep neutral green)
      tr.appendChild(tdNum(
        numOrDash(p.proteinPerServing, 1),
        eqNum(metrics.bestProteinPerServing, p.proteinPerServing) ? 'ok' : ''
      ));

      tr.appendChild(tdNum(numOrDash(p.caloriesPerServing, 0)));

      tr.appendChild(tdNum(
        numOrDash(p.carbsPerServing, 1),
        clsLow(metrics.minCarbs, p.carbsPerServing)
      ));

      tr.appendChild(tdNum(
        numOrDash(p.fatPerServing, 1),
        clsLow(metrics.minFat, p.fatPerServing)
      ));

      const actions = document.createElement('td');
      const rm = document.createElement('button');
      rm.className = 'btn';
      rm.textContent = 'Remove';
      rm.onclick = () => window.Compare.remove(p.id);
      actions.appendChild(rm);
      tr.appendChild(actions);

      body.appendChild(tr);
    });

    count.textContent = String(state.items.length);
    empty.style.display = state.items.length ? 'none' : 'block';
  }

  // ───────────────── Sort / Highlights ─────────────────
  function applySort(arr) {
    const { key, dir } = state.sort;
    const sign = (dir === 'asc') ? 1 : -1;

    arr.sort((a, b) => {
      const va = a[key];
      const vb = b[key];

      const na = (typeof va === 'number' && Number.isFinite(va)) ? va : null;
      const nb = (typeof vb === 'number' && Number.isFinite(vb)) ? vb : null;

      // Numbers first; nulls go last
      if (na === null && nb === null) return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * sign;
      if (na === null) return 1;
      if (nb === null) return -1;

      return (na - nb) * sign;
    });
  }

  function computeHighlights(items) {
    const vals = (k, f) => items.map(i => i[k]).filter(Number.isFinite).map(f || (x => x));
    const minVal = k => {
      const xs = vals(k);
      return xs.length ? Math.min(...xs) : null;
    };
    const maxVal = k => {
      const xs = vals(k);
      return xs.length ? Math.max(...xs) : null;
    };

    return {
      bestPricePerServing: minVal('pricePerServing'),
      bestProteinPerServing: maxVal('proteinPerServing'),
      minCarbs: minVal('carbsPerServing'),
      minFat: minVal('fatPerServing'),
    };
  }

  function clsLow(minVal, val) {
    if (!Number.isFinite(minVal) || !Number.isFinite(val)) return '';
    return val === minVal ? 'low' : '';
  }

  // ───────────────── Utils ─────────────────
  function tdText(text, extra = '') {
    const td = document.createElement('td');
    td.textContent = text;
    if (extra) td.className = extra;
    return td;
  }

  function tdNum(text, extra = '') {
    const td = tdText(text, 'num' + (extra ? ' ' + extra : ''));
    return td;
  }

  function formatMoney(n) {
    return Number.isFinite(n) ? ('€' + n.toFixed(2)) : '—';
  }

  function numOrDash(n, digits = 0) {
    return Number.isFinite(n) ? Number(n).toFixed(digits) : '—';
    }

  function eqNum(a, b) {
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }

  function normalizeItem(p) {
    const num = v => (v === null || v === undefined || v === '') ? undefined : Number(v);
    return {
      id: p.id,
      brand: p.brand || '',
      product: p.product || '',
      type: p.type || '',
      pricePerKg: num(p.pricePerKg),
      servingSizeG: num(p.servingSizeG),
      proteinPer100g: num(p.proteinPer100g),
      caloriesPerServing: num(p.caloriesPerServing),
      carbsPerServing: num(p.carbsPerServing),
      fatPerServing: num(p.fatPerServing),
      sweeteners: p.sweeteners,
      allergens: p.allergens,
      origin: p.origin,
      rating: num(p.rating),
    };
  }

  function computeDerived(p) {
    const pricePerServing =
      (Number.isFinite(p.pricePerKg) && Number.isFinite(p.servingSizeG))
        ? p.pricePerKg * (p.servingSizeG / 1000)
        : undefined;

    const proteinPerServing =
      (Number.isFinite(p.proteinPer100g) && Number.isFinite(p.servingSizeG))
        ? p.proteinPer100g * (p.servingSizeG / 100)
        : undefined;

    return { ...p, pricePerServing, proteinPerServing };
  }

  // Persist whole items (for reliable share links on new devices)
  function persist() {
    const payload = {
      items: state.items,
      prefs: { sort: state.sort }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    // Keep URL hash in sync with base64 JSON of items (no PII; easy to import)
    const json = JSON.stringify(payload.items);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const url = new URL(location.href);
    url.hash = 'cmp=' + b64;
    history.replaceState(null, '', url.toString());
  }

  function hydrateFromUrlOrStorage() {
    // 1) Try URL hash import first
    const m = location.hash.match(/(^|#|&)cmp=([^&]+)/);
    if (m) {
      try {
        const json = decodeURIComponent(escape(atob(m[2])));
        const items = JSON.parse(json);
        if (Array.isArray(items)) {
          state.items = items.map(computeDerived);
          return;
        }
      } catch { /* fall back */ }
    }

    // 2) Fallback to localStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        state.items = (saved.items || []).map(computeDerived);
        if (saved.prefs?.sort) state.sort = saved.prefs.sort;
      } catch { /* ignore */ }
    }
  }

  async function shareLink() {
    const raw = JSON.stringify(state.items);
    const b64 = btoa(unescape(encodeURIComponent(raw)));
    const url = new URL(location.href);
    url.hash = 'cmp=' + b64;

    try {
      await navigator.clipboard.writeText(url.toString());
      toast('Share link copied');
    } catch {
      prompt('Copy this link', url.toString());
    }
  }

  function loadDemo() {
    const demo = [
      { id: 'mp-impact-whey', brand: 'MyProtein', product: 'Impact Whey', type: 'Whey', pricePerKg: 25, servingSizeG: 30, proteinPer100g: 82, caloriesPerServing: 120, carbsPerServing: 4,   fatPerServing: 1.8, sweeteners: 'Sucralose', allergens: 'Milk, Soy Lecithin', origin: 'EU',  rating: 4.4 },
      { id: 'on-gold-standard', brand: 'Optimum Nutrition', product: 'Gold Standard Whey', type: 'Whey', pricePerKg: 32, servingSizeG: 30, proteinPer100g: 79, caloriesPerServing: 120, carbsPerServing: 3,   fatPerServing: 1.5, sweeteners: 'Sucralose', allergens: 'Milk, Soy Lecithin', origin: 'USA', rating: 4.6 },
      { id: 'bulk-vegan', brand: 'Bulk', product: 'Vegan Protein Powder', type: 'Vegan', pricePerKg: 28, servingSizeG: 35, proteinPer100g: 77, caloriesPerServing: 134, carbsPerServing: 2.3, fatPerServing: 2.4, sweeteners: 'Stevia',   allergens: 'None', origin: 'EU',  rating: 4.3 },
    ];
    const existing = new Set(state.items.map(i => i.id));
    demo.forEach(d => { if (!existing.has(d.id)) window.Compare.add(d); });
  }

  function toast(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(17,24,39,.95)', color: '#fff', padding: '10px 14px', borderRadius: '12px',
      fontSize: '14px', boxShadow: '0 8px 30px rgba(0,0,0,.25)', zIndex: 9999
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1400);
  }
})();
