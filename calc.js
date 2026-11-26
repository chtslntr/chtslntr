/* Hisse Defteri — saf hesaplama fonksiyonları (vesting, tur, çıkış dağılımı).
   Hem tarayıcıda (window.Calc) hem Node'da (require) çalışır. */
(function (root) {
  'use strict';

  // ---------- Tarih yardımcıları ----------
  function parse(d) { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); }
  function iso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  /** a'dan b'ye tamamlanmış ay sayısı (negatif olabilir). */
  function monthsBetween(a, b) {
    const d1 = parse(a), d2 = parse(b);
    let m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    if (m > 0 && d2.getDate() < d1.getDate()) m--;
    else if (m < 0 && d2.getDate() > d1.getDate()) m++;
    return m;
  }
  function addMonths(dateStr, n) {
    const d = parse(dateStr);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }

  // ---------- Vesting ----------
  /** Aylık hak ediş, cliff sonunda birikmiş kısım bir kerede açılır. */
  function vestedShares(iss, asOf) {
    const v = iss.vesting;
    if (!v || !v.months) return iss.shares;
    const m = monthsBetween(v.start, asOf);
    if (m < 0 || m < (v.cliff || 0)) return 0;
    if (m >= v.months) return iss.shares;
    return Math.floor((iss.shares * m) / v.months);
  }
  function nextVestDate(iss, asOf) {
    const v = iss.vesting;
    if (!v || !v.months) return null;
    const m = monthsBetween(v.start, asOf);
    if (m >= v.months) return null;
    const next = Math.max(m + 1, v.cliff || 0, 1);
    return addMonths(v.start, next);
  }
  function vestingEnd(iss) {
    const v = iss.vesting;
    return v && v.months ? addMonths(v.start, v.months) : null;
  }

  // ---------- Yatırım turu ----------
  /**
   * Opsiyon havuzu genişlemesi yatırım öncesi değerlemeye dahil edilir ("option pool shuffle").
   * F: mevcut tam seyreltilmiş pay, U: ayrılmamış havuz, t: tur sonrası hedef havuz oranı.
   */
  function simulateRound({ fullyDiluted: F, poolUnallocated: U, preMoney, investment, poolTarget }) {
    if (!preMoney || !F) return null;
    const t = Math.min(0.5, Math.max(0, poolTarget || 0));
    const post = preMoney + (investment || 0);
    const k = (t * post) / preMoney;
    const P = k < 1 ? Math.max(0, Math.round((k * F - U) / (1 - k))) : 0;
    const price = preMoney / (F + P);
    const I = Math.round((investment || 0) / price);
    return { post, poolAdded: P, price, newShares: I, totalAfter: F + P + I };
  }

  // ---------- Çıkış dağılımı (waterfall) ----------
  /**
   * positions: [{ classId, shares, price }] — price: imtiyazlı/adi için ihraç fiyatı, opsiyon için kullanım fiyatı.
   * classes: [{ id, kind, liqMultiple, participating, seniority }]
   * convert: { classId: true } — katılımsız imtiyazlının adi paya dönüşüp dönüşmediği.
   */
  function distribute(positions, classes, exit, convert) {
    const cls = Object.fromEntries(classes.map((c) => [c.id, c]));
    const payouts = positions.map(() => 0);
    const prefPaid = positions.map(() => 0);
    let remaining = Math.max(0, exit);

    // 1) Tasfiye tercihleri — kıdeme göre (büyük sayı önce), aynı kıdemde orantılı
    const prefPos = positions
      .map((p, i) => ({ p, i, c: cls[p.classId] }))
      .filter((x) => x.c && x.c.kind === 'preferred' && !convert[x.c.id]);
    const levels = [...new Set(prefPos.map((x) => x.c.seniority || 1))].sort((a, b) => b - a);
    for (const lvl of levels) {
      const group = prefPos.filter((x) => (x.c.seniority || 1) === lvl);
      const owed = group.map((x) => x.p.shares * (x.p.price || 0) * (x.c.liqMultiple ?? 1));
      const total = owed.reduce((a, b) => a + b, 0);
      const pay = Math.min(remaining, total);
      group.forEach((x, k) => {
        const amt = total ? (pay * owed[k]) / total : 0;
        payouts[x.i] += amt;
        prefPaid[x.i] += amt;
      });
      remaining -= pay;
    }

    // 2) Kalan tutar adi pay eşdeğerlerine paylaştırılır
    const base = positions
      .map((p, i) => ({ p, i, c: cls[p.classId] }))
      .filter((x) => x.c && (x.c.kind === 'common' || (x.c.kind === 'preferred' && (convert[x.c.id] || x.c.participating))));
    let itm = positions.map((p, i) => ({ p, i, c: cls[p.classId] })).filter((x) => x.c && x.c.kind === 'option');
    let pps = 0;
    for (let k = 0; k < 50; k++) {
      const shares = base.reduce((a, x) => a + x.p.shares, 0) + itm.reduce((a, x) => a + x.p.shares, 0);
      const strikes = itm.reduce((a, x) => a + x.p.shares * (x.p.price || 0), 0);
      pps = shares ? (remaining + strikes) / shares : 0;
      const next = itm.filter((x) => (x.p.price || 0) < pps);
      if (next.length === itm.length) break;
      itm = next;
    }
    base.forEach((x) => { payouts[x.i] += x.p.shares * pps; });
    itm.forEach((x) => { payouts[x.i] += x.p.shares * (pps - (x.p.price || 0)); });
    const distributed = payouts.reduce((a, b) => a + b, 0);

    const byClass = {};
    positions.forEach((p, i) => { byClass[p.classId] = (byClass[p.classId] || 0) + payouts[i]; });
    return { payouts, prefPaid, byClass, pps, unallocated: Math.max(0, exit - distributed), inTheMoney: new Set(itm.map((x) => x.i)) };
  }

  /** Katılımsız imtiyazlı sınıflar için, kendi lehlerine olan seçimi (tercih ya da dönüşüm) bulur. */
  function waterfall(positions, classes, exit) {
    const nonPart = classes.filter((c) => c.kind === 'preferred' && !c.participating);
    const convert = {};
    nonPart.forEach((c) => { convert[c.id] = false; });
    let result = distribute(positions, classes, exit, convert);
    for (let iter = 0; iter < 20; iter++) {
      let changed = false;
      for (const c of nonPart) {
        const flipped = { ...convert, [c.id]: !convert[c.id] };
        const alt = distribute(positions, classes, exit, flipped);
        if ((alt.byClass[c.id] || 0) > (result.byClass[c.id] || 0) + 1e-6) {
          convert[c.id] = !convert[c.id];
          result = alt;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return { ...result, convert };
  }

  const Calc = { monthsBetween, addMonths, vestedShares, nextVestDate, vestingEnd, simulateRound, distribute, waterfall };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
