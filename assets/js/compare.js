(function(){
  const STORAGE_KEY = 'protein_compare_v1';
  const MAX_ITEMS = 5;

  const state = {
    items: [],
    sort: { key: 'pricePerKg', dir: 'asc' },
    veganOnly: false,
    typeFilter: '',
    showExtended: false
  };

  // Public API
  window.Compare = {
    add(item) {
      const normalized = normalizeItem(item);
      if (!normalized.id) { console.warn('Compare.add: item.id is required'); return; }
      if (state.items.find(p => p.id === normalized.id)) { toast('Already in comparison'); return; }
      if (state.items.length >= MAX_ITEMS) { toast(`Max ${MAX_ITEMS} items`); return; }
      state.items.push(computeDerived(normalized));
      persist(); render(); toast('Added to comparison');
    },
    remove(id) { state.items = state.items.filter(p => p.id !== id); persist(); render(); },
    list(){ return [...state.items]; },
    clear(){ state.items = []; persist(); render(); }
  };

  // DOM
  const bodyEl   = () => document.getElementById('compareBody');
  const countEl  = () => document.getElementById('compare-count');
  const emptyEl  = () => document.getElementById('compare-empty');
  const tableEl  = () => document.getElementById('compareTable');
  const veganEl  = () => document.getElementById('veganOnly');
  const typeEl   = () => document.getElementById('typeFilter');
  const extEl    = () => document.getElementById('toggleExtended');

  // Init when DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    // Wire events
    veganEl().addEventListener('change', () => { state.veganOnly = veganEl().checked; render(); });
    typeEl().addEventListener('change', () => { state.typeFilter = typeEl().value; render(); });
    extEl().addEventListener('change', () => { state.showExtended = extEl().checked; toggleExtendedCols(); });

    document.getElementById('clearBtn').addEventListener('click', () => window.Compare.clear());
    document.getElementById('shareBtn').addEventListener('click', shareLink);
    document.getElementById('loadExamplesBtn').addEventListener('click', loadDemo);

    tableEl().querySelectorAll('thead th[data-key]').forEach(th=>{
      th.addEventListener('click', ()=>{
        const key = th.dataset.key;
        const dir = (state.sort.key === key && state.sort.dir === 'asc') ? 'desc' : 'asc';
        state.sort = { key, dir }; render();
      });
    });

    hydrateFromUrlOrStorage();
    toggleExtendedCols();
    render();
  });

  // Render
  function render(){
    const body = bodyEl(); const count = countEl(); const empty = emptyEl();
    const visible = applyFilters([...state.items]); applySort(visible);
    const metrics = computeHighlights(visible);

    body.innerHTML = '';
    visible.forEach(p=>{
      const tr = document.createElement('tr');
      tr.appendChild(tdText(p.brand));
      tr.appendChild(tdText(p.product));
      tr.appendChild(tdText(p.type, 'hide-md'));

      tr.appendChild(tdNum(formatMoney(p.pricePerKg), metrics.bestPriceKg === p.pricePerKg ? 'best' : ''));
      tr.appendChild(tdNum(p.servingSizeG ?? '—', 'hide-md'));
      tr.appendChild(tdNum(formatMoney(p.pricePerServing)));

      tr.appendChild(tdNum(p.proteinPer100g ?? '—', metrics.bestProtein100 === p.proteinPer100g ? 'ok':''));
      tr.appendChild(tdNum(p.proteinPerServing ?? '—'));

      tr.appendChild(tdNum(p.caloriesPerServing ?? '—', 'hide-md ext'));
      tr.appendChild(tdNum(p.carbsPerServing ?? '—', clsLow(metrics.minCarbs, p.carbsPerServing) + ' hide-md ext'));
      tr.appendChild(tdNum(p.fatPerServing ?? '—', clsLow(metrics.minFat, p.fatPerServing) + ' hide-md ext'));

      tr.appendChild(tdText(p.sweeteners ?? '—', 'hide-md ext'));
      tr.appendChild(tdText(p.allergens ?? '—', 'hide-md ext'));
      tr.appendChild(tdText(p.origin ?? '—', 'hide-md ext'));
      tr.appendChild(tdNum(p.rating ?? '—', 'hide-md ext'));

      const actions = document.createElement('td');
      const rm = document.createElement('button'); rm.className='btn'; rm.textContent='Remove';
      rm.onclick = ()=> window.Compare.remove(p.id);
      actions.appendChild(rm); tr.appendChild(actions);

      body.appendChild(tr);
    });

    count.textContent = state.items.length;
    empty.style.display = state.items.length ? 'none' : 'block';
    persist();
  }

  // Filters/sort/highlights
  function applyFilters(arr){ return arr.filter(p=>{
    if (state.veganOnly && p.type !== 'Vegan') return false;
    if (state.typeFilter && p.type !== state.typeFilter) return false;
    return true;
  });}
  function applySort(arr){
    const { key, dir } = state.sort; const sign = dir === 'asc' ? 1 : -1;
    arr.sort((a,b)=> {
      const va=a[key], vb=b[key];
      if (typeof va==='number' && typeof vb==='number') return (va-vb)*sign;
      return String(va??'').localeCompare(String(vb??''))*sign;
    });
  }
  function computeHighlights(items){
    const nums = {
      priceKg: items.map(i=>i.pricePerKg).filter(isFinite),
      protein100: items.map(i=>i.proteinPer100g).filter(isFinite),
      carbs: items.map(i=>i.carbsPerServing).filter(isFinite),
      fat: items.map(i=>i.fatPerServing).filter(isFinite)
    };
    return {
      bestPriceKg: nums.priceKg.length ? Math.min(...nums.priceKg) : null,
      bestProtein100: nums.protein100.length ? Math.max(...nums.protein100) : null,
      minCarbs: nums.carbs.length ? Math.min(...nums.carbs) : null,
      minFat: nums.fat.length ? Math.min(...nums.fat) : null
    };
  }
  function clsLow(minVal, val){ if(!isFinite(minVal)||!isFinite(val)) return ''; return val===minVal ? 'low' : ''; }

  // Utils
  function tdText(text, extra=''){ const td=document.createElement('td'); td.textContent=text; if(extra)td.className=extra; return td; }
  function tdNum(text, extra=''){ const td=tdText(text, 'num '+(extra||'')); return td; }
  function formatMoney(n){ return isFinite(n) ? '€'+n.toFixed(2) : '—'; }

  function normalizeItem(p){
    const num = v => (v===null||v===undefined||v==='') ? undefined : Number(v);
    return {
      id: p.id, brand: p.brand||'', product: p.product||'', type: p.type||'',
      pricePerKg: num(p.pricePerKg), servingSizeG: num(p.servingSizeG),
      proteinPer100g: num(p.proteinPer100g),
      caloriesPerServing: num(p.caloriesPerServing),
      carbsPerServing: num(p.carbsPerServing), fatPerServing: num(p.fatPerServing),
      sweeteners: p.sweeteners, allergens: p.allergens, origin: p.origin, rating: num(p.rating)
    };
  }
  function computeDerived(p){
    const pricePerServing = (isFinite(p.pricePerKg) && isFinite(p.servingSizeG)) ? (p.pricePerKg * (p.servingSizeG/1000)) : undefined;
    const proteinPerServing = (isFinite(p.proteinPer100g) && isFinite(p.servingSizeG)) ? (p.proteinPer100g * (p.servingSizeG/100)) : undefined;
    return { ...p, pricePerServing, proteinPerServing };
  }

  function persist(){
    const payload = { items: state.items, prefs: { sort: state.sort, veganOnly: state.veganOnly, typeFilter: state.typeFilter, showExtended: state.showExtended } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    history.replaceState(null, '', linkFor(itemsToShareIds(state.items)));
  }
  function hydrateFromUrlOrStorage(){
    const url = new URL(location.href);
    const cmp = url.searchParams.get('cmp');
    if (!cmp) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          state.items = (saved.items || []).map(computeDerived);
          Object.assign(state, saved.prefs || {});
          document.getElementById('veganOnly').checked = !!state.veganOnly;
          document.getElementById('typeFilter').value = state.typeFilter || '';
          document.getElementById('toggleExtended').checked = !!state.showExtended;
        } catch(e){}
      }
    }
  }
  function itemsToShareIds(items){ return items.map(i=>i.id).join(','); }
  function linkFor(idsCSV){ const url=new URL(location.href); if(idsCSV) url.searchParams.set('cmp', idsCSV); else url.searchParams.delete('cmp'); return url.toString(); }
  async function shareLink(){
    const link = linkFor(itemsToShareIds(state.items));
    try { await navigator.clipboard.writeText(link); toast('Share link copied'); }
    catch { prompt('Copy this link', link); }
  }
  function toggleExtendedCols(){ const show = state.showExtended; document.querySelectorAll('.ext').forEach(el=>{ el.style.display = show ? '' : 'none'; }); }
  function toast(msg){
    const t=document.createElement('div'); t.textContent=msg;
    Object.assign(t.style,{position:'fixed',bottom:'18px',left:'50%',transform:'translateX(-50%)',
      background:'rgba(17,24,39,.95)',color:'#fff',padding:'10px 14px',borderRadius:'12px',fontSize:'14px',
      boxShadow:'0 8px 30px rgba(0,0,0,.25)',zIndex:9999}); document.body.appendChild(t); setTimeout(()=>t.remove(),1400);
  }
  function loadDemo(){
    const demo=[{id:'mp-impact-whey',brand:'MyProtein',product:'Impact Whey',type:'Whey',pricePerKg:25,servingSizeG:30,proteinPer100g:82,caloriesPerServing:120,carbsPerServing:4,fatPerServing:1.8,sweeteners:'Sucralose',allergens:'Milk, Soy Lecithin',origin:'EU',rating:4.4},
                {id:'on-gold-standard',brand:'Optimum Nutrition',product:'Gold Standard',type:'Whey',pricePerKg:32,servingSizeG:30,proteinPer100g:79,caloriesPerServing:120,carbsPerServing:3,fatPerServing:1.5,sweeteners:'Sucralose',allergens:'Milk, Soy Lecithin',origin:'USA',rating:4.6},
                {id:'bulk-vegan',brand:'Bulk',product:'Vegan Protein Powder',type:'Vegan',pricePerKg:28,servingSizeG:35,proteinPer100g:77,caloriesPerServing:134,carbsPerServing:2.3,fatPerServing:2.4,sweeteners:'Stevia',allergens:'None',origin:'EU',rating:4.3}];
    const existing = new Set(state.items.map(i=>i.id)); demo.forEach(d=>{ if(!existing.has(d.id)) window.Compare.add(d); });
  }
})();