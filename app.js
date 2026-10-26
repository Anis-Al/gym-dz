const $ = (s) => document.querySelector(s);
const view = $('#view'), dlg = $('#dlg');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
$('.logo').innerHTML = `${esc(APP.name)}${APP.tagline ? `<small>${esc(APP.tagline)}</small>` : ''}`; // APP comes from config.js
const da = (n) => `${Number(n).toLocaleString('fr-DZ')} DA`;
const fdate = (s) => (s ? s.split('-').reverse().join('/') : '—');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => iso(new Date());
const plus7 = () => { const d = new Date(); d.setDate(d.getDate() + 7); return iso(d); };

function status(m) {
  const t = todayStr();
  if (m.archive_le) return ['archive', 'Archivé'];
  if (m.gel_debut && m.gel_debut <= t && t <= m.gel_fin) return ['pause', 'En pause'];
  if (!m.fin || m.fin < t) return ['bad', 'Expiré'];
  if (m.fin <= plus7()) return ['soon', 'Expire bientôt'];
  return ['ok', 'Actif'];
}
const pill = (m) => { const [c, l] = status(m); return `<span class="pill ${c}">${l}</span>`; };
const INACTIF_J = 14; // same as main.js: a valid member with no check-in for this many days is "inactif"
const minus = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
// phone number as a link: opens a WhatsApp chat (reminder text prefilled when the subscription ends within 7 days or has ended)
const telLink = (m) => (m.tel ? `<button type="button" class="lnk" data-wa="${m.id}" title="Écrire sur WhatsApp">${esc(m.tel)}</button>` : '');
const waText = (m) => (m.fin && m.fin <= plus7() ? `Bonjour ${m.nom}, votre abonnement à ${APP.name} ${m.fin < todayStr() ? 'a expiré le' : 'expire le'} ${fdate(m.fin)}. Pensez à le renouveler. À bientôt !` : '');
// member avatar: the photo when there is one (photos = id -> data URL, fetched for the rows on screen), else the first letter on grey
const avatar = (m, photos, cls = '') => (photos?.[m.id] ? `<img class="av ${cls}" src="${photos[m.id]}" alt="">` : `<span class="av ${cls}" aria-hidden="true">${esc((m.nom || '?').trim()[0]?.toUpperCase() ?? '?')}</span>`);
const fetchPhotos = (list) => { const ids = list.filter((m) => m.a_photo).map((m) => m.id); return ids.length ? api.photos(ids) : {}; };
const bindWa = (root, find) => root.querySelectorAll('[data-wa]').forEach((b) => b.onclick = guard(async () => { const m = find(+b.dataset.wa); await api.whatsapp(m.tel, waText(m)); }));

let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
// errors go inside the open dialog (a toast would sit under the modal overlay), else a longer toast
function fail(e) {
  if (!dlg.open) return toast(e.message, 5000);
  let p = dlg.querySelector('.err');
  if (!p) {
    p = document.createElement('p'); p.className = 'err'; p.setAttribute('role', 'alert');
    const h = dlg.querySelector('h3');
    h ? h.after(p) : dlg.firstElementChild.prepend(p);
  }
  p.textContent = e.message;
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };

function modal(html, onSubmit, { wide = false, tall = false } = {}) {
  dlg.innerHTML = `<form method="dialog">${html}<button type="button" class="x" aria-label="Fermer" title="Fermer"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></form>`;
  const f = dlg.firstElementChild;
  f.querySelector(".x").onclick = () => dlg.close(); // same as Esc; type=button so Enter in a field never hits it; last in the DOM so showModal() still focuses the first field
  f.querySelectorAll('[data-dd]').forEach(initDd);
  // cancel buttons never submit: as the first submit button of the form they were its default button, so Enter in a field cancelled
  f.querySelectorAll('[value=cancel]').forEach((b) => { b.type = 'button'; b.onclick = () => dlg.close(); });
  f.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    f.querySelector('.err')?.remove();
    await onSubmit(Object.fromEntries(new FormData(f)));
    dlg.close();
  }));
  dlg.classList.toggle('wide', wide); // delivery, history: 880px
  dlg.classList.toggle('tall', tall); // member edit: scrolls instead of overflowing a short window (dialogs with a dropdown must stay overflow: visible)
  dlg.showModal();
  if (document.activeElement?.classList.contains('help')) document.activeElement.blur(); // a "?" as first focusable would open its tooltip at once
}
const planOpts = (plans) => plans.map((p) => ({ v: p.id, l: p.nom, sub: `${da(p.prix)} · ${p.jours} j${p.seances_sem ? ` · ${p.seances_sem}/sem` : ''}` }));
const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Styled replacement for <select> (and for <input list>): the value lives in a real input, so FormData still works.
// opts = [{ v, l, sub }]. free = text input that suggests the options while typing.
function dd(name, opts, value = '', { free = false, placeholder = '' } = {}) {
  const cur = opts.find((o) => String(o.v) === String(value)) ?? (free ? null : opts[0]);
  const list = opts.map((o) => `<button type="button" class="dd-opt" data-v="${esc(o.v)}" aria-selected="${cur === o}"><span>${esc(o.l)}</span>${o.sub ? `<span class="muted">${esc(o.sub)}</span>` : ''}</button>`).join('');
  return free
    ? `<div class="dd" data-dd data-free><input name="${name}" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}"><div class="dd-list" hidden>${list}</div></div>`
    : `<div class="dd" data-dd><input type="hidden" name="${name}" value="${esc(cur?.v ?? '')}"><button type="button" class="dd-btn"><span>${esc(cur?.l ?? '')}</span></button><div class="dd-list" hidden>${list}</div></div>`;
}
function initDd(el) {
  const list = el.querySelector('.dd-list'), input = el.querySelector('input'), btn = el.querySelector('.dd-btn'), free = 'free' in el.dataset;
  const shown = () => [...list.querySelectorAll('.dd-opt')].filter((o) => !o.hidden);
  let hi = -1;
  const mark = (i) => { const o = shown(); o.forEach((x, j) => x.classList.toggle('hi', j === i)); hi = i; o[i]?.scrollIntoView({ block: 'nearest' }); };
  const close = () => { list.hidden = true; btn?.setAttribute('aria-expanded', 'false'); mark(-1); };
  const open = () => { if (!shown().length) return; list.hidden = false; btn?.setAttribute('aria-expanded', 'true'); mark(free ? -1 : Math.max(0, shown().findIndex((x) => x.dataset.v === input.value))); };
  const choose = (o) => {
    input.value = o.dataset.v;
    input.dispatchEvent(new Event('change', { bubbles: true })); // lets a dialog react to the choice
    if (btn) btn.firstElementChild.textContent = o.firstElementChild.textContent;
    list.querySelectorAll('.dd-opt').forEach((x) => x.setAttribute('aria-selected', x === o));
    close();
  };
  const filter = () => {
    const v = input.value.trim().toLowerCase();
    list.querySelectorAll('.dd-opt').forEach((o) => { o.hidden = !!v && !o.dataset.v.toLowerCase().includes(v); });
    shown().length && !(shown().length === 1 && shown()[0].dataset.v.toLowerCase() === v) ? open() : close();
  };
  btn?.addEventListener('click', () => (list.hidden ? open() : close()));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus where it is
  list.addEventListener('click', (e) => { const o = e.target.closest('.dd-opt'); if (o) choose(o); });
  if (free) { input.addEventListener('input', filter); input.addEventListener('focus', filter); }
  el.addEventListener('keydown', (e) => {
    const n = shown().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); list.hidden ? open() : mark(Math.min(hi + 1, n - 1)); }
    else if (e.key === 'ArrowUp' && !list.hidden) { e.preventDefault(); mark(Math.max(hi - 1, 0)); }
    else if ((e.key === 'Enter' || (e.key === ' ' && !free)) && !list.hidden && hi >= 0) { e.preventDefault(); choose(shown()[hi]); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
  });
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) close(); });
}
const btns = (ok = 'Enregistrer') => `<div class="row"><button class="btn alt" value="cancel" formnovalidate>Annuler</button><button class="btn">${ok}</button></div>`;
// small "?" bubble to put inside a title (or a form label with cls 'sm'): the text shows on hover or keyboard focus
const help = (text, cls = '') => `<span class="help ${cls}" tabindex="0" role="note" aria-label="${esc(text)}">?<span class="tip" aria-hidden="true">${esc(text)}</span></span>`;
const HELP_VERSE = 'Vide = prix complet. Plus bas que le prix : le reste est noté en dette. La période commence à la fin actuelle (aujourd\'hui si expiré).';

// Caisse = two tabs: today's cash summary / payments history
const caisseTabs = (on, extra = '') => `<div class="row noprint" style="margin-bottom:20px">${[['caisse', 'Aujourd\'hui'], ['pay', 'Historique']].map(([k, l]) => `<button class="chip ${on === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}${extra ? `<div class="row end">${extra}</div>` : ''}</div>`;
const bindTabs = () => view.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => pages[b.dataset.tab]());

// stock text + status tag, shared by Boutique (tiles) and Produits (table)
const stockLabel = (p) => {
  const u = (n) => `${n} unité${n > 1 ? 's' : ''}`; // one unit of measure everywhere: "unités" (a unit = a whole item, tub or bottle); scoops are "doses"
  if (p.doses < 2) return u(p.stock);
  const b = Math.floor(p.stock / p.doses), d = p.stock % p.doses;
  return [b && u(b), d && `${d} dose${d > 1 ? 's' : ''}`].filter(Boolean).join(' + ') || '0';
};
// low = 5 units, or the last bottle for products sold by the dose
const stockState = (p) => (!p.stock ? 'out' : p.stock <= (p.doses > 1 ? p.doses : 5) ? 'low' : 'ok');
const stockPill = (p) => ({ out: '<span class="pill bad">Rupture</span>', low: '<span class="pill soon">Bientôt vide</span>', ok: '' })[stockState(p)];
// search helper: case- and accent-insensitive ("creatine" finds "Créatine")
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PER = 10;
const PER_PRODUCTS = 9; // Produits has two filter rows, so one row fewer fits on screen
const pagerHtml = (n, p, per = PER) => n <= per ? '' : `<div class="row pager"><button type="button" class="chip" data-pg="${p - 1}" ${p === 0 ? 'disabled' : ''}>←</button><span class="muted">${p * per + 1}–${Math.min(n, (p + 1) * per)} sur ${n}</span><button type="button" class="chip" data-pg="${p + 1}" ${(p + 1) * per >= n ? 'disabled' : ''}>→</button></div>`;
const bindPager = (cb) => view.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => cb(+b.dataset.pg));

// Boutique (POS): the ticket in progress, [{ id, dose, qty }]. Module level so it survives a visit to another page (not an app restart).
let shopCart = [];

/* ---------- pages ---------- */
const pages = {
  async dash() {
    const [s, prods] = await Promise.all([api.stats(), api.products()]);
    const low = prods.filter((p) => stockState(p) !== 'ok').sort((a, b) => (stockState(a) === 'low') - (stockState(b) === 'low') || a.nom.localeCompare(b.nom, 'fr')); // ruptures first
    const st = pages.dash.state ??= { p: 0 };
    // row 1 = money, row 2 = members (each card opens Membres on the matching filter)
    view.innerHTML = `<h1>Tableau de bord</h1>
      <div class="grid">
        <div class="card dark" data-go="caisse" role="button" tabindex="0"><div class="k">Revenu du mois</div><div class="v">${s.revenuMois.toLocaleString('fr-DZ')}<small>DA</small></div></div>
        <div class="card" data-go="caisse" role="button" tabindex="0"><div class="k">Revenu aujourd'hui</div><div class="v">${s.revenuJour.toLocaleString('fr-DZ')}<small>DA</small></div></div>
        <div class="card" data-go="shop" role="button" tabindex="0"><div class="k">Ventes boutique (mois)</div><div class="v">${s.ventesMois.toLocaleString('fr-DZ')}<small>DA</small></div></div>
        <div class="card" data-go="members" data-f="dette" role="button" tabindex="0"><div class="k">Impayés · ${da(s.dettes.total)}</div><div class="v">${s.dettes.n}</div></div>
      </div>
      <div class="grid" style="margin-top:16px">
        <div class="card" data-go="members" data-f="actif" role="button" tabindex="0"><div class="k">Membres actifs</div><div class="v">${s.actifs}</div></div>
        <div class="card" data-go="members" data-f="soon" role="button" tabindex="0"><div class="k">Expirent sous 7 jours</div><div class="v">${s.expirent}</div></div>
        <div class="card" data-go="members" data-f="exp" role="button" tabindex="0"><div class="k">Abonnements expirés</div><div class="v" style="color:var(--sale)">${s.expires}</div></div>
        <div class="card" data-go="members" data-f="inactif" role="button" tabindex="0"><div class="k">Inactifs depuis ${INACTIF_J} j</div><div class="v">${s.inactifs}</div></div>
      </div>
      ${low.length ? `<div class="card low" data-go="products" data-s="${low.some((p) => stockState(p) === 'out') ? 'out' : 'low'}" role="button" tabindex="0"><div class="k">Stock à réapprovisionner · ${low.length}</div><div class="names">${low.map((p) => `<span>${esc(p.nom)} ${stockPill(p)}</span>`).join('')}</div></div>` : ''}
      <h2>À renouveler</h2><div id="renew"></div>`;
    // paged list, latest end date first (about to expire, then the most recently expired)
    const drawRenew = () => {
      const list = s.aRenouveler;
      st.p = Math.min(st.p, Math.max(0, Math.ceil(list.length / PER) - 1));
      $('#renew').innerHTML = list.length ? `<table><tr><th>Membre</th><th>Téléphone</th><th>Fin</th><th></th></tr>${list.slice(st.p * PER, (st.p + 1) * PER).map((m) => `
        <tr><td>${esc(m.nom)}</td><td>${telLink(m)}</td><td>${fdate(m.fin)}</td>
        <td class="acts"><button class="btn sm" data-renew="${m.id}">Renouveler</button></td></tr>`).join('')}</table>${pagerHtml(list.length, st.p)}`
        : '<div class="empty">Aucun abonnement à renouveler.</div>';
      $('#renew').querySelectorAll('[data-renew]').forEach((b) => b.onclick = () => renewDialog(+b.dataset.renew, 'dash'));
      bindWa($('#renew'), (id) => list.find((m) => m.id === id));
      bindPager((p) => { st.p = p; drawRenew(); });
    };
    drawRenew();
    // cards are shortcuts: Membres cards open the list already filtered
    view.querySelectorAll('[data-go]').forEach((c) => {
      const open = () => { if (c.dataset.f) pages.members.state = { q: '', f: c.dataset.f, p: 0 }; if (c.dataset.s) pages.products.state = { p: 0, q: '', s: c.dataset.s, cat: '' }; go(c.dataset.go); };
      c.onclick = open;
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  },

  async members() {
    const state = pages.members.state ??= { q: '', f: 'all', p: 0 };
    const all = await api.members(state.q);
    const t = todayStr(), w = plus7(), d14 = minus(INACTIF_J);
    const F = { all: () => true, actif: (m) => m.fin >= t, soon: (m) => m.fin >= t && m.fin <= w, exp: (m) => !m.fin || m.fin < t, dette: (m) => m.dette > 0,
      inactif: (m) => m.fin >= t && (!m.derniere || m.derniere < d14), archive: () => true };
    // archived members only appear in their own view; every other view and count ignores them
    const pool = (k) => all.filter((m) => (k === 'archive') === !!m.archive_le);
    const due = (m) => ['bad', 'soon'].includes(status(m)[0]); // a row carries « Renouveler » only when it is due; the fiche keeps it for a prepayment
    // sort: click a header (Nom / Fin) to toggle; members without an end date go last
    const srt = state.sort ??= { k: 'nom', d: 1 };
    const list = pool(state.f).filter(F[state.f]).sort((a, b) => srt.k === 'fin' ? (!a.fin) - (!b.fin) || srt.d * (a.fin < b.fin ? -1 : a.fin > b.fin ? 1 : 0) : srt.d * a.nom.localeCompare(b.nom, 'fr'));
    const th = (k, l) => `<th class="sort${srt.k === k ? ' on' : ''}" data-sort="${k}" title="Trier">${l}${srt.k === k ? (srt.d > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    state.p = Math.min(state.p, Math.max(0, Math.ceil(list.length / PER) - 1));
    const shown = list.slice(state.p * PER, (state.p + 1) * PER), photos = await fetchPhotos(shown);
    // what a filter means goes in the chip's tooltip; the Expirés view also carries the bulk-archive control (months input + button)
    const titles = { archive: 'Hors des listes et des statistiques, ne peuvent plus entrer. Paiements conservés.', inactif: `Abonnement valide mais aucune entrée depuis ${INACTIF_J} jours (ou jamais) : à relancer.` };
    const hints = { exp: list.length ? `<span class="row" style="gap:8px">Expirés depuis plus de <input id="oldm" type="number" min="1" max="60" step="1" value="${state.mois ?? 3}" style="width:76px;padding:4px 12px" aria-label="Mois"> mois : <button class="btn sm alt" id="arcold">Archiver…</button></span>` : '' };
    view.innerHTML = `<h1>Membres</h1>
      <div class="row" style="margin-bottom:16px">
        <input class="search" id="q" placeholder="Nom, téléphone ou n° membre" value="${esc(state.q)}">
        <div class="row end"><button class="btn" id="add">+ Nouveau membre</button></div>
      </div>
      <div class="row" style="margin-bottom:20px">
        ${[['all', 'Tous'], ['actif', 'Actifs'], ['soon', 'Bientôt'], ['exp', 'Expirés'], ['dette', 'Impayés'], ['inactif', 'Inactifs'], ['archive', 'Archivés']].map(([k, l]) => `<button class="chip ${state.f === k ? 'on' : ''}" data-f="${k}"${titles[k] ? ` title="${esc(titles[k])}"` : ''}>${l} ${pool(k).filter(F[k]).length}</button>`).join('')}
        ${hints[state.f] ? `<p class="muted" style="flex-basis:100%;margin:4px 4px 0;font-size:14px">${hints[state.f]}</p>` : ''}
      </div>
      ${list.length ? `<table><tr><th>N°</th>${th('nom', 'Nom')}<th>Téléphone</th><th>Abonnement</th>${th('fin', 'Fin')}<th>Statut</th><th></th></tr>${shown.map((m) => `
        <tr data-row="${m.id}"><td class="muted">${m.id}</td><td><div class="nm">${avatar(m, photos)}<button type="button" class="lnk" data-hist="${m.id}" title="Fiche"><b>${esc(m.nom)}</b></button></div></td><td>${telLink(m)}</td><td class="wrap">${esc(m.plan) || '—'}</td><td>${fdate(m.fin)}</td><td>${pill(m)}</td>
        <td class="acts">${m.archive_le
          ? `<button class="btn sm" data-unarchive="${m.id}">Réactiver</button>`
          : due(m) ? `<button class="btn sm" data-renew="${m.id}">Renouveler</button>` : ''}</td></tr>`).join('')}</table>${pagerHtml(list.length, state.p)}`
        : `<div class="empty">${state.f === 'archive' ? 'Aucun membre archivé.' : 'Aucun membre.'}</div>`}`;
    bindPager((p) => { state.p = p; pages.members(); });
    const q = $('#q');
    q.oninput = () => { state.q = q.value; state.p = 0; clearTimeout(q.t); q.t = setTimeout(async () => { await pages.members(); const n = $('#q'); n.focus(); n.setSelectionRange(99, 99); }, 200); };
    view.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.f = b.dataset.f; state.p = 0; pages.members(); });
    view.querySelectorAll('[data-sort]').forEach((h) => h.onclick = () => { state.sort = { k: h.dataset.sort, d: srt.k === h.dataset.sort ? -srt.d : 1 }; state.p = 0; pages.members(); });
    $('#add').onclick = () => memberDialog();
    view.querySelectorAll('[data-hist]').forEach((b) => b.onclick = () => historyDialog(+b.dataset.hist));
    // the row is the entry point (the name button stays for the keyboard); buttons inside the row keep their own action
    view.querySelectorAll('tr[data-row]').forEach((r) => r.onclick = (e) => { if (!e.target.closest('button')) historyDialog(+r.dataset.row); });
    bindWa(view, (id) => all.find((m) => m.id === id));
    $('#oldm')?.addEventListener('input', (e) => { state.mois = e.target.value; });
    $('#arcold')?.addEventListener('click', guard(async () => {
      const mois = Math.round(Number($('#oldm').value));
      const r = await api.archiveOld(mois, true);
      if (!r.n) return toast(!r.dettes ? 'Aucun membre expiré depuis si longtemps' : r.dettes > 1 ? `Aucun : les ${r.dettes} concernés doivent encore de l'argent` : 'Aucun : le seul concerné doit encore de l\'argent', 4000);
      modal(`<h3>Archiver ${r.n} membre${r.n > 1 ? 's' : ''} ?</h3><p class="muted" style="margin-top:12px">Abonnement terminé depuis plus de ${mois} mois (ou jamais abonné). Ils quittent les listes et les statistiques ; leurs paiements restent.</p>${r.dettes ? `<p style="margin-top:12px"><b>${r.dettes} ignoré${r.dettes > 1 ? 's' : ''}</b> : encore de l'argent dû.</p>` : ''}${btns('Archiver')}`,
        async () => { const d = await api.archiveOld(mois); toast(`${d.n} membre${d.n > 1 ? 's' : ''} archivé${d.n > 1 ? 's' : ''}`, 4000); pages.members(); });
    }));
    view.querySelectorAll('[data-renew]').forEach((b) => b.onclick = () => renewDialog(+b.dataset.renew, 'members'));
    view.querySelectorAll('[data-unarchive]').forEach((b) => b.onclick = guard(async () => { await api.unarchiveMember(+b.dataset.unarchive); toast('Membre réactivé'); pages.members(); }));
  },

  async checkin() {
    view.innerHTML = `<h1>Entrées${help('Tapez le n° ou le nom du membre, puis Entrée (ou cliquez sur son nom).')}</h1>
      <input class="scan" id="scan" placeholder="N° membre ou nom" autofocus autocomplete="off">
      <div id="sugg"></div><div id="res"></div><h2>Aujourd'hui <span class="muted" id="cnt"></span></h2><div id="today"></div>`;
    let rows = [], page = 0; // today's check-ins, newest first
    const drawToday = () => {
      page = Math.min(page, Math.max(0, Math.ceil(rows.length / PER) - 1));
      $('#cnt').textContent = rows.length ? `(${rows.length})` : '';
      $('#today').innerHTML = rows.length ? `<table>${rows.slice(page * PER, (page + 1) * PER).map((r) => `<tr><td class="muted" style="width:90px">${new Date(r.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td><td><b>${esc(r.nom)}</b></td><td class="muted num">N° ${r.id}</td><td class="acts"><button type="button" class="chip" data-undo="${r.id}" title="Retirer cette entrée (mauvaise personne)">Annuler</button></td></tr>`).join('')}</table>${pagerHtml(rows.length, page)}` : '<div class="empty" style="padding:20px">Aucune entrée pour le moment.</div>';
      bindPager((p) => { page = p; drawToday(); $('#scan').focus(); }); // keep the scan field ready
      $('#today').querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => undo(+b.dataset.undo, rows.find((r) => r.id === +b.dataset.undo)?.nom ?? ''));
    };
    const renderToday = async () => { rows = await api.checkinsToday(); drawToday(); };
    renderToday();
    const scan = $('#scan'), sugg = $('#sugg');
    scan.focus();
    let timer, bannerT, hi = -1; // hi = keyboard-highlighted suggestion
    // wrong person checked in: after a confirmation, remove today's row (it also counted against the weekly limit)
    const undo = (id, nom) => modal(`<h3>Annuler l'entrée ?</h3><p class="muted" style="margin-top:12px">${esc(nom)} — l'entrée d'aujourd'hui est retirée et ne compte plus dans la semaine.</p>${btns("Retirer l'entrée")}`,
      async () => {
        await api.uncheckin(id);
        $('#res').innerHTML = ''; toast('Entrée annulée'); renderToday();
        setTimeout(() => $('#scan')?.focus(), 50); // once the dialog has closed (focus is blocked while it is open)
      });
    const enter = async (id, force = false) => {
      clearTimeout(timer);
      const r = await api.checkin(id, force);
      const name = r.member ? esc(r.member.nom) : '';
      const face = r.member ? avatar(r.member, { [r.member.id]: r.member.photo }, 's88') : '';
      const left = r.member?.fin ? Math.round((new Date(r.member.fin + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5) : -1;
      const soon = r.ok && left <= 7 ? (left === 0 ? 'Expire aujourd\'hui' : `Expire dans ${left} jour${left > 1 ? 's' : ''}`) : '';
      // green already says it (no « Entrée enregistrée »); an expiry refusal carries the date instead of a second « fin » on the name line
      const msg = r.ok ? (r.deja ? 'Déjà enregistré aujourd\'hui' : '') : r.code === 'expire' ? (r.member.fin ? `Expiré depuis le ${fdate(r.member.fin)}` : 'Aucun abonnement') : esc(r.motif);
      const sem = r.semaine, dayFmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      const week = !sem ? '' : r.ok ? `<div><strong>Séance ${sem.n} sur ${sem.max} cette semaine</strong></div>`
        : `<div><strong>Prochaine séance : ${new Date(sem.reprise + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></div><div style="opacity:.85">Venu cette semaine : ${sem.jours.map(dayFmt).join(' · ')}</div>`;
      const renew = r.member && ((!r.ok && r.code === 'expire') || soon) ? `<button class="btn alt" id="rn">Renouveler</button>` : '';
      const due = r.member?.dette > 0 ? `<div><strong>Reste à payer : ${da(r.member.dette)}</strong></div>` : '';
      const settle = due ? `<button class="btn alt" id="sd">Encaisser</button>` : '';
      const undoBtn = r.ok ? `<button class="btn alt" id="undo">Annuler l'entrée</button>` : '';
      const okBtn = r.code === 'quota' ? `<button class="btn alt" id="force">Autoriser quand même</button>` : ''; // desk exception to the weekly limit; « Annuler l'entrée » takes it back
      $('#res').innerHTML = `<div class="result ${r.ok ? 'ok' : 'bad'}"><div class="who">${face}<div><b>${r.ok ? 'Bienvenue' : 'Accès refusé'}</b><div>${name}${r.member && !soon && r.code !== 'expire' ? ` — fin ${fdate(r.member.fin)}` : ''}</div></div></div><div style="text-align:right">${msg}${soon ? `<div><strong>${soon}</strong></div>` : ''}${week}${due}${renew || settle || undoBtn || okBtn ? `<div class="row" style="justify-content:flex-end;margin-top:12px">${renew}${settle}${undoBtn}${okBtn}</div>` : ''}</div></div>`;
      if (renew) $('#rn').onclick = () => renewDialog(id, () => enter(id)); // after paying, check the member in
      if (settle) $('#sd').onclick = () => settleDialog(r.member, () => enter(id));
      if (undoBtn) $('#undo').onclick = () => undo(id, r.member.nom);
      if (okBtn) $('#force').onclick = guard(() => enter(id, true));
      // clear the banner so it never looks like the current person; keep it longer when it carries a Renouveler button
      clearTimeout(bannerT);
      bannerT = setTimeout(() => { const el = $('#res'); if (el) el.innerHTML = ''; }, r.ok && !soon ? 6000 : 15000);
      if (r.ok && !r.deja) page = 0; // a new arrival shows on the first page
      scan.value = ''; sugg.innerHTML = ''; hi = -1; renderToday(); scan.focus();
    };
    // live suggestions: name, phone or n°; click one (or arrow down + Enter) to check in
    const mark = (i) => { [...sugg.children].forEach((x, j) => x.classList.toggle('hi', j === i)); hi = i; };
    scan.oninput = () => {
      clearTimeout(timer); hi = -1;
      timer = setTimeout(guard(async () => {
        const v = scan.value.trim();
        if (!v) { sugg.innerHTML = ''; return; }
        const hits = (await api.members(v)).filter((m) => !m.archive_le).slice(0, 6), photos = await fetchPhotos(hits);
        if (scan.value.trim() !== v) return;
        sugg.innerHTML = hits.map((m) => `<button class="sugg" data-id="${m.id}">${avatar(m, photos)}<b>${esc(m.nom)}</b><span class="muted">${esc(m.tel)} · N° ${m.id}</span>${pill(m)}</button>`).join('');
        sugg.querySelectorAll('[data-id]').forEach((b) => b.onclick = guard(() => enter(+b.dataset.id)));
      }), 150);
    };
    scan.onkeydown = guard(async (e) => {
      const n = sugg.children.length;
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); return mark(Math.min(hi + 1, n - 1)); }
      if (e.key === 'ArrowUp' && n) { e.preventDefault(); return mark(Math.max(hi - 1, 0)); }
      if (e.key === 'Escape') { scan.value = ''; sugg.innerHTML = ''; hi = -1; return; }
      if (e.key !== 'Enter' || !scan.value.trim()) return;
      if (hi >= 0 && sugg.children[hi]) return enter(+sugg.children[hi].dataset.id);
      const v = scan.value.trim(), found = await api.members(v), hits = found.filter((m) => !m.archive_le);
      const hit = found.find((m) => String(m.id) === v) ?? (hits.length === 1 ? hits[0] : null); // an exact n° also finds an archived member, to show why they cannot enter
      if (!hit) { toast(hits.length ? `${hits.length} résultats — choisissez dans la liste` : found.length ? 'Membre archivé — réactivez-le dans Membres' : 'Aucun membre trouvé'); return; }
      await enter(hit.id);
    });
  },

  async pay() {
    const all = await api.payments(), st = pages.pay.state ??= { p: 0 };
    const total = all.reduce((a, r) => a + r.montant, 0);
    const rows = all.slice(st.p * PER, (st.p + 1) * PER);
    view.innerHTML = `<h1>Caisse</h1>${caisseTabs('pay')}
      ${rows.length ? `<table><tr><th>Date</th><th>Membre</th><th>Abonnement</th><th>Période</th><th class="num">Montant</th><th></th></tr>${rows.map((r) => `
        <tr><td>${fdate(r.date)}</td><td><b>${esc(r.nom)}</b></td><td class="wrap">${esc(r.plan) || '—'}</td><td class="muted">${fdate(r.debut)} → ${fdate(r.fin)}</td><td class="num">${da(r.montant)}${r.dette > 0 ? `<div><span class="pill bad">Reste ${da(r.dette)}</span></div>` : ''}</td>
        <td class="acts">${r.annulable ? `<button class="btn sm alt" data-cancel="${r.id}">Annuler</button>` : ''}</td></tr>`).join('')}
        <tr><td colspan="4" class="muted">Total (200 derniers)</td><td class="num"><b>${da(total)}</b></td><td></td></tr></table>${pagerHtml(all.length, st.p)}` : '<div class="empty">Aucun paiement.</div>'}`;
    bindTabs();
    bindPager((p) => { st.p = p; pages.pay(); });
    view.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => {
      const r = all.find((x) => x.id == b.dataset.cancel);
      modal(`<h3>Annuler le paiement ?</h3><p class="muted" style="margin-top:12px">${esc(r.nom)} — ${esc(r.plan) || '—'} — ${da(r.montant)}.<br>Le paiement est supprimé et la fin d'abonnement du membre revient à son état d'avant. Pour corriger une erreur, annulez puis renouvelez avec le bon abonnement.</p>${btns('Annuler le paiement')}`,
        async () => { await api.cancelPayment(r.id); toast('Paiement annulé'); pages.pay(); });
    });
  },

  async caisse() {
    const st = pages.caisse.state ??= { date: todayStr() };
    const c = await api.caisse(st.date);
    const sum = (a) => a.reduce((s, x) => s + x.total, 0);
    const abos = c.reglements.n ? [...c.abos, { nom: 'Règlements de dettes', n: c.reglements.n, total: c.reglements.total }] : c.abos;
    const tAbos = sum(abos), tVentes = sum(c.ventes);
    // no section title over a table: its first header (Abonnement / Produit) names it, and the cards above show the same split; an empty one is simply not shown
    const tbl = (rows, label) => (rows.length ? `<table style="margin-top:28px"><tr><th>${label}</th><th class="num">Nombre</th><th class="num">Total</th></tr>${rows.map((r) => `
      <tr><td><b>${esc(r.nom)}</b>${r.dose ? ' <span class="muted">(dose)</span>' : ''}</td><td class="num">${r.n}</td><td class="num">${da(r.total)}</td></tr>`).join('')}</table>` : '');
    view.innerHTML = `<h1>Caisse</h1>${caisseTabs('caisse', `<input type="date" id="cd" value="${st.date}" style="width:auto"><button class="btn alt" id="xls" title="Toutes les opérations du mois en Excel">Exporter le mois</button><button class="btn" id="print">Imprimer</button>`)}
      <p class="muted printonly">Caisse du ${fdate(st.date)}</p>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="card dark"><div class="k">Total</div><div class="v">${(tAbos + tVentes).toLocaleString('fr-DZ')}<small>DA</small></div></div>
        <div class="card"><div class="k">Abonnements</div><div class="v">${tAbos.toLocaleString('fr-DZ')}<small>DA</small></div></div>
        <div class="card"><div class="k">Boutique</div><div class="v">${tVentes.toLocaleString('fr-DZ')}<small>DA</small></div></div>
      </div>
      ${tbl(abos, 'Abonnement')}${tbl(c.ventes, 'Produit')}`;
    bindTabs();
    $('#cd').onchange =(e) => { if (e.target.value) { st.date = e.target.value; pages.caisse(); } };
    $('#print').onclick = () => window.print();
    $('#xls').onclick = guard(async () => { if (await api.exportCaisse(st.date.slice(0, 7))) toast('Export enregistré'); });
  },

  // Point of sale: tap products to build the ticket on the right, enter the cash received, give the change, validate.
  // The ticket in progress lives in `shopCart` (module level), so it survives a visit to another page.
  async shop() {
    const [prods, tickets] = await Promise.all([api.products(), api.ticketsToday()]);
    const st = pages.shop.state ??= { cat: '', q: '', last: null };
    const byId = new Map(prods.map((p) => [p.id, p]));
    // the catalogue may have changed since the ticket was started: drop vanished products, clamp quantities to the stock
    const used = new Map();
    shopCart = shopCart.filter((l) => {
      const p = byId.get(l.id);
      if (!p || (l.dose && p.doses < 2)) return false;
      const f = l.dose ? 1 : p.doses;
      l.qty = Math.min(l.qty, Math.floor((p.stock - (used.get(p.id) ?? 0)) / f));
      if (l.qty < 1) return false;
      used.set(p.id, (used.get(p.id) ?? 0) + l.qty * f);
      return true;
    });
    const cats = [...new Set(prods.map((p) => p.categorie).filter(Boolean))];
    if (st.cat && st.cat !== '__none' && !cats.includes(st.cat)) st.cat = '';
    const chips = cats.length ? [['', 'Tous'], ...cats.map((c) => [c, c]), ...(prods.some((p) => !p.categorie) ? [['__none', 'Autres']] : [])]
      .map(([k, l]) => `<button type="button" class="chip" data-cat-chip="${esc(k)}">${esc(l)}</button>`).join('') : '';
    const sold = tickets.reduce((a, t) => a + t.total, 0);
    const big = (n) => `${Number(n).toLocaleString('fr-DZ')}<small>DA</small>`;
    const price = (l) => (l.dose ? byId.get(l.id).prix_dose : byId.get(l.id).prix);
    const total = () => shopCart.reduce((a, l) => a + l.qty * price(l), 0);
    const units = (l) => (l.dose ? l.qty : l.qty * byId.get(l.id).doses);
    const avail = (p) => p.stock - shopCart.filter((l) => l.id === p.id).reduce((a, l) => a + units(l), 0); // stock not yet in the ticket

    view.innerHTML = `<div class="pos-top"><h1>Boutique</h1>
        <button type="button" class="lnk muted" id="tkday" title="Ventes du jour">${tickets.length} ticket${tickets.length > 1 ? 's' : ''} · ${da(sold)} aujourd'hui →</button></div>
      <div class="row" style="margin-bottom:16px">
        <input class="search" id="q" placeholder="Chercher un produit" value="${esc(st.q)}" autocomplete="off">${chips}
      </div>
      <div class="pos">
        ${prods.length ? '<div class="ptiles" id="ptiles"></div>' : '<div class="empty">Aucun produit. <button type="button" class="btn sm" id="goprod" style="margin-left:8px">Ajouter des produits</button></div>'}
        <aside class="ticket">
          <div id="tkbanner"></div>
          <div class="tk-head"><b>Ticket</b><span class="muted" id="tkcount"></span><button type="button" class="chip" id="tkclear">Vider</button></div>
          <div class="tk-lines" id="tklines"></div>
          <div class="tk-sum"><span>Total</span><b id="tktotal"></b></div>
          <input id="tkrecu" type="number" min="0" step="1" placeholder="Montant reçu" title="Vide = montant exact" aria-label="Montant reçu en DA" autocomplete="off">
          <div class="tk-quick" id="tkquick"></div>
          <div class="tk-change" id="tkchange"></div>
          <button type="button" class="btn tk-pay" id="tkpay">Encaisser</button>
        </aside>
      </div>`;

    // one tile per product: tap = add to the ticket. A product sold by the dose has two buttons (whole unit / dose)
    const tile = (p) => {
      const a = avail(p), n = shopCart.filter((l) => l.id === p.id).reduce((s, l) => s + l.qty, 0);
      const head = `<span class="pn">${esc(p.nom)}</span><span class="pm">${p.stock ? stockLabel(p) : ''}${stockPill(p)}</span>`;
      const badge = n ? `<span class="pc">${n}</span>` : '';
      if (p.doses > 1) {
        return `<div class="ptile dual ${n ? 'in' : ''}">${head}<div class="pd">
          <button type="button" data-add="${p.id}" ${a < p.doses ? 'disabled' : ''}><span>Unité</span><b>${da(p.prix)}</b></button>
          <button type="button" data-add="${p.id}" data-dose="1" ${a < 1 ? 'disabled' : ''}><span>Dose</span><b>${da(p.prix_dose)}</b></button></div>${badge}</div>`;
      }
      return `<button type="button" class="ptile ${n ? 'in' : ''}" data-add="${p.id}" ${a < 1 ? 'disabled' : ''}>${head}<span class="pp">${big(p.prix)}</span>${badge}</button>`;
    };
    const drawTiles = () => {
      view.querySelectorAll('[data-cat-chip]').forEach((c) => c.classList.toggle('on', c.dataset.catChip === st.cat));
      const box = $('#ptiles');
      if (!box) return;
      const list = visible();
      box.innerHTML = list.length ? list.map(tile).join('') : '<div class="empty">Aucun produit ne correspond.</div>';
    };
    const visible = () => prods.filter((p) => norm(p.nom + ' ' + (p.categorie || '') + ' ' + (p.code_barre || '')).includes(norm(st.q)) && (!st.cat || (st.cat === '__none' ? !p.categorie : p.categorie === st.cat)));
    const drawTicket = () => {
      const t = total(), raw = $('#tkrecu').value.trim(), recu = raw === '' ? null : Number(raw);
      const short = recu !== null && recu < t;
      $('#tkbanner').innerHTML = st.last && !shopCart.length
        ? `<div class="tk-done"><span>Ticket n° ${st.last.ticket} encaissé</span><b>Rendu ${da(st.last.rendu)}</b><span>Reçu ${da(st.last.recu)} · Total ${da(st.last.total)}</span></div>` : '';
      $('#tkcount').textContent = shopCart.length ? `${shopCart.reduce((a, l) => a + l.qty, 0)} article${shopCart.reduce((a, l) => a + l.qty, 0) > 1 ? 's' : ''}` : '';
      $('#tkclear').style.display = shopCart.length ? '' : 'none';
      $('#tklines').innerHTML = shopCart.length ? shopCart.map((l, i) => {
        const p = byId.get(l.id);
        return `<div class="tk-line"><div><b>${esc(p.nom)}</b>${l.dose ? ' <span class="muted">(dose)</span>' : ''}<div class="tk-p">${da(price(l))}</div></div>
          <div class="tk-q"><button type="button" data-dec="${i}">−</button><span>${l.qty}</span><button type="button" data-inc="${i}" ${avail(p) >= (l.dose ? 1 : p.doses) ? '' : 'disabled'}>+</button></div>
          <div class="tk-t">${da(l.qty * price(l))}</div><button type="button" class="tk-x" data-rm="${i}" title="Retirer">×</button></div>`;
      }).join('') : '<div class="tk-empty">Touchez un produit pour l\'ajouter au ticket.</div>';
      $('#tktotal').innerHTML = big(t);
      // suggested cash amounts: the exact total, then the next round amounts
      const tenders = [...new Set([t, ...[100, 500, 1000, 2000].map((s) => Math.ceil(t / s) * s)])].sort((a, b) => a - b).slice(0, 3);
      $('#tkquick').innerHTML = t ? tenders.slice(1).map((v) => `<button type="button" class="chip" data-recu="${v}">${da(v)}</button>`).join('') : ''; // no « Exact » chip: an empty field already means exact
      $('#tkchange').className = `tk-change${short ? ' short' : ''}`;
      $('#tkchange').innerHTML = !t || recu === null ? '' : short ? `<span>Reste à payer</span><b>${da(t - recu)}</b>` : `<span>Rendu à donner</span><b>${da(recu - t)}</b>`;
      $('#tkpay').disabled = !t || short;
      $('#tkpay').textContent = t ? `Encaisser · ${da(t)}` : 'Encaisser';
    };
    const draw = () => { drawTiles(); drawTicket(); };
    const add = (id, dose) => {
      const p = byId.get(id);
      if (avail(p) < (dose ? 1 : p.doses)) return toast('Stock insuffisant');
      st.last = null;
      const l = shopCart.find((x) => x.id === id && x.dose === dose);
      if (l) l.qty++; else shopCart.push({ id, dose, qty: 1 });
      draw();
    };

    $('#q').oninput = (e) => { st.q = e.target.value; drawTiles(); };
    // Enter = add the product whose barcode is the text typed (a USB scanner types the code then Enter), else the first tile shown; then clear the search
    $('#q').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const q = st.q.trim();
      if (!q) return;
      const p = prods.find((x) => x.code_barre && x.code_barre === q) ?? visible()[0];
      if (!p) return toast('Aucun produit ne correspond');
      st.q = ''; e.target.value = '';
      add(p.id, false);
    };
    view.querySelectorAll('[data-cat-chip]').forEach((c) => c.onclick = () => { st.cat = c.dataset.catChip; drawTiles(); });
    $('#ptiles')?.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b && !b.disabled) add(+b.dataset.add, !!b.dataset.dose); });
    $('#tklines').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = +(b.dataset.inc ?? b.dataset.dec ?? b.dataset.rm), l = shopCart[i];
      if (!l) return;
      if (b.dataset.inc !== undefined) { if (avail(byId.get(l.id)) >= (l.dose ? 1 : byId.get(l.id).doses)) l.qty++; }
      else if (b.dataset.dec !== undefined && l.qty > 1) l.qty--;
      else shopCart.splice(i, 1);
      draw();
    });
    $('#tkclear').onclick = () => { shopCart = []; $('#tkrecu').value = ''; draw(); };
    $('#tkquick').addEventListener('click', (e) => { const b = e.target.closest('[data-recu]'); if (b) { $('#tkrecu').value = b.dataset.recu; drawTicket(); } });
    $('#tkrecu').oninput = drawTicket;
    $('#tkrecu').onkeydown = (e) => { if (e.key === 'Enter' && !$('#tkpay').disabled) $('#tkpay').click(); };
    $('#tkpay').onclick = async () => {
      const raw = $('#tkrecu').value.trim();
      try {
        const r = await api.checkout(shopCart.map(({ id, dose, qty }) => ({ id, dose, qty })));
        const recu = raw === '' ? r.total : Number(raw);
        shopCart = [];
        st.last = { ticket: r.ticket, total: r.total, recu, rendu: Math.max(0, recu - r.total) };
      } catch (e) { fail(e); }
      pages.shop(); // fresh stock and day totals, an empty ticket, and the change to give back
    };
    $('#tkday').onclick = () => salesDialog(tickets);
    $('#goprod')?.addEventListener('click', () => go('products'));
    draw();
  },

  // product catalogue + stock (setup); selling happens in Boutique
  async products() {
    const st = pages.products.state ??= { p: 0, q: '', s: 'all', cat: '' };
    const prods = await api.products();
    const stock = stockLabel;
    const cats = [...new Set(prods.map((p) => p.categorie).filter(Boolean))];
    const hasDose = prods.some((p) => p.doses > 1); // « Prix dose » column only when something is sold by the dose
    if (st.cat && st.cat !== '__none' && !cats.includes(st.cat)) st.cat = '';
    view.innerHTML = `<h1>Produits</h1>
      <div class="row" style="margin-bottom:16px">
        <input class="search" id="q" placeholder="Nom ou catégorie" value="${esc(st.q)}">
        <div class="row end"><button class="btn alt" id="rs" ${prods.length ? '' : 'disabled'}>Réapprovisionner</button><button class="btn" id="add">+ Nouveau produit</button></div>
      </div>
      <div id="flt" style="margin-bottom:20px"></div>
      <div id="tbl"></div>`;
    // filters combine (search + stock status + category); chip counts follow the other active filters
    const catOf = (p) => p.categorie || '__none';
    const matches = (p, skip) => (skip === 'q' || !norm(st.q) || norm(p.nom + ' ' + (p.categorie || '') + ' ' + (p.code_barre || '')).includes(norm(st.q)))
      && (skip === 's' || st.s === 'all' || stockState(p) === st.s) && (skip === 'c' || !st.cat || catOf(p) === st.cat);
    const draw = () => {
      const list = prods.filter((p) => matches(p));
      st.p = Math.min(st.p, Math.max(0, Math.ceil(list.length / PER_PRODUCTS) - 1));
      const chip = (g, k, l, n) => `<button class="chip ${st[g] === k ? 'on' : ''}" data-${g}="${esc(k)}">${esc(l)} ${n}</button>`;
      const frow = (chips) => `<div class="frow"><div class="row" style="gap:8px">${chips}</div></div>`; // the chips name themselves (Rupture…, Boissons…): no row label
      $('#flt').innerHTML = frow([['all', 'Tous'], ['out', 'Rupture'], ['low', 'Bientôt vide'], ['ok', 'En stock']]
        .map(([k, l]) => chip('s', k, l, prods.filter((p) => matches(p, 's') && (k === 'all' || stockState(p) === k)).length)).join(''))
        + (cats.length ? frow([['', 'Toutes'], ...cats.map((c) => [c, c]), ...(prods.some((p) => !p.categorie) ? [['__none', 'Sans catégorie']] : [])]
          .map(([k, l]) => chip('cat', k, l, prods.filter((p) => matches(p, 'c') && (k === '' || catOf(p) === k)).length)).join('')) : '');
      $('#tbl').innerHTML = list.length ? `<table><tr><th>Produit</th><th class="num">Prix</th>${hasDose ? '<th class="num">Prix dose</th>' : ''}<th>Stock</th></tr>${list.slice(st.p * PER_PRODUCTS, (st.p + 1) * PER_PRODUCTS).map((p) => `
        <tr data-row="${p.id}"><td><b>${esc(p.nom)}</b>${p.categorie || p.code_barre ? `<div class="sub">${esc([p.categorie, p.code_barre].filter(Boolean).join(' · '))}</div>` : ''}</td><td class="num">${da(p.prix)}</td>${hasDose ? `<td class="num">${p.doses > 1 ? da(p.prix_dose) : '—'}</td>` : ''}
        <td>${p.stock ? stock(p) + ' ' : ''}${stockPill(p)}</td></tr>`).join('')}</table>${pagerHtml(list.length, st.p, PER_PRODUCTS)}`
        : `<div class="empty">${prods.length ? 'Aucun produit ne correspond.' : 'Aucun produit. Ajoutez eau, boissons, compléments…'}</div>`;
      $('#flt').querySelectorAll('[data-s]').forEach((c) => c.onclick = () => { st.s = c.dataset.s; st.p = 0; draw(); });
      $('#flt').querySelectorAll('[data-cat]').forEach((c) => c.onclick = () => { st.cat = c.dataset.cat; st.p = 0; draw(); });
      bindPager((p) => { st.p = p; draw(); });
      view.querySelectorAll('tr[data-row]').forEach((r) => r.onclick = () => dialog(prods.find((p) => p.id == r.dataset.row))); // the row opens the product
    };
    $('#q').oninput = (e) => { st.q = e.target.value; st.p = 0; draw(); };
    $('#rs').onclick = () => restockDialog(prods);
    const dialog = (p = {}) => {
      modal(`<h3>${p.id ? 'Modifier' : 'Nouveau'} produit</h3>
        <input type="hidden" name="id" value="${p.id ?? ''}">
        <label>Nom</label><input name="nom" required value="${esc(p.nom)}">
        <label>Catégorie</label>${dd('categorie', [...new Set(prods.map((x) => x.categorie).filter(Boolean))].map((c) => ({ v: c, l: c })), p.categorie || '', { free: true, placeholder: 'Optionnel — ex. Boissons' })}
        <label>Code-barres</label><input name="code_barre" inputmode="numeric" autocomplete="off" placeholder="Optionnel — scannez ou tapez" value="${esc(p.code_barre)}">
        <label>Prix de l'unité (DA)</label><input name="prix" type="number" min="0" required value="${p.prix ?? ''}">
        ${p.id ? (p.doses > 1 ? `<label>Prix de la dose (DA)</label><input name="prix_dose" type="number" min="0" required value="${p.prix_dose}">` : '')
          : `<label>Doses par unité${help('Produit aussi vendu à la dose (whey, créatine…) : nombre de doses dans une unité. Vide sinon.', 'sm')}</label><input name="doses" type="number" min="2" step="1" placeholder="Vide = vendu entier">
             <label>Prix de la dose (DA)</label><input name="prix_dose" type="number" min="0">
             <label>Stock initial</label><input name="stock" type="number" min="0" step="1" placeholder="0 unité">`}
        ${btns()}${p.id ? '<button type="button" class="btn sm danger" id="del" style="margin-top:20px">Supprimer</button>' : ''}`,
        async (d) => {
          await api.saveProduct({ id: d.id ? +d.id : null, nom: d.nom.trim(), prix: +d.prix, doses: d.doses ? +d.doses : 1, prix_dose: d.prix_dose ? +d.prix_dose : null, stock: +d.stock || 0, categorie: d.categorie, code_barre: d.code_barre });
          toast('Enregistré'); pages.products();
        });
      if (p.id) $('#del').onclick = () => {
        dlg.close();
        modal(`<h3>Supprimer ?</h3><p class="muted" style="margin-top:12px">${esc(p.nom)} sera retiré. L'historique des ventes est conservé.</p>${btns('Supprimer')}`,
          async () => { await api.deleteProduct(p.id); toast('Produit supprimé'); pages.products(); });
      };
    };
    $('#add').onclick = () => dialog();
    draw();
  },

  async plans() {
    const plans = await api.plans();
    view.innerHTML = `<h1>Formules</h1>
      <div class="row" style="margin-bottom:20px;justify-content:flex-end"><button class="btn" id="add">+ Nouvelle formule</button></div>
      <table><tr><th>Nom</th><th class="num">Durée (jours)</th><th class="num">Séances / semaine</th><th class="num">Prix</th></tr>${plans.map((p) => `
        <tr data-row="${p.id}"><td><b>${esc(p.nom)}</b></td><td class="num">${p.jours}</td><td class="num">${p.seances_sem ?? '<span class="muted" title="Illimité">∞</span>'}</td><td class="num">${da(p.prix)}</td></tr>`).join('')}</table>`;
    // the row opens the formule; « Supprimer » sits in the dialog, like a product's
    const dialog = (p = {}) => {
      modal(`<h3>${p.id ? 'Modifier la' : 'Nouvelle'} formule</h3>
      <input type="hidden" name="id" value="${p.id ?? ''}">
      <label>Nom</label><input name="nom" required value="${esc(p.nom)}">
      <label>Durée (jours)</label><input name="jours" type="number" min="1" required value="${p.jours ?? 30}">
      <label>Séances par semaine${help(`Jours de présence autorisés par semaine (du ${DAYS_FR[APP.weekStart]} au ${DAYS_FR[(APP.weekStart + 6) % 7]}). Vide = illimité.`, 'sm')}</label><input name="seances_sem" type="number" min="1" max="7" step="1" placeholder="Illimité" value="${p.seances_sem ?? ''}">
      <label>Prix (DA)</label><input name="prix" type="number" min="0" step="1" required value="${p.prix ?? ''}">${btns()}${p.id ? '<button type="button" class="btn sm danger" id="del" style="margin-top:20px">Supprimer</button>' : ''}`,
      async (d) => { await api.savePlan({ id: d.id ? +d.id : null, nom: d.nom.trim(), jours: +d.jours, prix: +d.prix, seances_sem: d.seances_sem === '' ? null : +d.seances_sem }); toast('Enregistré'); pages.plans(); });
      if (p.id) $('#del').onclick = () => {
        dlg.close();
        modal(`<h3>Supprimer ?</h3><p class="muted" style="margin-top:12px">Formule « ${esc(p.nom)} ». Impossible si elle est utilisée par un membre ou un paiement.</p>${btns('Supprimer')}`,
          async () => { await api.deletePlan(p.id); toast('Formule supprimée'); pages.plans(); });
      };
    };
    $('#add').onclick = () => dialog();
    view.querySelectorAll('tr[data-row]').forEach((r) => r.onclick = () => dialog(plans.find((p) => p.id == r.dataset.row)));
  },
};

// Member dialog, three zones: a header (photo, n°, status, photo buttons) in edit mode; the form in two groups, Identité then
// Abonnement (end date with the pause button beside it, or formule + amount for a new member); under a hairline the rare actions
// (Historique, Archiver / Réactiver) and the hard delete alone on its own line, right, as a red text button.
async function memberDialog(m = {}) {
  const [plans, photos] = await Promise.all([api.plans(), m.id ? api.photos([m.id]) : {}]);
  const arch = !!m.archive_le;
  const paused = !arch && !!m.gel_fin && m.gel_fin >= todayStr(); // a pause in progress or planned
  const head = !m.id ? '<h3>Nouveau membre</h3>' : `<div class="row hd">${avatar(m, photos, 's64')}<div><h3>Membre n° ${m.id}</h3>
    <p class="muted">${m.fin ? `Fin ${fdate(m.fin)} ` : ''}${pill(m)}${m.dette > 0 ? ` <span class="pill bad">Doit ${da(m.dette)}</span>` : ''}</p>
    <div class="row ph"><button type="button" class="btn sm alt" id="cam">Webcam</button><button type="button" class="btn sm alt" id="pick">Fichier…</button>${photos[m.id] ? '<button type="button" class="btn sm txt danger" id="rmph">Retirer</button>' : ''}</div></div></div>`;
  const pauseBtn = arch ? '' : paused ? '<button type="button" class="btn sm alt" id="gel">Reprendre maintenant</button>'
    : m.fin >= todayStr() ? '<button type="button" class="btn sm alt" id="gel">Mettre en pause…</button>' : '';
  const abo = m.id
    ? `<label>Fin d'abonnement${help("À corriger à la main seulement (jours offerts, erreur d'import) : un renouvellement la calcule tout seul.", 'sm')}</label>
      <div class="row fin"><input name="fin" type="date" value="${esc(m.fin ?? '')}">${pauseBtn}</div>
      ${paused ? `<p class="muted note">Pause du ${fdate(m.gel_debut)} au ${fdate(m.gel_fin)}.</p>` : ''}
      ${arch ? `<p class="muted note">Archivé le ${fdate(m.archive_le)} : hors des listes, ne peut plus entrer.</p>` : ''}`
    : `<label>Formule${help('Le paiement est enregistré aussitôt avec la formule choisie. « Aucune » : membre créé sans abonnement.', 'sm')}</label>${dd('plan_id', [{ v: '', l: 'Aucune' }, ...planOpts(plans)], '')}
      <label>Montant versé (DA)${help(HELP_VERSE, 'sm')}</label><input name="verse" type="number" min="0" step="1" placeholder="Prix complet">`;
  const foot = !m.id ? '' : `<div class="zone"><div class="row"><button type="button" class="btn sm alt" id="hist">Historique</button>${arch
      ? '<button type="button" class="btn sm" id="unarch">Réactiver</button>' : '<button type="button" class="btn sm alt" id="arch">Archiver</button>'}
    <button type="button" class="btn sm txt danger" id="del">Supprimer</button></div></div>`;
  modal(`${head}
    <input type="hidden" name="id" value="${m.id ?? ''}">
    <div class="grp">Identité</div>
    <label>Nom complet</label><input name="nom" required value="${esc(m.nom)}">
    <label>Téléphone</label><input name="tel" inputmode="tel" placeholder="0555 12 34 56" value="${esc(m.tel)}">
    <label>Notes</label><input name="notes" value="${esc(m.notes)}">
    <div class="grp">Abonnement</div>
    ${abo}${btns()}${foot}`,
    async (d) => {
      const id = await api.saveMember({ id: d.id ? +d.id : null, nom: d.nom, tel: d.tel, notes: d.notes, fin: d.fin, plan_id: d.plan_id ? +d.plan_id : null, verse: d.verse === '' ? null : d.verse });
      toast(d.id ? 'Enregistré' : `Membre créé — n° ${id}`, d.id ? 2200 : 5000); pages.members();
    }, { tall: !!m.id }); // the edit form is taller than a 640px window: it scrolls (no dropdown inside, so clipping is harmless)
  if (m.id) $('#hist').onclick = () => { dlg.close(); historyDialog(m.id); };
  if (m.id) {
    const reopen = (msg) => { dlg.close(); toast(msg); pages.members(); memberDialog(m); };
    $('#cam').onclick = () => { dlg.close(); photoDialog(m); };
    $('#pick').onclick = guard(async () => { if (await api.pickPhoto(m.id)) reopen('Photo enregistrée'); });
    $('#rmph')?.addEventListener('click', guard(async () => { await api.deletePhoto(m.id); reopen('Photo retirée'); }));
  }
  if (m.id) $('#gel')?.addEventListener('click', paused
    ? guard(async () => { const r = await api.unfreeze(m.id); dlg.close(); toast(`Reprise — nouvelle fin : ${fdate(r.fin)}`, 4000); pages.members(); })
    : () => { dlg.close(); freezeDialog(m); });
  if (m.id) {
    $('#unarch')?.addEventListener('click', guard(async () => { await api.unarchiveMember(m.id); dlg.close(); toast('Membre réactivé'); pages.members(); }));
    $('#arch')?.addEventListener('click', () => {
      dlg.close();
      modal(`<h3>Archiver ?</h3><p class="muted" style="margin-top:12px">${esc(m.nom)} quitte les listes et les statistiques et ne peut plus entrer. Ses paiements restent.</p>${m.fin >= todayStr() ? `<p style="margin-top:12px"><b>Son abonnement est encore valide jusqu'au ${fdate(m.fin)}.</b></p>` : ''}${btns('Archiver')}`,
        async () => { await api.archiveMember(m.id); toast('Membre archivé'); pages.members(); });
    });
    // hard delete is for mistakes: say what it would erase (past revenue shrinks with the payments)
    $('#del').onclick = guard(async () => {
      const paid = await api.memberPaid(m.id);
      dlg.close();
      modal(`<h3>Supprimer définitivement ?</h3><p class="muted" style="margin-top:12px">${esc(m.nom)} et tout son historique (paiements, entrées) seront effacés.</p>${paid.n ? `<p style="margin-top:12px"><b>${paid.n} paiement${paid.n > 1 ? 's' : ''} (${da(paid.total)}) ${paid.n > 1 ? 'seront effacés' : 'sera effacé'} : les revenus passés diminueront d'autant.</b> Préférez « Archiver » sauf erreur de saisie.</p>` : ''}${btns('Supprimer')}`,
        async () => { await api.deleteMember(m.id); toast('Membre supprimé'); pages.members(); });
    });
  }
}

const IMPORTS = {
  members: { titre: 'membres', onglet: 'Membres', model: 'importModel', pick: 'importMembers', after: () => go('members') },
  products: { titre: 'produits', onglet: 'Produits', model: 'importProductsModel', pick: 'importProducts', after: () => go('products') },
};

function importDialog(kind = 'members') {
  const k = IMPORTS[kind];
  modal(`<h3>Importer des ${k.titre}</h3>
    <p class="muted" style="margin-top:12px">1. Téléchargez le modèle Excel et remplissez l'onglet ${k.onglet}.</p>
    <div class="row" style="margin-top:12px;justify-content:flex-start"><button type="button" class="btn alt" id="dl">Télécharger le modèle</button></div>
    <p class="muted" style="margin-top:20px">2. Choisissez le fichier rempli (.xlsx ou .csv).</p>
    <div class="row" style="margin-top:12px;justify-content:flex-start"><button type="button" class="btn" id="pick">Choisir le fichier</button></div>`, async () => {});
  $('#dl').onclick = guard(async () => { if (await api[k.model]()) toast('Modèle enregistré'); });
  $('#pick').onclick = guard(async () => {
    const r = await api[k.pick]();
    if (!r) return;
    dlg.close(); k.after();
    modal(`<h3>Import terminé</h3><p style="margin-top:12px">${r.ajoutes} ajouté(s), ${r.ignores} déjà existant(s), ${r.erreurs.length} erreur(s).</p>
      ${r.erreurs.length ? `<p class="muted" style="margin-top:8px;max-height:200px;overflow:auto">${r.erreurs.map(esc).join('<br>')}</p>` : ''}
      <div class="row"><button class="btn">OK</button></div>`, async () => {});
  });
}

function freezeDialog(m) {
  const t = todayStr();
  modal(`<h3>Mettre en pause</h3><p class="muted" style="margin-top:8px">${esc(m.nom)} — fin actuelle : ${fdate(m.fin)}</p>
    <label>Durée (jours)${help("La fin d'abonnement est repoussée d'autant de jours ; l'entrée est refusée pendant la pause.", 'sm')}</label><input name="jours" type="number" min="1" max="365" step="1" value="14" required>
    <label>À partir du</label><input name="debut" type="date" value="${t}" min="${t}" required>
    <p id="gnew" style="margin:12px 4px 0;font-weight:500"></p>${btns('Mettre en pause')}`,
    async (d) => { const r = await api.freeze(m.id, +d.jours, d.debut); toast(`Pause enregistrée — nouvelle fin : ${fdate(r.fin)}`, 4000); pages.members(); });
  const upd = () => {
    const n = +dlg.querySelector('[name=jours]').value;
    const e = new Date(m.fin + 'T00:00:00'); e.setDate(e.getDate() + (n > 0 ? n : 0));
    $('#gnew').textContent = n > 0 ? `Nouvelle fin : ${fdate(iso(e))}` : '';
  };
  dlg.querySelector('[name=jours]').addEventListener('input', upd); upd();
}

// Today's tickets (Boutique): one row per ticket; cancelling a ticket puts every line's stock back and removes it from the cash.
function salesDialog(tickets) {
  const hm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sum = (t) => t.lignes.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.nom}${l.dose ? ' (dose)' : ''}`).join(', ');
  const day = tickets.reduce((a, t) => a + t.total, 0);
  modal(`<h3>Ventes du jour</h3><p class="muted" style="margin-top:8px">${tickets.length} ticket${tickets.length > 1 ? 's' : ''} · ${da(day)}</p>
    <div class="tk-list">${tickets.length ? `<table><tr><th>N°</th><th>Heure</th><th>Articles</th><th class="num">Total</th><th></th></tr>${tickets.map((t) => `
      <tr><td class="muted">${t.ticket ?? '—'}</td><td class="muted">${hm(t.ts)}</td><td class="wrap">${esc(sum(t))}</td><td class="num">${da(t.total)}</td><td class="acts"><button type="button" class="chip" data-cancel="${t.key}">Annuler</button></td></tr>`).join('')}</table>` : '<div class="empty">Aucune vente aujourd\'hui.</div>'}</div>
    `, async () => {}, { wide: true });
  dlg.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => {
    const t = tickets.find((x) => String(x.key) === b.dataset.cancel);
    dlg.close();
    modal(`<h3>Annuler ce ticket ?</h3><p class="muted" style="margin-top:12px">${t.ticket ? `Ticket n° ${t.ticket}` : 'Vente'} de ${hm(t.ts)} : ${esc(sum(t))} — ${da(t.total)}.<br>Le stock est remis et le montant retiré de la caisse.</p>${btns('Annuler le ticket')}`,
      async () => { await api.cancelTicket(t.key); toast('Ticket annulé'); pages.shop(); });
  });
}

// Delivery dialog: one quantity per product, always in units. Search + filters + pages keep a long catalogue manageable;
// what was typed lives in `qty`, so it survives page changes and filters.
function restockDialog(prods) {
  const PER_RS = 7;
  const rs = { q: '', s: 'all', p: 0 }; // search text (name or category), status filter, page
  const qty = {}; // product id -> text typed
  const entered = (p) => { const n = Number(qty[p.id]); return Number.isFinite(n) && n !== 0; };
  const inSearch = (p) => !norm(rs.q) || norm(p.nom + ' ' + (p.categorie || '')).includes(norm(rs.q));
  const inStatus = (p, s) => s === 'all' || (s === 'low' ? stockState(p) !== 'ok' : entered(p));
  const visible = () => prods.filter((p) => inSearch(p) && inStatus(p, rs.s));

  const count = () => {
    const n = prods.filter(entered).length;
    $('#rscount').textContent = n ? `${n} produit${n > 1 ? 's' : ''} saisi${n > 1 ? 's' : ''}` : '';
  };
  const chips = () => {
    $('#rsflt').innerHTML = [['all', 'Tous'], ['low', 'À réapprovisionner'], ['typed', 'Saisis']]
      .map(([k, l]) => `<button type="button" class="chip ${rs.s === k ? 'on' : ''}" data-s="${k}">${l} ${prods.filter((p) => inSearch(p) && inStatus(p, k)).length}</button>`).join('');
    $('#rsflt').querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { rs.s = b.dataset.s; rs.p = 0; draw(); });
  };
  const draw = () => {
    const list = visible();
    rs.p = Math.min(rs.p, Math.max(0, Math.ceil(list.length / PER_RS) - 1));
    $('#rslist').innerHTML = list.length ? `<table><tr><th>Produit</th><th>Stock actuel</th><th class="num">Quantité reçue (unités)</th></tr>${list.slice(rs.p * PER_RS, (rs.p + 1) * PER_RS).map((p) => `
      <tr><td><b>${esc(p.nom)}</b>${p.categorie ? `<span class="rs-cat">${esc(p.categorie)}</span>` : ''}</td>
      <td>${p.stock ? stockLabel(p) : '<span class="pill bad">Rupture</span>'}</td>
      <td class="num"><span class="rs-in"><input type="number" step="1" data-q="${p.id}" value="${esc(qty[p.id] ?? '')}" placeholder="0"></span></td></tr>`).join('')}</table>${pagerHtml(list.length, rs.p, PER_RS)}`
      : '<div class="empty" style="padding:20px">Aucun produit ne correspond.</div>';
    $('#rslist').querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => { rs.p = +b.dataset.pg; draw(); });
    chips(); count();
  };

  modal(`<h3>Réapprovisionner${help('Quantité reçue par produit, en unités. Un nombre négatif corrige le stock.')}</h3>
    <div class="row rs-bar"><input class="search" id="rsq" placeholder="Nom ou catégorie" autocomplete="off"></div>
    <div class="row rs-flt" id="rsflt"></div>
    <div id="rslist"></div>
    <div class="row rs-foot"><span class="muted" id="rscount"></span><button class="btn alt" value="cancel" formnovalidate>Annuler</button><button class="btn" id="rssave">Enregistrer</button></div>`,
    async () => {
      const bad = prods.find((p) => qty[p.id] && !Number.isInteger(Number(qty[p.id])));
      if (bad) throw new Error(`Quantité invalide : ${bad.nom}`);
      const items = prods.map((p) => ({ id: p.id, n: Number(qty[p.id]) })).filter((x) => x.n); // empty and 0 are skipped
      if (!items.length) throw new Error('Aucune quantité saisie');
      await api.restockMany(items);
      toast(`Stock mis à jour (${items.length} produit${items.length > 1 ? 's' : ''})`); pages.products();
    }, { wide: true });

  $('#rsq').addEventListener('input', (e) => { rs.q = e.target.value; rs.p = 0; draw(); });
  $('#rsq').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#rslist [data-q]')?.focus(); } });
  $('#rslist').addEventListener('input', (e) => { const i = e.target.closest('[data-q]'); if (i) { qty[i.dataset.q] = i.value; chips(); count(); } });
  $('#rslist').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-q]')) return;
    e.preventDefault(); // Enter goes to the next quantity (next page after the last row), it never saves by accident
    const ins = [...$('#rslist').querySelectorAll('[data-q]')], i = ins.indexOf(e.target);
    if (i < ins.length - 1) ins[i + 1].focus();
    else if ((rs.p + 1) * PER_RS < visible().length) { rs.p++; draw(); $('#rslist [data-q]')?.focus(); }
    else $('#rssave').focus();
  });
  draw();
  $('#rsq').focus();
}

// cash received against a member's unpaid balance
function settleDialog(m, back) {
  modal(`<h3>Encaisser</h3><p class="muted" style="margin-top:8px">${esc(m.nom)} — reste à payer : <b>${da(m.dette)}</b></p>
    <label>Montant encaissé (DA)</label><input name="montant" type="number" min="1" max="${m.dette}" step="1" value="${m.dette}" required>${btns('Encaisser')}`,
    async (d) => { await api.settle(m.id, +d.montant); toast('Paiement enregistré'); typeof back === 'function' ? back() : pages[back](); });
}

async function renewDialog(id, back) {
  const [plans, found] = await Promise.all([api.plans(), api.members(String(id))]);
  const m = found.find((x) => x.id === id); // the search also matches phone numbers, so pick the exact member
  modal(`<h3>Renouveler</h3><p class="muted" style="margin-top:8px">${esc(m.nom)} — fin actuelle : ${fdate(m.fin)}</p>
    <label>Formule</label>${dd('plan_id', planOpts(plans), m.plan_id)}
    <label>Montant versé (DA)${help(HELP_VERSE, 'sm')}</label><input name="verse" type="number" min="0" step="1" placeholder="Prix complet">${btns('Encaisser')}`,
    async (d) => { const r = await api.renew(id, +d.plan_id, d.verse === '' ? null : +d.verse); toast(`Paiement enregistré — valable jusqu'au ${fdate(r.fin)}`, 4000); typeof back === 'function' ? back() : pages[back](); });
}

// webcam capture for the member photo: live preview, « Capturer » takes a centre-cropped square frame; the camera stops when the dialog closes
async function photoDialog(m) {
  let stream;
  modal(`<h3>Photo</h3><p class="muted" style="margin-top:8px">${esc(m.nom)} — cadrez le visage, puis capturez.</p>
    <div class="cam"><video id="cam" autoplay playsinline muted></video></div>${btns('Capturer')}`,
    async () => {
      const v = $('#cam');
      if (!v.videoWidth) throw new Error('Webcam pas prête');
      const s = Math.min(v.videoWidth, v.videoHeight), c = document.createElement('canvas');
      c.width = c.height = 320;
      c.getContext('2d').drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 320, 320);
      await api.savePhoto(m.id, c.toDataURL('image/jpeg', 0.85));
      toast('Photo enregistrée'); pages.members();
      setTimeout(() => memberDialog(m), 0); // after modal() has closed this dialog
    });
  dlg.addEventListener('close', () => stream?.getTracks().forEach((t) => t.stop()), { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    if (dlg.open) $('#cam').srcObject = stream; else stream.getTracks().forEach((t) => t.stop());
  } catch { fail(new Error('Webcam introuvable ou refusée : utilisez « Fichier… ».')); }
}

// One member's story (wide dialog, opened by clicking a name): header = photo, name, « N° · phone · status », « formule · end · debt »,
// notes, and the day-to-day actions on the right (Renouveler, Encaisser when owed, Modifier); four small figures (entries this month,
// in total, last visit, total paid); then the money ledger (payments and later versements, newest first, one line each) beside the
// last 30 check-ins, both tables scrolling to the same height.
async function historyDialog(id) {
  const h = await api.memberHistory(id), m = h.member;
  const ops = [
    ...h.paiements.map((y) => ({ date: y.date, id: y.id, lib: esc(y.plan) || 'Abonnement', periode: `${fdate(y.debut)} → ${fdate(y.fin)}`, montant: y.montant, note: y.prix > y.montant ? `sur ${da(y.prix)}` : '', dette: y.dette })),
    ...h.versements.map((v) => ({ date: v.date, id: v.id, lib: 'Règlement de dette', periode: '', montant: v.montant, note: '', dette: 0 })),
  ].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  const paye = ops.reduce((a, o) => a + o.montant, 0);
  const hm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jour = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const fig = (k, v) => `<div class="card mini"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const acts = `${m.archive_le ? '' : '<button type="button" class="btn sm" id="hrenew">Renouveler</button>'}${m.dette > 0 ? '<button type="button" class="btn sm alt" id="hsettle">Encaisser</button>' : ''}<button type="button" class="btn sm alt" id="hedit">Modifier</button>`;
  modal(`<div class="row hd">${avatar(m, { [m.id]: m.photo }, 's72')}<div class="who">
      <h3>${esc(m.nom)}</h3>
      <p class="muted">N° ${m.id}${m.tel ? ` · ${telLink(m)}` : ''} ${pill(m)}</p>
      <p class="muted">${esc(m.plan) || 'Sans formule'}${m.fin ? ` · jusqu'au ${fdate(m.fin)}` : ''}${m.dette > 0 ? ` <span class="pill bad">Doit ${da(m.dette)}</span>` : ''}</p>
      ${m.notes ? `<p class="muted note">${esc(m.notes)}</p>` : ''}</div>
      <div class="row acts">${acts}</div></div>
    <div class="grid mini">${fig('Entrées ce mois', h.nbMois)}${fig('Entrées au total', h.nbEntrees)}${fig('Dernière venue', h.entrees[0] ? fdate(h.entrees[0].day) : '—')}${fig('Payé au total', `${paye.toLocaleString('fr-DZ')}<small>DA</small>`)}</div>
    <div class="hist">
      <div><h4>Paiements <span class="muted">${ops.length}</span></h4>
        <div class="tk-list">${ops.length ? `<table><tr><th>Date</th><th>Opération</th><th>Période</th><th class="num">Montant</th></tr>${ops.map((o) => `
          <tr><td class="muted">${fdate(o.date)}</td><td class="wrap">${o.lib}</td><td class="muted">${o.periode}</td><td class="num"><b>${da(o.montant)}</b>${o.note ? `<div class="sub">${o.note}</div>` : ''}${o.dette > 0 ? `<div><span class="pill bad">Reste ${da(o.dette)}</span></div>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty" style="padding:20px">Aucun paiement.</div>'}</div></div>
      <div><h4>Entrées <span class="muted">${h.nbEntrees > h.entrees.length ? `${h.entrees.length} dernières` : h.nbEntrees}</span></h4>
        <div class="tk-list">${h.entrees.length ? `<table><tr><th>Jour</th><th class="num">Heure</th></tr>${h.entrees.map((e) => `<tr><td>${jour(e.day)}</td><td class="muted num">${hm(e.ts)}</td></tr>`).join('')}</table>` : '<div class="empty" style="padding:20px">Jamais venu.</div>'}</div></div>
    </div>`, async () => {}, { wide: true });
  bindWa(dlg, () => m);
  const again = () => historyDialog(id); // come back here after the action
  $('#hrenew')?.addEventListener('click', () => { dlg.close(); renewDialog(id, again); });
  $('#hsettle')?.addEventListener('click', () => { dlg.close(); settleDialog(m, again); });
  $('#hedit').onclick = () => { dlg.close(); memberDialog(m); };
}

/* ---------- nav ---------- */
function go(p) {
  document.querySelectorAll('nav [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  view.classList.toggle('fill', p === 'shop'); // boutique: fixed-height page, only the product grid and sales list scroll
  guard(pages[p])();
}
// a sidebar click opens a page fresh (no stale filter/search/date); dashboard shortcuts call go() directly to keep their preset
document.querySelectorAll('nav [data-p]').forEach((b) => b.onclick = () => { Object.values(pages).forEach((pg) => delete pg.state); go(b.dataset.p); });
// F1 / F2 / F3 = the Comptoir pages, same as a sidebar click (labels on the buttons in index.html)
document.addEventListener('keydown', (e) => { const p = { F1: 'checkin', F2: 'members', F3: 'shop' }[e.key]; if (!p) return; e.preventDefault(); if (!dlg.open) $(`nav [data-p="${p}"]`).click(); });
async function backupDialog() {
  const [i, auto] = await Promise.all([api.backupInfo(), api.autostartInfo()]);
  const m = i.last?.match(/(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)/);
  modal(`<h3>Paramètres</h3>
    <label>Copie automatique${help('Une copie toutes les 2 heures et à chaque fermeture, 10 de chaque conservées. Idéal : une clé USB ou un autre disque.', 'sm')}</label>
    <p style="margin:0 4px"><b title="${esc(i.dir)}">${esc(i.dir.length > 46 ? i.dir.slice(0, 22) + '…' + i.dir.slice(-22) : i.dir)}</b></p>
    <p class="muted" style="margin:0 4px">Dernière copie : ${m ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : 'aucune'}</p>
    <div class="row" style="margin-top:12px;justify-content:flex-start"><button type="button" class="btn alt sm" id="chdir">Changer le dossier</button></div>
    <div class="row" style="margin-top:16px;justify-content:flex-start"><button type="button" class="btn sm" id="now">Sauvegarder maintenant…</button><button type="button" class="btn alt sm" id="restore">Restaurer une sauvegarde…</button></div>
    <label style="margin-top:24px">Données</label>
    <div class="row" style="margin-top:8px;justify-content:flex-start"><button type="button" class="btn alt sm" id="impm">Importer des membres…</button><button type="button" class="btn alt sm" id="impp">Importer des produits…</button></div>
    ${auto.dispo ? `<label style="margin-top:24px">Démarrage</label><label class="chk"><input type="checkbox" id="auto" ${auto.on ? 'checked' : ''}> Lancer l'application au démarrage de Windows</label>` : ''}
    <label style="margin-top:24px">Fermeture de la salle${help("Salle fermée (travaux, fêtes…) : tous les abonnements en cours sont prolongés d'autant de jours.", 'sm')}</label>
    <div class="row" style="margin-top:8px;justify-content:flex-start"><input id="extj" type="number" min="1" max="365" step="1" value="7" style="width:110px" aria-label="Jours"><span class="muted">jours</span><button type="button" class="btn alt sm" id="ext">Prolonger…</button></div>
    `, async () => {});
  $('#impm').onclick = () => { dlg.close(); importDialog('members'); };
  $('#impp').onclick = () => { dlg.close(); importDialog('products'); };
  $('#extj').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#ext').click(); } }; // the dialog form would otherwise just close
  $('#ext').onclick = guard(async () => {
    const j = Math.round(Number($('#extj').value));
    if (!(j >= 1 && j <= 365)) throw new Error('Nombre de jours invalide (1 à 365)');
    const s = await api.stats();
    dlg.close();
    modal(`<h3>Prolonger ?</h3><p class="muted" style="margin-top:12px">Les ${s.actifs} abonnements valides aujourd'hui finiront <b>${j} jour${j > 1 ? 's' : ''}</b> plus tard. Les abonnements expirés ne changent pas.</p>${btns('Prolonger')}`,
      async () => { const n = await api.extendAll(j); toast(`${n} abonnement${n > 1 ? 's' : ''} prolongé${n > 1 ? 's' : ''} de ${j} jour${j > 1 ? 's' : ''}`, 4000); });
  });
  $('#chdir').onclick = guard(async () => { if (await api.chooseBackupDir()) { dlg.close(); toast('Dossier enregistré'); } });
  $('#now').onclick = guard(async () => { if (await api.backup()) { dlg.close(); toast('Sauvegarde créée'); } });
  $('#auto')?.addEventListener('change', guard(async (e) => { await api.setAutostart(e.target.checked); toast(e.target.checked ? 'Démarrage automatique activé' : 'Démarrage automatique désactivé'); }));
  $('#restore').onclick = guard(async () => {
    const f = await api.pickBackup();
    if (!f) return;
    dlg.close();
    modal(`<h3>Restaurer ?</h3><p class="muted" style="margin-top:12px">Les données actuelles seront remplacées par « ${esc(f.name)} ». Une copie de sécurité des données actuelles est faite juste avant.</p>${btns('Restaurer')}`,
      async () => { await api.restoreBackup(f.file); toast('Sauvegarde restaurée', 4000); setTimeout(() => location.reload(), 700); });
  });
}
$('#backup').onclick = guard(backupDialog);
go('checkin'); // the desk PC opens on check-in
