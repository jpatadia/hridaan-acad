/* Run with: node tests/run.js */
'use strict';
require('../js/util.js');
require('../js/skills.js');
require('../js/engine.js');
const assert = require('assert');
const { util: U, skills: SK, engine: E } = globalThis.NJ;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}\n  ${e.stack}`); process.exitCode = 1; }
}

// ---------- answer parsing ----------
test('parseAnswer formats', () => {
  const eq = (s, n, d) => { const p = U.parseAnswer(s); assert(p, s); assert.strictEqual(p.n * d, n * p.d, s); };
  eq('42', 42, 1); eq('1,234', 1234, 1); eq('-7', -7, 1); eq('−7', -7, 1); eq('3.25', 13, 4); eq('.5', 1, 2);
  eq('3/4', 3, 4); eq('2 1/3', 7, 3); eq('$12.50', 25, 2); eq('45 cm', 45, 1); eq('7 / 8', 7, 8); eq('-2 1/2', -5, 2);
  assert.strictEqual(U.parseAnswer('abc'), null);
  assert.strictEqual(U.parseAnswer('3/0'), null);
});

test('checkAnswer simplest form', () => {
  const a = { type: 'fraction', n: 1, d: 2, simplest: true };
  assert(U.checkAnswer(a, '1/2').correct);
  assert(U.checkAnswer(a, '0.5').correct);
  const r = U.checkAnswer(a, '2/4');
  assert(!r.correct && r.nearly);
  assert(!U.checkAnswer(a, '1/3').correct);
  const m = { type: 'fraction', n: 7, d: 3, simplest: true };
  assert(U.checkAnswer(m, '2 1/3').correct && U.checkAnswer(m, '7/3').correct);
  assert(U.checkAnswer(m, '2 2/6').nearly);
  assert(U.checkAnswer({ type: 'number', value: 9022 }, '9,022').correct);
});

// ---------- every skill, every level, many seeds ----------
test('all generators produce valid, self-consistent questions', () => {
  const N = 400;
  for (const s of SK.list) {
    for (let level = 1; level <= 5; level++) {
      const prompts = new Set();
      for (let i = 0; i < N; i++) {
        const seed = `${s.id}-${level}-${i}`;
        let q;
        try { q = SK.generate(s.id, level, seed); } catch (e) { throw new Error(`${seed}: ${e.message}`); }
        const ctx = `${seed}: ${q.prompt}`;
        assert(typeof q.prompt === 'string' && q.prompt.length > 3, ctx);
        assert(!/NaN|undefined|Infinity|\[object/.test(q.prompt), `bad prompt ${ctx}`);
        assert(Array.isArray(q.steps) && q.steps.length >= 1, `no steps ${ctx}`);
        q.steps.forEach((st) => assert(!/NaN|undefined|Infinity|\[object/.test(st), `bad step "${st}" in ${ctx}`));
        assert(q.hint && !/NaN|undefined/.test(q.hint), `bad hint ${ctx}`);
        const a = q.answer;
        if (a.type === 'choice') {
          assert(a.choices.length >= 2 && a.correct >= 0, `choice ${ctx}`);
          assert.strictEqual(new Set(a.choices).size, a.choices.length, `duplicate choices ${ctx}`);
          assert(U.checkAnswer(a, a.correct).correct);
        } else {
          if (a.type === 'number') assert(Number.isFinite(a.value), `value ${ctx}`);
          if (a.type === 'fraction') assert(Number.isInteger(a.n) && Number.isInteger(a.d) && a.d > 0, `frac ${ctx}`);
          // typing the displayed answer must be marked correct
          const r = U.checkAnswer(a, q.answerText);
          assert(r.correct, `answerText "${q.answerText}" not accepted for ${ctx}`);
          // the final answer should appear in the worked steps
          const last = q.steps.join(' ').replace(/,/g, '');
          const shown = q.answerText.replace(/^-/, '').replace(/,/g, '');
          assert(last.includes(shown) || last.includes(U.F.improper(a.type === 'fraction' ? a : { n: 0, d: 1 })), `answer ${q.answerText} not shown in steps for ${ctx}\n${q.steps.join('\n')}`);
        }
        // grade 5 skills below level 5 should not need negative numbers
        if (s.grade === 5 && a.type === 'number') assert(a.value >= 0, `negative answer ${ctx}`);
        prompts.add(q.prompt + JSON.stringify(q.answer));
      }
      assert(prompts.size > 3, `${s.id} L${level} has too little variety (${prompts.size})`);
    }
  }
});

test('generation is deterministic per seed', () => {
  for (const s of SK.list) {
    const a = SK.generate(s.id, 3, 'same'), b = SK.generate(s.id, 3, 'same');
    assert.deepStrictEqual(a, b);
  }
});

// ---------- engine ----------
test('first day plan: 10 questions, grade 5 only, max 2 per skill', () => {
  const st = E.newState();
  const plan = E.planDay(st, '2026-11-01');
  assert.strictEqual(plan.length, 10);
  const counts = {};
  plan.forEach((p) => { counts[p.skillId] = (counts[p.skillId] || 0) + 1; assert.strictEqual(SK.byId[p.skillId].grade, 5); });
  Object.values(counts).forEach((c) => assert(c <= 2));
});

function simulate(prob, days = 40) {
  const st = E.newState();
  const rng = U.makeRng('sim' + prob);
  let date = new Date(2026, 10, 1);
  for (let d = 0; d < days; d++) {
    const key = U.dayKey(date);
    for (let i = 0; i < E.DAILY; i++) {
      const q = E.questionAt(st, key, i);
      const right = rng.next() < prob(q);
      const wrongInput = q.answer.type === 'choice' ? (q.answer.correct + 1) % q.answer.choices.length : '-99999';
      let r = E.submit(st, key, i, right ? (q.answer.type === 'choice' ? q.answer.correct : q.answerText) : wrongInput);
      if (r.tryAgain) r = E.submit(st, key, i, wrongInput);
      assert(r.outcome, 'question resolved');
    }
    assert(E.getDay(st, key).completed);
    date.setDate(date.getDate() + 1);
  }
  return st;
}

test('strong student climbs levels and unlocks grade 6', () => {
  const st = simulate(() => 0.95);
  const sum = E.summary(st);
  assert(sum.g5Avg >= 4, `avg level ${sum.g5Avg}`);
  assert(sum.unlockedG6 >= 4, `unlocked ${sum.unlockedG6}`);
  const g6Attempts = sum.rows.filter((r) => r.grade === 6).reduce((s, r) => s + r.attempts, 0);
  assert(g6Attempts > 20, `grade 6 attempts ${g6Attempts}`);
  assert(st.streak.count === 40);
});

test('struggling student drops to easier levels, gets fix-it questions', () => {
  const st = simulate(() => 0.3, 15);
  const sum = E.summary(st);
  assert(sum.g5Avg < 3, `avg level ${sum.g5Avg}`);
  assert.strictEqual(sum.unlockedG6, 0);
  const plan = E.planDay(st, '2026-12-01');
  assert(plan.filter((p) => p.role === 'fix').length === 3);
});

test('adaptive to a specific weakness', () => {
  // good at everything except fractions
  const st = simulate((q) => (q.skillId.startsWith('frac') ? 0.2 : 0.95), 25);
  const lv = (id) => st.skills[id].level;
  const fracAvg = (lv('frac_addsub') + lv('frac_mult') + lv('frac_div')) / 3;
  assert(fracAvg <= 2.4, `fraction avg level ${fracAvg}`);
  assert(['frac_addsub', 'frac_mult', 'frac_div'].every((id) => st.skills[id].rating < 0.5), 'fraction ratings low');
  assert(lv('multiply') >= 4, `multiply level ${lv('multiply')}`);
  const plan = E.planDay(st, '2026-12-01');
  assert(plan.filter((p) => p.role === 'fix' && p.skillId.startsWith('frac')).length >= 2, JSON.stringify(plan));
});

test('bonus questions extend the day', () => {
  const st = simulate(() => 0.9, 1);
  const key = '2026-11-01';
  E.addBonus(st, key, 5);
  assert.strictEqual(E.getDay(st, key).plan.length, 15);
  assert.strictEqual(E.currentIndex(st, key), 10);
});

test('state survives JSON round-trip', () => {
  const st = simulate(() => 0.7, 3);
  const copy = JSON.parse(JSON.stringify(st));
  assert.deepStrictEqual(copy, st);
});

console.log(`${passed} test groups passed${process.exitCode ? ' (with failures above)' : ''}.`);
