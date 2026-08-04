async function check(url, label) {
  const res = await fetch(url, { cache: "no-store" })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch {
    console.log(label, "NOT_JSON", res.status, text.slice(0, 100))
    return
  }
  console.log(label, res.status, "cc="+res.headers.get("cache-control"), "updatedAt="+j.updatedAt, "count="+j.items?.length, "top="+j.items?.[0]?.title)
}
const t = Date.now()
await check("https://raw.githubusercontent.com/tornukdernek1/tornuk-dernegi/gh-pages/data/duyurular.json?t="+t, "RAW")
await check("https://tornukdernek1.github.io/tornuk-dernegi/data/duyurular.json?t="+t, "PAGES")
