// Çalıştırma: node tests/calc.test.js
const assert = require('assert');
const C = require('../calc.js');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} != ${b}`);

// Vesting: 4 yıl, 1 yıl cliff
const g = { shares: 48000, vesting: { start: '2024-01-15', months: 48, cliff: 12 } };
assert.strictEqual(C.vestedShares(g, '2024-12-31'), 0, 'cliff öncesi');
assert.strictEqual(C.vestedShares(g, '2025-01-15'), 12000, 'cliff günü');
assert.strictEqual(C.vestedShares(g, '2025-07-20'), 18000, '18. ay');
assert.strictEqual(C.vestedShares(g, '2030-01-01'), 48000, 'tamamı');
assert.strictEqual(C.nextVestDate(g, '2024-06-01'), '2025-01-15', 'sonraki: cliff');
assert.strictEqual(C.nextVestDate(g, '2025-07-20'), '2025-08-15', 'sonraki: aylık');
assert.strictEqual(C.addMonths('2024-01-31', 1), '2024-02-29', 'ay sonu');

const classes = [
  { id: 'c', kind: 'common' },
  { id: 'a', kind: 'preferred', liqMultiple: 1, participating: false, seniority: 1 },
  { id: 'o', kind: 'option' },
];
// Kurucu 8M adi, yatırımcı 2M imtiyazlı @ 5 (10M yatırım), opsiyon 1M @ 1
const pos = [
  { classId: 'c', shares: 8e6, price: 0 },
  { classId: 'a', shares: 2e6, price: 5 },
  { classId: 'o', shares: 1e6, price: 1 },
];
// Düşük çıkış: 6M → tamamı tercihli yatırımcıya
let r = C.waterfall(pos, classes, 6e6);
near(r.payouts[1], 6e6, 'düşük çıkış yatırımcı'); near(r.payouts[0], 0, 'düşük çıkış kurucu');
// 30M: tercih 10M, kalan 20M / 9M pay(kurucu+opsiyon) → opsiyon dahil mi? pps=(20M+1M)/9M=2.33>1 → evet
// Dönüşüm: (30M+1M)/11M = 2.818 *2M = 5.6M < 10M → tercih seçilir
r = C.waterfall(pos, classes, 30e6);
assert.strictEqual(r.convert.a, false);
near(r.payouts[1], 10e6, '30M yatırımcı');
near(r.payouts[0] + r.payouts[2] + r.payouts[1], 30e6, '30M toplam');
// 100M: dönüşüm (101M/11M=9.18*2M=18.4M) > 10M → dönüşür
r = C.waterfall(pos, classes, 100e6);
assert.strictEqual(r.convert.a, true);
near(r.payouts.reduce((a, b) => a + b), 100e6, '100M toplam');
// Opsiyon kullanım fiyatı paydan yüksekse dağıtıma girmez
r = C.waterfall([{ classId: 'c', shares: 1e6, price: 0 }, { classId: 'o', shares: 1e6, price: 10 }], classes, 2e6);
near(r.payouts[0], 2e6, 'para dışı opsiyon'); near(r.payouts[1], 0, 'para dışı opsiyon 0');
// Katılımlı: tercih + oransal pay
const cp = classes.map((c) => (c.id === 'a' ? { ...c, participating: true } : c));
r = C.waterfall(pos.slice(0, 2), cp, 30e6);
near(r.payouts[1], 10e6 + 20e6 * 0.2, 'katılımlı');
// Kıdem: B kıdemli, A ondan sonra
const cs = [...classes, { id: 'b', kind: 'preferred', liqMultiple: 1, seniority: 2 }];
r = C.waterfall([{ classId: 'a', shares: 1e6, price: 5 }, { classId: 'b', shares: 1e6, price: 5 }, { classId: 'c', shares: 8e6, price: 0 }], cs, 7e6);
near(r.payouts[1], 5e6, 'kıdemli tam'); near(r.payouts[0], 2e6, 'kıdemsiz kalan');
// Tur: 40M öncesi, 10M yatırım, %10 havuz
const s = C.simulateRound({ fullyDiluted: 10.25e6, poolUnallocated: 550000, preMoney: 40e6, investment: 10e6, poolTarget: 0.1 });
near(s.newShares / s.totalAfter, 0.2, 'yatırımcı %20');
near((550000 + s.poolAdded) / s.totalAfter, 0.1, 'havuz %10');
console.log('Tüm testler geçti ✓');
