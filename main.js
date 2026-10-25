const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeImage } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const xlsx = require('./xlsx');
const APP = require('./config'); // name, tagline, weekStart

// demo mode (start-demo.bat): a separate user-data folder, so the real database, settings and backups are never touched
if (process.env.GYM_DEMO) app.setPath('userData', app.getPath('userData') + '-demo');
const dbFile = path.join(app.getPath('userData'), 'gym.db');
let db;

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => iso(new Date());
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
// first day of the week that contains `day`; the week start comes from config.js (0 = Sunday ... 6 = Saturday)
const weekStart = (day) => addDays(day, -((new Date(day + 'T00:00:00').getDay() - APP.weekStart + 7) % 7));

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const settings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const defaultBackupDir = () => path.join(app.getPath('documents'), `${app.getName()}-sauvegardes`); // follows the package.json "name"
const backupDir = () => settings().backupDir || defaultBackupDir();
// automatic copies: gym-auto-<stamp> at every close, gym-periodique-<stamp> every 2 hours while the app runs (a power cut loses 2 hours at most).
// Each series keeps its 10 newest files, so the close copies still go back ~10 days while the periodic ones cover the last day or two.
const AUTO_RE = /^gym-(auto|periodique)-(\d{4}-\d\d-\d\d-\d{6})\.db$/;
const PERIODIC_MS = 2 * 3600e3;

const stamp = () => { const p = (n) => String(n).padStart(2, '0'), d = new Date(); return `${today()}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// copy the DB into the backup folder; if the chosen folder (USB) is unavailable fall back to Documents. prune = series prefix whose 10 newest files are kept
function snapshot(name, prune) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const dir of [backupDir(), defaultBackupDir()]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(dbFile, path.join(dir, name));
      if (prune) fs.readdirSync(dir).filter((f) => f.startsWith(prune + '-') && AUTO_RE.test(f)).sort().slice(0, -10).forEach((f) => fs.unlinkSync(path.join(dir, f)));
      return dir;
    } catch (e) { console.error('Copie échouée dans', dir, e.message); }
  }
  throw new Error('Impossible de créer la copie de sécurité');
}
function autoBackup(prefix = 'gym-auto') {
  try { snapshot(`${prefix}-${stamp()}.db`, prefix); } catch (e) { console.error('Sauvegarde auto échouée', e.message); }
}
async function saveXlsx(defaultName, sheets) {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, xlsx.write(sheets));
  return true;
}
const fr = (s) => (s ? s.split('-').reverse().join('/') : ''); // YYYY-MM-DD -> JJ/MM/AAAA (exports)

// a file is accepted as a backup only if it is a SQLite database with our core tables
function checkDb(file) {
  let t;
  try {
    t = new DatabaseSync(file, { readOnly: true });
    const names = t.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    if (!['plans', 'members', 'payments', 'checkins'].every((n) => names.includes(n))) throw new Error('tables');
  } catch { throw new Error("Ce fichier n'est pas une sauvegarde valide"); } finally { t?.close(); }
}

// minimal CSV parser: ';' or ',' delimiter (from header line), "quoted" fields with "" escapes
function parseCsv(text) {
  const head = text.split(/\r?\n/, 1)[0];
  const d = head.split(';').length >= head.split(',').length ? ';' : ',';
  const rows = [[]];
  let f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], r = rows[rows.length - 1];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; r.push(f); f = ''; rows.push([]); }
    else f += c;
  }
  rows[rows.length - 1].push(f);
  return rows;
}

function initDb() {
  db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, nom TEXT NOT NULL, jours INTEGER NOT NULL, prix INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY, nom TEXT NOT NULL, tel TEXT, plan_id INTEGER REFERENCES plans(id),
      debut TEXT, fin TEXT, notes TEXT, created TEXT DEFAULT (date('now','localtime')));
    CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      plan_id INTEGER, montant INTEGER NOT NULL, date TEXT NOT NULL, debut TEXT, fin TEXT);
    CREATE TABLE IF NOT EXISTS checkins(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      ts TEXT NOT NULL, day TEXT NOT NULL);
    -- stock is counted in base units: 1 per item, or 1 per scoop for bottles sold by the dose (bottle = doses units)
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, nom TEXT NOT NULL, prix INTEGER NOT NULL, doses INTEGER NOT NULL DEFAULT 1,
      prix_dose INTEGER, stock INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY, product_id INTEGER, nom TEXT NOT NULL, qty INTEGER NOT NULL,
      dose INTEGER NOT NULL DEFAULT 0, montant INTEGER NOT NULL, date TEXT NOT NULL, ts TEXT NOT NULL);
    -- later cash received against a payment that was not paid in full
    CREATE TABLE IF NOT EXISTS versements(id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE, montant INTEGER NOT NULL, date TEXT NOT NULL);
    -- optional member photo (320x320 JPEG, ~15 KB), kept inside the database so a backup stays one file
    CREATE TABLE IF NOT EXISTS photos(member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE, jpeg BLOB NOT NULL);
  `);
  // payments.prix = price of the period (montant = cash received when it was recorded); NULL = paid in full
  // members.gel_debut/gel_fin = the (last or planned) membership pause, inclusive dates
  for (const col of ['gel_debut', 'gel_fin']) if (!db.prepare("SELECT 1 FROM pragma_table_info('members') WHERE name=?").get(col)) db.exec(`ALTER TABLE members ADD COLUMN ${col} TEXT`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='prix'").get()) db.exec('ALTER TABLE payments ADD COLUMN prix INTEGER');
  // payments.prev = JSON snapshot of the member's plan/debut/fin before the payment, so cancelling restores it exactly
  if (!db.prepare("SELECT 1 FROM pragma_table_info('payments') WHERE name='prev'").get()) db.exec('ALTER TABLE payments ADD COLUMN prev TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name='categorie'").get()) db.exec('ALTER TABLE products ADD COLUMN categorie TEXT');
  // products.code_barre = barcode as printed on the item (optional, unique): a USB scanner typing it + Enter in the Boutique search adds the product
  if (!db.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name='code_barre'").get()) db.exec('ALTER TABLE products ADD COLUMN code_barre TEXT');
  // plans.seances_sem = max days of attendance per week for this plan (NULL = unlimited), enforced at check-in
  if (!db.prepare("SELECT 1 FROM pragma_table_info('plans') WHERE name='seances_sem'").get()) db.exec('ALTER TABLE plans ADD COLUMN seances_sem INTEGER');
  // members.archive_le = date the member was archived (NULL = active member): hidden from lists, stats and check-in, history kept
  if (!db.prepare("SELECT 1 FROM pragma_table_info('members') WHERE name='archive_le'").get()) db.exec('ALTER TABLE members ADD COLUMN archive_le TEXT');
  // sales.ticket = receipt number: the lines sold together share it. Rows from before the POS get a number of their own (one line = one ticket).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('sales') WHERE name='ticket'").get()) {
    db.exec('ALTER TABLE sales ADD COLUMN ticket INTEGER');
    db.exec('UPDATE sales SET ticket = id');
  }
  // the member list adds up each member's payments, so these indexes matter: with 4000 members the list took 2.5 s without them, 25 ms with them
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
    CREATE INDEX IF NOT EXISTS idx_versements_payment ON versements(payment_id);
    CREATE INDEX IF NOT EXISTS idx_versements_member ON versements(member_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_member_day ON checkins(member_id, day);
    CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(day);
    CREATE INDEX IF NOT EXISTS idx_sales_ticket ON sales(ticket);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
  `);
  if (!db.prepare('SELECT COUNT(*) c FROM plans').get().c) {
    const ins = db.prepare('INSERT INTO plans(nom,jours,prix) VALUES(?,?,?)');
    ins.run('Séance', 1, 500);
    ins.run('Mensuel', 30, 3000);
    ins.run('Trimestriel', 90, 8000);
    ins.run('Annuel', 365, 28000);
  }
  // demo mode only (demo-data.js is deleted at deployment; the real database never reaches this)
  if (process.env.GYM_DEMO && fs.existsSync(path.join(__dirname, 'demo-data.js'))) require('./demo-data')(db, { today, addDays });
}

// debt of one payment = price of the period - paid at the time - later versements; NULL prix = paid in full
const DETTE_PAY = `(COALESCE(y.prix, y.montant) - y.montant - COALESCE((SELECT SUM(v.montant) FROM versements v WHERE v.payment_id = y.id), 0))`;
const DETTE_M = `(SELECT COALESCE(SUM(${DETTE_PAY}), 0) FROM payments y WHERE y.member_id = m.id)`;

const INACTIF_J = 14; // days without a check-in after which a valid member counts as inactive (Membres chip, dashboard card)

// member photos: whatever comes in (webcam frame, picked file) is centre-cropped to a square and stored as a 320px JPEG
const PHOTO_PX = 320;
const toDataUrl = (jpeg) => 'data:image/jpeg;base64,' + Buffer.from(jpeg).toString('base64');
const photoOf = (id) => { const r = db.prepare('SELECT jpeg FROM photos WHERE member_id=?').get(id); return r ? toDataUrl(r.jpeg) : null; };
function storePhoto(id, img) {
  if (!img || img.isEmpty()) throw new Error('Image illisible');
  if (!db.prepare('SELECT 1 FROM members WHERE id=?').get(id)) throw new Error('Introuvable');
  const { width, height } = img.getSize(), s = Math.min(width, height);
  const sq = img.crop({ x: Math.floor((width - s) / 2), y: Math.floor((height - s) / 2), width: s, height: s }).resize({ width: PHOTO_PX, height: PHOTO_PX, quality: 'best' });
  db.prepare('INSERT OR REPLACE INTO photos(member_id, jpeg) VALUES(?, ?)').run(id, sq.toJPEG(80));
}

const nextTicket = () => db.prepare('SELECT COALESCE(MAX(ticket), 0) + 1 n FROM sales').get().n;
// puts a sold line's stock back: qty units, or qty doses
const restoreStock = (s) => {
  const p = db.prepare('SELECT doses FROM products WHERE id=?').get(s.product_id);
  if (p) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run((s.dose ? 1 : p.doses) * s.qty, s.product_id);
};

// ponytail: all queries run synchronously in main; fine for one gym (thousands of rows)
const api = {
  stats() {
    const t = today(), month = t.slice(0, 7);
    const one = (sql, ...a) => db.prepare(sql).get(...a).c;
    return {
      actifs: one('SELECT COUNT(*) c FROM members WHERE archive_le IS NULL AND fin >= ?', t),
      expirent: one('SELECT COUNT(*) c FROM members WHERE archive_le IS NULL AND fin BETWEEN ? AND ?', t, addDays(t, 7)),
      expires: one('SELECT COUNT(*) c FROM members WHERE archive_le IS NULL AND (fin < ? OR fin IS NULL)', t),
      ventesMois: one("SELECT COALESCE(SUM(montant),0) c FROM sales WHERE substr(date,1,7) = ?", month),
      revenuMois: one("SELECT COALESCE(SUM(montant),0) c FROM payments WHERE substr(date,1,7) = ?", month)
        + one("SELECT COALESCE(SUM(montant),0) c FROM versements WHERE substr(date,1,7) = ?", month)
        + one("SELECT COALESCE(SUM(montant),0) c FROM sales WHERE substr(date,1,7) = ?", month),
      revenuJour: one('SELECT COALESCE(SUM(montant),0) c FROM payments WHERE date = ?', t)
        + one('SELECT COALESCE(SUM(montant),0) c FROM versements WHERE date = ?', t)
        + one('SELECT COALESCE(SUM(montant),0) c FROM sales WHERE date = ?', t),
      dettes: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(d), 0) total FROM (SELECT SUM(${DETTE_PAY}) d FROM payments y GROUP BY y.member_id HAVING d > 0)`).get(),
      // valid subscription but no check-in for 14 days (or never): members to call before they lapse
      inactifs: one(`SELECT COUNT(*) c FROM members m WHERE archive_le IS NULL AND fin >= ? AND COALESCE((SELECT MAX(day) FROM checkins c WHERE c.member_id = m.id), '') < ?`, t, addDays(t, -INACTIF_J)),
      aRenouveler: db.prepare(`SELECT id, nom, tel, fin FROM members WHERE archive_le IS NULL AND fin <= ? ORDER BY fin DESC, nom`).all(addDays(t, 7)),
    };
  },
  plans: () => db.prepare('SELECT * FROM plans ORDER BY jours').all(),
  savePlan(p) {
    if (!p.nom || p.jours < 1 || p.prix < 0) throw new Error('Formule invalide');
    const cap = p.seances_sem == null || p.seances_sem === '' ? null : Number(p.seances_sem); // max days per week, null = unlimited
    if (cap !== null && !(Number.isInteger(cap) && cap >= 1 && cap <= 7)) throw new Error('Séances par semaine : un nombre de 1 à 7');
    if (p.id) db.prepare('UPDATE plans SET nom=?, jours=?, prix=?, seances_sem=? WHERE id=?').run(p.nom, p.jours, p.prix, cap, p.id);
    else db.prepare('INSERT INTO plans(nom,jours,prix,seances_sem) VALUES(?,?,?,?)').run(p.nom, p.jours, p.prix, cap);
  },
  products: () => db.prepare('SELECT * FROM products ORDER BY categorie IS NULL, categorie, nom').all(),
  saveProduct(p) {
    if (!p.nom || !(p.prix >= 0) || (p.prix_dose != null && !(p.prix_dose >= 0))) throw new Error('Produit invalide');
    const cat = (p.categorie || '').trim() || null; // free text, blank = no category
    const code = (p.code_barre || '').trim() || null; // optional barcode, unique
    const dup = code && db.prepare('SELECT nom FROM products WHERE code_barre=? AND id IS NOT ?').get(code, p.id ?? null);
    if (dup) throw new Error(`Code-barres déjà utilisé par « ${dup.nom} »`);
    if (p.id) {
      db.prepare('UPDATE products SET nom=?, prix=?, prix_dose=CASE WHEN doses>1 THEN ? ELSE NULL END, categorie=?, code_barre=? WHERE id=?').run(p.nom, p.prix, p.prix_dose, cat, code, p.id);
      return;
    }
    p.prix = Math.round(p.prix); // prices are whole DA
    if (p.prix_dose != null) p.prix_dose = Math.round(p.prix_dose);
    const doses = p.doses || 1;
    if (!Number.isInteger(doses) || doses < 1 || (doses > 1) !== (p.prix_dose != null)) throw new Error('Doses par unité et prix de la dose vont ensemble');
    db.prepare('INSERT INTO products(nom,prix,doses,prix_dose,stock,categorie,code_barre) VALUES(?,?,?,?,?,?,?)').run(p.nom, p.prix, doses, p.prix_dose, Math.max(0, Math.round((p.stock || 0) * doses)), cat, code);
  },
  deleteProduct: (id) => void db.prepare('DELETE FROM products WHERE id=?').run(id), // sales keep the product name
  restock(id, bottles) { // bottles may be negative to correct a miscount
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!p || !Number.isInteger(bottles) || bottles === 0) throw new Error('Quantité invalide');
    if (p.stock + bottles * p.doses < 0) throw new Error('Stock insuffisant');
    db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(bottles * p.doses, id);
  },
  restockMany(items) { // all or nothing
    db.exec('BEGIN');
    try { items.forEach(({ id, n }) => api.restock(id, n)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  sell(id, dose = false) {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!p) throw new Error('Introuvable');
    if (dose && p.doses < 2) throw new Error('Pas de vente à la dose');
    const units = dose ? 1 : p.doses;
    if (p.stock < units) throw new Error('Stock insuffisant');
    db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(units, id);
    db.prepare('INSERT INTO sales(product_id,nom,qty,dose,montant,date,ts,ticket) VALUES(?,?,?,?,?,?,?,?)').run(id, p.nom, 1, dose ? 1 : 0, dose ? p.prix_dose : p.prix, today(), new Date().toISOString(), nextTicket());
  },
  salesToday: () => db.prepare('SELECT * FROM sales WHERE date=? ORDER BY id DESC').all(today()),
  cancelSale(id) { // puts the stock back
    const s = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
    if (!s) throw new Error('Introuvable');
    restoreStock(s);
    db.prepare('DELETE FROM sales WHERE id=?').run(id);
  },
  // POS ticket: every line is recorded under one ticket number, or none. Stock is checked for the whole cart first
  // (a product can be in the cart both whole and by the dose). lines = [{ id, dose, qty }]
  checkout(lines) {
    if (!Array.isArray(lines) || !lines.length) throw new Error('Ticket vide');
    const prods = new Map(), need = new Map();
    const rows = lines.map((l) => {
      const p = prods.get(l.id) ?? db.prepare('SELECT * FROM products WHERE id=?').get(l.id);
      if (!p) throw new Error('Produit introuvable');
      prods.set(p.id, p);
      const qty = Number(l.qty), dose = !!l.dose;
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new Error('Quantité invalide');
      if (dose && p.doses < 2) throw new Error('Pas de vente à la dose');
      const units = dose ? qty : qty * p.doses;
      need.set(p.id, (need.get(p.id) ?? 0) + units);
      return { p, qty, dose, units, montant: qty * (dose ? p.prix_dose : p.prix) };
    });
    for (const [id, units] of need) if (prods.get(id).stock < units) throw new Error(`Stock insuffisant : ${prods.get(id).nom}`);
    const ticket = nextTicket(), t = today(), ts = new Date().toISOString();
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(r.units, r.p.id);
        db.prepare('INSERT INTO sales(product_id,nom,qty,dose,montant,date,ts,ticket) VALUES(?,?,?,?,?,?,?,?)').run(r.p.id, r.p.nom, r.qty, r.dose ? 1 : 0, r.montant, t, ts, ticket);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ticket, total: rows.reduce((a, r) => a + r.montant, 0) };
  },
  // today's sales grouped by ticket, newest first (a row without a ticket number counts as a ticket of one line)
  ticketsToday() {
    const by = new Map();
    for (const r of db.prepare('SELECT * FROM sales WHERE date=? ORDER BY id').all(today())) {
      const key = r.ticket ?? -r.id;
      if (!by.has(key)) by.set(key, { key, ticket: r.ticket, ts: r.ts, total: 0, lignes: [] });
      const t = by.get(key);
      t.total += r.montant;
      t.lignes.push({ nom: r.nom, qty: r.qty, dose: r.dose, montant: r.montant });
    }
    return [...by.values()].reverse();
  },
  // cancels a whole ticket (key = ticket number, or minus the sale id for a row without one) and puts every line's stock back
  cancelTicket(key) {
    const lines = db.prepare('SELECT * FROM sales WHERE COALESCE(ticket, -id) = ?').all(key);
    if (!lines.length) throw new Error('Introuvable');
    db.exec('BEGIN');
    try {
      lines.forEach(restoreStock);
      db.prepare('DELETE FROM sales WHERE COALESCE(ticket, -id) = ?').run(key);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  deletePlan(id) {
    const n = db.prepare('SELECT (SELECT COUNT(*) FROM members WHERE plan_id=?) + (SELECT COUNT(*) FROM payments WHERE plan_id=?) c').get(id, id).c;
    if (n) throw new Error('Formule utilisée par des membres ou des paiements');
    db.prepare('DELETE FROM plans WHERE id=?').run(id);
  },
  importModel() {
    const plans = api.plans();
    return saveXlsx('modele-membres.xlsx', [
      { name: 'Membres', widths: [28, 18, 22, 14, 36], textCols: [0, 1, 2, 3, 4], rows: [
        ['nom', 'tel', 'formule', 'fin', 'notes'],
        ['Ahmed Benali', '0555 12 34 56', plans[0]?.nom ?? '', '31/12/2026', 'exemple (supprimer cette ligne)']] },
      { name: 'Formules', widths: [28, 10, 12], rows: [['formule', 'jours', 'prix (DA)'], ...plans.map((p) => [p.nom, p.jours, p.prix])] },
    ]);
  },
  // generic Excel export: the renderer builds the sheet ({ name, widths, textCols, rows }) from what it shows (Membres: the filtered list)
  exportXlsx({ name, sheet }) { return saveXlsx(name, [sheet]); },
  // every cash operation of a month ('YYYY-MM'), one row each, oldest first, then a total row
  exportCaisse(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Mois invalide');
    const ops = [
      ...db.prepare(`SELECT y.date, 'Abonnement' type, m.nom || ' — ' || COALESCE(p.nom, '(sans formule)') || ' · ' || y.debut || ' → ' || y.fin detail, y.montant FROM payments y JOIN members m ON m.id = y.member_id LEFT JOIN plans p ON p.id = y.plan_id WHERE substr(y.date, 1, 7) = ?`).all(month),
      ...db.prepare(`SELECT v.date, 'Règlement de dette' type, m.nom detail, v.montant FROM versements v JOIN members m ON m.id = v.member_id WHERE substr(v.date, 1, 7) = ?`).all(month),
      ...db.prepare(`SELECT date, 'Boutique' type, CASE WHEN qty > 1 THEN qty || '× ' ELSE '' END || nom || CASE WHEN dose THEN ' (dose)' ELSE '' END || CASE WHEN ticket IS NULL THEN '' ELSE ' · ticket ' || ticket END detail, montant FROM sales WHERE substr(date, 1, 7) = ?`).all(month),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const rows = ops.map((o) => [fr(o.date), o.type, o.detail.replace(/(\d{4})-(\d\d)-(\d\d)/g, '$3/$2/$1'), o.montant]);
    rows.push(['', 'Total', `${ops.length} opération${ops.length > 1 ? 's' : ''}`, ops.reduce((a, o) => a + o.montant, 0)]);
    return saveXlsx(`caisse-${month}.xlsx`, [{ name: 'Caisse', widths: [12, 20, 60, 14], textCols: [0, 1, 2], rows: [['date', 'type', 'détail', 'montant (DA)'], ...rows] }]);
  },
  // columns: nom, tel, formule (plan name), fin (JJ/MM/AAAA), notes. First tab of .xlsx, or a .csv. No payment is created: this loads existing members.
  async importMembers() {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Excel et CSV', extensions: ['xlsx', 'csv'] }, { name: 'Excel (.xlsx)', extensions: ['xlsx'] }, { name: 'CSV (.csv)', extensions: ['csv'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    const rows = /\.xlsx$/i.test(file) ? xlsx.read(fs.readFileSync(file)) : parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const plans = db.prepare('SELECT * FROM plans').all();
    const exists = db.prepare('SELECT 1 FROM members WHERE nom=? AND tel=?');
    const ins = db.prepare('INSERT INTO members(nom,tel,plan_id,debut,fin,notes) VALUES(?,?,?,?,?,?)');
    const res = { ajoutes: 0, ignores: 0, erreurs: [] };
    db.exec('BEGIN');
    try { rows.slice(1).forEach((c, i) => {
      const [nom = '', tel = '', ab = '', fin = '', notes = ''] = c.map((x) => x.trim());
      if (!nom && !tel && !ab && !fin && !notes) return;
      const err = (m) => res.erreurs.push(`Ligne ${i + 2} : ${m}`);
      if (!nom) return err('nom manquant');
      const plan = ab && plans.find((p) => p.nom.toLowerCase() === ab.toLowerCase());
      if (ab && !plan) return err(`formule "${ab}" inconnue`);
      let f = null;
      if (fin) {
        const m = fin.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/), n = fin.match(/^\d{4}-\d{2}-\d{2}$/);
        // Excel stores typed dates as day serials (days since 1899-12-30)
        if (/^\d{5}(\.\d+)?$/.test(fin)) f = new Date(Date.UTC(1899, 11, 30) + Math.floor(fin) * 864e5).toISOString().slice(0, 10);
        else f = n ? fin : m &&`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (!f || iso(new Date(f + 'T00:00:00')) !== f) return err(`date "${fin}" invalide (JJ/MM/AAAA)`);
      }
      if (exists.get(nom, tel)) return void res.ignores++;
      ins.run(nom, tel, plan?.id ?? null, f && plan ? addDays(f, 1 - plan.jours) : null, f, notes);
      res.ajoutes++;
    }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return res;
  },
  importProductsModel() {
    return saveXlsx('modele-produits.xlsx', [{ name: 'Produits', widths: [28, 12, 14, 14, 14, 18, 18], textCols: [0, 1, 2, 3, 4, 5, 6], rows: [
      ['nom', 'prix', 'doses par unité', 'prix dose', 'stock', 'catégorie', 'code-barres'],
      ['Eau 1,5L', '50', '', '', '24', 'Boissons', '6130000000001'],
      ['Whey 2kg', '9000', '30', '400', '2', 'Compléments', '']] }]);
  },
  // columns: nom, prix (DA), doses par unité (empty = not sold by the dose), prix dose, stock (units), catégorie (optional), code-barres (optional). Existing names are skipped.
  async importProducts() {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Excel et CSV', extensions: ['xlsx', 'csv'] }, { name: 'Excel (.xlsx)', extensions: ['xlsx'] }, { name: 'CSV (.csv)', extensions: ['csv'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    const rows = /\.xlsx$/i.test(file) ? xlsx.read(fs.readFileSync(file)) : parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const num = (s) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));
    const exists = db.prepare('SELECT 1 FROM products WHERE lower(nom)=lower(?)');
    const res = { ajoutes: 0, ignores: 0, erreurs: [] };
    db.exec('BEGIN');
    try {
      rows.slice(1).forEach((c, i) => {
        const [nom = '', prix = '', doses = '', pd = '', stock = '', categorie = '', code_barre = ''] = c.map((x) => x.trim());
        if (!c.some((x) => x.trim())) return;
        if (exists.get(nom)) return void res.ignores++;
        try {
          api.saveProduct({ nom, prix: num(prix) ?? NaN, doses: num(doses) ?? 1, prix_dose: num(pd), stock: num(stock) ?? 0, categorie, code_barre });
          res.ajoutes++;
        } catch (e) { res.erreurs.push(`Ligne ${i + 2} : ${e.message}`); }
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return res;
  },
  // derniere = last check-in day (NULL = never came), read through idx_checkins_member_day; a_photo = has a photo (fetch it with photos())
  members(q = '') {
    const like = `%${q}%`;
    return db.prepare(`SELECT m.*, p.nom plan, ${DETTE_M} dette, (SELECT MAX(day) FROM checkins c WHERE c.member_id = m.id) derniere,
      EXISTS(SELECT 1 FROM photos f WHERE f.member_id = m.id) a_photo
      FROM members m LEFT JOIN plans p ON p.id = m.plan_id
      WHERE m.nom LIKE ? OR m.tel LIKE ? OR CAST(m.id AS TEXT) = ? ORDER BY m.nom`).all(like, like, q.trim());
  },
  // photos of the members on screen only: id -> data URL (the blobs never travel with the member list)
  photos: (ids) => Object.fromEntries(ids.map((id) => [id, photoOf(id)]).filter(([, u]) => u)),
  savePhoto(id, dataUrl) { // from the webcam dialog
    const m = String(dataUrl).match(/^data:image\/(?:jpeg|png);base64,(.+)$/);
    if (!m) throw new Error('Image invalide');
    storePhoto(id, nativeImage.createFromBuffer(Buffer.from(m[1], 'base64')));
  },
  async pickPhoto(id) { // from a file (phone photo copied over, scanner…)
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (r.canceled) return false;
    storePhoto(id, nativeImage.createFromPath(r.filePaths[0]));
    return true;
  },
  deletePhoto: (id) => void db.prepare('DELETE FROM photos WHERE member_id=?').run(id),
  // edit form also carries `fin`: the end date can be corrected by hand (gift days, a wrong import); empty = no subscription
  saveMember(m) {
    if (!m.nom || !m.nom.trim()) throw new Error('Nom obligatoire');
    if (m.id) {
      const fin = m.fin || null;
      if (fin && iso(new Date(fin + 'T00:00:00')) !== fin) throw new Error('Date de fin invalide');
      db.prepare('UPDATE members SET nom=?, tel=?, notes=?, fin=? WHERE id=?').run(m.nom.trim(), m.tel || '', m.notes || '', fin, m.id);
      return m.id;
    }
    const id = db.prepare('INSERT INTO members(nom,tel,notes) VALUES(?,?,?)').run(m.nom.trim(), m.tel || '', m.notes || '').lastInsertRowid;
    if (m.plan_id) api.renew(Number(id), m.plan_id, m.verse);
    return Number(id);
  },
  // the gym was closed (holidays, works, Ramadan hours): every subscription valid today ends `jours` days later
  extendAll(jours) {
    const n = Math.round(Number(jours));
    if (!(n >= 1 && n <= 365)) throw new Error('Nombre de jours invalide (1 à 365)');
    return db.prepare('UPDATE members SET fin = date(fin, ?) WHERE archive_le IS NULL AND fin >= ?').run(`+${n} days`, today()).changes;
  },
  // one member's full story: payments (with what is still owed on each), later versements, last check-ins and attendance counts
  memberHistory(id) {
    const member = db.prepare(`SELECT m.*, p.nom plan, ${DETTE_M} dette FROM members m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id=?`).get(id);
    if (!member) throw new Error('Introuvable');
    member.photo = photoOf(id);
    return {
      member,
      paiements: db.prepare(`SELECT y.id, y.date, y.montant, y.prix, y.debut, y.fin, p.nom plan, ${DETTE_PAY} dette FROM payments y LEFT JOIN plans p ON p.id = y.plan_id WHERE y.member_id=? ORDER BY y.id DESC`).all(id),
      versements: db.prepare('SELECT id, date, montant FROM versements WHERE member_id=? ORDER BY id DESC').all(id),
      entrees: db.prepare('SELECT ts, day FROM checkins WHERE member_id=? ORDER BY id DESC LIMIT 30').all(id),
      nbEntrees: db.prepare('SELECT COUNT(*) c FROM checkins WHERE member_id=?').get(id).c,
      nbMois: db.prepare('SELECT COUNT(*) c FROM checkins WHERE member_id=? AND day >= ?').get(id, today().slice(0, 7) + '-01').c,
    };
  },
  // opens a WhatsApp chat with the member in the default browser (the PC needs internet); Algerian numbers: 0555… -> 213555…
  whatsapp(tel, text = '') {
    let n = String(tel || '').replace(/\D/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '213' + n.slice(1);
    if (n.length < 10) throw new Error('Numéro de téléphone invalide');
    return shell.openExternal(`https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
  },
  // hard delete: also erases the member's payments and check-ins, so past revenue shrinks. The UI pushes archiveMember instead.
  deleteMember: (id) => void db.prepare('DELETE FROM members WHERE id=?').run(id),
  // archive = hide a member (lists, stats, check-in) but keep every payment, so past revenue never changes; refused while they owe money
  archiveMember(id) {
    const m = db.prepare(`SELECT m.*, ${DETTE_M} dette FROM members m WHERE m.id=?`).get(id);
    if (!m) throw new Error('Introuvable');
    if (m.dette > 0) throw new Error(`Ce membre doit encore ${m.dette} DA : encaissez d'abord`);
    db.prepare('UPDATE members SET archive_le=? WHERE id=?').run(today(), id);
  },
  unarchiveMember: (id) => void db.prepare('UPDATE members SET archive_le=NULL WHERE id=?').run(id),
  // bulk archive: members whose subscription ended more than `mois` months ago (never subscribed = created that long ago); those who owe money are skipped.
  // dryRun = count only, for the confirmation. Returns { n, dettes } = archived (or to archive) / skipped for debt
  archiveOld(mois, dryRun = false) {
    const n = Math.round(Number(mois));
    if (!(n >= 1 && n <= 60)) throw new Error('Nombre de mois invalide (1 à 60)');
    const limit = db.prepare('SELECT date(?, ?) d').get(today(), `-${n} months`).d;
    const rows = db.prepare(`SELECT m.id, ${DETTE_M} dette FROM members m WHERE m.archive_le IS NULL AND COALESCE(m.fin, m.created, '') < ?`).all(limit);
    const ok = rows.filter((r) => r.dette <= 0);
    if (!dryRun && ok.length) db.prepare(`UPDATE members SET archive_le=? WHERE id IN (${ok.map(() => '?').join(',')})`).run(today(), ...ok.map((r) => r.id));
    return { n: ok.length, dettes: rows.length - ok.length };
  },
  // what a hard delete would erase, shown in its confirmation
  memberPaid: (id) => db.prepare('SELECT COUNT(*) n, COALESCE(SUM(montant), 0) + COALESCE((SELECT SUM(v.montant) FROM versements v WHERE v.member_id = ?), 0) total FROM payments WHERE member_id = ?').get(id, id),
  // renew: new period starts at the later of today / current end + 1 day, so paying early loses nothing
  // pause: pushes the end date forward by the pause length (prepaid days are not lost); check-in is refused during the pause
  freeze(memberId, jours, debut) {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    if (!m) throw new Error('Introuvable');
    if (m.archive_le) throw new Error("Membre archivé : réactivez-le d'abord");
    const t = today(), d = debut || t, n = Math.round(Number(jours));
    if (!(n >= 1 && n <= 365)) throw new Error('Durée invalide (1 à 365 jours)');
    if (d < t) throw new Error('La pause ne peut pas commencer dans le passé');
    if (!m.fin || m.fin < d) throw new Error("L'abonnement doit être valide au début de la pause");
    if (m.gel_fin && m.gel_fin >= t) throw new Error('Une pause est déjà en cours ou prévue');
    const fin = addDays(m.fin, n);
    db.prepare('UPDATE members SET fin=?, gel_debut=?, gel_fin=? WHERE id=?').run(fin, d, addDays(d, n - 1), memberId);
    return { fin };
  },
  // resume now: pause days not yet consumed are taken back from the end date
  unfreeze(memberId) {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    const t = today();
    if (!m || !m.gel_fin || m.gel_fin < t) throw new Error('Aucune pause en cours');
    const planned = m.gel_debut > t;
    const unused = planned ? dayDiff(m.gel_debut, m.gel_fin) + 1 : dayDiff(t, m.gel_fin) + 1;
    const fin = addDays(m.fin, -unused);
    db.prepare('UPDATE members SET fin=?, gel_debut=?, gel_fin=? WHERE id=?').run(fin, planned ? null : m.gel_debut, planned ? null : addDays(t, -1), memberId);
    return { fin };
  },
  // paid = cash received now (default: the full price); the rest becomes a debt, settled later with api.settle
  renew(memberId, planId, paid) {
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    if (!plan || !m) throw new Error('Introuvable');
    if (m.archive_le) throw new Error("Membre archivé : réactivez-le d'abord");
    const t = today();
    const verse = paid === undefined || paid === null || paid === '' ? plan.prix : Math.round(Number(paid));
    if (!(verse >= 0 && verse <= plan.prix)) throw new Error('Montant versé invalide');
    const debut = m.fin && m.fin >= t ? addDays(m.fin, 1) : t;
    const fin = addDays(debut, plan.jours - 1);
    const prev = JSON.stringify({ plan_id: m.plan_id, debut: m.debut, fin: m.fin });
    db.prepare('INSERT INTO payments(member_id,plan_id,montant,date,debut,fin,prev,prix) VALUES(?,?,?,?,?,?,?,?)').run(memberId, planId, verse, t, debut, fin, prev, plan.prix);
    db.prepare('UPDATE members SET plan_id=?, debut=?, fin=? WHERE id=?').run(planId, m.fin && m.fin >= t ? m.debut : debut, fin, memberId);
    return { debut, fin };
  },
  // cash received later against a member's debts, oldest payment first
  settle(memberId, montant) {
    const amount = Math.round(Number(montant));
    const rows = db.prepare(`SELECT y.id, ${DETTE_PAY} dette FROM payments y WHERE y.member_id=? ORDER BY y.id`).all(memberId).filter((r) => r.dette > 0);
    const owed = rows.reduce((a, r) => a + r.dette, 0);
    if (!(amount > 0) || amount > owed) throw new Error(`Montant invalide (reste ${owed} DA)`);
    let left = amount;
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        if (!left) break;
        const part = Math.min(left, r.dette);
        db.prepare('INSERT INTO versements(payment_id,member_id,montant,date) VALUES(?,?,?,?)').run(r.id, memberId, part, today());
        left -= part;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  payments: () => db.prepare(`SELECT y.*, m.nom, p.nom plan, ${DETTE_PAY} dette,
    y.id = (SELECT MAX(id) FROM payments WHERE member_id = y.member_id) annulable
    FROM payments y JOIN members m ON m.id = y.member_id
    LEFT JOIN plans p ON p.id = y.plan_id ORDER BY y.id DESC LIMIT 200`).all(),
  // only a member's latest payment can be cancelled (older ones would leave the dates inconsistent); this restores the member's state before it
  cancelPayment(id) {
    const y = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
    if (!y) throw new Error('Introuvable');
    if (db.prepare('SELECT MAX(id) m FROM payments WHERE member_id=?').get(y.member_id).m !== id) throw new Error('Annulez d\'abord le paiement le plus récent de ce membre');
    // rows from before the snapshot existed: fall back to the previous payment, else no subscription
    const prev = y.prev ? JSON.parse(y.prev)
      : db.prepare('SELECT plan_id, debut, fin FROM payments WHERE member_id=? AND id<>? ORDER BY id DESC LIMIT 1').get(y.member_id, id) ?? { plan_id: null, debut: null, fin: null };
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM payments WHERE id=?').run(id);
      db.prepare('UPDATE members SET plan_id=?, debut=?, fin=?, gel_debut=NULL, gel_fin=NULL WHERE id=?').run(prev.plan_id, prev.debut, prev.fin, y.member_id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  // daily cash summary: subscriptions by plan + shop sales by product
  caisse(date = today()) {
    return {
      date,
      abos: db.prepare(`SELECT COALESCE(p.nom, '(sans abonnement)') nom, COUNT(*) n, SUM(y.montant) total FROM payments y
        LEFT JOIN plans p ON p.id = y.plan_id WHERE y.date=? GROUP BY y.plan_id ORDER BY total DESC`).all(date),
      ventes: db.prepare('SELECT nom, dose, SUM(qty) n, SUM(montant) total FROM sales WHERE date=? GROUP BY nom, dose ORDER BY total DESC').all(date),
      reglements: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(montant), 0) total FROM versements WHERE date=?').get(date),
    };
  },
  async pickBackup() {
    const r = await dialog.showOpenDialog({ defaultPath: backupDir(), properties: ['openFile'], filters: [{ name: 'Base de données', extensions: ['db'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    if (r.canceled) return null;
    checkDb(r.filePaths[0]);
    return { file: r.filePaths[0], name: path.basename(r.filePaths[0]) };
  },
  // replaces the current data with a backup (older backups are migrated by initDb); a safety copy of the current data is made first and never pruned
  restoreBackup(file) {
    if (path.resolve(file) === path.resolve(dbFile)) throw new Error('Choisissez un fichier de sauvegarde');
    checkDb(file);
    snapshot(`gym-avant-restauration-${stamp()}.db`, false);
    db.close();
    fs.copyFileSync(file, dbFile);
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    initDb();
  },
  // start with Windows: only for the installed app (in dev it would register the bare electron.exe)
  autostartInfo: () => ({ dispo: app.isPackaged, on: app.isPackaged && app.getLoginItemSettings().openAtLogin }),
  setAutostart(on) {
    if (!app.isPackaged) throw new Error('Disponible dans la version installée');
    app.setLoginItemSettings({ openAtLogin: !!on });
  },
  backupInfo() {
    const dir = backupDir();
    let last = null;
    // newest automatic copy of either series, by the date-time in the name
    try { last = fs.readdirSync(dir).map((f) => f.match(AUTO_RE)).filter(Boolean).sort((a, b) => (a[2] < b[2] ? -1 : 1)).pop()?.[0] ?? null; } catch { /* folder missing (USB unplugged) */ }
    return { dir, last };
  },
  async chooseBackupDir() {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), backupDir: r.filePaths[0] }));
    return api.backupInfo();
  },
  checkin(memberId) {
    const m = db.prepare(`SELECT m.*, p.nom plan, p.seances_sem, ${DETTE_M} dette FROM members m LEFT JOIN plans p ON p.id=m.plan_id WHERE m.id=?`).get(memberId);
    if (!m) return { ok: false, code: 'inconnu', motif: 'Membre introuvable' };
    m.photo = photoOf(memberId); // the banner shows the face next to the name, so the desk can match the person
    if (m.archive_le) return { ok: false, code: 'archive', motif: 'Membre archivé — réactivez-le dans Membres', member: m };
    const t = today();
    if (!m.fin || m.fin < t) return { ok: false, code: 'expire', motif: 'Abonnement expiré', member: m };
    if (m.gel_debut && m.gel_debut <= t && t <= m.gel_fin) return { ok: false, code: 'pause', motif: `En pause jusqu'au ${m.gel_fin.split('-').reverse().join('/')}`, member: m };
    const deja = db.prepare('SELECT COUNT(*) c FROM checkins WHERE member_id=? AND day=?').get(memberId, t).c;
    // weekly limit of the plan: days already attended this week (a second scan the same day never counts again)
    let semaine = null;
    if (m.seances_sem) {
      const debutSem = weekStart(t);
      const jours = db.prepare('SELECT DISTINCT day FROM checkins WHERE member_id=? AND day BETWEEN ? AND ? ORDER BY day').all(memberId, debutSem, t).map((r) => r.day);
      semaine = { n: jours.length, max: m.seances_sem, jours, reprise: addDays(debutSem, 7) };
      if (!deja && jours.length >= m.seances_sem) {
        return { ok: false, code: 'quota', motif: `Limite atteinte : ${m.seances_sem} séance${m.seances_sem > 1 ? 's' : ''} par semaine`, member: m, semaine };
      }
    }
    if (!deja) {
      db.prepare('INSERT INTO checkins(member_id,ts,day) VALUES(?,?,?)').run(memberId, new Date().toISOString(), t);
      if (semaine) { semaine.jours.push(t); semaine.n++; }
    }
    return { ok: true, member: m, deja: !!deja, semaine };
  },
  checkinsToday: () => db.prepare(`SELECT c.ts, m.id, m.nom FROM checkins c JOIN members m ON m.id=c.member_id WHERE c.day=? ORDER BY c.id DESC`).all(today()),
  // wrong person clicked: removes today's check-in (it counted against the weekly limit)
  uncheckin(memberId) {
    if (!db.prepare('DELETE FROM checkins WHERE member_id=? AND day=?').run(memberId, today()).changes) throw new Error("Aucune entrée aujourd'hui pour ce membre");
  },
  async backup() {
    const r = await dialog.showSaveDialog({ defaultPath: `gym-sauvegarde-${today()}.db`, filters: [{ name: 'Base de données', extensions: ['db'] }] });
    if (r.canceled) return false;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbFile, r.filePath);
    return true;
  },
};

app.whenReady().then(() => {
  initDb();
  if (!process.env.GYM_DEMO) setInterval(() => autoBackup('gym-periodique'), PERIODIC_MS);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media')); // webcam for member photos, nothing else
  ipcMain.handle('api', async (_e, name, ...args) => {
    try {
      return { data: await api[name](...args) };
    } catch (e) {
      return { error: e.message };
    }
  });
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 640, backgroundColor: '#ffffff',
    title: APP.name, autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.ico'), // taskbar icon in dev; the installed exe carries its own
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // the window title comes from config.js, not from the page
  win.loadFile(path.join(__dirname, 'index.html'));
});

let backedUp = false;
app.on('before-quit', () => { if (!backedUp && db && !process.env.GYM_DEMO) { backedUp = true; autoBackup(); } });
app.on('window-all-closed', () => app.quit());
