/* L'Épicerie Girard — logique de l'app (à partir de la trousse « Simplement L'Épicerie ») */
const SUPABASE_URL = "https://xvgzlvozhexqgydmkqlk.supabase.co"; // Projet Supabase epicerie-girard (Canada Central)
const SUPABASE_KEY = "sb_publishable_a8PrgQJAnsh2Egf-McB2BQ_d_YMx8yt"; // Clé « publishable » (publique) : sans le code de famille, elle ne donne accès à rien. JAMAIS la clé secret ici
const CODE_KEY = "epicerie-code";

const CATS = ["Fruits et légumes","Boulangerie","Viandes et poissons","Produits laitiers et œufs","Garde-manger","Surgelés","Boissons","Collations","Ménager","Soins personnels","Autre"];
const GUESS = {
  "Fruits et légumes":"pomme banane orange citron fraise bleuet raisin poire melon avocat tomate patate pomme de terre carotte oignon ail laitue salade concombre poivron brocoli chou céleri champignon courgette épinard légume fruit lime mangue ananas",
  "Boulangerie":"pain baguette bagel muffin croissant tortilla pita brioche",
  "Viandes et poissons":"poulet boeuf bœuf porc jambon bacon saucisse steak viande haché dinde poisson saumon thon crevette côtelette",
  "Produits laitiers et œufs":"lait beurre fromage yogourt yaourt crème oeuf oeufs œuf œufs margarine cheddar mozzarella",
  "Garde-manger":"pâtes pate spaghetti macaroni riz farine sucre sel poivre huile vinaigre conserve soupe sauce ketchup moutarde mayonnaise céréales gruau arachide confiture épice bouillon café thé miel sirop",
  "Surgelés":"congelé surgelé frites pizza crème glacée glace",
  "Boissons":"jus liqueur boisson eau bière vin",
  "Collations":"chips biscuit croustille barre chocolat bonbon popcorn noix craquelin",
  "Ménager":"papier toilette essuie-tout savon vaisselle détergent lessive sac poubelle javel nettoyant",
  "Soins personnels":"shampoing dentifrice brosse déodorant rasoir couche"
};
// Catégories Open Food Facts → nos catégories (le premier qui correspond gagne)
const OFF_MAP = [
  // « :mot » = le début d'une étiquette (ex. « en:beverages »), pour ne pas confondre
  // « plant-based-foods-and-beverages » (beurre d'arachide) avec une boisson
  [/:(frozen[\w-]*)\b/, "Surgelés"],
  [/:(beverages|drinks|waters|juices|sodas|coffees|teas)\b/, "Boissons"],
  [/:(dairies|dairy|cheeses|milks|yogurts|butters|eggs|creams)\b/, "Produits laitiers et œufs"],
  [/:(meats|poultry|fishes|seafood|hams|sausages)\b/, "Viandes et poissons"],
  [/:(breads|bakery|viennoiseries|tortillas|bagels)\b/, "Boulangerie"],
  [/:(fruits|vegetables|fresh-fruits|fresh-vegetables)\b/, "Fruits et légumes"],
  [/:(snacks|sweet-snacks|salty-snacks|chips|biscuits|cookies|chocolates|candies|confectioneries)\b/, "Collations"],
  [/:(cleaning|household|detergents)\b/, "Ménager"],
  [/:(hygiene|cosmetics|toothpastes|shampoos)\b/, "Soins personnels"],
  [/./, "Garde-manger"]
];

const $ = id => document.getElementById(id);
const norm = s => String(s ?? "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function guess(name){ const n = norm(name); for (const c in GUESS) for (const w of GUESS[c].split(" ")) if (w.length > 2 && n.includes(norm(w))) return c; return "Autre"; }
let toastT; function toast(t){ const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2800); }
function getCode(){ try { return localStorage.getItem(CODE_KEY) || ""; } catch(e){ return ""; } }
function setCode(c){ try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch(e){} }

/* ---------- Serveur ---------- */
async function rpc(fn, body){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
let code = getCode();
const api = (action, args = {}) => rpc("api", { p_code: code, p_action: action, p_args: args });

/* ---------- État ---------- */
const data = { family: "", items: [], staples: [], meals: [] };
let loaded = false, curTab = "list", busy = 0;

async function refresh(){
  if (!code || busy) return;
  try {
    const r = await api("state");
    if (!r.ok){ if (r.error === "mauvais_code"){ logout("Ce code de famille ne marche plus."); } return; }
    if (busy) return; // un changement est parti pendant la lecture : on attend le prochain tour
    Object.assign(data, { family: r.family, items: r.items, staples: r.staples, meals: r.meals });
    loaded = true; $("offline").hidden = true; renderAll();
  } catch(e){ $("offline").hidden = false; }
}
const apiRepas = (action, args = {}) => rpc("api_repas", { p_code: code, p_action: action, p_args: args });
const apiItem = (action, args = {}) => rpc("api_item", { p_code: code, p_action: action, p_args: args });
const apiSpecial = (action, args = {}) => rpc("api_special", { p_code: code, p_action: action, p_args: args });
async function act(action, args, optimistic, fn = api){
  if (optimistic){ optimistic(); renderAll(); }
  busy++;
  try {
    const r = await fn(action, args);
    if (!r.ok) toast("Pas pu enregistrer. Réessaie.");
    return r;
  } catch(e){ $("offline").hidden = false; toast("Pas de connexion. Réessaie."); return { ok:false }; }
  finally { busy--; refresh(); }
}
// meal (optionnel) = { id, name } : retient pour quel repas l'article est sur la liste
// deal (optionnel) = { store, label, price, to } : retient où l'acheter en spécial
async function addToList(name, qty, cat, meal, deal){
  const dup = data.items.find(i => !i.done && norm(i.name) === norm(name));
  if (deal){
    const r = await act("item_add", { name, qty: qty || "", cat: cat || guess(name), deal }, () => {
      if (dup) dup.deal = deal;
      else data.items.push({ id: "tmp" + Date.now(), name, qty: qty || "", cat: cat || guess(name), done: false, meals: [], deal });
    }, apiSpecial);
    return !dup && r.ok && !r.dup;
  }
  if (dup && !meal) return false;
  const args = { name, qty: qty || "", cat: cat || guess(name) };
  if (!meal){
    const r = await act("item_add", args,
      () => data.items.push({ id: "tmp" + Date.now(), name, qty: qty || "", cat: cat || guess(name), done: false, meals: [] }));
    return r.ok && !r.dup;
  }
  const r = await act("item_add", { ...args, meal }, () => {
    if (dup){ dup.meals = dup.meals || []; if (!dup.meals.some(x => x.id === meal.id)) dup.meals.push(meal); }
    else data.items.push({ id: "tmp" + Date.now(), name, qty: qty || "", cat: cat || guess(name), done: false, meals: [meal], from_meal: true });
  }, apiRepas);
  return !dup && r.ok && !r.dup;
}
function dealTag(i){
  const d = i.deal; if (!d || !d.label) return "";
  const fini = d.to && Date.parse(d.to) < Date.now();
  const fin = d.to && !fini ? " · jusqu'au " + new Date(d.to).toLocaleDateString("fr-CA", { day: "numeric", month: "short" }) : "";
  return `<span class="where ${fini ? "fini" : ""}"><span class="chip ${esc(d.store)}">${esc(d.label)}</span>${fini ? "spécial terminé" : esc(d.price || "") + esc(fin)}</span>`;
}
// Est-ce que la famille a déjà cet ingrédient? (marqué « J'en ai » dans Avant de partir)
const words = t => norm(t).replace(/['’]/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 1 || w === "d" || w === "a").map(w => w.length > 3 ? w.replace(/(s|x)$/, "") : w);
// Un nom commence par l'autre, sans que la suite en fasse un autre produit :
// « Lait » = « Lait 2 % (Natrel) », mais « Beurre » ≠ « Beurre d'arachide »
const LINK = new Set(["d","de","du","de","a","au","aux","en","sans","pour"]);
function sameStart(a, b){
  if (!a.length || !b.length) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (!s.every((w, k) => l[k] === w)) return false;
  return l.length === s.length || !LINK.has(l[s.length]);
}
function atHome(name){
  const iw = words(name);
  return data.staples.find(st => { if (st.status !== "ok") return false;
    const sw = words(String(st.name).replace(/\([^)]*\)/g, " "));
    return sameStart(iw, sw); }) || null;
}
const mealsOf = i => Array.isArray(i.meals) ? i.meals : [];
// Repas choisis = les repas qui ont encore au moins un ingrédient sur la liste
function plannedMeals(){
  const map = new Map();
  for (const i of data.items) for (const m of mealsOf(i)){
    const p = map.get(m.id) || { id: m.id, name: (data.meals.find(x => x.id === m.id) || m).name, left: 0, total: 0 };
    p.total++; if (!i.done) p.left++; map.set(m.id, p);
  }
  return [...map.values()].sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
}

/* ---------- Rendu ---------- */
function renderHead(){
  const total = data.items.length, done = data.items.filter(i => i.done).length;
  $("count").textContent = !loaded ? "Chargement…" : total ? `${total} article${total>1?"s":""} sur la liste · ${done} dans le panier` : "La liste est vide";
  $("prog").style.width = total ? (done/total*100) + "%" : "0";
}
function renderList(){
  const its = data.items, done = its.filter(i => i.done).length;
  $("clearZone").hidden = !done;
  if (!loaded){ $("list").innerHTML = ""; return; }
  if (!its.length){ $("list").innerHTML = `<p class="empty">Ajoute un article en bas, scanne un code-barres,<br>ou passe par « Avant de partir » et « Repas ».</p>`; return; }
  const pm = plannedMeals();
  const planned = pm.length ? `<section class="planned"><h2><span>Repas choisis</span><span>${pm.length}</span></h2><ul class="box">${pm.map(p => `
    <li><span class="name"><b>${esc(p.name)}</b><span class="qty">${p.left ? `${p.left} ingrédient${p.left>1?"s":""} à acheter` : "tout est dans le panier ✓"}</span></span>
    <button class="btn sm ghost" type="button" data-unplan="${esc(p.id)}">Retirer</button></li>`).join("")}</ul></section>` : "";
  $("list").innerHTML = planned + CATS.filter(c => its.some(i => (CATS.includes(i.cat) ? i.cat : "Autre") === c)).map(c => {
    const g = its.filter(i => (CATS.includes(i.cat) ? i.cat : "Autre") === c).sort((a,b) => a.done - b.done);
    const left = g.filter(i => !i.done).length;
    return `<section><h2><span>${c}</span><span>${left || "✓"}</span></h2><ul class="box">${g.map(i => `
      <li class="${i.done ? "done" : ""}"><label><input class="chk" type="checkbox" data-id="${esc(i.id)}" ${i.done ? "checked" : ""}>
      <span class="name">${esc(i.name)}${dealTag(i)}${mealsOf(i).length ? `<span class="for">pour : ${mealsOf(i).map(m => esc((data.meals.find(x => x.id === m.id) || m).name)).join(", ")}</span>` : ""}</span></label>
      <button class="qtyb ${i.qty ? "" : "vide"}" type="button" data-q="${esc(i.id)}" aria-label="Quantité de ${esc(i.name)} : ${esc(i.qty || "aucune")}">${i.qty ? esc(i.qty) : "Qté"}</button>
      <button class="del" type="button" data-del="${esc(i.id)}" aria-label="Enlever ${esc(i.name)}">×</button></li>`).join("")}</ul></section>`;
  }).join("");
}
function renderInv(){
  if (!loaded){ $("inv").innerHTML = ""; return; }
  const st = [...data.staples].sort((a,b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || norm(a.name).localeCompare(norm(b.name)));
  if (!st.length){ $("inv").innerHTML = `<p class="empty">Ajoute les produits que tu veux vérifier avant chaque épicerie.</p>`; return; }
  const left = st.filter(s => !s.status).length;
  $("inv").innerHTML = `<section><h2><span>Produits de base</span><span>${left ? left + " à vérifier" : "Vérification finie ✓"}</span></h2><ul class="box inv">${st.map(s => `
    <li><span class="name">${esc(s.name)}</span><span class="seg">
      <button type="button" class="have" data-st="${esc(s.id)}" data-v="ok" aria-pressed="${s.status === "ok"}">J'en ai</button>
      <button type="button" class="need" data-st="${esc(s.id)}" data-v="manque" aria-pressed="${s.status === "manque"}">Manque</button>
    </span><button class="del" type="button" data-sdel="${esc(s.id)}" aria-label="Retirer ${esc(s.name)} des produits de base">×</button></li>`).join("")}</ul></section>`;
}
function renderMeals(){
  if (!loaded){ $("meals").innerHTML = ""; return; }
  const open = new Set([...document.querySelectorAll(".meal[open]")].map(d => d.dataset.id));
  const ms = [...data.meals].sort((a,b) => norm(a.name).localeCompare(norm(b.name)));
  if (!ms.length){ $("meals").innerHTML = `<p class="empty">Ta banque de repas est vide.<br>Appuie sur « Nouveau repas » pour commencer.</p>`; return; }
  const onList = new Set(plannedMeals().map(p => p.id));
  $("meals").innerHTML = ms.map(m => { const ing = Array.isArray(m.ingredients) ? m.ingredients : [];
    return `<details class="meal" data-id="${esc(m.id)}" ${open.has(m.id) ? "open" : ""}><summary><b>${esc(m.name)}</b><span>${onList.has(m.id) ? `<i class="onlist">Sur la liste</i>` : ""}${ing.length} ingrédient${ing.length>1?"s":""}</span></summary><div class="body">
      <div class="row" style="margin-top:14px"><button class="btn pri sm" type="button" data-cook="${esc(m.id)}">Ajouter les ingrédients à la liste</button></div>
      <h3>Ingrédients</h3><ul>${ing.map((x, k) => { const h = atHome(x.name);
        return `<li class="${h ? "home" : ""}">${esc(x.name)}${x.qty ? ` <span class="qty">${esc(x.qty)}</span>` : ""}${h ? ` <span class="athome">à la maison</span> <button class="linkbtn" type="button" data-anyway="${esc(m.id)}" data-k="${k}">ajouter quand même</button>` : ""}</li>`; }).join("") || "<li>Aucun</li>"}</ul>
      ${m.recipe ? `<h3>Recette</h3><p class="recipe">${esc(m.recipe)}</p>` : ""}
      <div class="row"><button class="btn sm" type="button" data-medit="${esc(m.id)}">Modifier</button><button class="btn sm warnb" type="button" data-mdel="${esc(m.id)}">Supprimer</button></div>
    </div></details>`; }).join("");
}
function renderAll(){
  renderHead(); renderList(); renderInv();
  if (!document.activeElement || !$("p-meals").contains(document.activeElement)) renderMeals();
}

/* ---------- Entrée / sortie ---------- */
function showApp(){ $("login").hidden = true; $("app").hidden = false; loaded = false; renderAll(); refresh(); }
function logout(msg){ setCode(""); code = ""; $("app").hidden = true; $("login").hidden = false;
  // Le nom de famille sert de « nom d'utilisateur » pour le trousseau iCloud; le code n'est jamais réaffiché
  if (data.family && !$("joinUser").value) $("joinUser").value = data.family; $("joinCode").value = "";
  if (msg){ $("joinErr").textContent = msg; $("joinErr").hidden = false; } }
$("joinForm").addEventListener("submit", async e => {
  e.preventDefault(); const c = $("joinCode").value.trim(); $("joinErr").hidden = true;
  try { const r = await rpc("api", { p_code: c, p_action: "state", p_args: {} });
    if (!r.ok){ $("joinErr").textContent = "Ce code ne correspond à aucune famille. Vérifie les lettres et les tirets."; $("joinErr").hidden = false; return; }
    code = c; setCode(c); showApp();
  } catch(err){ $("joinErr").textContent = "Pas de connexion. Réessaie."; $("joinErr").hidden = false; }
});
$("createForm").addEventListener("submit", async e => {
  e.preventDefault(); const c = $("newCode").value.trim(); $("createErr").hidden = true;
  try { const r = await rpc("create_family", { p_code: c, p_name: $("famName").value.trim() });
    if (!r.ok){ $("createErr").textContent = r.error === "code_court" ? "Le code doit avoir au moins 8 caractères." : "Ce code est déjà pris. Choisis-en un autre."; $("createErr").hidden = false; return; }
    code = c; setCode(c); showApp(); toast("Liste créée! Donne le code à la famille.");
  } catch(err){ $("createErr").textContent = "Pas de connexion. Réessaie."; $("createErr").hidden = false; }
});
$("logout").onclick = () => logout();

/* ---------- Onglets ---------- */
document.querySelector(".tabs").addEventListener("click", e => {
  const t = e.target.dataset.tab; if (!t) return; curTab = t;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  ["list","inv","meals","deals"].forEach(k => $("p-" + k).hidden = k !== t);
  $("addBar").hidden = t !== "list"; window.scrollTo(0, 0);
});

/* ---------- Liste ---------- */
const catOptions = CATS.map(c => `<option>${c}</option>`).join("");
$("cat").innerHTML = '<option value="">Catégorie : je devine pour toi</option>' + catOptions;
$("fCat").innerHTML = catOptions;
$("form").addEventListener("submit", async e => {
  e.preventDefault(); const n = $("item").value.trim(); if (!n) return;
  const q = $("qty").value.trim(), c = $("cat").value || guess(n);
  $("item").value = ""; $("qty").value = ""; $("cat").value = ""; $("item").focus();
  if (!(await addToList(n, q, c))) toast(`${n} est déjà sur la liste`);
});
$("list").addEventListener("change", e => { const id = e.target.dataset.id; if (!id) return; const v = e.target.checked;
  act("item_done", { id, done: v }, () => { const it = data.items.find(i => i.id === id); if (it) it.done = v; }); });
$("list").addEventListener("click", e => {
  const up = e.target.dataset.unplan;
  if (up){
    if (!e.target.dataset.sure){ e.target.dataset.sure = "1"; e.target.textContent = "Retirer ses ingrédients?"; e.target.classList.add("warnb"); return; }
    const p = plannedMeals().find(x => x.id === up); const meal = { id: up, name: p ? p.name : "" };
    act("unplan", { meal }, () => {
      data.items.forEach(i => { if (!i.done) i.meals = mealsOf(i).filter(m => m.id !== up); });
      data.items = data.items.filter(i => i.done || !i.from_meal || mealsOf(i).length);
    }, apiRepas);
    toast(`${meal.name || "Repas"} retiré de la liste`); return;
  }
  const qb = e.target.closest("[data-q]"); if (qb){ openQty(qb.dataset.q); return; }
  const id = e.target.dataset.del; if (!id) return;
  act("item_del", { id }, () => { data.items = data.items.filter(i => i.id !== id); }); });
$("clearBtn").onclick = () => { $("confirm").hidden = false; $("clearBtn").hidden = true; };
$("no").onclick = () => { $("confirm").hidden = true; $("clearBtn").hidden = false; };
$("yes").onclick = () => { $("confirm").hidden = true; $("clearBtn").hidden = false;
  act("items_clear_done", {}, () => { data.items = data.items.filter(i => !i.done); }); };

/* ---------- Avant de partir ---------- */
$("inv").addEventListener("click", async e => {
  const sd = e.target.dataset.sdel;
  if (sd){ act("staple_del", { id: sd }, () => { data.staples = data.staples.filter(s => s.id !== sd); }); return; }
  const id = e.target.dataset.st; if (!id) return;
  const s = data.staples.find(x => x.id === id); if (!s) return;
  const v = s.status === e.target.dataset.v ? "" : e.target.dataset.v;
  await act("staple_status", { id, status: v }, () => { s.status = v; });
  if (v === "manque"){ const added = await addToList(s.name, "", s.cat); toast(added ? `${s.name} ajouté à la liste` : `${s.name} est déjà sur la liste`); }
});
$("invReset").onclick = () => { act("staples_reset", {}, () => data.staples.forEach(s => s.status = "")); toast("Prêt pour une nouvelle vérification"); };
function addStaple(n, cat){
  n = String(n || "").trim(); if (!n) return false;
  if (data.staples.some(s => norm(s.name) === norm(n))){ toast(`${n} est déjà dans tes produits de base`); return false; }
  const c = cat || guess(n);
  act("staple_add", { name: n, cat: c }, () => data.staples.push({ id: "tmp" + Date.now(), name: n, cat: c, status: "" }));
  toast(`${n} ajouté aux produits de base`); return true;
}
$("stapleForm").addEventListener("submit", e => {
  e.preventDefault(); const n = $("stapleName").value.trim(); if (!n) return;
  if (addStaple(n)){ $("stapleName").value = ""; hideSugg(); }
});
$("stapleScan").onclick = () => startScan("staple");

/* Suggestions de marques pendant qu'on tape (Open Food Facts, produits vendus au Canada) */
const suggCache = new Map(); let suggT = null, suggSeq = 0, suggList = [];
function hideSugg(){ $("sugg").hidden = true; $("sugg").innerHTML = ""; suggList = []; }
async function searchProducts(q){
  const k = norm(q); if (suggCache.has(k)) return suggCache.get(k);
  const j = await fetchJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&tagtype_0=countries&tag_contains_0=contains&tag_0=canada&fields=code,product_name_fr,product_name,brands,quantity,categories_tags&sort_by=unique_scans_n`, 7000);
  let prods = j ? (j.products || []) : null, fallbackCat = null;
  if (!prods || prods.length < 3){
    // Pas assez d'aliments : on regarde les produits ménagers et de soins vendus au Canada
    const q2 = `search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=8&tagtype_0=countries&tag_contains_0=contains&tag_0=canada&fields=code,product_name_fr,product_name,brands,quantity`;
    const [h, c] = await Promise.all([fetchJSON(`https://world.openproductsfacts.org/cgi/search.pl?${q2}`, 6000), fetchJSON(`https://world.openbeautyfacts.org/cgi/search.pl?${q2}`, 6000)]);
    const extra = [...((h && h.products) || []).map(p => ({ ...p, _cat: "Ménager" })), ...((c && c.products) || []).map(p => ({ ...p, _cat: "Soins personnels" }))];
    if (!prods && !h && !c) return null;
    prods = [...(prods || []), ...extra];
  }
  const seen = new Set(), out = [];
  for (const p of prods){
    const name = String(p.product_name_fr || p.product_name || "").trim(); if (!name) continue;
    const brand = String(p.brands || "").split(",")[0].trim();
    const full = brand && !norm(name).includes(norm(brand)) ? `${name} (${brand})` : name;
    if (seen.has(norm(full))) continue; seen.add(norm(full));
    const tags = (p.categories_tags || []).join(" ");
    out.push({ name: full, brand, size: p.quantity || "", code: p.code || "", cat: p._cat || (tags ? OFF_MAP.find(([re]) => re.test(tags))[1] : guess(name)) });
    if (out.length >= 8) break;
  }
  suggCache.set(k, out); return out;
}
$("stapleName").addEventListener("input", () => {
  clearTimeout(suggT); const q = $("stapleName").value.trim();
  if (q.length < 3){ hideSugg(); return; }
  suggT = setTimeout(async () => {
    const my = ++suggSeq; $("sugg").hidden = false; $("sugg").innerHTML = `<div class="sugg-msg">Je cherche des marques…</div>`;
    const r = await searchProducts(q); if (my !== suggSeq) return;
    if (r === null){ $("sugg").innerHTML = `<div class="sugg-msg">Pas de suggestions pour l'instant. Appuie sur « Ajouter » pour le nom tel quel.</div>`; return; }
    if (!r.length){ $("sugg").innerHTML = `<div class="sugg-msg">Aucune marque trouvée. Appuie sur « Ajouter » pour le nom tel quel.</div>`; return; }
    suggList = r;
    $("sugg").innerHTML = r.map((p, k) => `<button type="button" class="sugg-it" data-sg="${k}"><span>${esc(p.name)}</span>${p.size ? `<small>${esc(p.size)}</small>` : ""}</button>`).join("");
  }, 600);
});
$("sugg").addEventListener("click", e => { const b = e.target.closest("[data-sg]"); if (!b) return;
  const p = suggList[Number(b.dataset.sg)]; if (!p) return;
  if (addStaple(p.name, p.cat)){
    if (p.code) api("product_save", { barcode: p.code, name: p.name, cat: p.cat }).catch(() => {});
    $("stapleName").value = ""; hideSugg(); }
});

/* ---------- Repas ---------- */
let editing = null;
const parseIng = t => t.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
  const k = l.indexOf(","); const name = (k < 0 ? l : l.slice(0, k)).trim(); const qty = k < 0 ? "" : l.slice(k + 1).trim();
  return { name, qty, cat: guess(name) }; });
function openForm(m){ editing = m?.id || null; $("mealForm").hidden = false; $("newMeal").hidden = true;
  $("mName").value = m?.name || ""; $("mIng").value = (m?.ingredients || []).map(x => x.qty ? `${x.name}, ${x.qty}` : x.name).join("\n");
  $("mRec").value = m?.recipe || ""; $("mName").focus(); }
function closeForm(){ editing = null; $("mealForm").hidden = true; $("newMeal").hidden = false; renderMeals(); }
$("newMeal").onclick = () => openForm(null);
$("cancelMeal").onclick = closeForm;
$("mealForm").addEventListener("submit", async e => {
  e.preventDefault(); const name = $("mName").value.trim(); if (!name) return;
  const r = await act("meal_save", { id: editing || "", name, ingredients: parseIng($("mIng").value), recipe: $("mRec").value.trim() });
  if (r.ok){ closeForm(); toast("Repas enregistré"); }
});
$("meals").addEventListener("click", async e => {
  const t = e.target.dataset;
  if (t.cook){ const m = data.meals.find(x => x.id === t.cook); if (!m) return; let a = 0, s = 0, h = 0;
    for (const x of m.ingredients || []){
      if (atHome(x.name)){ h++; continue; }
      if (await addToList(x.name, x.qty, x.cat, { id: m.id, name: m.name })) a++; else s++; }
    toast(`${a} ajouté${a>1?"s":""} à la liste${h ? ` · ${h} déjà à la maison` : ""}${s ? ` · ${s} déjà dessus` : ""}`); }
  if (t.anyway){ const m = data.meals.find(x => x.id === t.anyway); const x = m && (m.ingredients || [])[Number(t.k)]; if (!x) return;
    toast((await addToList(x.name, x.qty, x.cat, { id: m.id, name: m.name })) ? `${x.name} ajouté à la liste` : `${x.name} est déjà sur la liste`); }
  if (t.medit){ openForm(data.meals.find(x => x.id === t.medit)); window.scrollTo(0, 0); }
  if (t.mdel){ if (e.target.dataset.sure){ act("meal_del", { id: t.mdel }, () => { data.meals = data.meals.filter(x => x.id !== t.mdel); }); }
    else { e.target.dataset.sure = "1"; e.target.textContent = "Appuie encore pour supprimer"; } }
});

/* ---------- Scanner de code-barres ---------- */
// Vérifie la clé de contrôle d'un EAN-8 / UPC-A / EAN-13 (évite les mauvaises lectures)
function validCode(c){
  if (!/^\d{8}$|^\d{12,14}$/.test(c)) return false;
  const d = c.split("").map(Number), chk = d.pop();
  let sum = 0; d.reverse().forEach((n, i) => sum += n * (i % 2 === 0 ? 3 : 1));
  return (10 - sum % 10) % 10 === chk;
}
let stream = null, track = null, detector = null, loopOn = false, h5 = null, lastCode = "", hits = {}, taken = false;
let scanFor = "list";
async function startScan(target){
  if (typeof target === "string") scanFor = target;
  $("foundSheet").hidden = true; $("scanSheet").hidden = false; $("manualCode").value = "";
  $("scanMsg").textContent = "Tiens le produit à environ 20 cm. Le code se lit tout seul.";
  $("torchBtn").hidden = true; $("zoomWrap").hidden = true; hits = {}; taken = false;
  // 1) Lecteur intégré au téléphone (Android/Chrome) : le plus rapide
  if ("BarcodeDetector" in window){
    try {
      const fmts = await BarcodeDetector.getSupportedFormats();
      if (fmts.includes("ean_13")){
        detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e"].filter(f => fmts.includes(f)) });
        await openCamera(); $("scanVideo").hidden = false; $("reader").hidden = true;
        loopOn = true; detectLoop(); return;
      }
    } catch(e){ await closeCamera(); if (camBlocked(e)) return; }
  }
  // 2) Sinon (iPhone) : lecteur de secours
  $("scanVideo").hidden = true; $("reader").hidden = false;
  if (typeof Html5Qrcode === "undefined"){ $("scanMsg").textContent = "Le scanner n'a pas pu se charger. Tape les chiffres plus bas."; return; }
  try {
    h5 = h5 || new Html5Qrcode("reader", { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E], verbose: false });
    await h5.start({ facingMode: "environment" },
      { fps: 15, qrbox: (w, h) => ({ width: Math.floor(w * 0.82), height: Math.floor(h * 0.32) }),
        videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: "continuous" }] } },
      txt => accept(txt), () => {});
    try { track = h5.getRunningTrack(); setupTools(); } catch(e){}
  } catch(e){ camBlocked(e); }
}
function camBlocked(e){
  if (e && (e.name === "NotAllowedError" || /permission/i.test(String(e)))){
    $("scanMsg").textContent = "La caméra est bloquée. Autorise la caméra pour ce site dans le navigateur, ou tape les chiffres plus bas."; return true; }
  $("scanMsg").textContent = "La caméra n'a pas démarré. Tape les chiffres plus bas."; return false;
}
async function openCamera(){
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
    facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 },
    advanced: [{ focusMode: "continuous" }] } });
  const v = $("scanVideo"); v.srcObject = stream; await v.play();
  track = stream.getVideoTracks()[0]; setupTools();
}
function setupTools(){
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  const adv = {};
  if (caps.focusMode && caps.focusMode.includes("continuous")) adv.focusMode = "continuous";
  if (caps.zoom){ // un peu de zoom : on tient le produit plus loin, la caméra fait mieux le focus
    const z = Math.min(Math.max(2, caps.zoom.min), caps.zoom.max);
    adv.zoom = z; const r = $("zoomRange"); r.min = caps.zoom.min; r.max = Math.min(caps.zoom.max, 6); r.step = caps.zoom.step || 0.1; r.value = z;
    $("zoomWrap").hidden = false; }
  if (Object.keys(adv).length) track.applyConstraints({ advanced: [adv] }).catch(() => {});
  if (caps.torch){ $("torchBtn").hidden = false; $("torchBtn").setAttribute("aria-pressed", "false"); }
}
$("zoomRange").addEventListener("input", e => { if (track) track.applyConstraints({ advanced: [{ zoom: Number(e.target.value) }] }).catch(() => {}); });
$("torchBtn").onclick = () => { if (!track) return; const on = $("torchBtn").getAttribute("aria-pressed") !== "true";
  track.applyConstraints({ advanced: [{ torch: on }] }).then(() => $("torchBtn").setAttribute("aria-pressed", on)).catch(() => {}); };
async function detectLoop(){
  const v = $("scanVideo");
  while (loopOn){
    if (v.readyState >= 2){
      try { const res = await detector.detect(v); for (const r of res){ if (accept(r.rawValue)) return; } } catch(e){}
    }
    await new Promise(r => setTimeout(r, 60));
  }
}
// Accepte un code valide; s'il ne passe pas la vérification, il faut deux lectures identiques
function accept(raw){
  const c = String(raw || "").replace(/\D/g, ""); if (!c) return false;
  if (!validCode(c)){ hits[c] = (hits[c] || 0) + 1; if (hits[c] < 2) return false; }
  if (taken) return false; taken = true;
  $("scanSheet").querySelector(".cam-box").classList.add("hit");
  try { navigator.vibrate && navigator.vibrate(80); } catch(e){}
  setTimeout(() => onCode(c), 120); loopOn = false; return true;
}
async function closeCamera(){
  loopOn = false;
  try { if (h5 && h5.isScanning) await h5.stop(); } catch(e){}
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  track = null; $("scanSheet").querySelector(".cam-box").classList.remove("hit");
}
$("scanBtn").onclick = () => startScan("list");
$("scanClose").onclick = async () => { await closeCamera(); $("scanSheet").hidden = true; };
$("manualForm").addEventListener("submit", e => { e.preventDefault(); const c = $("manualCode").value.replace(/\D/g, "");
  if (c.length < 8){ toast("Tape tous les chiffres sous le code-barres"); return; } onCode(c); });

/* Recherche du produit : plusieurs banques gratuites, plusieurs formes du code */
function codeVariants(c){
  const v = new Set([c]);
  if (c.length === 12) v.add("0" + c);
  if (c.length === 13 && c[0] === "0") v.add(c.slice(1));
  if (c.length === 14 && c[0] === "0") { v.add(c.slice(1)); v.add(c.slice(2)); }
  return [...v];
}
const BANKS = ["https://world.openfoodfacts.org", "https://world.openproductsfacts.org", "https://world.openbeautyfacts.org"];
async function fetchJSON(url, ms = 6000){
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch(e){ return null; } finally { clearTimeout(t); }
}
async function lookupOpen(bank, code){
  const j = await fetchJSON(`${bank}/api/v2/product/${code}.json?fields=product_name_fr,product_name,product_name_en,generic_name_fr,generic_name,brands,quantity,categories_tags&lc=fr`);
  if (!j || j.status !== 1 || !j.product) return null;
  const p = j.product; const name = (p.product_name_fr || p.generic_name_fr || p.product_name || p.product_name_en || p.generic_name || "").trim();
  if (!name) return null;
  const tags = (p.categories_tags || []).join(" ");
  let cat = bank.includes("beauty") ? "Soins personnels" : bank.includes("products") ? "Ménager" : null;
  if (!cat) cat = tags ? OFF_MAP.find(([re]) => re.test(tags))[1] : guess(name);
  const brand = (p.brands || "").split(",")[0].trim();
  return { name: brand && !norm(name).includes(norm(brand)) ? `${name} (${brand})` : name, cat, size: p.quantity || "" };
}
async function lookupAll(code){
  const vars = codeVariants(code);
  // Les banques Open*Facts en parallèle; la première qui trouve gagne (dans l'ordre de préférence)
  const tries = BANKS.flatMap(b => vars.map(v => lookupOpen(b, v)));
  const res = await Promise.all(tries);
  const found = res.find(Boolean); if (found) return found;
  return null;
}
async function onCode(bc){
  await closeCamera(); lastCode = bc; $("scanSheet").hidden = true;
  $("foundTitle").textContent = "Je cherche le produit…"; $("foundHint").textContent = `Code-barres ${bc}`;
  $("fName").value = ""; $("fQty").value = ""; $("fCat").value = "Autre"; $("foundSheet").hidden = false;
  const st = scanFor === "staple";
  $("fQtyWrap").hidden = st; $("fGo").textContent = st ? "Ajouter aux produits de base" : "Ajouter à la liste";
  $("fNameLbl").textContent = st ? "Nom dans les produits de base" : "Nom sur la liste";
  let mine = null;
  try { for (const v of codeVariants(bc)){ const r = await api("product_get", { barcode: v }); if (r.ok && r.product){ mine = r.product; break; } } } catch(e){}
  if (mine){ $("foundTitle").textContent = "Déjà connu de la famille"; $("fName").value = mine.name; $("fCat").value = mine.cat; return; }
  const p = await lookupAll(bc);
  if (p){ $("foundTitle").textContent = "Produit trouvé"; $("foundHint").textContent = `Vérifie le nom avant de l'ajouter.${p.size ? " Format : " + p.size : ""}`;
    $("fName").value = p.name; $("fCat").value = CATS.includes(p.cat) ? p.cat : "Autre"; }
  else { $("foundTitle").textContent = "Produit inconnu"; $("foundHint").textContent = `Code ${bc}. Écris son nom une fois : la prochaine fois que quelqu'un le scanne, l'app va s'en souvenir.`;
    $("fName").focus(); }
}
$("foundForm").addEventListener("submit", async e => {
  e.preventDefault(); const name = $("fName").value.trim(); if (!name) return; const cat = $("fCat").value;
  $("foundSheet").hidden = true;
  api("product_save", { barcode: lastCode, name, cat }).catch(() => {});
  if (scanFor === "staple"){ addStaple(name, cat); return; }
  toast((await addToList(name, $("fQty").value.trim(), cat)) ? `${name} ajouté à la liste` : `${name} est déjà sur la liste`);
});
$("foundAgain").onclick = () => startScan();
$("foundCancel").onclick = () => { $("foundSheet").hidden = true; };

/* ---------- Spéciaux (circulaires via Flipp) ---------- */
const STORES = [
  { key: "maxi", label: "Maxi", re: /^maxi\b/i },
  { key: "iga", label: "IGA", re: /^iga\b/i },
  { key: "superc", label: "Super C", re: /^super\s*c\b/i },
  { key: "costco", label: "Costco", re: /^costco\b/i },
  // Noms vérifiés dans les réponses de Flipp (oct. 2026) : « Metro », « Provigo », « Walmart »
  { key: "metro", label: "Metro", re: /^metro\b/i },
  { key: "provigo", label: "Provigo", re: /^provigo\b/i },
  { key: "walmart", label: "Walmart", re: /^walmart\b/i }
];
const storeNames = STORES.slice(0, -1).map(s => s.label).join(", ") + " et " + STORES[STORES.length - 1].label;
const storeNamesOu = STORES.slice(0, -1).map(s => s.label).join(", ") + " ou " + STORES[STORES.length - 1].label;
$("storeNames").textContent = storeNames;
const REGION_KEY = "epicerie-region";
const DEFAULT_REGION = "G2G1P9"; // Code postal par défaut pour les circulaires (modifiable dans l'app)
let region = (() => { try { return localStorage.getItem(REGION_KEY) || DEFAULT_REGION; } catch(e){ return DEFAULT_REGION; } })();
$("regionTxt").textContent = region.slice(0, 3);
$("regionEdit").onclick = () => {
  const box = document.createElement("form"); box.className = "inline"; box.innerHTML = `<input class="f" id="regionIn" maxlength="7" placeholder="Code postal complet, ex. H2X 1Y4" aria-label="Code postal"><button class="btn" type="submit">OK</button>`;
  $("regionEdit").parentElement.after(box); $("regionEdit").hidden = true; $("regionIn").focus();
  box.addEventListener("submit", e => { e.preventDefault(); const v = $("regionIn").value.toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(v)){ toast("Écris un code postal complet, ex. H2X 1Y4"); return; }
    region = v; try { localStorage.setItem(REGION_KEY, v); } catch(err){} dealCache.clear(); flyerCache.clear();
    $("regionTxt").textContent = v.slice(0, 3); box.remove(); $("regionEdit").hidden = false; toast("Région changée"); });
};
const storeOf = m => STORES.find(s => s.re.test(m || ""));
const dealCache = new Map();
const cleanQuery = n => String(n).replace(/\([^)]*\)/g, " ").replace(/\d+([.,]\d+)?\s*(kg|g|lb|l|ml|oz|x)\b/gi, " ").replace(/\s+/g, " ").trim();
async function searchDeals(q){
  const key = region + "|" + norm(q); if (dealCache.has(key)) return dealCache.get(key);
  const j = await fetchJSON(`https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${region}&q=${encodeURIComponent(q)}`, 8000);
  if (!j) return null;
  const now = Date.now(), per = {};
  const out = [];
  for (const it of j.items || []){
    const st = storeOf(it.merchant_name); if (!st) continue;
    if (it.valid_to && Date.parse(it.valid_to) < now) continue;
    per[st.key] = (per[st.key] || 0) + 1; if (per[st.key] > 2) continue; // les 2 plus pertinents par magasin
    out.push({ store: st, name: it.name || "", price: it.current_price, pre: it.pre_price_text, post: it.post_price_text, story: it.sale_story, to: it.valid_to, img: it.clean_image_url || it.clipping_image_url });
  }
  out.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  dealCache.set(key, out); return out;
}
const priceText = d => [d.pre, d.price != null ? d.price.toFixed(2).replace(".", ",") + " $" : "", d.post].filter(Boolean).join(" ") || d.story || "Voir en magasin";
const endText = d => { if (!d.to) return ""; const t = new Date(d.to); return "jusqu'au " + t.toLocaleDateString("fr-CA", { weekday: "short", day: "numeric", month: "short" }); };
/* Fiche agrandie d'un spécial */
const zoomReg = [];
const zoomId = o => zoomReg.push(o) - 1;
function dealRow(d){
  return `<div class="deal zoomable" data-zoom="${zoomId({ store: d.store, name: d.name, price: priceText(d), meta: [endText(d), d.story && d.price != null ? d.story : ""].filter(Boolean).join(" · "), img: d.img, to: d.to })}">${d.img ? `<img src="${esc(d.img)}" alt="" loading="lazy">` : ""}<div class="dtxt">
    <div class="dname"><span class="chip ${d.store.key}">${d.store.label}</span>${esc(d.name)}</div>
    <div class="dmeta">${esc(endText(d))}${d.story && d.price != null ? " · " + esc(d.story) : ""}</div></div>
    <div class="dprice">${esc(priceText(d))}</div></div>`;
}
async function runDeals(){
  const items = data.items.filter(i => !i.done);
  if (!items.length){ $("dealsSummary").innerHTML = ""; $("deals").innerHTML = `<p class="empty">Ta liste est vide. Ajoute des articles, puis reviens ici.</p>`; return; }
  const btn = $("dealsGo"); btn.disabled = true; $("deals").innerHTML = ""; $("dealsSummary").innerHTML = "";
  const results = new Array(items.length); let done = 0, failed = 0;
  const queue = items.map((it, i) => [it, i]);
  async function worker(){ while (queue.length){ const [it, i] = queue.shift();
    const r = await searchDeals(cleanQuery(it.name)); if (r === null) failed++; results[i] = r || [];
    done++; $("dealsStatus").textContent = `${done} / ${items.length} articles vérifiés…`; } }
  await Promise.all([worker(), worker(), worker(), worker()]);
  btn.disabled = false;
  if (failed === items.length){ $("dealsStatus").textContent = ""; $("deals").innerHTML = `<p class="empty">Je n'arrive pas à rejoindre les circulaires. Vérifie ta connexion et réessaie.</p>`; return; }
  $("dealsStatus").textContent = `Mis à jour à ${new Date().toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}`;
  // Combien d'articles de la liste sont en spécial dans chaque magasin
  const count = Object.fromEntries(STORES.map(s => [s.key, 0]));
  results.forEach(r => new Set(r.map(d => d.store.key)).forEach(k => count[k]++));
  const max = Math.max(...Object.values(count));
  const best = STORES.filter(s => count[s.key] === max && max > 0);
  $("dealsSummary").innerHTML = `<div class="stores">${STORES.map(s => `<div class="store ${max > 0 && count[s.key] === max ? "best" : ""}"><b>${count[s.key]}</b><span>${s.label}</span></div>`).join("")}</div>
    <p class="best-line">${max > 0 ? `${best.length > 1 ? best.slice(0, -1).map(s => s.label).join(", ") + " et " + best[best.length - 1].label : best[0].label} :${max} de tes ${items.length} articles en circulaire cette semaine.` : "Aucun article de ta liste n'est en circulaire cette semaine."}</p>`;
  $("deals").innerHTML = items.map((it, i) => `<section><h2><span>${esc(it.name)}</span><span>${results[i].length ? results[i].length + " offre" + (results[i].length > 1 ? "s" : "") : ""}</span></h2>
    <div class="box">${results[i].length ? results[i].slice(0, 5).map(dealRow).join("") : `<div class="nodeal">Pas en circulaire cette semaine.</div>`}</div></section>`).join("");
}
/* ---------- Circulaire complète d'un magasin ---------- */
const flyerCache = new Map(); let flyerOpen = null;
$("flyerBtns").innerHTML = STORES.map(s => `<button class="btn sm" type="button" data-flyer="${s.key}"><span class="chip ${s.key}">${s.label}</span></button>`).join("");
const tidy = n => { let s = String(n || "").split(" | ")[0].trim();
  const L = s.replace(/[^A-Za-zÀ-ÿŒœ]/g, ""), U = L.replace(/[^A-ZÀ-ÞŒ]/g, "");
  if (L.length > 3 && U.length / L.length > 0.6) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1); };
const httpsImg = u => u ? String(u).replace(/^http:/, "https:") : "";
async function loadFlyer(st){
  const key = region + "|" + st.key; if (flyerCache.has(key)) return flyerCache.get(key);
  const d = await fetchJSON(`https://backflipp.wishabi.com/flipp/data?locale=fr-ca&postal_code=${region}`, 10000);
  if (!d) return null;
  const now = Date.now();
  const fls = (d.flyers || []).filter(f => st.re.test(f.merchant || "") && (!f.valid_to || Date.parse(f.valid_to) >= now));
  // Certains magasins ont plusieurs circulaires d'épicerie (ex. Metro : la vraie + un petit cahier thématique;
  // Walmart : la circulaire + Diwali) : on garde celle qui a le plus de produits
  const groc = fls.filter(f => (f.categories || []).includes("Groceries"));
  const cands = (groc.length ? groc : fls).slice(0, 3);
  if (!cands.length){ flyerCache.set(key, { none: true }); return { none: true }; }
  const got = await Promise.all(cands.map(f => fetchJSON(`https://backflipp.wishabi.com/flipp/flyers/${f.id}?locale=fr-ca`, 12000)));
  const size = j => j ? (j.items || []).filter(i => i.display_type === 1 && i.name).length : -1;
  let k = 0; got.forEach((j, n) => { if (size(j) > size(got[k])) k = n; });
  const f = cands[k], j = got[k];
  if (!j) return null;
  const items = (j.items || []).filter(i => i.display_type === 1 && i.name).map(i => {
    const name = tidy(i.name);
    return { name, cat: guess(name), price: i.price ? Number(i.price) : null, img: httpsImg(i.cutout_image_url), to: i.valid_to || f.valid_to };
  });
  const out = { store: st, title: f.name || "", from: f.valid_from, to: f.valid_to, items };
  flyerCache.set(key, out); return out;
}
function flyerRow(it, k){
  const onList = data.items.some(i => !i.done && norm(i.name) === norm(it.name.split(",")[0]));
  const z = zoomId({ store: flyerOpen.store, name: it.name, price: it.price != null ? it.price.toFixed(2).replace(".", ",") + " $" : "Prix à voir en magasin", meta: endText({ to: it.to }), img: it.img, cat: it.cat, to: it.to });
  return `<div class="deal zoomable" data-zoom="${z}">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy">` : ""}<div class="dtxt">
    <div class="dname">${esc(it.name)}</div></div>
    <div class="dprice">${it.price != null ? it.price.toFixed(2).replace(".", ",") + " $" : `<span class="dmeta">Voir prix</span>`}</div>
    <button class="addf" type="button" data-fadd="${k}" ${onList ? "disabled" : ""} aria-label="Ajouter ${esc(it.name)} à la liste">${onList ? "✓" : "+"}</button></div>`;
}
function renderFlyer(){
  const fl = flyerOpen; if (!fl) return;
  const q = norm($("flyerQ") ? $("flyerQ").value : "");
  const shown = fl.items.map((it, k) => [it, k]).filter(([it]) => !q || norm(it.name).includes(q));
  const d = t => t ? new Date(t).toLocaleDateString("fr-CA", { day: "numeric", month: "short" }) : "";
  $("flyerBody").innerHTML = !shown.length ? `<p class="empty">Rien qui correspond dans cette circulaire.</p>` :
    CATS.filter(c => shown.some(([it]) => it.cat === c)).map(c => {
      const g = shown.filter(([it]) => it.cat === c);
      return `<section><h2><span>${c === "Autre" ? "Autres produits" : c}</span><span>${g.length}</span></h2><div class="box">${g.map(([it, k]) => flyerRow(it, k)).join("")}</div></section>`;
    }).join("");
  $("flyerMeta").textContent = `${fl.items.length} produits · du ${d(fl.from)} au ${d(fl.to)}`;
}
async function openFlyer(st){
  $("dealsSummary").hidden = true; $("deals").hidden = true; $("flyer").hidden = false;
  document.querySelectorAll("[data-flyer]").forEach(b => b.setAttribute("aria-pressed", b.dataset.flyer === st.key));
  $("flyer").innerHTML = `<p class="empty">J'ouvre la circulaire ${st.label}…</p>`;
  const fl = await loadFlyer(st);
  if (!fl){ $("flyer").innerHTML = `<p class="empty">Je n'arrive pas à rejoindre les circulaires. Vérifie ta connexion et réessaie.</p>`; return; }
  if (fl.none){ $("flyer").innerHTML = `<p class="empty">Pas de circulaire ${st.label} trouvée pour ta région cette semaine.</p>`; return; }
  flyerOpen = fl;
  $("flyer").innerHTML = `<div class="flyer-head"><div><b><span class="chip ${st.key}">${st.label}</span>Circulaire</b><span class="hint" id="flyerMeta"></span></div>
    <button class="btn sm" type="button" id="flyerClose">Fermer</button></div>
    <form class="inline" id="flyerFilter" autocomplete="off"><input class="f" id="flyerQ" placeholder="Filtrer : poulet, fromage…" aria-label="Filtrer la circulaire"></form>
    <div id="flyerBody"></div>`;
  $("flyerQ").addEventListener("input", renderFlyer);
  $("flyerFilter").addEventListener("submit", e => e.preventDefault());
  $("flyerClose").onclick = closeFlyer;
  renderFlyer();
}
function closeFlyer(){ flyerOpen = null; $("flyer").hidden = true; $("flyer").innerHTML = "";
  $("dealsSummary").hidden = false; $("deals").hidden = false;
  document.querySelectorAll("[data-flyer]").forEach(b => b.setAttribute("aria-pressed", "false")); }
$("flyerBtns").addEventListener("click", e => { const b = e.target.closest("[data-flyer]"); if (!b) return;
  const st = STORES.find(s => s.key === b.dataset.flyer); if (st) openFlyer(st); });
$("flyer").addEventListener("click", async e => { const b = e.target.closest("[data-fadd]"); if (!b || !flyerOpen) return;
  const it = flyerOpen.items[Number(b.dataset.fadd)]; if (!it) return;
  const name = it.name.split(",")[0].trim(); b.disabled = true; b.textContent = "✓";
  const p = it.price != null ? it.price.toFixed(2).replace(".", ",") + " $" : "";
  const st = flyerOpen.store;
  toast((await addToList(name, "", it.cat, null, { store: st.key, label: st.label, price: p, to: it.to || "" })) ? `${name} ajouté à la liste (${st.label})` : `${name} : ${st.label} noté sur la liste`); });

$("dealsGo").onclick = () => { closeFlyer(); runDeals(); };
$("dealSearch").addEventListener("submit", async e => {
  e.preventDefault(); closeFlyer(); const q = $("dealQ").value.trim(); if (!q) return;
  $("dealsSummary").innerHTML = ""; $("deals").innerHTML = `<p class="empty">Je cherche « ${esc(q)} »…</p>`;
  const r = await searchDeals(q);
  if (r === null){ $("deals").innerHTML = `<p class="empty">Je n'arrive pas à rejoindre les circulaires. Réessaie.</p>`; return; }
  $("deals").innerHTML = `<section><h2><span>${esc(q)}</span><span>${r.length} offre${r.length > 1 ? "s" : ""}</span></h2><div class="box">${r.length ? r.map(dealRow).join("") : `<div class="nodeal">Rien en circulaire chez ${storeNamesOu} cette semaine.</div>`}</div></section>`;
});

/* ---------- Démarrage ---------- */
if (code) showApp(); else $("login").hidden = false;
setInterval(() => { if (!document.hidden && !$("app").hidden) refresh(); }, 4000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
window.addEventListener("online", refresh);

let zoomCur = null;
document.addEventListener("click", e => {
  if (e.target.closest("[data-fadd]")) return;
  const row = e.target.closest("[data-zoom]"); if (!row) return;
  const z = zoomReg[Number(row.dataset.zoom)]; if (!z) return; zoomCur = z;
  const big = z.img ? String(z.img).replace(/\/(small|medium|large)\.(jpg|png)$/, "/extra_large.$2") : "";
  $("zImg").hidden = !z.img; if (z.img){ $("zImg").src = big; $("zImg").onerror = () => { $("zImg").onerror = null; $("zImg").src = z.img; }; }
  $("zStore").className = "chip " + z.store.key; $("zStore").textContent = z.store.label;
  $("zName").textContent = z.name; $("zPrice").textContent = z.price; $("zMeta").textContent = z.meta || "";
  const listName = z.name.split(",")[0].trim();
  const li = data.items.find(i => !i.done && norm(i.name) === norm(listName));
  const same = li && li.deal && li.deal.store === z.store.key;
  $("zAdd").disabled = !!same;
  $("zAdd").textContent = same ? `✓ Sur la liste (${z.store.label})` : li ? `Noter : l'acheter chez ${z.store.label}` : "Ajouter à la liste";
  $("zoomSheet").hidden = false;
});
const closeZoom = () => { $("zoomSheet").hidden = true; zoomCur = null; };
$("zClose").onclick = closeZoom;
$("zoomSheet").addEventListener("click", e => { if (e.target === $("zoomSheet")) closeZoom(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("zoomSheet").hidden) closeZoom(); });
$("zAdd").onclick = async () => { if (!zoomCur) return; const name = zoomCur.name.split(",")[0].trim();
  $("zAdd").disabled = true; $("zAdd").textContent = "✓ Ajouté";
  const z = zoomCur, dl = { store: z.store.key, label: z.store.label, price: /\d/.test(z.price) ? z.price : "", to: z.to || "" };
  toast((await addToList(name, "", z.cat || guess(name), null, dl)) ? `${name} ajouté à la liste (${dl.label})` : `${name} : ${dl.label} noté sur la liste`);
  if (flyerOpen) renderFlyer(); };

/* ---------- Quantité d'un article ---------- */
let qtyId = null;
// Change le premier nombre du texte (« 2 lb » → « 3 lb »); sans nombre, on part de 1
function bump(t, step){
  const txt = String(t || "").trim(), m = txt.match(/^(\d+(?:[.,]\d+)?)(.*)$/);
  const n = m ? parseFloat(m[1].replace(",", ".")) : 1, rest = m ? m[2] : (txt ? " " + txt : "");
  const v = Math.max(1, Math.round((n + step) * 100) / 100);
  return String(v).replace(".", ",") + rest;
}
function openQty(id){
  const it = data.items.find(i => i.id === id); if (!it) return;
  if (String(id).startsWith("tmp")){ toast("Un instant, l'article s'enregistre…"); return; }
  qtyId = id; $("qName").textContent = it.name; $("qIn").value = it.qty || ""; $("qtySheet").hidden = false;
}
const closeQty = () => { $("qtySheet").hidden = true; qtyId = null; };
$("qMinus").onclick = () => { $("qIn").value = bump($("qIn").value, -1); };
$("qPlus").onclick = () => { $("qIn").value = bump($("qIn").value, +1); };
$("qClear").onclick = () => { $("qIn").value = ""; $("qIn").focus(); };
$("qCancel").onclick = closeQty;
$("qtySheet").addEventListener("click", e => { if (e.target === $("qtySheet")) closeQty(); });
$("qtyForm").addEventListener("submit", e => { e.preventDefault(); if (!qtyId) return;
  const id = qtyId, q = $("qIn").value.trim(); closeQty();
  act("qty", { id, qty: q }, () => { const it = data.items.find(i => i.id === id); if (it) it.qty = q; }, apiItem); });
