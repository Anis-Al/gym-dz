// DEMO DATA, loaded only when the app is started with GYM_DEMO=1 (start-demo.bat) into an empty demo database.
// Production never requires this file: delete it (and start-demo.bat) when deploying.
// Deterministic (seeded), so every run produces the same gym.
module.exports = function seedDemo(db, { today, addDays }) {
  let seed = 20261022;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const p2 = (n) => String(n).padStart(2, '0');
  const T = today();
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
  const insertedBefore = db.prepare('SELECT COUNT(*) c FROM members').get().c;
  if (insertedBefore) return; // never touch a database that already has members

  db.exec('BEGIN');

  // ---- plans (same duration, different price: with/without cardio, student)
  const insPlan = db.prepare('INSERT INTO plans(nom,jours,prix,seances_sem) VALUES(?,?,?,?)');
  [['3 séances/sem — 1 mois', 30, 3000, 3], ['3 séances/sem + cardio — 1 mois', 30, 3500, 3], ['Étudiant — 1 mois', 30, 2500, null]].forEach((p) => insPlan.run(...p));
  const plans = db.prepare('SELECT * FROM plans').all();
  const monthly = plans.filter((p) => p.jours >= 30);
  const byName = (n) => plans.find((p) => p.nom === n);

  // ---- members + payment history
  const firsts = ['Ahmed', 'Mohamed', 'Yacine', 'Karim', 'Sofiane', 'Walid', 'Samir', 'Rachid', 'Mehdi', 'Amine', 'Bilal', 'Hamza', 'Nabil', 'Farid', 'Omar', 'Riad', 'Lyes', 'Anis', 'Nadia', 'Lina', 'Imane', 'Amel', 'Sarah', 'Meriem', 'Yasmine', 'Samira', 'Katia', 'Fatima', 'Houda', 'Rania'];
  const lasts = ['Benali', 'Mansouri', 'Haddad', 'Boudiaf', 'Cherif', 'Bensalem', 'Rahmani', 'Khelifi', 'Saadi', 'Ouali', 'Taleb', 'Belkacem', 'Ziani', 'Hamidi', 'Merabet', 'Bouzid', 'Slimani', 'Kaci', 'Amrane', 'Djebbar', 'Larbi', 'Medjahed', 'Toumi', 'Yahiaoui', 'Guerfi'];
  const notes = ['', '', '', '', '', 'Étudiant', 'Blessure épaule', 'Tarif famille', 'Préparation compétition', 'Vient avec son frère', 'Certificat médical OK', 'Préfère le matin'];
  const used = new Set();
  const insMember = db.prepare('INSERT INTO members(nom,tel,plan_id,debut,fin,notes,created) VALUES(?,?,?,?,?,?,?)');
  const insPay = db.prepare('INSERT INTO payments(member_id,plan_id,montant,date,debut,fin,prev,prix) VALUES(?,?,?,?,?,?,?,?)');
  const insVers = db.prepare('INSERT INTO versements(payment_id,member_id,montant,date) VALUES(?,?,?,?)');
  const setPause = db.prepare('UPDATE members SET fin=?, gel_debut=?, gel_fin=? WHERE id=?');
  const insCheck = db.prepare('INSERT INTO checkins(member_id,ts,day) VALUES(?,?,?)');
  const N = 35; // members (was 70 until 2026-10-25: too much to scroll through in a demo)
  for (let i = 0; i < N; i++) {
    let nom;
    do { nom = `${pick(firsts)} ${pick(lasts)}`; } while (used.has(nom));
    used.add(nom);
    const tel = i % 17 === 5 ? '' : `0${pick([5, 5, 5, 6, 7])}${int(5, 9)}${int(0, 9)} ${p2(int(0, 99))} ${p2(int(0, 99))} ${p2(int(0, 99))}`;
    const r = rnd();
    const state = r < 0.55 ? 'active' : r < 0.70 ? 'soon' : r < 0.92 ? 'expired' : 'none';
    if (state === 'none') { insMember.run(nom, tel, null, null, null, pick(notes), addDays(T, -int(0, 20))); continue; }
    const plan = state === 'expired' && rnd() < 0.2 ? byName('Séance') : pick(monthly);
    let fin = state === 'active' ? addDays(T, int(Math.min(8, plan.jours - 1), plan.jours - 1))
      : state === 'soon' ? addDays(T, int(0, 7)) : addDays(T, -int(1, 90));
    if (plan.jours === 1 && state !== 'expired') fin = T;
    // build the chain of periods backwards from the last one: 1..6 periods, not older than ~18 months
    const periods = [];
    let f = fin;
    for (let k = int(1, plan.jours >= 90 ? 3 : 6); k > 0; k--) {
      const d = addDays(f, 1 - plan.jours);
      if (dayDiff(d, T) > 540) break;
      periods.unshift({ debut: d, fin: f });
      f = addDays(d, -1 - (rnd() < 0.25 ? int(1, 20) : 0)); // sometimes a gap before renewing
    }
    const last = periods[periods.length - 1];
    const id = Number(insMember.run(nom, tel, plan.id, last.debut, last.fin, pick(notes), periods[0].debut).lastInsertRowid);
    periods.forEach((per, k) => {
      const before = k ? periods[k - 1] : null;
      const prev = JSON.stringify({ plan_id: before ? plan.id : null, debut: before ? before.debut : null, fin: before ? before.fin : null });
      // ~15% of the latest payments are only partly paid; some of those were partly settled since
      const partial = k === periods.length - 1 && plan.prix >= 2500 && rnd() < 0.15;
      const paid = partial ? plan.prix - int(1, 3) * 500 : plan.prix;
      const payId = Number(insPay.run(id, plan.id, paid, per.debut > T ? T : per.debut, per.debut, per.fin, prev, plan.prix).lastInsertRowid);
      if (partial && rnd() < 0.4) insVers.run(payId, id, 500, addDays(T, -int(0, 3)));
      // attendance: ~35% of the days of the last 45 within the period
      for (let off = 0; off < 45; off++) {
        const day = addDays(T, -off);
        if (day < per.debut || day > per.fin || rnd() > 0.35) continue;
        insCheck.run(id, `${day}T${p2(int(6, 21))}:${p2(int(0, 59))}:00.000Z`, day);
      }
    });
  }

  // ---- a few long-lapsed members already archived (never with a debt: archiving is refused while they owe money)
  db.prepare(`UPDATE members SET archive_le = ? WHERE id IN (
    SELECT m.id FROM members m WHERE m.fin < ? AND NOT EXISTS (
      SELECT 1 FROM payments y WHERE y.member_id = m.id
        AND COALESCE(y.prix, y.montant) - y.montant - COALESCE((SELECT SUM(v.montant) FROM versements v WHERE v.payment_id = y.id), 0) > 0)
    ORDER BY m.fin LIMIT 2)`).run(addDays(T, -2), addDays(T, -60));

  // ---- memberships on pause: some right now (end date already pushed forward), some planned
  db.prepare('SELECT id, fin FROM members WHERE fin >= ? AND fin <= ?').all(addDays(T, 20), addDays(T, 200)).forEach((m, i) => {
    if (i % 7 !== 0) return;
    const now = i % 14 === 0, d = now ? addDays(T, -int(1, 4)) : addDays(T, int(3, 10)), n = int(7, 21);
    setPause.run(addDays(m.fin, n), d, addDays(d, n - 1), m.id);
  });

  // ---- products (stock in base units: bottle = doses units)
  const insProd = db.prepare('INSERT INTO products(nom,prix,doses,prix_dose,stock,categorie) VALUES(?,?,?,?,?,?)');
  // 14 products across the four categories, with one out of stock and a few nearly empty (was 24 until 2026-10-25)
  const P = [
    ['Eau 0,5L', 30, 1, null, 96], ['Eau 1,5L', 50, 1, null, 48], ['Jus', 80, 1, null, 36],
    ['Boisson énergisante', 250, 1, null, 3], ['Café', 60, 1, null, 0], ['Barre protéinée', 300, 1, null, 22],
    ['Shaker', 500, 1, null, 12], ['Serviette', 700, 1, null, 9], ['Gants de musculation', 1200, 1, null, 6], ['Ceinture lombaire', 2500, 1, null, 2],
    ['Whey 2kg', 9500, 60, 250, 5 * 60 + 17], ['Créatine 300g', 4500, 60, 120, 6 * 60 + 9], ['Pré-workout 300g', 5500, 30, 300, 15],
    ['Multivitamines', 2800, 1, null, 11],
  ];
  const cat = (n) => (/^(Eau|Jus|Soda|Boisson|Café)/.test(n) ? 'Boissons' : /^Barre/.test(n) ? 'Snacks' : /^(Shaker|Serviette|Gants|Ceinture|Corde|Bandes)/.test(n) ? 'Accessoires' : 'Compléments');
  P.forEach((p) => insProd.run(...p, cat(p[0])));
  const prods = db.prepare('SELECT * FROM products').all();

  // ---- sales: 30 days of history, cheap items much more often than supplements
  // each day = a few tickets of 1 to 3 lines (cheap items can be bought several at once)
  const insSale = db.prepare('INSERT INTO sales(product_id,nom,qty,dose,montant,date,ts,ticket) VALUES(?,?,?,?,?,?,?,?)');
  const weight = (p) => (p.prix <= 100 ? 10 : p.prix <= 400 ? 4 : p.prix <= 1500 ? 1.2 : 0.8);
  const pool = prods.flatMap((p) => Array(Math.round(weight(p) * 2)).fill(p));
  let ticket = 0;
  for (let off = 29; off >= 0; off--) {
    const day = addDays(T, -off), n = off === 0 ? int(3, 5) : int(2, 6);
    for (let s = 0; s < n; s++) {
      ticket++;
      const ts = `${day}T${p2(int(7, 21))}:${p2(int(0, 59))}:00.000Z`, lines = 1 + (rnd() < 0.4 ? int(1, 2) : 0);
      for (let k = 0; k < lines; k++) {
        const p = pick(pool), dose = p.doses > 1 && rnd() < 0.6, qty = p.prix <= 100 ? int(1, 3) : 1;
        insSale.run(p.id, p.nom, qty, dose ? 1 : 0, qty * (dose ? p.prix_dose : p.prix), day, ts, ticket);
      }
    }
  }

  db.exec('COMMIT');
};
