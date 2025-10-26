// Finds elements with data-include="/path/to/file.html" and injects the file
(async function () {
  const slots = document.querySelectorAll("[data-include]");
  await Promise.all(
    [...slots].map(async (el) => {
      const url = el.getAttribute("data-include");
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(res.statusText);
        el.innerHTML = await res.text();
      } catch (e) {
        el.innerHTML = `<div style="color:#b00">Failed to load ${url}</div>`;
      }
    })
  );
})();
