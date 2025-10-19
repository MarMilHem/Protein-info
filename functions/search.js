export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get("q");

  if (!q) {
    return new Response(JSON.stringify({ error: "Missing query" }), {
      status: 400,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
    });
  }

  try {
    const endpoint = `https://serpapi.com/search.json?q=${encodeURIComponent(q + " protein brand")}&api_key=${env.SERP_KEY}`;
    const resp = await fetch(endpoint);
    const data = await resp.json();

    const results = (data.organic_results || []).map(r => ({
      name: r.title,
      url: r.link,
      snippet: r.snippet,
      displayUrl: r.displayed_link
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Search failed", detail: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
    });
  }
}
