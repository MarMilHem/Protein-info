// /functions/search.js
export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  // --- MVP catalog (extend freely) ---
  const CATALOG = [
    {
      id: "mp-impact-whey",
      brand: "MyProtein",
      product: "Impact Whey",
      type: "Whey",
      pricePerKg: 25,
      servingSizeG: 30,
      proteinPer100g: 82,
      caloriesPerServing: 120,
      carbsPerServing: 4,
      fatPerServing: 1.8
    },
    {
      id: "on-gold-standard",
      brand: "Optimum Nutrition",
      product: "Gold Standard Whey",
      type: "Whey",
      pricePerKg: 32,
      servingSizeG: 30,
      proteinPer100g: 79,
      caloriesPerServing: 120,
      carbsPerServing: 3,
      fatPerServing: 1.5
    },
    {
      id: "bulk-vegan",
      brand: "Bulk",
      product: "Vegan Protein Powder",
      type: "Vegan",
      pricePerKg: 28,
      servingSizeG: 35,
      proteinPer100g: 77,
      caloriesPerServing: 134,
      carbsPerServing: 2.3,
      fatPerServing: 2.4
    },
    {
      id: "dym-iso100",
      brand: "Dymatize",
      product: "ISO100",
      type: "Isolate",
      pricePerKg: 40,
      servingSizeG: 30,
      proteinPer100g: 84,
      caloriesPerServing: 110,
      carbsPerServing: 2,
      fatPerServing: 0.5
    }
  ];

  // simple fuzzy-ish filter on brand/product/type
  const results = CATALOG.filter(p => {
    if (!q) return true;
    const hay = `${p.brand} ${p.product} ${p.type}`.toLowerCase();
    return hay.includes(q);
  });

  return new Response(JSON.stringify({ results }), {
    headers: { "content-type": "application/json" }
  });
}
