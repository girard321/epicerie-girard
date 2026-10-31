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
  // Le serveur compare sans tenir compte des majuscules mais AVEC les accents : on lui donne le nom exact déjà sur la liste
  if (dup) name = dup.name;
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
  if (!loaded){ setHTML("list", ""); return; }
  if (!its.length){ setHTML("list", `<p class="empty">Ajoute un article en bas, scanne un code-barres,<br>ou passe par « Avant de partir » et « Repas ».</p>`); return; }
  const pm = plannedMeals();
  const planned = pm.length ? `<section class="planned"><h2><span>Repas choisis</span><span>${pm.length}</span></h2><ul class="box">${pm.map(p => `
    <li><span class="name"><b>${esc(p.name)}</b><span class="qty">${p.left ? `${p.left} ingrédient${p.left>1?"s":""} à acheter` : "tout est dans le panier ✓"}</span></span>
    <button class="btn sm ghost" type="button" data-unplan="${esc(p.id)}">Retirer</button></li>`).join("")}</ul></section>` : "";
  setHTML("list", planned + CATS.filter(c => its.some(i => (CATS.includes(i.cat) ? i.cat : "Autre") === c)).map(c => {
    const g = its.filter(i => (CATS.includes(i.cat) ? i.cat : "Autre") === c).sort((a,b) => a.done - b.done);
    const left = g.filter(i => !i.done).length;
    return `<section><h2><span>${c}</span><span>${left || "✓"}</span></h2><ul class="box">${g.map(i => `
      <li class="${i.done ? "done" : ""}"><label><input class="chk" type="checkbox" data-id="${esc(i.id)}" ${i.done ? "checked" : ""}>
      <span class="name">${esc(i.name)}${dealTag(i)}${mealsOf(i).length ? `<span class="for">pour : ${mealsOf(i).map(m => esc((data.meals.find(x => x.id === m.id) || m).name)).join(", ")}</span>` : ""}</span></label>
      <button class="qtyb ${i.qty ? "" : "vide"}" type="button" data-q="${esc(i.id)}" aria-label="Quantité de ${esc(i.name)} : ${esc(i.qty || "aucune")}">${i.qty ? esc(i.qty) : "Qté"}</button>
      <button class="del" type="button" data-del="${esc(i.id)}" aria-label="Enlever ${esc(i.name)}">×</button></li>`).join("")}</ul></section>`;
  }).join(""));
}
function renderInv(){
  if (!loaded){ setHTML("inv", ""); return; }
  const st = [...data.staples].sort((a,b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat) || norm(a.name).localeCompare(norm(b.name)));
  if (!st.length){ setHTML("inv", `<p class="empty">Ajoute les produits que tu veux vérifier avant chaque épicerie.</p>`); return; }
  const left = st.filter(s => !s.status).length;
  setHTML("inv", `<section><h2><span>Produits de base</span><span>${left ? left + " à vérifier" : "Vérification finie ✓"}</span></h2><ul class="box inv">${st.map(s => `
    <li><span class="name">${esc(s.name)}</span><span class="seg">
      <button type="button" class="have" data-st="${esc(s.id)}" data-v="ok" aria-pressed="${s.status === "ok"}">J'en ai</button>
      <button type="button" class="need" data-st="${esc(s.id)}" data-v="manque" aria-pressed="${s.status === "manque"}">Manque</button>
    </span><button class="del" type="button" data-sdel="${esc(s.id)}" aria-label="Retirer ${esc(s.name)} des produits de base">×</button></li>`).join("")}</ul></section>`);
}
function renderMeals(){
  if (!loaded){ setHTML("meals", ""); return; }
  const open = new Set([...document.querySelectorAll(".meal[open]")].map(d => d.dataset.id));
  const ms = [...data.meals].sort((a,b) => norm(a.name).localeCompare(norm(b.name)));
  if (!ms.length){ setHTML("meals", `<p class="empty">Ta banque de repas est vide.<br>Appuie sur « Nouveau repas » pour commencer.</p>`); return; }
  const onList = new Set(plannedMeals().map(p => p.id));
  setHTML("meals", ms.map(m => { const ing = Array.isArray(m.ingredients) ? m.ingredients : [];
    return `<details class="meal" data-id="${esc(m.id)}" ${open.has(m.id) ? "open" : ""}><summary><b>${esc(m.name)}</b><span>${onList.has(m.id) ? `<i class="onlist">Sur la liste</i>` : ""}${ing.length} ingrédient${ing.length>1?"s":""}</span></summary><div class="body">
      <div class="row" style="margin-top:14px"><button class="btn pri sm" type="button" data-cook="${esc(m.id)}">Ajouter les ingrédients à la liste</button></div>
      <h3>Ingrédients</h3><ul>${ing.map((x, k) => { const h = atHome(x.name);
        return `<li class="${h ? "home" : ""}">${esc(x.name)}${x.qty ? ` <span class="qty">${esc(x.qty)}</span>` : ""}${h ? ` <span class="athome">à la maison</span> <button class="linkbtn" type="button" data-anyway="${esc(m.id)}" data-k="${k}">ajouter quand même</button>` : ""}</li>`; }).join("") || "<li>Aucun</li>"}</ul>
      ${m.recipe ? `<h3>Recette</h3><p class="recipe">${esc(m.recipe)}</p>` : ""}
      <div class="row"><button class="btn sm" type="button" data-medit="${esc(m.id)}">Modifier</button><button class="btn sm warnb" type="button" data-mdel="${esc(m.id)}">Supprimer</button></div>
    </div></details>`; }).join(""));
}
function renderAll(){
  renderHead(); renderList(); renderInv();
  if (!document.activeElement || !$("p-meals").contains(document.activeElement)) renderMeals();
  if (curTab === "week") renderMySpecial();
}

// Bouton à deux touches : la 1re arme (5 secondes), la 2e confirme
function arm(b, ask, label){
  b.dataset.sure = "1"; b.textContent = ask; b.classList.add("warnb");
  setTimeout(() => { if (b.isConnected && b.dataset.sure){ delete b.dataset.sure; b.textContent = label; if (label !== "Supprimer") b.classList.remove("warnb"); } }, 5000);
}

/* ---------- Entrée / sortie ---------- */
function showApp(){ $("login").hidden = true; $("app").hidden = false; loaded = false; renderAll(); refresh(); }
function logout(msg){ setCode(""); code = ""; $("app").hidden = true; $("login").hidden = false;
  if (typeof resetWeek === "function") resetWeek();
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
  ["list","inv","meals","week","deals"].forEach(k => $("p-" + k).hidden = k !== t);
  $("addBar").hidden = t !== "list"; window.scrollTo(0, 0);
  if (t === "week"){ showBonsDeals(); loadPlan(); loadIaQuota(); renderIdeas(); }
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
    if (!e.target.dataset.sure){ arm(e.target, "Retirer ses ingrédients?", "Retirer"); return; }
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
    else arm(e.target, "Appuie encore pour supprimer", "Supprimer"); }
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
  // La liste des circulaires de la région ne se charge qu'une fois pour tous les magasins
  if (!flyerCache.has(region)) flyerCache.set(region, fetchJSON(`https://backflipp.wishabi.com/flipp/data?locale=fr-ca&postal_code=${region}`, 10000));
  const d = await flyerCache.get(region);
  if (!d){ flyerCache.delete(region); return null; }
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
    return { name, raw: i.name, cat: guess(name), price: Number.isFinite(Number(i.price)) && Number(i.price) > 0 ? Number(i.price) : null, discount: Number(i.discount) || 0,
      img: httpsImg(i.cutout_image_url), from: i.valid_from || f.valid_from, to: i.valid_to || f.valid_to };
  });
  const out = { store: st, title: f.name || "", from: f.valid_from, to: f.valid_to, items };
  flyerCache.set(key, out); savePrices(out); return out;
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

/* ---------- Semaine : les bons deals ---------- */
const apiPrix = (action, args = {}) => rpc("api_prix", { p_code: code, p_action: action, p_args: args });
// Nom normalisé pour l'historique des prix (règle décrite dans LISEZ-MOI.md) : partie française seulement
// (avant « | »), sans marque entre parenthèses, minuscules, sans accents, chaque mot au singulier
const normProduct = n => words(String(n || "").split(" | ")[0].replace(/\([^)]*\)/g, " ")).join(" ");
// Un aliment qui fait un repas : viande, volaille, poisson, fruits de mer, fruits et légumes frais, fromage, pâtes, riz.
// Jamais de grignotines, boissons, sucreries, produits préparés ou ménagers.
const DEAL_OK = /\b(poulet|boeuf|porc|veau|agneau|dinde|jambon|saucisse|bacon|cote|roti|steak|bifteck|filet|haut de cuisse|pilon|poitrine|hache|osso|saumon|truite|morue|tilapia|sebaste|aiglefin|crevette|poisson|petoncle|moule|homard|crabe|tomate|carotte|pomme|poire|banane|orange|clementine|nectarine|peche|prune|kiwi|raisin|fraise|bleuet|framboise|brocoli|chou|laitue|poivron|oignon|patate|courge|champignon|pleurote|celeri|concombre|epinard|haricot|avocat|citron|lime|mangue|ananas|melon|cantaloup|rutabaga|navet|fenouil|courgette|zucchini|asperge|poireau|fromage|cheddar|mozzarella|parmesan|feta|brie|pates?|spaghetti|penne|fusilli|linguine|lasagne|macaroni|riz|cotelette)(e|s|x|es)?\b/;
const DEAL_NO = /\b(chips|croustille|biscuit|gateau|bonbon|chocolat|liqueur|boisson|jus|biere|vin|gelee|saindoux|frite|surgele|nectar|smoothie|craquelin|barre|creme glacee|savon|detergent|papier|sauce|vinaigrette|trempette|collation|muffin|cereale|pizza|pane|compote|confiture|soupe|salade de|simili|croquette|pepite|sandwich|tarte|pate a|pate de tomate|pate de cari|bouillon|fond de|bouchee|nourriture|chien|chat)(e|s|x|es)?\b/;
const isMealFood = raw => { const n = norm(String(raw || "").split(" | ")[0]); return DEAL_OK.test(n) && !DEAL_NO.test(n); };
// Préférences de la famille (dans la base, partagées) : personnes, n'aime pas, allergies, temps max, magasins
const apiPrefs = (action, args = {}) => rpc("api_prefs", { p_code: code, p_action: action, p_args: args });
let prefs = { people: 4, dislikes: [], allergies: [], max_minutes: 45, stores: ["metro", "iga"] }, prefsLoaded = false;
let myStores = new Set(prefs.stores);
async function loadPrefs(){
  try { const r = await apiPrefs("get"); if (r.ok){ prefs = r.prefs; myStores = new Set(prefs.stores); prefsLoaded = true; } } catch(e){}
}
// fields = seulement ce qui a changé (le serveur ne touche pas aux autres champs)
let prefsSeq = 0;
async function savePrefs(fields){
  if (!prefsLoaded){ await loadPrefs(); if (!prefsLoaded){ toast("Pas de connexion. Réessaie."); return false; } }
  const my = ++prefsSeq;
  try { const r = await apiPrefs("save", fields);
    if (r.ok){ if (my === prefsSeq){ prefs = r.prefs; myStores = new Set(prefs.stores); } return true; } } catch(e){}
  toast("Pas pu enregistrer. Réessaie."); return false;
}
const savedFlyers = new Set();
// Chaque circulaire chargée nourrit l'historique (une fois par appareil et par circulaire)
function savePrices(fl){
  if (!code || !fl || fl.none) return;
  const k = fl.store.key + "|" + fl.from; if (savedFlyers.has(k)) return; savedFlyers.add(k);
  const seen = String(fl.from || "").slice(0, 10), done = new Set(), prices = [];
  for (const it of fl.items){
    if (it.price == null || !isMealFood(it.raw)) continue;
    const product = normProduct(it.raw); if (!product || done.has(product)) continue; done.add(product);
    prices.push({ product, store: fl.store.key, price: it.price.toFixed(2), seen_on: seen });
  }
  if (prices.length) apiPrix("save", { prices }).catch(() => { savedFlyers.delete(k); });
}
// Genre d'aliment affiché sous un deal (le premier qui correspond gagne)
const DEAL_KIND = [
  [/\b(saumon|truite|morue|tilapia|sebaste|aiglefin|crevette|poisson|petoncle|moule|homard|crabe)/, "Poissons et fruits de mer"],
  [/\b(poulet|dinde)/, "Volaille"],
  [/\b(fromage|cheddar|mozzarella|parmesan|feta|brie)/, "Fromages"],
  [/\b(pates?|spaghetti|penne|fusilli|linguine|lasagne|macaroni|riz)\b/, "Pâtes et riz"],
  [/\b(boeuf|porc|veau|agneau|jambon|saucisse|bacon|cote|roti|steak|bifteck|filet|haut de cuisse|pilon|poitrine|hache|osso)/, "Viandes"],
  [/\b(pommes? de terre|patate)/, "Légumes"],
  [/\b(pomme|poire|banane|orange|clementine|nectarine|peche|prune|kiwi|raisin|fraise|bleuet|framboise|avocat|citron|lime|mangue|ananas|melon|cantaloup)/, "Fruits"],
  [/./, "Légumes"]
];
const dealKind = raw => { const n = norm(String(raw || "").split(" | ")[0]); return DEAL_KIND.find(([re]) => re.test(n))[1]; };
let bdState = { key: "", list: null, all: false };
// Flipp ne donne pas l'unité (/lb, /100 g) dans la circulaire complète : on la cherche dans sa recherche
async function findUnit(d){
  const j = await fetchJSON(`https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${region}&q=${encodeURIComponent(cleanQuery(d.name).split(",")[0].slice(0, 40))}`, 8000);
  const hit = j && (j.items || []).find(i => d.store.re.test(i.merchant_name || "") && Math.abs(Number(i.current_price) - d.price) < 0.005);
  return hit ? String(hit.post_price_text || "").trim() : "";
}
async function loadBonsDeals(){
  const stores = STORES.filter(s => myStores.has(s.key));
  const fls = (await Promise.all(stores.map(loadFlyer))).filter(f => f && !f.none);
  if (!fls.length && stores.length) return null;
  const best = new Map();
  for (const fl of fls) for (const it of fl.items){
    if (it.price == null || !isMealFood(it.raw)) continue;
    const product = normProduct(it.raw), k = fl.store.key + "|" + product, cur = best.get(k);
    if (!cur || it.price < cur.price) best.set(k, { ...it, store: fl.store, product });
  }
  const cands = [...best.values()];
  const before = fls.map(f => String(f.from || "").slice(0, 10)).filter(Boolean).sort()[0] || "";
  let stats = {};
  try { const r = await apiPrix("stats", { products: [...new Set(cands.map(c => c.product))].slice(0, 1500), before }); if (r.ok) stats = r.stats || {}; } catch(e){}
  for (const c of cands){ const st = stats[c.product]; c.bestSeen = !!(st && st.n >= 3 && c.price <= Number(st.min)); }
  // Quasi-doublons (« Carottes » et « Carottes ou oignons » au même prix, même magasin) : on garde le premier
  const kept = [];
  // Les « meilleur prix vu » passent en premier (ils peuvent avoir moins de 25 % de rabais), puis le plus gros rabais
  for (const c of cands.filter(c => c.discount >= 25 || c.bestSeen).sort((a, b) => b.bestSeen - a.bestSeen || (b.discount || 0) - (a.discount || 0) || a.price - b.price)){
    const w = new Set(c.product.split(" ").filter(x => x.length > 3));
    if (kept.some(k => k.store.key === c.store.key && k.price === c.price && k.product.split(" ").some(x => w.has(x)))) continue;
    kept.push(c); if (kept.length === 15) break;
  }
  // pool = tous les bons deals (pas seulement les 15 affichés), pour trouver mes repas en spécial
  const pool = cands.filter(c => c.discount >= 25 || c.bestSeen);
  return { list: kept, pool, to: fls.map(f => f.to).sort()[0] };
}
function bdRow(d){
  const price = d.price.toFixed(2).replace(".", ",") + " $";
  const z = zoomId({ store: d.store, name: d.name, price: price + (d.unit ? " " + d.unit : ""), meta: [d.discount ? `${d.discount} % de rabais` : "", d.bestSeen ? "Meilleur prix vu" : "", endText(d)].filter(Boolean).join(" · "), img: d.img, cat: d.cat, to: d.to });
  return `<div class="deal zoomable" data-zoom="${z}">${d.img ? `<img src="${esc(d.img)}" alt="" loading="lazy">` : ""}<div class="dtxt">
    <div class="dname"><span class="chip ${d.store.key}">${d.store.label}</span>${esc(d.name)}${d.discount >= 25 ? `<span class="off">−${d.discount} %</span>` : ""}</div>
    ${d.bestSeen ? `<div class="bestseen">★ Meilleur prix vu</div>` : `<div class="dmeta">${esc(dealKind(d.raw))}</div>`}</div>
    <div class="dprice">${price}${d.unit ? `<small>${esc(d.unit)}</small>` : ""}</div></div>`;
}
function renderBonsDeals(){
  $("bdStores").innerHTML = STORES.map(s => `<button type="button" class="pill ${myStores.has(s.key) ? "on" : ""}" data-mystore="${s.key}" aria-pressed="${myStores.has(s.key)}">${s.label}</button>`).join("");
  const st = bdState;
  if (!st.list){ $("bdList").innerHTML = `<p class="empty">${st.error || "Je regarde les circulaires…"}</p>`; $("bdEnd").textContent = ""; renderMySpecial(); return; }
  $("bdEnd").textContent = st.to ? endText({ to: st.to }) : "";
  if (!st.list.length){ $("bdList").innerHTML = `<p class="empty">${myStores.size ? "Pas de bon deal d'aliments cette semaine dans tes magasins." : "Choisis au moins un magasin."}</p>`; return; }
  const shown = st.all ? st.list : st.list.slice(0, 8);
  $("bdList").innerHTML = `<section><div class="box">${shown.map(bdRow).join("")}</div></section>` +
    (st.list.length > 8 ? `<div class="row"><button class="btn" type="button" id="bdMore" style="width:100%">${st.all ? "Voir moins" : `Voir les ${st.list.length} deals`}</button></div>` : "");
}
async function showBonsDeals(force){
  if (!prefsLoaded) await loadPrefs();
  const key = region + "|" + [...myStores].sort().join(",");
  if (!force && bdState.key === key && bdState.list) return renderBonsDeals();
  bdState = { key, list: null, all: false }; renderBonsDeals();
  const r = await loadBonsDeals(); if (bdState.key !== key) return;
  if (!r){ bdState.error = "Je n'arrive pas à rejoindre les circulaires. Vérifie ta connexion et réessaie."; return renderBonsDeals(); }
  Object.assign(bdState, r); renderBonsDeals(); renderMySpecial(); renderIdeas();
  // Les unités arrivent ensuite, sans bloquer l'affichage
  const q = [...r.list];
  await Promise.all([1, 2, 3, 4].map(async () => { while (q.length){ const d = q.shift(); d.unit = await findUnit(d); } }));
  if (bdState.key === key) renderBonsDeals();
}
$("bdStores").addEventListener("click", e => { const b = e.target.closest("[data-mystore]"); if (!b) return;
  const k = b.dataset.mystore; myStores.has(k) ? myStores.delete(k) : myStores.add(k);
  showBonsDeals(); savePrefs({ stores: [...myStores] }); });
$("bdList").addEventListener("click", e => { if (e.target.id === "bdMore"){ bdState.all = !bdState.all; renderBonsDeals(); } });

/* ---------- Semaine : mes repas en spécial ---------- */
// Ne redessine que si le contenu change (l'état revient aux 4 secondes : un toucher ne doit pas tomber dans le vide)
function setHTML(id, html){ const el = $(id); if (el.dataset.html !== html){ el.innerHTML = html; el.dataset.html = html; } }
// Le nom a court (« Bœuf haché ») se retrouve-t-il dans le nom b (« Bœuf haché maigre ») sans devenir
// un autre produit? « Pommes » ≠ « Pommes de terre », « Beurre » ≠ « Beurre d'arachide » (même règle que atHome).
// loose = le mot suffit (« Foie » trouvé dans « Foie de veau ») : pour les aliments à éviter
// Position où le nom a commence dans b (-1 si absent)
function namePos(a, b, loose){
  const s = words(String(a).replace(/\([^)]*\)/g, " ")), l = words(String(b).replace(/\([^)]*\)/g, " "));
  if (!s.length) return false;
  for (let i = 0; i + s.length <= l.length; i++)
    if (s.every((w, k) => l[i + k] === w) && (loose || !LINK.has(l[i + s.length]))) return i;
  return -1;
}
const nameIn = (a, b, loose) => namePos(a, b, loose) >= 0;
// Le spécial qui correspond le mieux à un ingrédient : « Poulet » → « Poitrines de poulet »
// plutôt que « Bouillon de poulet »; seulement pour un aliment qui fait un repas
function dealFor(ing, pool){
  if (!isMealFood(ing)) return null;
  const fr = d => d.raw.split(" | ")[0];
  return pool.map(d => ({ d, pos: namePos(ing, fr(d)) })).filter(x => x.pos >= 0)
    .sort((a, b) => a.pos - b.pos || fr(a.d).length - fr(b.d).length || a.d.price - b.d.price)[0]?.d || null;
}
// Repas à éviter : un ingrédient (ou le nom du repas) touche une allergie ou un aliment qu'on n'aime pas
const avoids = m => [...(prefs.allergies || []), ...(prefs.dislikes || [])].some(x =>
  nameIn(x, m.name, true) || (m.ingredients || []).some(i => nameIn(x, i.name, true)));
function mealsInSpecial(pool){
  const out = [];
  for (const m of data.meals){
    if (avoids(m)) continue;
    const hits = [];
    // Ingrédient principal = un aliment qui fait un repas (viande, poisson, légumes, fruits, fromage, pâtes, riz)
    for (const ing of (m.ingredients || []).filter(i => isMealFood(i.name))){
      const d = dealFor(ing.name, pool);
      if (d) hits.push({ ing: ing.name, d });
    }
    if (hits.length) out.push({ meal: m, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length || norm(a.meal.name).localeCompare(norm(b.meal.name)));
}
function renderMySpecial(){
  const pool = bdState.pool;
  if (!pool){ setHTML("mySpecial", ""); $("mySpecialCount").textContent = ""; renderWeek(); return; }
  const ms = mealsInSpecial(pool);
  $("mySpecialCount").textContent = ms.length ? `${ms.length} repas` : "";
  if (!data.meals.length){ setHTML("mySpecial", `<p class="empty">Ta banque de repas est vide. Ajoute des repas dans l'onglet « Repas ».</p>`); renderWeek(); return; }
  if (!ms.length){ setHTML("mySpecial", `<p class="empty">Aucun repas de ta banque n'a un ingrédient principal en spécial cette semaine.</p>`); renderWeek(); return; }
  setHTML("mySpecial", ms.map(({ meal, hits }) => `<div class="idea" data-mealid="${esc(meal.id)}"><h3>${esc(meal.name)}</h3>
    <div class="why">${hits.map(h => `<div><span class="chip ${h.d.store.key}">${h.d.store.label}</span>${esc(h.ing)} <b>${h.d.price.toFixed(2).replace(".", ",")} $</b>${h.d.discount >= 25 ? ` · −${h.d.discount} %` : ""}${h.d.bestSeen ? " · meilleur prix vu" : ""}<br><i>${esc(h.d.name)}</i></div>`).join("")}</div>
    <div class="row tight"><button class="btn pri sm" type="button" data-planmeal="${esc(meal.id)}">Choisir pour un soir</button></div></div>`).join(""));
  renderWeek();
}

/* ---------- Préférences de la famille ---------- */
let prefsDraft = null;
const MINUTES = [30, 45, 60];
function renderPrefs(){
  const p = prefsDraft;
  $("pPeople").value = p.people;
  const tags = (k) => p[k].map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-rm="${k}" data-i="${i}" aria-label="Retirer ${esc(t)}">×</button></span>`).join("");
  $("pDislikes").innerHTML = tags("dislikes"); $("pAllergies").innerHTML = tags("allergies");
  $("pMinutes").innerHTML = MINUTES.map(m => `<button type="button" class="pill ${p.max_minutes === m ? "on" : ""}" data-min="${m}">${m} min</button>`).join("");
  $("pStores").innerHTML = STORES.map(s => `<button type="button" class="pill ${p.stores.includes(s.key) ? "on" : ""}" data-pstore="${s.key}">${s.label}</button>`).join("");
}
$("prefsOpen").onclick = async () => {
  await loadPrefs(); // toujours la version la plus récente : un autre téléphone a peut-être changé quelque chose
  if (!prefsLoaded){ toast("Pas de connexion. Réessaie."); return; }
  prefsDraft = JSON.parse(JSON.stringify({ ...prefs, stores: [...myStores] }));
  renderPrefs(); $("prefsSheet").hidden = false;
};
const closePrefs = () => { $("prefsSheet").hidden = true; prefsDraft = null; };
$("prefsClose").onclick = closePrefs;
$("prefsSheet").addEventListener("click", e => {
  if (e.target === $("prefsSheet")) return closePrefs();
  const t = e.target.closest("button"); if (!t || !prefsDraft) return; const p = prefsDraft;
  if (t.dataset.people){ p.people = Math.min(20, Math.max(1, (parseInt($("pPeople").value, 10) || p.people) + Number(t.dataset.people))); }
  else if (t.dataset.rm){ p[t.dataset.rm].splice(Number(t.dataset.i), 1); }
  else if (t.dataset.addto){ const inp = t.dataset.addto === "dislikes" ? $("pDislikeIn") : $("pAllergyIn");
    const v = inp.value.trim(); if (v && !p[t.dataset.addto].some(x => norm(x) === norm(v))) p[t.dataset.addto].push(v); inp.value = ""; }
  else if (t.dataset.min){ p.max_minutes = Number(t.dataset.min); }
  else if (t.dataset.pstore){ const i = p.stores.indexOf(t.dataset.pstore); i < 0 ? p.stores.push(t.dataset.pstore) : p.stores.splice(i, 1); }
  else return;
  renderPrefs();
});
// Entrée dans un champ « n'aime pas » ou « allergies » = Ajouter
["pDislikeIn", "pAllergyIn"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); e.target.nextElementSibling.click(); } }));
$("prefsForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!prefsDraft) return;
  prefsDraft.people = Math.min(20, Math.max(1, parseInt($("pPeople").value, 10) || prefsDraft.people));
  const d = prefsDraft; myStores = new Set(d.stores);
  closePrefs();
  if (await savePrefs({ people: d.people, dislikes: d.dislikes, allergies: d.allergies, max_minutes: d.max_minutes, stores: d.stores })){ toast("Préférences enregistrées"); showBonsDeals(); renderMySpecial(); }
});

/* ---------- Semaine : le plan (un souper par soir, partagé) ---------- */
const apiSemaine = (action, args = {}) => rpc("api_semaine", { p_code: code, p_action: action, p_args: args });
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
let plan = [], planBusy = 0, planSeq = 0, weekRunning = false;
// Déconnexion : rien de la famille précédente ne doit rester
function resetWeek(){ plan = []; planSeq++; ideas = []; iaLeft = null; try { localStorage.removeItem(IDEAS_KEY); } catch(e){} prefsLoaded = false; prefsSeq++; bdState = { key: "", list: null, all: false }; $("weekSum").innerHTML = "";
  prefs = { people: 4, dislikes: [], allergies: [], max_minutes: 45, stores: ["metro", "iga"] }; myStores = new Set(prefs.stores); }
async function loadPlan(){
  if (planBusy) return;
  const my = planSeq;
  try { const r = await apiSemaine("get"); if (r.ok && !planBusy && my === planSeq){ plan = r.plan; renderWeek(); } } catch(e){}
}
setInterval(() => { if (curTab === "week" && !document.hidden && !$("app").hidden) loadPlan(); }, 8000);
const mealById = id => data.meals.find(m => m.id === id);
const planOf = day => { const p = plan.find(x => x.day === day); return p ? mealById(p.meal_id) : null; };
async function setDay(day, mealId){
  plan = plan.filter(x => x.day !== day); if (mealId) plan.push({ day, meal_id: mealId }); renderWeek();
  planBusy++; planSeq++;
  try { const r = await apiSemaine("set", { day, meal_id: mealId || "" }); if (r.ok) plan = r.plan; else toast("Pas pu enregistrer. Réessaie."); }
  catch(e){ toast("Pas de connexion. Réessaie."); }
  finally { planBusy--; renderWeek(); }
}
function renderWeek(){
  if (!$("week")) return;
  const sp = bdState.pool ? new Map(mealsInSpecial(bdState.pool).map(x => [x.meal.id, x.hits.length])) : new Map();
  const n = DAYS.filter((_, d) => planOf(d)).length;
  $("planCount").textContent = `${n} souper${n > 1 ? "s" : ""} sur 7 · partagé`;
  setHTML("week", DAYS.map((name, d) => { const m = planOf(d), k = m && sp.get(m.id);
    return `<div class="day ${m ? "" : "vide"}"><div class="d">${name.slice(0, 3)}${d >= 5 ? "<small>fin de sem.</small>" : ""}</div>
      <div class="m">${m ? `<b>${esc(m.name)}</b>${k ? `<span class="sp">${k} en spécial</span>` : `<span>${(m.ingredients || []).length} ingrédients</span>`}` : "Rien de prévu"}</div>
      <button class="btn sm ${m ? "ghost" : ""}" type="button" data-pickday="${d}">${m ? "Changer" : "+ Choisir"}</button></div>`; }).join(""));
  $("weekToList").disabled = !n || weekRunning;
}
/* Feuille : choisir un repas pour un soir (pickDay) ou un soir pour un repas (pickMeal) */
let planPick = null;
function renderPlanSheet(){
  const pk = planPick; if (!pk) return;
  if (pk.meal){
    const m = mealById(pk.meal); $("planTitle").textContent = m ? m.name : "Quel soir?"; $("planQ").hidden = true;
    $("planBody").innerHTML = `<p class="hint" style="margin-top:4px">Quel soir?</p><div class="pickday">${DAYS.map((name, d) => { const cur = planOf(d);
      return `<button class="btn" type="button" data-setday="${d}"><b>${name}</b><span>${cur ? esc(cur.name) : "libre"}</span></button>`; }).join("")}</div>`;
    return;
  }
  $("planTitle").textContent = DAYS[pk.day]; $("planQ").hidden = false;
  const q = norm($("planQ").value), ok = m => !q || norm(m.name).includes(q);
  const special = bdState.pool ? mealsInSpecial(bdState.pool).filter(x => ok(x.meal)) : [];
  const spIds = new Set(special.map(x => x.meal.id));
  const rest = [...data.meals].filter(m => !spIds.has(m.id) && !avoids(m) && ok(m)).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  const row = (m, sub, pri) => `<li><span class="name" style="flex:1;padding:12px 0"><b>${esc(m.name)}</b>${sub ? `<span class="for">${esc(sub)}</span>` : ""}</span><button class="btn sm ${pri ? "pri" : ""}" type="button" data-setmeal="${esc(m.id)}">Choisir</button></li>`;
  $("planBody").innerHTML = (special.length ? `<section><h2><span>En spécial cette semaine</span></h2><ul class="box">${special.map(x => row(x.meal, x.hits.map(h => h.ing).join(", ") + " en spécial", true)).join("")}</ul></section>` : "") +
    (rest.length ? `<section><h2><span>Ma banque de repas</span></h2><ul class="box">${rest.map(m => row(m, "", false)).join("")}</ul></section>` : "") +
    (!special.length && !rest.length ? `<p class="empty">${data.meals.length ? "Aucun repas ne correspond." : "Ta banque de repas est vide. Ajoute des repas dans l'onglet « Repas »."}</p>` : "") +
    (planOf(pk.day) ? `<div class="row tight"><button class="btn ghost" type="button" data-setmeal="" style="width:100%">Laisser ce soir vide</button></div>` : "");
}
function openPlan(pk){ planPick = pk; $("planQ").value = ""; renderPlanSheet(); $("planSheet").hidden = false; }
const closePlan = () => { $("planSheet").hidden = true; planPick = null; };
$("planClose").onclick = closePlan;
$("planQ").addEventListener("input", renderPlanSheet);
$("planSheet").addEventListener("click", e => {
  if (e.target === $("planSheet")) return closePlan();
  const b = e.target.closest("button"); if (!b || !planPick) return;
  if (b.dataset.setday !== undefined){ const m = mealById(planPick.meal); setDay(Number(b.dataset.setday), planPick.meal); closePlan(); toast(`${m ? m.name : "Repas"} : ${DAYS[Number(b.dataset.setday)].toLowerCase()}`); }
  else if (b.dataset.setmeal !== undefined){ setDay(planPick.day, b.dataset.setmeal); closePlan(); }
});
$("week").addEventListener("click", e => { const b = e.target.closest("[data-pickday]"); if (b) openPlan({ day: Number(b.dataset.pickday) }); });
$("mySpecial").addEventListener("click", e => { const b = e.target.closest("[data-planmeal]"); if (b) openPlan({ meal: b.dataset.planmeal }); });

/* Ajouter la semaine à la liste : api_repas pour chaque ingrédient (lien avec le repas, doublons regroupés),
   api_special pour garder magasin et prix, et on saute ce qui est marqué « J'en ai » */
const priceFr = n => n.toFixed(2).replace(".", ",") + " $";
$("weekToList").onclick = async () => {
  const days = DAYS.map((_, d) => planOf(d)).filter(Boolean); if (!days.length || weekRunning) return;
  weekRunning = true; const btn = $("weekToList"); btn.disabled = true; btn.textContent = "J'ajoute…"; $("weekSum").innerHTML = "";
  const pool = bdState.pool || [], seen = new Map(), atHomeSet = new Set();
  let added = 0, dup = 0, home = 0;
  for (const m of days) for (const ing of (m.ingredients || [])){
    const k = norm(ing.name);
    if (atHomeSet.has(k)) continue;
    if (seen.has(k)){ await addToList(ing.name, ing.qty, ing.cat, { id: m.id, name: m.name }); continue; } // même ingrédient, 2e repas : regroupé
    if (atHome(ing.name)){ home++; atHomeSet.add(k); continue; }
    const d = dealFor(ing.name, pool);
    if (await addToList(ing.name, ing.qty, ing.cat, { id: m.id, name: m.name })) added++; else dup++;
    if (d) await addToList(ing.name, "", ing.cat, null, { store: d.store.key, label: d.store.label, price: priceFr(d.price) + (d.unit ? " " + d.unit : ""), to: d.to || "" });
    seen.set(k, d);
  }
  const deals = [...seen.values()].filter(Boolean);
  const total = deals.reduce((t, d) => t + d.price, 0);
  // Économie = prix régulier − prix en spécial, quand Flipp donne le % de rabais
  const eco = deals.reduce((t, d) => t + (d.discount > 0 && d.discount < 100 ? d.price * d.discount / (100 - d.discount) : 0), 0);
  const noPrice = [...seen.values()].filter(v => !v).length;
  weekRunning = false; btn.textContent = "Ajouter la semaine à la liste"; renderWeek();
  $("weekSum").innerHTML = `<div class="sum"><b>✓ Ajouté à la liste</b>
    <div class="big"><div><b>${priceFr(total)}</b><span>total des ${deals.length} articles en spécial</span></div><div class="eco"><b>${priceFr(eco)}</b><span>économie grâce aux spéciaux</span></div></div>
    <p>${added} article${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""} · ${home} déjà à la maison (« J'en ai ») · ${dup} déjà sur la liste · ${noPrice} sans prix connu.
    Prix de la circulaire, à l'unité affichée (ex. /lb) : c'est une estimation.</p></div>`;
};
let weekNewT = null;
$("weekNew").onclick = async () => {
  const b = $("weekNew");
  if (!b.dataset.sure){ b.dataset.sure = "1"; b.textContent = "Oui, vider le plan de la semaine"; b.classList.add("warnb"); clearTimeout(weekNewT);
    weekNewT = setTimeout(() => { delete b.dataset.sure; b.textContent = "Nouvelle semaine"; b.classList.remove("warnb"); }, 5000); return; }
  delete b.dataset.sure; b.textContent = "Nouvelle semaine"; b.classList.remove("warnb");
  plan = []; $("weekSum").innerHTML = ""; renderWeek(); planBusy++; planSeq++;
  let ok = false;
  try { const r = await apiSemaine("clear"); ok = r.ok; if (r.ok) plan = r.plan; } catch(e){}
  finally { planBusy--; renderWeek(); }
  if (ok) toast("Plan vidé. Bonne nouvelle semaine!"); else { toast("Pas pu vider le plan. Réessaie."); loadPlan(); }
};

/* ---------- Semaine : nouvelles idées (IA, par l'Edge Function « recettes ») ---------- */
// La clé Anthropic reste dans les secrets Supabase : le site n'appelle que la fonction, avec le code de famille
const IDEAS_KEY = "epicerie-idees";
let ideas = (() => { try { return JSON.parse(localStorage.getItem(IDEAS_KEY)) || []; } catch(e){ return []; } })();
let iaLeft = null, iaWeekend = false, iaBusy = false;
const IA_ERR = { mauvais_code: "Le code de famille n'est pas reconnu.", limite: "Vous avez utilisé vos 10 essais d'aujourd'hui. Revenez demain!",
  pas_de_deals: "Il faut des bons deals pour proposer des recettes.", cle_manquante: "La clé de l'IA n'est pas encore installée dans Supabase.",
  ia_indisponible: "L'IA ne répond pas pour l'instant. Réessaie dans une minute.", ia_refus: "L'IA n'a pas voulu répondre. Réessaie.",
  ia_json: "La réponse de l'IA était illisible. Réessaie.", ia_vide: "Aucune recette ne respectait vos préférences. Réessaie.", ia_coupee: "La réponse était trop longue. Réessaie." };
async function loadIaQuota(){
  try { const r = await rpc("api_ia", { p_code: code, p_action: "quota", p_args: {} }); if (r.ok){ iaLeft = r.left; renderIdeas(); } } catch(e){}
}
function renderIdeas(){
  $("iaLeft").textContent = iaLeft == null ? "" : `${iaLeft} essai${iaLeft > 1 ? "s" : ""} aujourd'hui`;
  $("iaWeekend").classList.toggle("on", iaWeekend); $("iaWeekend").setAttribute("aria-pressed", iaWeekend);
  $("iaGo").disabled = iaBusy || iaLeft === 0 || !bdState.list || !bdState.list.length;
  if (iaLeft === 0 && !iaBusy) $("iaMsg").textContent = IA_ERR.limite;
  $("iaGo").textContent = iaBusy ? "Je cherche des idées… (environ 30 secondes)" : "✨ Proposer des recettes";
  const pool = bdState.pool || [];
  setHTML("iaList", ideas.map((r, k) => {
    const saved = r.mealId && mealById(r.mealId);
    const sp = r.ingredients.map(i => ({ i, d: dealFor(i.nom, pool) })).filter(x => x.d);
    return `<div class="idea"><h3>${esc(r.nom)}</h3><div class="meta">${r.minutes} min · ${r.portions} portions</div>
      ${sp.length ? `<div class="why">${sp.map(({ i, d }) => `<div><span class="chip ${d.store.key}">${d.store.label}</span>${esc(i.nom)} <b>${priceFr(d.price)}${d.unit ? " " + esc(d.unit) : ""}</b>${d.discount >= 25 ? ` · −${d.discount} %` : ""}</div>`).join("")}</div>` : ""}
      <details><summary>Ingrédients et étapes</summary>
        <ul>${r.ingredients.map(i => `<li>${esc(i.quantite ? i.quantite + " — " : "")}${esc(i.nom)}</li>`).join("")}</ul>
        <ol>${r.etapes.map(e => `<li>${esc(e)}</li>`).join("")}</ol></details>
      <div class="row tight"><button class="btn pri sm" type="button" data-ideaplan="${k}">Choisir pour un soir</button>
      ${saved ? `<span class="ok">✓ Dans ma banque</span>` : `<button class="btn sm" type="button" data-ideasave="${k}">Garder dans ma banque</button>`}</div></div>`;
  }).join(""));
}
// Garde une idée dans la banque de repas (même format que le formulaire Repas) et rend l'id du repas
async function keepIdea(k){
  const r = ideas[k]; if (!r) return null;
  if (r.mealId && mealById(r.mealId)) return r.mealId;
  const before = new Set(data.meals.map(m => m.id));
  const res = await act("meal_save", { id: "", name: r.nom,
    ingredients: r.ingredients.map(i => ({ name: i.nom, qty: i.quantite, cat: guess(i.nom) })),
    recipe: `${r.minutes} min · ${r.portions} portions\n\n${r.etapes.map((e, n) => `${n + 1}. ${e}`).join("\n")}` });
  if (!res.ok) return null;
  await refresh();
  const m = data.meals.find(x => !before.has(x.id) && x.name === r.nom); if (!m) return null;
  r.mealId = m.id; try { localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas)); } catch(e){}
  return m.id;
}
$("iaWeekend").onclick = () => { iaWeekend = !iaWeekend; renderIdeas(); };
$("iaGo").onclick = async () => {
  if (iaBusy || !bdState.list) return;
  iaBusy = true; $("iaMsg").textContent = "À partir des bons deals et de vos préférences."; renderIdeas();
  const deals = bdState.list.map(d => ({ nom: d.name, magasin: d.store.label, prix: priceFr(d.price) + (d.unit ? " " + d.unit : ""), rabais: d.discount || 0 }));
  let r = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/recettes`, { method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ code, deals, fin_de_semaine: iaWeekend }) });
    r = await res.json().catch(() => null);
  } catch(e){}
  iaBusy = false;
  if (!r || !r.ok){ $("iaMsg").textContent = (r && IA_ERR[r.error]) || "Pas de connexion. Réessaie."; if (r && r.error === "limite") iaLeft = 0; renderIdeas(); return; }
  ideas = r.recettes; iaLeft = r.left;
  try { localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas)); } catch(e){}
  $("iaMsg").textContent = `${ideas.length} idée${ideas.length > 1 ? "s" : ""} pour vous.`; renderIdeas();
};
$("iaList").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.ideasave !== undefined){ b.disabled = true; const id = await keepIdea(Number(b.dataset.ideasave));
    toast(id ? "Gardé dans ta banque de repas" : "Pas pu enregistrer. Réessaie."); renderIdeas(); }
  if (b.dataset.ideaplan !== undefined){ b.disabled = true; const id = await keepIdea(Number(b.dataset.ideaplan)); b.disabled = false;
    if (id){ renderIdeas(); openPlan({ meal: id }); } else toast("Pas pu enregistrer. Réessaie."); }
});
