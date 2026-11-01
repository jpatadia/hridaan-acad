/*
 * Skill catalog + question generators.
 *
 * Every skill has 5 levels:
 *   1 = Grade 5 warm-up, 2 = on grade, 3 = NJSLA-ready (multi-step / tricky),
 *   4 = advanced, 5 = Grade 6 challenge.
 * Grade 6 skills (unlocked once their Grade 5 prerequisites are strong) use the
 * same 1-5 scale inside Grade 6 content.
 *
 * gen(level, rng) returns { prompt, answer, hint, steps } where answer is one of
 *   { type:'number', value }
 *   { type:'fraction', n, d, simplest }
 *   { type:'choice', choices:[...], correct:index }
 * Text uses a/b for fractions and ^ for exponents; the UI renders them nicely.
 */
(function (g) {
  'use strict';
  const NJ = (g.NJ = g.NJ || {});
  const U = NJ.util;
  const { gcd, lcm, fmt, round, F } = U;

  // ---------- answer builders ----------
  const num = (v) => ({ type: 'number', value: round(v, 6) });
  const frac = (n, d, simplest = true) => {
    const f = F.make(n, d);
    return { type: 'fraction', n: f.n, d: f.d, simplest };
  };
  const fracOf = (f, simplest = true) => frac(f.n, f.d, simplest);
  function mc(rng, correct, distractors) {
    const set = [String(correct)];
    for (const x of distractors) {
      const s = String(x);
      if (!set.includes(s) && set.length < 4) set.push(s);
    }
    const choices = rng.shuffle(set);
    return { type: 'choice', choices, correct: choices.indexOf(String(correct)) };
  }
  function retry(fn, ok, tries = 200) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (ok(v)) return v;
    }
    throw new Error('generator could not satisfy constraints');
  }
  // a numerator 1..d-1 that makes n/d already in lowest terms
  const cp = (rng, d) => retry(() => rng.int(1, d - 1), (n) => gcd(n, d) === 1);
  const pl = (n, word, plural) => `${fmt(n)} ${n === 1 ? word : (plural || word + 's')}`;

  // ---------- shared step builders ----------
  function placeParts(n) {
    const s = String(n);
    const parts = [];
    for (let i = 0; i < s.length; i++) {
      const d = Number(s[i]);
      if (d) parts.push(d * Math.pow(10, s.length - 1 - i));
    }
    return parts;
  }

  function multiplySteps(a, b) {
    const parts = placeParts(b);
    if (parts.length === 1) return [`${fmt(a)} × ${fmt(b)} = ${fmt(a * b)}`];
    const steps = [`Break ${fmt(b)} into place values: ${parts.map(fmt).join(' + ')}.`];
    for (const p of parts) steps.push(`${fmt(a)} × ${fmt(p)} = ${fmt(a * p)}`);
    steps.push(`Add the partial products: ${parts.map((p) => fmt(a * p)).join(' + ')} = ${fmt(a * b)}`);
    return steps;
  }

  function longDivision(dividend, divisor) {
    const digits = String(dividend).split('').map(Number);
    let rem = 0, started = false, q = '';
    const steps = [];
    for (let i = 0; i < digits.length; i++) {
      const cur = rem * 10 + digits[i];
      const qd = Math.floor(cur / divisor);
      if (!started && qd === 0 && i < digits.length - 1) { rem = cur; continue; }
      started = true;
      q += qd;
      const next = i < digits.length - 1 ? ` Bring down the ${digits[i + 1]}.` : '';
      steps.push(`How many ${fmt(divisor)}s fit in ${fmt(cur)}? ${qd}. (${qd} × ${fmt(divisor)} = ${fmt(qd * divisor)}, and ${fmt(cur)} − ${fmt(qd * divisor)} = ${fmt(cur - qd * divisor)}.)${next}`);
      rem = cur - qd * divisor;
    }
    return { steps, q: Number(q), r: rem };
  }

  // Add/subtract a list of fractions/mixed numbers with full working.
  // terms: [{w, n, d}], ops: ['+','-',...] (length terms-1)
  function fractionSumSteps(terms, ops) {
    const steps = [];
    const imps = terms.map((t) => ({ n: t.w * t.d + t.n, d: t.d }));
    if (terms.some((t) => t.w)) {
      const conv = terms.filter((t) => t.w).map((t) => `${F.mixed(t.w, t.n, t.d)} = ${t.w * t.d + t.n}/${t.d}`);
      steps.push(`Change mixed numbers to improper fractions: ${conv.join(', ')}. (whole × denominator + numerator)`);
    }
    const L = imps.reduce((acc, f) => lcm(acc, f.d), 1);
    const dens = [...new Set(imps.map((f) => f.d))];
    if (dens.length > 1) {
      steps.push(`Find a common denominator. The least common multiple of ${dens.join(' and ')} is ${L}.`);
      const rew = imps.filter((f) => f.d !== L).map((f) => `${f.n}/${f.d} = (${f.n} × ${L / f.d})/(${f.d} × ${L / f.d}) = ${f.n * (L / f.d)}/${L}`);
      if (rew.length) steps.push(`Rewrite with denominator ${L}: ${rew.join('; ')}.`);
    }
    const nums = imps.map((f) => f.n * (L / f.d));
    let total = nums[0];
    let expr = `${nums[0]}`;
    for (let i = 0; i < ops.length; i++) {
      total = ops[i] === '+' ? total + nums[i + 1] : total - nums[i + 1];
      expr += ` ${ops[i] === '+' ? '+' : '−'} ${nums[i + 1]}`;
    }
    steps.push(`${ops.every((o) => o === '+') ? 'Add' : 'Combine'} the numerators and keep the denominator: (${expr}) / ${L} = ${total}/${L}.`);
    const res = F.make(total, L);
    const simple = F.str(res);
    if (simple !== `${total}/${L}`) steps.push(`Simplify: ${total}/${L} = ${simple}.`);
    return { steps, result: res };
  }

  function fracMulSteps(a, b) {
    // a, b: {n, d}
    const steps = [`Multiply the numerators and multiply the denominators: (${a.n} × ${b.n}) / (${a.d} × ${b.d}) = ${a.n * b.n}/${a.d * b.d}.`];
    const res = F.make(a.n * b.n, a.d * b.d);
    const s = F.str(res);
    if (s !== `${a.n * b.n}/${a.d * b.d}`) steps.push(`Simplify: ${a.n * b.n}/${a.d * b.d} = ${s}.`);
    return { steps, result: res };
  }

  // ---------- expression trees (order of operations with steps) ----------
  const N = (v) => ({ v });
  const op = (o, l, r, paren) => ({ o, l, r, paren });
  const PREC = { '^': 3, '×': 2, '÷': 2, '+': 1, '−': 1 };
  function render(t) {
    if ('v' in t) return fmt(t.v);
    const inner = t.o === '^' ? `${render(t.l)}^${render(t.r)}` : `${render(t.l)} ${t.o} ${render(t.r)}`;
    if (t.paren === '[') return `[${inner}]`;
    if (t.paren) return `(${inner})`;
    return inner;
  }
  function apply(o, a, b) {
    switch (o) {
      case '+': return a + b;
      case '−': return a - b;
      case '×': return a * b;
      case '÷': return a / b;
      case '^': return Math.pow(a, b);
    }
  }
  function evalTree(t) { return 'v' in t ? t.v : apply(t.o, evalTree(t.l), evalTree(t.r)); }
  function exprSteps(tree) {
    const steps = [];
    let t = JSON.parse(JSON.stringify(tree));
    let guard = 0;
    while (!('v' in t) && guard++ < 20) {
      // collect reducible nodes with (depth, prec, order)
      const cands = [];
      let order = 0;
      (function walk(node, depth, parent, side) {
        if ('v' in node) return;
        const d = depth + (node.paren ? 1 : 0);
        walk(node.l, d, node, 'l');
        const my = order++;
        if ('v' in node.l && 'v' in node.r) cands.push({ node, d, prec: PREC[node.o], my, parent, side });
        walk(node.r, d, node, 'r');
      })(t, 0, null, null);
      cands.sort((a, b) => b.d - a.d || b.prec - a.prec || a.my - b.my);
      const c = cands[0];
      const val = apply(c.node.o, c.node.l.v, c.node.r.v);
      const desc = c.node.o === '^'
        ? `${fmt(c.node.l.v)}^${fmt(c.node.r.v)} = ${Array(c.node.r.v).fill(fmt(c.node.l.v)).join(' × ')} = ${fmt(val)}`
        : `${fmt(c.node.l.v)} ${c.node.o} ${fmt(c.node.r.v)} = ${fmt(val)}`;
      const why = c.d > 0 ? 'Grouping symbols first' : c.node.o === '^' ? 'Exponents next' : c.prec === 2 ? 'Multiply/divide left to right' : 'Add/subtract left to right';
      if (c.parent) c.parent[c.side] = N(val); else t = N(val);
      steps.push(`${why}: ${desc} → ${render(t)}`);
    }
    return steps;
  }

  // ---------- skill definitions ----------
  const S = [];

  // ===== 5.NBT.A Place value & powers of 10 =====
  const PV = [
    { v: 1000, name: 'thousands', one: 'thousand' },
    { v: 100, name: 'hundreds', one: 'hundred' },
    { v: 10, name: 'tens', one: 'ten' },
    { v: 1, name: 'ones', one: 'one' },
    { v: 0.1, name: 'tenths', one: 'tenth' },
    { v: 0.01, name: 'hundredths', one: 'hundredth' },
  ];
  const fromDigits = (digits) => round(digits.reduce((s, d, i) => s + d * PV[i].v * 1000, 0) / 1000, 3);

  S.push({
    id: 'place_value', name: 'Place Value & Powers of 10', standard: '5.NBT.1-4', domain: 'Number & Operations in Base Ten', grade: 5, weight: 1.2,
    gen(level, rng) {
      if (level === 1) {
        const { digits, idx } = retry(() => {
          const digits = [rng.int(1, 9), rng.int(0, 9), rng.int(0, 9), rng.int(0, 9), rng.int(0, 9), rng.int(1, 9)];
          const ok = digits.map((d, i) => i).filter((i) => digits[i] !== 0 && digits.filter((x) => x === digits[i]).length === 1);
          return { digits, idx: ok.length ? rng.pick(ok) : -1 };
        }, (o) => o.idx >= 0);
        const d = digits[idx], p = PV[idx], n = fromDigits(digits);
        return {
          prompt: `What is the value of the digit ${d} in ${fmt(n)}?`,
          answer: num(d * p.v),
          hint: `Find which place the ${d} is in, then multiply the digit by the value of that place.`,
          steps: [`The ${d} is in the ${p.name} place.`, `One ${p.one} = ${fmt(p.v)}.`, `${d} × ${fmt(p.v)} = ${fmt(d * p.v)}.`],
        };
      }
      if (level === 2) {
        const d = rng.int(1, 9);
        const i = rng.int(0, 4);
        const j = Math.min(5, i + rng.int(1, 3));
        const digits = PV.map((_, k) => (k === i || k === j ? d : retry(() => rng.int(0, 9), (x) => x !== d)));
        if (digits[0] === 0) digits[0] = d === 1 ? 2 : 1;
        if (i !== 0 && digits[0] === d) digits[0] = d === 9 ? 8 : d + 1;
        if (digits[5] === 0) digits[5] = d === 1 ? 2 : 1;
        const n = fromDigits(digits);
        const a = d * PV[i].v, b = round(d * PV[j].v, 4), ratio = Math.round(PV[i].v / PV[j].v);
        return {
          prompt: `In the number ${fmt(n)}, the value of the ${d} in the ${PV[i].name} place is how many times the value of the ${d} in the ${PV[j].name} place?`,
          answer: num(ratio),
          hint: `Each place to the left is worth 10 times as much as the place to its right. Count how many places apart the two ${d}s are.`,
          steps: [
            `The ${d} in the ${PV[i].name} place is worth ${d} × ${fmt(PV[i].v)} = ${fmt(a)}.`,
            `The ${d} in the ${PV[j].name} place is worth ${d} × ${fmt(PV[j].v)} = ${fmt(b)}.`,
            `They are ${j - i} place(s) apart, so the first is ${Array(j - i).fill('10').join(' × ')} = ${fmt(ratio)} times as much. (Check: ${fmt(a)} ÷ ${fmt(b)} = ${fmt(ratio)}.)`,
          ],
        };
      }
      if (level === 3) {
        const e = rng.int(1, 3);
        const p = Math.pow(10, e);
        if (rng.chance(0.5)) {
          const base = rng.int(101, 9999) / rng.pick([100, 1000]);
          const ans = round(base * p, 6);
          return {
            prompt: `${fmt(base)} × 10^${e} = ?`,
            answer: num(ans),
            hint: `10^${e} means 1 followed by ${e} zero(s). Multiplying by it moves the decimal point ${e} place(s) to the right.`,
            steps: [`10^${e} = ${fmt(p)}.`, `Multiplying by ${fmt(p)} makes every digit ${fmt(p)} times bigger, so the decimal point moves ${e} place(s) to the RIGHT.`, `${fmt(base)} × ${fmt(p)} = ${fmt(ans)}.`],
          };
        }
        const base = rng.int(12, 9999) / rng.pick([1, 10]);
        const ans = round(base / p, 6);
        return {
          prompt: `${fmt(base)} ÷ 10^${e} = ?`,
          answer: num(ans),
          hint: `10^${e} means 1 followed by ${e} zero(s). Dividing by it moves the decimal point ${e} place(s) to the left.`,
          steps: [`10^${e} = ${fmt(p)}.`, `Dividing by ${fmt(p)} makes every digit ${fmt(p)} times smaller, so the decimal point moves ${e} place(s) to the LEFT (add zeros in front if you need them).`, `${fmt(base)} ÷ ${fmt(p)} = ${fmt(ans)}.`],
        };
      }
      if (level === 4) {
        const f = rng.pick([10, 100]);
        const X = rng.int(11, 999) / rng.pick([1, 10, 100]);
        const kind = rng.int(0, 3);
        const fr = `1/${f}`;
        const variants = [
          { p: `What number is ${fr} of ${fmt(X)}?`, a: X / f, s: [`"${fr} of" means divide by ${f}.`, `${fmt(X)} ÷ ${f} = ${fmt(X / f)}.`] },
          { p: `What number is ${f} times as much as ${fmt(X)}?`, a: X * f, s: [`"${f} times as much" means multiply by ${f}.`, `${fmt(X)} × ${f} = ${fmt(X * f)}.`] },
          { p: `${fmt(X)} is ${fr} of what number?`, a: X * f, s: [`If ${fmt(X)} is only ${fr} of the mystery number, the mystery number is ${f} times bigger.`, `${fmt(X)} × ${f} = ${fmt(X * f)}.`, `Check: ${fr} of ${fmt(X * f)} is ${fmt(X)}. ✓`] },
          { p: `${fmt(X)} is ${f} times as much as what number?`, a: X / f, s: [`If ${fmt(X)} is ${f} times the mystery number, the mystery number is ${f} times smaller.`, `${fmt(X)} ÷ ${f} = ${fmt(X / f)}.`, `Check: ${f} × ${fmt(X / f)} = ${fmt(X)}. ✓`] },
        ];
        const v = variants[kind];
        return { prompt: v.p, answer: num(v.a), hint: 'Decide: is the number you are looking for bigger or smaller than the number given? Then multiply or divide.', steps: v.s };
      }
      // level 5: expanded form with exponents and fractions, terms out of order
      const exps = rng.shuffle([3, 2, 1, 0, -1, -2, -3]).slice(0, rng.int(3, 4));
      const terms = exps.map((e) => ({ e, d: rng.int(1, 9) }));
      const txt = (t) => (t.e >= 1 ? `${t.d} × 10^${t.e}` : t.e === 0 ? `${t.d} × 1` : `${t.d} × (1/${Math.pow(10, -t.e)})`);
      const val = (t) => round(t.d * Math.pow(10, t.e), 6);
      const total = round(terms.reduce((s, t) => s + val(t), 0), 6);
      const sorted = terms.slice().sort((a, b) => b.e - a.e);
      return {
        prompt: `What number is equal to ${terms.map(txt).join(' + ')}?`,
        answer: num(total),
        hint: 'Find the value of each part first. Watch out: the parts are NOT in order! A place with no part gets a 0.',
        steps: [...sorted.map((t) => `${txt(t)} = ${fmt(val(t))}`), `Add them (put 0 in any empty place): ${sorted.map((t) => fmt(val(t))).join(' + ')} = ${fmt(total)}.`],
      };
    },
  });

  // ===== 5.NBT.5 Multi-digit multiplication =====
  S.push({
    id: 'multiply', name: 'Multi-Digit Multiplication', standard: '5.NBT.5', domain: 'Number & Operations in Base Ten', grade: 5, weight: 1.0,
    gen(level, rng) {
      const ranges = { 1: [[102, 999], [3, 9]], 2: [[13, 99], [13, 99]], 3: [[102, 999], [12, 99]], 4: [[1002, 9999], [12, 99]] };
      if (level <= 4 && !(level >= 3 && rng.chance(0.4))) {
        const [[a1, a2], [b1, b2]] = ranges[level];
        const a = rng.int(a1, a2), b = rng.int(b1, b2);
        return { prompt: `${fmt(a)} × ${fmt(b)} = ?`, answer: num(a * b), hint: `Break ${fmt(b)} into tens and ones (and hundreds), multiply each part, then add the partial products.`, steps: multiplySteps(a, b) };
      }
      if (level <= 4) {
        const a = rng.int(102, 999), b = rng.int(12, 99);
        const ctx = rng.pick([
          `A stadium has ${b} sections. Each section has ${fmt(a)} seats. How many seats are in the stadium?`,
          `A printer prints ${fmt(a)} pages every hour. How many pages does it print in ${b} hours?`,
          `A farm packs ${fmt(a)} apples into each crate. How many apples are in ${b} crates?`,
        ]);
        return { prompt: ctx, answer: num(a * b), hint: `This is a multiplication problem: ${fmt(a)} × ${b}.`, steps: [`Write the multiplication: ${fmt(a)} × ${b}.`, ...multiplySteps(a, b)] };
      }
      if (rng.chance(0.5)) {
        const a = rng.int(102, 999), b = rng.int(102, 999);
        return { prompt: `${fmt(a)} × ${fmt(b)} = ?`, answer: num(a * b), hint: `Break ${fmt(b)} into hundreds, tens and ones. Multiply ${fmt(a)} by each part and add.`, steps: multiplySteps(a, b) };
      }
      const n1 = rng.int(12, 48), p1 = rng.int(205, 899), n2 = rng.int(12, 60), p2 = rng.int(105, 499);
      const t1 = n1 * p1, t2 = n2 * p2;
      return {
        prompt: `A school buys ${n1} laptops for $${fmt(p1)} each and ${n2} tablets for $${fmt(p2)} each. What is the total cost, in dollars?`,
        answer: num(t1 + t2),
        hint: 'Find the cost of the laptops and the cost of the tablets separately, then add.',
        steps: [`Laptops: ${n1} × $${fmt(p1)}.`, ...multiplySteps(p1, n1), `Tablets: ${n2} × $${fmt(p2)}.`, ...multiplySteps(p2, n2), `Total: $${fmt(t1)} + $${fmt(t2)} = $${fmt(t1 + t2)}.`],
      };
    },
  });

  // ===== 5.NBT.6 Division =====
  S.push({
    id: 'divide', name: 'Multi-Digit Division', standard: '5.NBT.6', domain: 'Number & Operations in Base Ten', grade: 5, weight: 1.0,
    gen(level, rng) {
      if (level <= 3) {
        const [d1, d2, q1, q2] = { 1: [3, 9, 21, 199], 2: [3, 9, 201, 1999], 3: [12, 48, 21, 299] }[level];
        const { dv, q } = retry(() => ({ dv: rng.int(d1, d2), q: rng.int(q1, q2) }), (o) => o.dv * o.q <= 9999);
        const D = dv * q;
        const ld = longDivision(D, dv);
        return {
          prompt: `${fmt(D)} ÷ ${dv} = ?`,
          answer: num(q),
          hint: level === 3 ? `Estimate first: round ${dv} to a friendly number. Then divide step by step, place by place.` : `Divide one place at a time, starting from the left.`,
          steps: [...ld.steps, `So ${fmt(D)} ÷ ${dv} = ${fmt(q)}. Check: ${fmt(q)} × ${dv} = ${fmt(D)}. ✓`],
        };
      }
      if (level === 4) {
        const cap = rng.int(12, 48);
        const total = retry(() => rng.int(150, 2000), (t) => t % cap !== 0);
        const q = Math.floor(total / cap), r = total % cap;
        const ld = longDivision(total, cap);
        const kind = rng.int(0, 2);
        const v = [
          { p: `${fmt(total)} students are going on a field trip. Each bus holds ${cap} students. What is the fewest number of buses needed so every student gets a seat?`, a: q + 1, end: `The ${r} leftover students still need a bus, so round UP: ${q} + 1 = ${q + 1} buses.` },
          { p: `A factory packs ${fmt(total)} crayons into boxes of ${cap}. How many boxes can be completely filled?`, a: q, end: `Only full boxes count, so the remainder is dropped: ${q} full boxes.` },
          { p: `A baker packs ${fmt(total)} cookies into boxes of ${cap}. After filling as many boxes as possible, how many cookies are left over?`, a: r, end: `The question asks for the leftovers, which is the remainder: ${r}.` },
        ][kind];
        return { prompt: v.p, answer: num(v.a), hint: `Divide ${fmt(total)} by ${cap}. Then think carefully about what to do with the remainder.`, steps: [`Divide: ${fmt(total)} ÷ ${cap}.`, ...ld.steps, `${fmt(total)} ÷ ${cap} = ${q} remainder ${r}.`, v.end] };
      }
      // level 5: quotient with a decimal part
      const k = rng.int(3, 12);
      const dv = 4 * k;
      const whole = rng.int(21, 249);
      const part = rng.pick([0.25, 0.5, 0.75]);
      const q = whole + part;
      const D = Math.round(q * dv);
      const ld = longDivision(D, dv);
      const r = D - whole * dv;
      const rf = F.make(r, dv);
      return {
        prompt: `${fmt(D)} ÷ ${dv} = ?  (Write your answer as a decimal.)`,
        answer: num(q),
        hint: `Divide to get a whole number and a remainder. Then turn the remainder into a fraction of ${dv} and change it to a decimal.`,
        steps: [...ld.steps, `So far: ${whole} remainder ${r}.`, `The remainder is ${r} out of ${dv}: ${r}/${dv} = ${F.str(rf)} = ${fmt(part)}.`, `Answer: ${whole} + ${fmt(part)} = ${fmt(q)}. Check: ${fmt(q)} × ${dv} = ${fmt(D)}. ✓`],
      };
    },
  });

  // ===== 5.NBT.7 Decimal operations =====
  S.push({
    id: 'decimals', name: 'Decimal Operations', standard: '5.NBT.7', domain: 'Number & Operations in Base Ten', grade: 5, weight: 1.1,
    gen(level, rng) {
      if (level === 1) {
        const a = rng.int(10, 999) / 10, b = rng.int(100, 9999) / 100;
        const add = rng.chance(0.5);
        const [x, y] = add ? [a, b] : [Math.max(a, b), Math.min(a, b)];
        const ans = round(add ? x + y : x - y, 2);
        const X = Math.round(x * 100), Y = Math.round(y * 100);
        return {
          prompt: `${fmt(x)} ${add ? '+' : '−'} ${fmt(y)} = ?`,
          answer: num(ans),
          hint: 'Line up the decimal points. Add zeros so both numbers have the same number of decimal places.',
          steps: [`Line up the decimal points: ${x.toFixed(2)} ${add ? '+' : '−'} ${y.toFixed(2)}.`, `Work like whole numbers (in hundredths): ${fmt(X)} ${add ? '+' : '−'} ${fmt(Y)} = ${fmt(add ? X + Y : X - Y)}.`, `Put the decimal point back (2 places): ${fmt(ans)}.`],
        };
      }
      if (level === 2) {
        const places = rng.pick([1, 2]);
        const A = rng.int(11, 999), a = A / Math.pow(10, places), b = rng.int(3, 48);
        const ans = round(a * b, 2);
        return {
          prompt: `${fmt(a)} × ${b} = ?`,
          answer: num(ans),
          hint: 'Multiply as if there were no decimal point, then put back the same number of decimal places.',
          steps: [`Ignore the decimal: ${fmt(A)} × ${b} = ${fmt(A * b)}.`, `${fmt(a)} has ${places} decimal place(s), so the answer needs ${places}: ${fmt(ans)}.`, `Estimate to check: about ${fmt(Math.round(a))} × ${b} ≈ ${fmt(Math.round(a) * b)}. ✓`],
        };
      }
      if (level === 3) {
        if (rng.chance(0.5)) {
          const A = rng.int(11, 99), pb = rng.pick([1, 2]), B = pb === 1 ? rng.int(11, 99) : rng.int(11, 99);
          const a = A / 10, b = B / Math.pow(10, pb);
          const ans = round(a * b, 3);
          return {
            prompt: `${fmt(a)} × ${fmt(b)} = ?`,
            answer: num(ans),
            hint: 'Multiply the whole numbers, then count the total decimal places in both factors.',
            steps: [`Ignore the decimals: ${A} × ${B} = ${fmt(A * B)}.`, `Decimal places: ${fmt(a)} has 1, ${fmt(b)} has ${pb}, total ${1 + pb}.`, `Move the decimal ${1 + pb} places left: ${fmt(ans)}.`],
          };
        }
        const b = rng.int(2, 9), Q = rng.int(11, 999), q = Q / 100, A = Q * b, a = A / 100;
        return {
          prompt: `${fmt(a)} ÷ ${b} = ?`,
          answer: num(q),
          hint: 'Divide like whole numbers, and keep the decimal point in the same spot in the answer.',
          steps: [`Think in hundredths: ${fmt(a)} is ${fmt(A)} hundredths.`, `${fmt(A)} ÷ ${b} = ${fmt(Q)} hundredths.`, `${fmt(Q)} hundredths = ${fmt(q)}. Check: ${fmt(q)} × ${b} = ${fmt(a)}. ✓`],
        };
      }
      if (level === 4) {
        const items = rng.shuffle([['notebooks', [175, 450]], ['pens', [85, 299]], ['folders', [65, 250]], ['markers', [120, 399]], ['erasers', [45, 150]]]).slice(0, 2);
        const n1 = rng.int(2, 6), n2 = rng.int(2, 6);
        const p1 = rng.int(...items[0][1]), p2 = rng.int(...items[1][1]);
        const total = n1 * p1 + n2 * p2;
        const bill = [2000, 5000, 10000].find((b) => b > total);
        const change = bill - total;
        const $ = (c) => `$${(c / 100).toFixed(2)}`;
        return {
          prompt: `Maya buys ${n1} ${items[0][0]} for ${$(p1)} each and ${n2} ${items[1][0]} for ${$(p2)} each. She pays with a ${$(bill)} bill. How much change should she get, in dollars?`,
          answer: num(change / 100),
          hint: 'Step 1: cost of each item type. Step 2: total cost. Step 3: subtract from the money she paid.',
          steps: [`${items[0][0]}: ${n1} × ${$(p1)} = ${$(n1 * p1)}.`, `${items[1][0]}: ${n2} × ${$(p2)} = ${$(n2 * p2)}.`, `Total: ${$(n1 * p1)} + ${$(n2 * p2)} = ${$(total)}.`, `Change: ${$(bill)} − ${$(total)} = ${$(change)}.`],
        };
      }
      // level 5: decimal ÷ decimal (6.NS.3)
      if (rng.chance(0.5)) {
        const D = rng.int(2, 99), q = rng.int(12, 99);
        const dv = D / 100, dd = round((q * D) / 100, 2);
        return {
          prompt: `${fmt(dd)} ÷ ${fmt(dv)} = ?`,
          answer: num(q),
          hint: 'Make the divisor a whole number: multiply BOTH numbers by the same power of 10.',
          steps: [`The divisor ${fmt(dv)} has 2 decimal places, so multiply both numbers by 100.`, `${fmt(dd)} ÷ ${fmt(dv)} becomes ${fmt(q * D)} ÷ ${D}.`, `${fmt(q * D)} ÷ ${D} = ${q}.`, `Check: ${q} × ${fmt(dv)} = ${fmt(dd)}. ✓`],
        };
      }
      const D = rng.int(2, 9), Q = rng.int(12, 199);
      const q = Q / 10, dv = D / 10, dd = round((Q * D) / 100, 2);
      return {
        prompt: `${fmt(dd)} ÷ ${fmt(dv)} = ?`,
        answer: num(q),
        hint: 'Make the divisor a whole number: multiply BOTH numbers by 10.',
        steps: [`Multiply both numbers by 10: ${fmt(dd)} ÷ ${fmt(dv)} becomes ${fmt(dd * 10)} ÷ ${D}.`, `${fmt(dd * 10)} ÷ ${D} = ${fmt(q)}.`, `Check: ${fmt(q)} × ${fmt(dv)} = ${fmt(dd)}. ✓`],
      };
    },
  });

  // ===== 5.NF.1-2 Add & subtract fractions =====
  function randFrac(rng, d) { return { w: 0, n: cp(rng, d), d }; }
  S.push({
    id: 'frac_addsub', name: 'Adding & Subtracting Fractions', standard: '5.NF.1-2', domain: 'Number & Operations – Fractions', grade: 5, weight: 1.4,
    gen(level, rng) {
      const hint = 'Fractions need the SAME denominator before you add or subtract. Find the least common multiple of the denominators.';
      const show = (t) => F.mixed(t.w, t.n, t.d);
      if (level <= 2) {
        const pairs = level === 1
          ? [[2, 4], [2, 6], [3, 6], [4, 8], [2, 8], [3, 9], [5, 10], [3, 12], [4, 12], [6, 12], [2, 10]]
          : [[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [5, 6], [4, 6], [3, 8], [6, 8], [4, 10], [6, 9], [5, 12], [8, 12], [7, 3], [9, 6]].map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
        const { a, b, sub } = retry(() => {
          const [d1, d2] = rng.shuffle(rng.pick(pairs));
          const a = randFrac(rng, d1), b = randFrac(rng, d2);
          return { a, b, sub: rng.chance(0.4) };
        }, (o) => (!o.sub || o.a.n / o.a.d > o.b.n / o.b.d) && o.a.d !== o.b.d);
        const { steps, result } = fractionSumSteps([a, b], [sub ? '-' : '+']);
        return { prompt: `${show(a)} ${sub ? '−' : '+'} ${show(b)} = ?  (simplest form)`, answer: fracOf(result), hint, steps };
      }
      if (level === 3) {
        const dens = [2, 3, 4, 5, 6, 8, 10, 12];
        const [a, b] = retry(() => [{ ...randFrac(rng, rng.pick(dens)), w: rng.int(1, 6) }, { ...randFrac(rng, rng.pick(dens)), w: rng.int(1, 6) }], ([x, y]) => x.d !== y.d);
        const { steps, result } = fractionSumSteps([a, b], ['+']);
        const word = rng.chance(0.5);
        const prompt = word
          ? `Liam hiked ${show(a)} miles on Saturday and ${show(b)} miles on Sunday. How many miles did he hike in all?  (simplest form)`
          : `${show(a)} + ${show(b)} = ?  (simplest form)`;
        return { prompt, answer: fracOf(result), hint, steps };
      }
      if (level === 4) {
        const dens = [3, 4, 5, 6, 8, 10, 12];
        const [a, b] = retry(() => {
          const da = rng.pick(dens), db = rng.pick(dens);
          return [{ ...randFrac(rng, da), w: rng.int(3, 9) }, { ...randFrac(rng, db), w: rng.int(1, 2) }];
        }, ([x, y]) => x.d !== y.d && x.n / x.d < y.n / y.d && x.w > y.w);
        const { steps, result } = fractionSumSteps([a, b], ['-']);
        steps.unshift(`Notice ${a.n}/${a.d} is smaller than ${b.n}/${b.d}, so you can't subtract the fraction parts directly — that's why improper fractions (or regrouping a whole) help.`);
        const word = rng.chance(0.5);
        const prompt = word
          ? `A water jug holds ${show(a)} liters. Sam pours out ${show(b)} liters. How many liters are left in the jug?  (simplest form)`
          : `${show(a)} − ${show(b)} = ?  (simplest form)`;
        return { prompt, answer: fracOf(result), hint: hint + ' You may need to regroup (borrow) a whole.', steps };
      }
      // level 5: three fractions, word problem, mixed operations
      const dens = [2, 3, 4, 5, 6, 8, 10, 12];
      const { start, a, b } = retry(() => ({
        start: { ...randFrac(rng, rng.pick(dens)), w: rng.int(4, 8) },
        a: { ...randFrac(rng, rng.pick(dens)), w: rng.int(0, 1) },
        b: randFrac(rng, rng.pick(dens)),
      }), (o) => new Set([o.start.d, o.a.d, o.b.d]).size >= 2 && lcm(lcm(o.start.d, o.a.d), o.b.d) <= 60);
      const { steps, result } = fractionSumSteps([start, a, b], ['-', '-']);
      return {
        prompt: `Ava had ${show(start)} yards of ribbon. She used ${show(a)} yards for a bow and ${show(b)} yard for a bookmark. How many yards of ribbon does she have left?  (simplest form)`,
        answer: fracOf(result),
        hint: 'Subtract BOTH amounts she used from what she started with. Use one common denominator for all three fractions.',
        steps: [`Write the expression: ${show(start)} − ${show(a)} − ${show(b)}.`, ...steps],
      };
    },
  });

  // ===== 5.NF.4-6 Multiply fractions =====
  S.push({
    id: 'frac_mult', name: 'Multiplying Fractions', standard: '5.NF.4-6', domain: 'Number & Operations – Fractions', grade: 5, weight: 1.3,
    gen(level, rng) {
      const hint = 'Multiply numerator × numerator and denominator × denominator. Change mixed numbers to improper fractions first.';
      if (level === 1) {
        const d = rng.int(2, 12), n = cp(rng, d);
        const W = rng.chance(0.6) ? d * rng.int(1, 6) : rng.int(2, 15);
        const res = F.make(n * W, d);
        return {
          prompt: rng.chance(0.5) ? `What is ${n}/${d} of ${W}?  (simplest form)` : `${n}/${d} × ${W} = ?  (simplest form)`,
          answer: fracOf(res),
          hint: `Think: ${W} ÷ ${d} gives one part (1/${d}); then take ${n} of those parts. Or multiply ${n} × ${W} and put it over ${d}.`,
          steps: [`Write ${W} as ${W}/1.`, `${n}/${d} × ${W}/1 = (${n} × ${W}) / ${d} = ${n * W}/${d}.`, ...(F.str(res) !== `${n * W}/${d}` ? [`Simplify: ${n * W}/${d} = ${F.str(res)}.`] : [])],
        };
      }
      if (level === 2) {
        const d1 = rng.int(2, 10), d2 = rng.int(2, 10);
        const a = { n: cp(rng, d1), d: d1 }, b = { n: cp(rng, d2), d: d2 };
        const { steps, result } = fracMulSteps(a, b);
        return { prompt: `${a.n}/${a.d} × ${b.n}/${b.d} = ?  (simplest form)`, answer: fracOf(result), hint, steps };
      }
      if (level === 3) {
        const kind = rng.int(0, 2);
        if (kind === 0) {
          const d1 = rng.int(2, 8), d2 = rng.int(2, 8);
          const a = { n: cp(rng, d1), d: d1 }, b = { n: cp(rng, d2), d: d2 };
          const { steps, result } = fracMulSteps(a, b);
          return {
            prompt: `A rectangular garden is ${a.n}/${a.d} of a mile long and ${b.n}/${b.d} of a mile wide. What is its area, in square miles?  (simplest form)`,
            answer: fracOf(result), hint: 'Area of a rectangle = length × width.', steps: ['Area = length × width.', ...steps],
          };
        }
        if (kind === 1) {
          const d = rng.int(2, 8), n = cp(rng, d), w = rng.int(1, 5), W = rng.int(2, 9);
          const imp = { n: w * d + n, d };
          const { steps, result } = fracMulSteps(imp, { n: W, d: 1 });
          return {
            prompt: `${F.mixed(w, n, d)} × ${W} = ?  (simplest form)`,
            answer: fracOf(result), hint,
            steps: [`Change ${F.mixed(w, n, d)} to an improper fraction: ${imp.n}/${d}. Write ${W} as ${W}/1.`, ...steps],
          };
        }
        // scaling (5.NF.5)
        const N0 = rng.int(120, 980);
        const type = rng.pick(['less', 'greater', 'equal', 'less', 'greater']);
        const d = rng.int(3, 9);
        const n = type === 'less' ? cp(rng, d) : type === 'greater' ? rng.int(d + 1, 2 * d - 1) : d;
        const correct = { less: `Less than ${N0}`, greater: `Greater than ${N0}`, equal: `Equal to ${N0}` }[type];
        return {
          prompt: `Without multiplying, decide: is ${n}/${d} × ${N0} greater than, less than, or equal to ${N0}?`,
          answer: mc(rng, correct, [`Less than ${N0}`, `Greater than ${N0}`, `Equal to ${N0}`]),
          hint: 'Compare the fraction to 1. Multiplying by something less than 1 makes a number smaller; more than 1 makes it bigger.',
          steps: [`Compare ${n}/${d} to 1: ${n < d ? `${n} < ${d}, so ${n}/${d} is less than 1` : n > d ? `${n} > ${d}, so ${n}/${d} is greater than 1` : `${n}/${d} = 1`}.`, `So ${n}/${d} × ${N0} is ${correct.toLowerCase()}.`],
        };
      }
      if (level === 4) {
        const mk = () => { const d = rng.int(2, 6); return { w: rng.int(1, 4), n: cp(rng, d), d }; };
        const a = mk(), b = mk();
        const ia = { n: a.w * a.d + a.n, d: a.d }, ib = { n: b.w * b.d + b.n, d: b.d };
        const { steps, result } = fracMulSteps(ia, ib);
        return {
          prompt: `${F.mixed(a.w, a.n, a.d)} × ${F.mixed(b.w, b.n, b.d)} = ?  (simplest form)`,
          answer: fracOf(result), hint,
          steps: [`Change to improper fractions: ${F.mixed(a.w, a.n, a.d)} = ${ia.n}/${ia.d} and ${F.mixed(b.w, b.n, b.d)} = ${ib.n}/${ib.d}.`, ...steps, 'Estimate to check: round each mixed number to the nearest whole and multiply.'],
        };
      }
      // level 5: multi-step "fraction of the remainder"
      const b = rng.int(2, 5), a = cp(rng, b), d = rng.int(2, 5), c = cp(rng, d), k = rng.int(1, 4);
      const T = b * d * k;
      const used1 = (T / b) * a, left1 = T - used1, used2 = (left1 / d) * c, left2 = left1 - used2;
      return {
        prompt: `Ana has ${T} stickers. She gives ${a}/${b} of them to her brother. Then she gives ${c}/${d} of the stickers she has left to her friend. How many stickers does Ana have now?`,
        answer: num(left2),
        hint: 'Work in two steps. The second fraction is a fraction of what is LEFT, not of the starting amount.',
        steps: [`Brother: ${a}/${b} of ${T} = ${T} ÷ ${b} × ${a} = ${used1}.`, `Left: ${T} − ${used1} = ${left1}.`, `Friend: ${c}/${d} of ${left1} = ${left1} ÷ ${d} × ${c} = ${used2}.`, `Now: ${left1} − ${used2} = ${left2} stickers.`],
      };
    },
  });

  // ===== 5.NF.7 Divide fractions (→ 6.NS.1) =====
  S.push({
    id: 'frac_div', name: 'Dividing with Fractions', standard: '5.NF.7 → 6.NS.1', domain: 'Number & Operations – Fractions', grade: 5, weight: 1.1,
    gen(level, rng) {
      if (level === 1 || (level === 3 && rng.chance(0.5))) {
        const W = rng.int(2, 12), d = rng.int(2, 10);
        const word = level === 3;
        return {
          prompt: word ? `Mr. Lee has ${W} pounds of trail mix. He puts 1/${d} pound in each bag. How many bags can he fill?` : `${W} ÷ 1/${d} = ?`,
          answer: num(W * d),
          hint: `Ask: how many 1/${d}s fit in ${W}? Each whole has ${d} pieces of size 1/${d}.`,
          steps: [`${word ? `Write the division: ${W} ÷ 1/${d}. ` : ''}Each whole is made of ${d} pieces that are 1/${d} in size.`, `${W} wholes × ${d} pieces each = ${W * d}.`, `Check: ${W * d} × 1/${d} = ${W * d}/${d} = ${W}. ✓`],
        };
      }
      if (level <= 3) {
        const W = rng.int(2, 9), d = rng.int(2, 8);
        const word = level === 3;
        return {
          prompt: word ? `${W} friends share 1/${d} of a pizza equally. What fraction of the WHOLE pizza does each friend get?` : `1/${d} ÷ ${W} = ?`,
          answer: frac(1, d * W),
          hint: `Split 1/${d} into ${W} equal parts. Each part is smaller than 1/${d}!`,
          steps: [`${word ? `Write the division: 1/${d} ÷ ${W}. ` : ''}Splitting 1/${d} into ${W} equal parts makes each part 1/(${d} × ${W}).`, `1/${d} ÷ ${W} = 1/${d * W}.`, `Check: 1/${d * W} × ${W} = ${W}/${d * W} = 1/${d}. ✓`],
        };
      }
      if (level === 4) {
        const b = rng.int(2, 9), d = rng.int(2, 9);
        const a = { n: cp(rng, b), d: b }, c = { n: cp(rng, d), d };
        const recip = { n: c.d, d: c.n };
        const { steps, result } = fracMulSteps(a, recip);
        return {
          prompt: `${a.n}/${a.d} ÷ ${c.n}/${c.d} = ?  (simplest form)`,
          answer: fracOf(result),
          hint: 'Dividing by a fraction is the same as multiplying by its reciprocal (flip the second fraction).',
          steps: [`Keep the first fraction, change ÷ to ×, flip the second: ${a.n}/${a.d} × ${recip.n}/${recip.d}.`, ...steps],
        };
      }
      // level 5: mixed numbers; integer word problem or bare computation
      if (rng.chance(0.5)) {
        const pd = rng.int(2, 6), pn = cp(rng, pd), k = rng.int(3, 15);
        const len = F.make(k * pn, pd);
        const lenTxt = F.str(len);
        return {
          prompt: `A ribbon is ${lenTxt} yards long. It is cut into pieces that are each ${pn}/${pd} yard long. How many pieces are there?`,
          answer: num(k),
          hint: `Divide the total length by the length of one piece: ${lenTxt} ÷ ${pn}/${pd}.`,
          steps: [`Write the division: ${lenTxt} ÷ ${pn}/${pd}.`, `As an improper fraction, ${lenTxt} = ${F.improper(len)}.`, `Multiply by the reciprocal: ${F.improper(len)} × ${pd}/${pn} = ${len.n * pd}/${len.d * pn} = ${k}.`, `Check: ${k} × ${pn}/${pd} = ${lenTxt}. ✓`],
        };
      }
      const d1 = rng.int(2, 6), w = rng.int(1, 5), n1 = cp(rng, d1), d2 = rng.int(2, 9), n2 = cp(rng, d2);
      const imp = { n: w * d1 + n1, d: d1 }, recip = { n: d2, d: n2 };
      const { steps, result } = fracMulSteps(imp, recip);
      return {
        prompt: `${F.mixed(w, n1, d1)} ÷ ${n2}/${d2} = ?  (simplest form)`,
        answer: fracOf(result),
        hint: 'Change the mixed number to an improper fraction, then multiply by the reciprocal.',
        steps: [`${F.mixed(w, n1, d1)} = ${imp.n}/${imp.d}.`, `Keep, change, flip: ${imp.n}/${imp.d} × ${d2}/${n2}.`, ...steps],
      };
    },
  });

  // ===== 5.OA.1-2 Expressions (→ 6.EE.1-2) =====
  S.push({
    id: 'expressions', name: 'Order of Operations & Expressions', standard: '5.OA.1-2 → 6.EE.1-2', domain: 'Operations & Algebraic Thinking', grade: 5, weight: 1.0,
    gen(level, rng) {
      const hint = 'Order: grouping symbols ( ) and [ ] first, then exponents, then × and ÷ from left to right, then + and − from left to right.';
      const R = (a, b) => rng.int(a, b);
      const build = (tree) => {
        const v = evalTree(tree);
        return { prompt: `${render(tree)} = ?`, answer: num(v), hint, steps: exprSteps(tree) };
      };
      const valid = (tree) => {
        let ok = true;
        (function w(t) { if ('v' in t) return; w(t.l); w(t.r); const v = evalTree(t); if (v < 0 || !Number.isInteger(v)) ok = false; })(tree);
        return ok;
      };
      if (level === 1) {
        const tree = retry(() => {
          const k = R(0, 3);
          if (k === 0) return op('−', op('×', op('+', N(R(2, 15)), N(R(2, 15)), true), N(R(2, 9))), N(R(1, 20)));
          if (k === 1) return op('+', op('×', N(R(2, 9)), op('−', N(R(8, 20)), N(R(1, 7)), true)), N(R(1, 20)));
          if (k === 2) return op('+', N(R(2, 20)), op('×', N(R(2, 9)), N(R(2, 9))));
          const c = R(2, 6), q = R(2, 9), b = R(1, 20);
          return op('+', op('÷', op('−', N(c * q + b), N(b), true), N(c)), N(R(1, 15)));
        }, valid);
        return build(tree);
      }
      if (level === 2) {
        const tree = retry(() => {
          const k = R(0, 2);
          if (k === 0) return op('−', op('×', N(R(2, 9)), op('+', N(R(2, 12)), N(R(2, 12)), true), '['), N(R(1, 30)));
          if (k === 1) {
            return op('+', N(R(2, 30)), op('÷', op('×', op('−', N(R(6, 20)), N(R(1, 5)), true), N(R(2, 6)), '['), N(R(2, 9))));
          }
          return op('÷', op('×', op('+', N(R(2, 15)), N(R(2, 15)), true), N(R(2, 6)), '['), N(R(2, 9)));
        }, valid);
        return build(tree);
      }
      if (level === 3) {
        const a = R(3, 20), b = R(3, 20), c = R(2, 9);
        const kind = R(0, 2);
        if (kind === 0) {
          return {
            prompt: `Which expression means "add ${a} and ${b}, then multiply by ${c}"?`,
            answer: mc(rng, `(${a} + ${b}) × ${c}`, [`${a} + ${b} × ${c}`, `${a} × ${c} + ${b}`, `${a} + (${b} × ${c})`]),
            hint: 'The step that happens FIRST in words must be done first — put it in parentheses.',
            steps: [`"Add ${a} and ${b}" happens first, so it goes in parentheses: (${a} + ${b}).`, `"Then multiply by ${c}": (${a} + ${b}) × ${c}.`, `Without parentheses, ${a} + ${b} × ${c} would multiply first — that's a different value!`],
          };
        }
        if (kind === 1) {
          const [hi, lo] = a > b ? [a, b] : [b + 1, a];
          return {
            prompt: `Which expression means "multiply ${c} by the difference of ${hi} and ${lo}"?`,
            answer: mc(rng, `${c} × (${hi} − ${lo})`, [`${c} × ${hi} − ${lo}`, `(${c} × ${lo}) − ${hi}`, `${c} + (${hi} − ${lo})`]),
            hint: '"The difference of" two numbers means subtract them — and that has to happen before multiplying.',
            steps: [`"The difference of ${hi} and ${lo}" is (${hi} − ${lo}).`, `Multiply ${c} by that: ${c} × (${hi} − ${lo}).`],
          };
        }
        const big = R(1000, 9999), small = R(100, 999);
        return {
          prompt: `Without calculating, how does the value of ${c} × (${fmt(big)} + ${small}) compare to the value of ${fmt(big)} + ${small}?`,
          answer: mc(rng, `It is ${c} times as large.`, [`It is ${c} more.`, `It is ${c} less.`, `It is 1/${c} as large.`]),
          hint: `The part in parentheses is the same in both. What does multiplying it by ${c} do?`,
          steps: [`Both expressions contain (${fmt(big)} + ${small}).`, `The first one multiplies that whole amount by ${c}.`, `So it is ${c} times as large — no need to calculate!`],
        };
      }
      if (level === 4) {
        const tree = retry(() => {
          const k = R(0, 2);
          if (k === 0) return op('+', op('^', N(R(2, 9)), N(2)), op('×', N(R(2, 6)), op('−', N(R(8, 15)), N(R(1, 7)), true)));
          if (k === 1) return op('−', op('^', op('+', N(R(1, 6)), N(R(1, 5)), true), N(2)), op('×', N(R(2, 6)), N(R(2, 6))));
          return op('+', op('×', op('^', N(R(2, 3)), N(R(3, 4))), N(R(2, 5))), op('÷', N(R(2, 6) * 6), N(6)));
        }, valid);
        return build(tree);
      }
      // level 5: evaluate with variables (6.EE.2c)
      const x = R(2, 9), y = R(2, 9);
      const forms = [
        { show: (a, b) => `${a}x + ${b}y`, tree: (a, b) => op('+', op('×', N(a), N(x)), op('×', N(b), N(y))) },
        { show: (a, b) => `${a}(x + y) − ${b}`, tree: (a, b) => op('−', op('×', N(a), op('+', N(x), N(y), true)), N(b)) },
        { show: (a, b) => `x^2 + ${a}y − ${b}`, tree: (a, b) => op('−', op('+', op('^', N(x), N(2)), op('×', N(a), N(y))), N(b)) },
        { show: (a, b) => `${a}x^2 − ${b}y`, tree: (a, b) => op('−', op('×', N(a), op('^', N(x), N(2))), op('×', N(b), N(y))) },
      ];
      const { f, a, b, tree } = retry(() => {
        const f = rng.pick(forms), a = R(2, 6), b = R(2, 9);
        return { f, a, b, tree: f.tree(a, b) };
      }, (o) => valid(o.tree));
      return {
        prompt: `Evaluate ${f.show(a, b)} when x = ${x} and y = ${y}.`,
        answer: num(evalTree(tree)),
        hint: `Replace x with ${x} and y with ${y}. A number next to a letter means multiply (${a}x means ${a} × x). Then use order of operations.`,
        steps: [`Substitute: ${render(tree)}.`, ...exprSteps(tree)],
      };
    },
  });

  // ===== 5.OA.3 Patterns (→ 6.EE.9) =====
  S.push({
    id: 'patterns', name: 'Numerical Patterns & Relationships', standard: '5.OA.3 → 6.EE.9', domain: 'Operations & Algebraic Thinking', grade: 5, weight: 0.7,
    gen(level, rng) {
      const seq = (start, add, n) => Array.from({ length: n }, (_, i) => start + i * add);
      if (level === 1) {
        const s = rng.int(0, 12), a = rng.int(2, 12), n = rng.int(6, 10);
        const terms = seq(s, a, n);
        return {
          prompt: `A pattern starts at ${s} and the rule is "add ${a}". What is term number ${n}? (The first term is ${s}.)`,
          answer: num(terms[n - 1]),
          hint: `Keep adding ${a}, or notice that term ${n} is ${s} plus ${n - 1} jumps of ${a}.`,
          steps: [`Terms: ${terms.join(', ')}.`, `Shortcut: ${s} + (${n - 1} × ${a}) = ${terms[n - 1]}.`],
        };
      }
      const a = rng.int(2, 6), k = rng.int(2, 5), b = a * k;
      const A = seq(0, a, 6), B = seq(0, b, 6);
      const intro = `Pattern A starts at 0 and the rule is "add ${a}". Pattern B starts at 0 and the rule is "add ${b}".`;
      if (level === 2) {
        return {
          prompt: `${intro} Each term in Pattern B is how many times the matching term in Pattern A?`,
          answer: num(k),
          hint: 'Write out the first few terms of each pattern and compare matching terms.',
          steps: [`A: ${A.join(', ')}.`, `B: ${B.join(', ')}.`, `Compare: ${A.slice(1, 4).map((x, i) => `${B[i + 1]} ÷ ${x} = ${k}`).join('; ')}.`, `Each term in B is ${k} times the matching term in A (because ${b} ÷ ${a} = ${k}).`],
        };
      }
      if (level === 3) {
        const m = rng.int(6, 15);
        return {
          prompt: `${intro} When a term in Pattern A is ${a * m}, what is the matching term in Pattern B?`,
          answer: num(b * m),
          hint: `Find the relationship between the two patterns first (B ÷ A for matching terms).`,
          steps: [`A: ${A.slice(0, 4).join(', ')}, …  B: ${B.slice(0, 4).join(', ')}, …`, `B is always ${k} times A (since ${b} ÷ ${a} = ${k}).`, `${a * m} × ${k} = ${b * m}.`],
        };
      }
      if (level === 4) {
        const n = rng.int(4, 7);
        const pa = (n - 1) * a, pb = (n - 1) * b;
        return {
          prompt: `${intro} Matching terms form ordered pairs (A, B). The first pair is (0, 0). Which ordered pair is term number ${n}?`,
          answer: mc(rng, `(${pa}, ${pb})`, [`(${pb}, ${pa})`, `(${n * a}, ${n * b})`, `(${pa}, ${pa + b})`]),
          hint: `Term ${n} means ${n - 1} jumps after the first term. The A value comes first in the pair.`,
          steps: [`A: ${seq(0, a, n).join(', ')} → term ${n} is ${pa}.`, `B: ${seq(0, b, n).join(', ')} → term ${n} is ${pb}.`, `Ordered pair (A, B) = (${pa}, ${pb}).`],
        };
      }
      // level 5: input/output rule y = m x + c
      const m = rng.int(2, 9), c = rng.int(0, 12), X = rng.int(10, 25);
      const xs = [1, 2, 3, 4];
      return {
        prompt: `The table follows a rule.\nx: ${xs.join(', ')}\ny: ${xs.map((v) => m * v + c).join(', ')}\nWhat is y when x = ${X}?`,
        answer: num(m * X + c),
        hint: 'How much does y go up each time x goes up by 1? That number multiplies x. Then see what you must add.',
        steps: [`Each time x goes up by 1, y goes up by ${m}, so the rule includes ${m} × x.`, `When x = 1: ${m} × 1 = ${m}, but y = ${m + c}, so add ${c}.`, `Rule: y = ${m}x + ${c}.`, `x = ${X}: y = ${m} × ${X} + ${c} = ${m * X + c}.`],
      };
    },
  });

  // ===== 5.MD.3-5 Volume (→ 6.G.2) =====
  S.push({
    id: 'volume', name: 'Volume', standard: '5.MD.3-5 → 6.G.2', domain: 'Measurement & Data', grade: 5, weight: 1.0,
    gen(level, rng) {
      const hint = 'Volume of a rectangular prism = length × width × height (or base area × height).';
      if (level <= 2) {
        if (level === 2 && rng.chance(0.5)) {
          const r = rng.int(3, 9), c = rng.int(3, 9), h = rng.int(2, 8);
          return {
            prompt: `A box is packed with unit cubes in ${h} layers. Each layer has ${r} rows of ${c} cubes. How many cubes are in the box?`,
            answer: num(r * c * h), hint: 'Find the number of cubes in one layer, then multiply by the number of layers.',
            steps: [`One layer: ${r} × ${c} = ${r * c} cubes.`, `${h} layers: ${r * c} × ${h} = ${r * c * h} cubes.`],
          };
        }
        const [l, w, h] = level === 1 ? [rng.int(2, 9), rng.int(2, 9), rng.int(2, 9)] : [rng.int(8, 25), rng.int(4, 15), rng.int(3, 12)];
        return {
          prompt: `A rectangular prism is ${l} cm long, ${w} cm wide, and ${h} cm tall. What is its volume, in cubic centimeters?`,
          answer: num(l * w * h), hint,
          steps: [`V = l × w × h.`, `${l} × ${w} = ${l * w} (base area).`, `${l * w} × ${h} = ${l * w * h} cubic cm.`],
        };
      }
      if (level === 3) {
        const l = rng.int(3, 15), w = rng.int(2, 12), h = rng.int(2, 12), V = l * w * h;
        return {
          prompt: `A fish tank shaped like a rectangular prism has a volume of ${fmt(V)} cubic inches. It is ${l} inches long and ${w} inches wide. How tall is it, in inches?`,
          answer: num(h), hint: 'Volume = base area × height, so height = volume ÷ base area.',
          steps: [`Base area = ${l} × ${w} = ${l * w} square inches.`, `Height = ${fmt(V)} ÷ ${l * w} = ${h} inches.`, `Check: ${l} × ${w} × ${h} = ${fmt(V)}. ✓`],
        };
      }
      if (level === 4) {
        const A = [rng.int(4, 12), rng.int(3, 8), rng.int(2, 6)], B = [rng.int(2, 8), rng.int(3, 8), rng.int(2, 10)];
        const va = A[0] * A[1] * A[2], vb = B[0] * B[1] * B[2];
        return {
          prompt: `A figure is made by joining two rectangular prisms (they don't overlap). Prism A is ${A[0]} ft by ${A[1]} ft by ${A[2]} ft. Prism B is ${B[0]} ft by ${B[1]} ft by ${B[2]} ft. What is the total volume, in cubic feet?`,
          answer: num(va + vb), hint: 'Find the volume of each prism separately, then add them.',
          steps: [`Prism A: ${A.join(' × ')} = ${va} cubic ft.`, `Prism B: ${B.join(' × ')} = ${vb} cubic ft.`, `Total: ${va} + ${vb} = ${va + vb} cubic ft.`],
        };
      }
      const d1 = rng.pick([2, 3, 4]), w1 = rng.int(1, 4), n1 = cp(rng, d1);
      const W = rng.int(2, 6), d3 = rng.pick([2, 3, 4]), n3 = cp(rng, d3);
      const L = { n: w1 * d1 + n1, d: d1 };
      const res = F.make(L.n * W * n3, L.d * d3);
      return {
        prompt: `A box is ${F.mixed(w1, n1, d1)} ft long, ${W} ft wide, and ${n3}/${d3} ft tall. What is its volume, in cubic feet?  (simplest form)`,
        answer: fracOf(res), hint: hint + ' Change mixed numbers to improper fractions first.',
        steps: [`V = ${F.mixed(w1, n1, d1)} × ${W} × ${n3}/${d3}.`, `As fractions: ${L.n}/${L.d} × ${W}/1 × ${n3}/${d3}.`, `Multiply tops and bottoms: ${L.n * W * n3}/${L.d * d3}.`, `Simplify: ${F.str(res)} cubic ft.`],
      };
    },
  });

  // ===== 5.MD.1 Measurement conversions (→ 6.RP.3d) =====
  const UNITS = [
    ['feet', 'inches', 12], ['yards', 'feet', 3], ['yards', 'inches', 36], ['meters', 'centimeters', 100], ['kilometers', 'meters', 1000],
    ['centimeters', 'millimeters', 10], ['kilograms', 'grams', 1000], ['pounds', 'ounces', 16], ['liters', 'milliliters', 1000],
    ['gallons', 'quarts', 4], ['quarts', 'pints', 2], ['hours', 'minutes', 60], ['minutes', 'seconds', 60], ['days', 'hours', 24],
  ];
  const METRIC = UNITS.filter((u) => [10, 100, 1000].includes(u[2]));
  const sing = { feet: 'foot', inches: 'inch' };
  const one = (u) => sing[u] || u.replace(/s$/, '');
  S.push({
    id: 'convert', name: 'Measurement Conversions', standard: '5.MD.1 → 6.RP.3d', domain: 'Measurement & Data', grade: 5, weight: 0.9,
    gen(level, rng) {
      if (level === 1) {
        const [big, small, f] = rng.pick(UNITS), n = rng.int(2, 15);
        return {
          prompt: `${n} ${big} = ? ${small}`, answer: num(n * f),
          hint: `Going from a bigger unit to a smaller unit, you need MORE of them — multiply. 1 ${one(big)} = ${f} ${small}.`,
          steps: [`1 ${one(big)} = ${f} ${small}.`, `${n} × ${f} = ${n * f} ${small}.`],
        };
      }
      if (level === 2) {
        if (rng.chance(0.5)) {
          const [big, small, f] = rng.pick(METRIC);
          const v = retry(() => rng.int(f / 10 + 1, f * 9), (x) => x % f !== 0 && (x * 100) % f === 0);
          return {
            prompt: `${fmt(v)} ${small} = ? ${big}`, answer: num(v / f),
            hint: `Going from a smaller unit to a bigger unit, you need FEWER — divide by ${f}.`,
            steps: [`1 ${one(big)} = ${f} ${small}.`, `${fmt(v)} ÷ ${f} = ${fmt(v / f)} ${big} (move the decimal point ${Math.log10(f)} places left).`],
          };
        }
        const [big, small, f] = rng.pick(UNITS), n = rng.int(2, 12);
        return {
          prompt: `${fmt(n * f)} ${small} = ? ${big}`, answer: num(n),
          hint: `Going from a smaller unit to a bigger unit, you need FEWER — divide by ${f}.`,
          steps: [`1 ${one(big)} = ${f} ${small}.`, `${fmt(n * f)} ÷ ${f} = ${n} ${big}.`],
        };
      }
      if (level === 3) {
        const [big, small, f] = rng.pick(UNITS.filter((u) => u[2] <= 60 && u[2] !== 36));
        const a = rng.int(2, 12), b = rng.int(1, f - 1);
        return {
          prompt: `${a} ${big} ${b} ${b === 1 ? one(small) : small} = how many ${small}?`, answer: num(a * f + b),
          hint: `Change the ${big} to ${small} first, then add the extra ${small}.`,
          steps: [`${a} ${big} = ${a} × ${f} = ${a * f} ${small}.`, `Add the extra: ${a * f} + ${b} = ${a * f + b} ${small}.`],
        };
      }
      if (level === 4) {
        if (rng.chance(0.5)) {
          const P = rng.pick([4, 6, 8, 9, 12, 18]);
          const Y = retry(() => rng.int(2, 12), (y) => (y * 36) % P === 0);
          return {
            prompt: `A ribbon is ${Y} yards long. Jada cuts it into pieces that are each ${P} inches long. How many pieces does she get?`,
            answer: num((Y * 36) / P), hint: 'Use the same unit for everything. Change yards to inches first (1 yard = 36 inches).',
            steps: [`${Y} yards = ${Y} × 36 = ${Y * 36} inches.`, `${Y * 36} ÷ ${P} = ${(Y * 36) / P} pieces.`],
          };
        }
        const n = rng.int(3, 12), ml = rng.pick([250, 350, 500, 750, 125, 200]);
        const total = n * ml;
        return {
          prompt: `A class has ${n} bottles of water. Each bottle holds ${ml} milliliters. How many liters of water is that in all?`,
          answer: num(total / 1000), hint: 'Find the total milliliters, then convert: 1 liter = 1,000 milliliters.',
          steps: [`Total: ${n} × ${ml} = ${fmt(total)} mL.`, `${fmt(total)} ÷ 1,000 = ${fmt(total / 1000)} liters.`],
        };
      }
      const kind = rng.int(0, 2);
      if (kind === 0) {
        const g = rng.pick([1.5, 2, 2.5, 3, 3.5, 4, 0.5]);
        return {
          prompt: `${fmt(g)} gallons = how many cups? (1 gallon = 4 quarts, 1 quart = 2 pints, 1 pint = 2 cups)`,
          answer: num(g * 16), hint: 'Convert one step at a time: gallons → quarts → pints → cups.',
          steps: [`${fmt(g)} gal × 4 = ${fmt(g * 4)} quarts.`, `${fmt(g * 4)} qt × 2 = ${fmt(g * 8)} pints.`, `${fmt(g * 8)} pt × 2 = ${fmt(g * 16)} cups.`],
        };
      }
      if (kind === 1) {
        const r = rng.pick([5, 10, 12, 15, 20, 25, 30]), h = rng.int(2, 6);
        return {
          prompt: `A leaky faucet drips ${r} milliliters of water every minute. How many liters does it drip in ${h} hours?`,
          answer: num((r * 60 * h) / 1000), hint: 'Change hours to minutes, find the total mL, then change mL to liters.',
          steps: [`${h} hours = ${h} × 60 = ${h * 60} minutes.`, `${h * 60} × ${r} mL = ${fmt(r * 60 * h)} mL.`, `${fmt(r * 60 * h)} ÷ 1,000 = ${fmt((r * 60 * h) / 1000)} liters.`],
        };
      }
      const d = rng.int(2, 5);
      return {
        prompt: `How many minutes are in ${d} days?`,
        answer: num(d * 24 * 60), hint: 'Days → hours → minutes.',
        steps: [`${d} days × 24 = ${d * 24} hours.`, `${d * 24} hours × 60 = ${fmt(d * 1440)} minutes.`],
      };
    },
  });

  // ===== 5.G.1-2 Coordinate plane (→ 6.NS.8) =====
  S.push({
    id: 'coordinate', name: 'Coordinate Plane', standard: '5.G.1-2 → 6.NS.8', domain: 'Geometry', grade: 5, weight: 0.8,
    gen(level, rng) {
      const P = (x, y) => `(${x}, ${y})`;
      if (level === 1) {
        const [x, y] = retry(() => [rng.int(1, 10), rng.int(1, 10)], ([a, b]) => a !== b);
        return {
          prompt: `Start at the origin (0, 0). Move ${pl(x, 'unit')} to the right and ${pl(y, 'unit')} up. Which ordered pair names the point?`,
          answer: mc(rng, P(x, y), [P(y, x), P(x + y, 0), P(x, 0)]),
          hint: 'An ordered pair is (x, y): the first number is how far right, the second is how far up.',
          steps: [`Right ${x} → x-coordinate is ${x}.`, `Up ${y} → y-coordinate is ${y}.`, `The point is ${P(x, y)}. (x always comes first!)`],
        };
      }
      if (level === 2) {
        const [a, b, r, u] = retry(() => [rng.int(1, 8), rng.int(3, 10), rng.int(1, 6), rng.int(1, 3)], ([a, b, r, u]) => a + r !== b - u);
        return {
          prompt: `Point P is at ${P(a, b)}. It moves ${pl(r, 'unit')} right and ${pl(u, 'unit')} down. What are its new coordinates?`,
          answer: mc(rng, P(a + r, b - u), [P(a - r, b + u), P(a + u, b - r), P(b - u, a + r)]),
          hint: 'Right/left changes the x-coordinate. Up/down changes the y-coordinate.',
          steps: [`Right ${r}: x = ${a} + ${r} = ${a + r}.`, `Down ${u}: y = ${b} − ${u} = ${b - u}.`, `New point: ${P(a + r, b - u)}.`],
        };
      }
      if (level === 3) {
        const horiz = rng.chance(0.5), c = rng.int(1, 10);
        const [p, q] = retry(() => [rng.int(0, 12), rng.int(0, 12)], ([p, q]) => p !== q);
        const A = horiz ? P(p, c) : P(c, p), B = horiz ? P(q, c) : P(c, q);
        return {
          prompt: `On a map, the library is at ${A} and the park is at ${B}. Each unit is 1 block. How many blocks apart are they?`,
          answer: num(Math.abs(p - q)),
          hint: `The points share the same ${horiz ? 'y' : 'x'}-coordinate, so they are on a ${horiz ? 'horizontal' : 'vertical'} line. Subtract the other coordinates.`,
          steps: [`Both points have ${horiz ? 'y' : 'x'} = ${c}, so the distance is along the ${horiz ? 'x' : 'y'}-axis.`, `${Math.max(p, q)} − ${Math.min(p, q)} = ${Math.abs(p - q)} blocks.`],
        };
      }
      if (level === 4) {
        const x1 = rng.int(1, 6), y1 = rng.int(1, 6), w = rng.int(2, 8), h = rng.int(2, 8);
        const x2 = x1 + w, y2 = y1 + h;
        if (rng.chance(0.5)) {
          return {
            prompt: `Three corners of a rectangle are at ${P(x1, y1)}, ${P(x2, y1)}, and ${P(x2, y2)}. What are the coordinates of the fourth corner?`,
            answer: mc(rng, P(x1, y2), [P(y2, x1), P(x2, y1 + w), P(x1 + h, y2)]),
            hint: 'Opposite sides of a rectangle line up. The missing corner shares an x-coordinate with one corner and a y-coordinate with another.',
            steps: [`${P(x1, y1)} and ${P(x2, y1)} are on the bottom side.`, `${P(x2, y2)} is above ${P(x2, y1)}.`, `The fourth corner is above ${P(x1, y1)} at the same height as ${P(x2, y2)}: ${P(x1, y2)}.`],
          };
        }
        return {
          prompt: `A rectangle has corners at ${P(x1, y1)}, ${P(x2, y1)}, ${P(x2, y2)}, and ${P(x1, y2)}. What is its perimeter, in units?`,
          answer: num(2 * (w + h)),
          hint: 'Find the length (difference of x-coordinates) and the width (difference of y-coordinates).',
          steps: [`Length: ${x2} − ${x1} = ${w}.`, `Width: ${y2} − ${y1} = ${h}.`, `Perimeter: 2 × (${w} + ${h}) = ${2 * (w + h)} units.`],
        };
      }
      const c = rng.int(-8, 8), a = -rng.int(1, 9), b = rng.int(1, 9);
      const horiz = rng.chance(0.5);
      const A = horiz ? P(a, c) : P(c, a), B = horiz ? P(b, c) : P(c, b);
      return {
        prompt: `What is the distance between ${A} and ${B} on the coordinate plane?`,
        answer: num(b - a),
        hint: 'One point is on each side of an axis. Find each point\'s distance to 0 and add them.',
        steps: [`The points share ${horiz ? 'y' : 'x'} = ${c}.`, `Distance from ${a} to 0 is |${a}| = ${-a}. Distance from 0 to ${b} is ${b}.`, `Total: ${-a} + ${b} = ${b - a} units.`],
      };
    },
  });

  // ===== 5.G.3-4 Classifying shapes =====
  const ALWAYS = [
    ['Every square is a rhombus.', 'A square has 4 equal sides, which is what makes a rhombus.'],
    ['Every square is a rectangle.', 'A square has 4 right angles, which is what makes a rectangle.'],
    ['Every rectangle is a parallelogram.', 'A rectangle has 2 pairs of parallel sides.'],
    ['Every rhombus is a parallelogram.', 'A rhombus has 2 pairs of parallel sides.'],
    ['Every equilateral triangle is an isosceles triangle.', 'Isosceles means at least 2 equal sides; equilateral has 3.'],
  ];
  const NOT_ALWAYS = [
    ['Every rhombus is a square.', 'A rhombus does not need right angles.'],
    ['Every rectangle is a square.', 'A rectangle does not need 4 equal sides.'],
    ['Every parallelogram is a rectangle.', 'A parallelogram does not need right angles.'],
    ['Every quadrilateral is a parallelogram.', 'Some quadrilaterals (like a kite) have no parallel sides.'],
    ['Every isosceles triangle is an equilateral triangle.', 'An isosceles triangle may have only 2 equal sides.'],
    ['Every right triangle is isosceles.', 'A right triangle can have three different side lengths.'],
  ];
  S.push({
    id: 'shapes', name: 'Classifying 2-D Figures', standard: '5.G.3-4', domain: 'Geometry', grade: 5, weight: 0.6,
    gen(level, rng) {
      if (level === 1) {
        const bank = [
          ['A quadrilateral with 4 right angles is always a ___.', 'rectangle', ['square', 'rhombus', 'trapezoid'], 'Right angles are what make a rectangle. It is not always a square, because the sides might not all be equal.'],
          ['A quadrilateral with 4 equal sides is always a ___.', 'rhombus', ['square', 'rectangle', 'trapezoid'], 'Four equal sides make a rhombus. It is a square only if it also has right angles.'],
          ['How many pairs of parallel sides does a parallelogram have?', '2', ['0', '1', '4'], 'A parallelogram has 2 pairs of parallel sides — that is its definition.'],
          ['A triangle with one 90° angle is called a(n) ___ triangle.', 'right', ['acute', 'obtuse', 'equilateral'], 'A 90° angle is a right angle, so it is a right triangle.'],
          ['A triangle with all 3 sides the same length is called a(n) ___ triangle.', 'equilateral', ['isosceles', 'scalene', 'right'], '"Equi-lateral" means equal sides.'],
          ['A triangle with no equal sides is called a(n) ___ triangle.', 'scalene', ['isosceles', 'equilateral', 'acute'], 'Scalene triangles have three different side lengths.'],
          ['A triangle with one angle greater than 90° is called a(n) ___ triangle.', 'obtuse', ['acute', 'right', 'scalene'], 'An angle greater than 90° is obtuse.'],
        ];
        const [p, c, d, why] = rng.pick(bank);
        return { prompt: p, answer: mc(rng, c, d), hint: 'Think about the definition: which property MUST the shape have?', steps: [why] };
      }
      if (level === 2 || level === 4) {
        const right = level === 2 ? rng.pick(ALWAYS) : rng.pick(NOT_ALWAYS);
        const wrong = rng.shuffle(level === 2 ? NOT_ALWAYS : ALWAYS).slice(0, 3);
        return {
          prompt: level === 2 ? 'Which statement is ALWAYS true?' : 'Which statement is NOT always true?',
          answer: mc(rng, right[0], wrong.map((w) => w[0])),
          hint: 'A shape belongs to a bigger category if it has ALL the properties of that category. Think: square ⊂ rectangle ⊂ parallelogram ⊂ quadrilateral, and square ⊂ rhombus ⊂ parallelogram.',
          steps: [`${right[0]} — ${right[1]}`, ...wrong.slice(0, 2).map((w) => `${w[0]} — ${w[1]}`)],
        };
      }
      if (level === 3) {
        if (rng.chance(0.5)) {
          const type = rng.pick(['acute', 'right', 'obtuse']);
          const [a, b] = retry(() => {
            if (type === 'right') { const a = rng.int(20, 70); return [a, 90 - a]; }
            return [rng.int(20, 100), rng.int(20, 100)];
          }, ([a, b]) => {
            const c = 180 - a - b;
            if (c <= 0) return false;
            const mx = Math.max(a, b, c);
            return type === 'right' ? true : type === 'acute' ? mx < 90 : mx > 90;
          });
          const angles = rng.shuffle([a, b, 180 - a - b]);
          return {
            prompt: `A triangle has angles of ${angles.join('°, ')}°. Classify it by its angles.`,
            answer: mc(rng, type, ['acute', 'right', 'obtuse', 'equilateral']),
            hint: 'Look at the largest angle: less than 90° → acute, exactly 90° → right, more than 90° → obtuse.',
            steps: [`The largest angle is ${Math.max(...angles)}°.`, `${Math.max(...angles)}° is ${type === 'right' ? 'exactly 90°' : type === 'acute' ? 'less than 90°' : 'greater than 90°'}, so the triangle is ${type}.`],
          };
        }
        const type = rng.pick(['equilateral', 'isosceles', 'scalene']);
        const s = rng.int(4, 12);
        const sides = type === 'equilateral' ? [s, s, s] : type === 'isosceles' ? [s, s, retry(() => rng.int(2, 2 * s - 1), (x) => x !== s)] : retry(() => [rng.int(4, 12), rng.int(4, 12), rng.int(4, 12)], (a) => new Set(a).size === 3 && a.every((x, i) => x < a.reduce((p, q) => p + q, 0) - x));
        return {
          prompt: `A triangle has sides of ${rng.shuffle(sides).join(' cm, ')} cm. Classify it by its sides.`,
          answer: mc(rng, type, ['equilateral', 'isosceles', 'scalene', 'right']),
          hint: 'Count the equal sides: 3 equal → equilateral, exactly 2 equal → isosceles, none equal → scalene.',
          steps: [`Number of equal sides: ${type === 'equilateral' ? 3 : type === 'isosceles' ? 2 : 0}.`, `So it is ${type}.`],
        };
      }
      if (rng.chance(0.5)) {
        const a = rng.int(25, 100), b = rng.int(20, 155 - a);
        return {
          prompt: `Two angles of a triangle measure ${a}° and ${b}°. What is the measure of the third angle, in degrees?`,
          answer: num(180 - a - b), hint: 'The three angles of any triangle add up to 180°.',
          steps: [`${a} + ${b} = ${a + b}.`, `180 − ${a + b} = ${180 - a - b}°.`],
        };
      }
      const [a, b, c] = retry(() => [rng.int(60, 130), rng.int(60, 130), rng.int(60, 130)], (x) => { const d = 360 - x[0] - x[1] - x[2]; return d > 30 && d < 170; });
      return {
        prompt: `Three angles of a quadrilateral measure ${a}°, ${b}°, and ${c}°. What is the fourth angle, in degrees?`,
        answer: num(360 - a - b - c), hint: 'The four angles of any quadrilateral add up to 360°.',
        steps: [`${a} + ${b} + ${c} = ${a + b + c}.`, `360 − ${a + b + c} = ${360 - a - b - c}°.`],
      };
    },
  });

  // =================== GRADE 6 STRETCH SKILLS ===================

  S.push({
    id: 'g6_ratios', name: 'Ratios, Rates & Percents', standard: '6.RP.1-3', domain: 'Grade 6: Ratios & Proportional Relationships', grade: 6, weight: 1.2,
    prereqs: ['frac_mult', 'divide'],
    gen(level, rng) {
      if (level === 1) {
        const a = rng.int(2, 9), b = retry(() => rng.int(2, 11), (x) => x !== a && gcd(x, a) === 1), k = rng.int(2, 9);
        return {
          prompt: `The ratio of red marbles to blue marbles in a bag is ${a} : ${b}. If there are ${a * k} red marbles, how many blue marbles are there?`,
          answer: num(b * k), hint: 'Find what number the first part of the ratio was multiplied by. Multiply the second part by the same number.',
          steps: [`${a} × ? = ${a * k} → the scale factor is ${k}.`, `Blue: ${b} × ${k} = ${b * k}.`, `Ratio table: ${a}:${b} = ${a * k}:${b * k}.`],
        };
      }
      if (level === 2) {
        if (rng.chance(0.5)) {
          const n = rng.int(3, 12), u = rng.int(105, 899) / 100;
          const T = round(n * u, 2);
          return {
            prompt: `${n} notebooks cost $${T.toFixed(2)}. What is the cost of 1 notebook, in dollars?`,
            answer: num(u), hint: 'A unit rate is the amount for ONE. Divide the total cost by the number of items.',
            steps: [`Unit price = total ÷ number of items.`, `$${T.toFixed(2)} ÷ ${n} = $${u.toFixed(2)}.`],
          };
        }
        const h = rng.int(2, 8), r = rng.int(35, 70);
        return {
          prompt: `A car travels ${h * r} miles in ${h} hours at a steady speed. How many miles does it travel in 1 hour?`,
          answer: num(r), hint: 'Divide the distance by the time to get miles per ONE hour.',
          steps: [`${h * r} ÷ ${h} = ${r} miles per hour.`],
        };
      }
      if (level === 3) {
        const { n1, p1, n2, p2 } = retry(() => {
          const n1 = rng.int(3, 8), n2 = rng.int(9, 16);
          const u1 = rng.int(50, 150), u2 = rng.int(50, 150);
          return { n1, n2, p1: n1 * u1, p2: n2 * u2 };
        }, (o) => Math.abs(o.p1 / o.n1 - o.p2 / o.n2) >= 5);
        const u1 = p1 / n1, u2 = p2 / n2;
        const best = u1 < u2 ? 'Store A' : 'Store B';
        return {
          prompt: `Store A sells ${n1} granola bars for $${(p1 / 100).toFixed(2)}. Store B sells ${n2} granola bars for $${(p2 / 100).toFixed(2)}. Which store has the better buy (lower price per bar)?`,
          answer: mc(rng, best, ['Store A', 'Store B', 'They cost the same per bar']),
          hint: 'Find the price of ONE bar at each store (unit price), then compare.',
          steps: [`Store A: $${(p1 / 100).toFixed(2)} ÷ ${n1} = $${(u1 / 100).toFixed(2)} per bar.`, `Store B: $${(p2 / 100).toFixed(2)} ÷ ${n2} = $${(u2 / 100).toFixed(2)} per bar.`, `${best} is cheaper per bar.`],
        };
      }
      if (level === 4) {
        const p = rng.pick([10, 20, 25, 30, 40, 50, 60, 75, 5, 15]);
        const base = 100 / gcd(p, 100);
        const N0 = base * rng.int(1, Math.max(2, Math.floor(400 / base)));
        const ans = (p * N0) / 100;
        return {
          prompt: `What is ${p}% of ${fmt(N0)}?`, answer: num(ans),
          hint: `Percent means "out of 100". ${p}% = ${p}/100. Tip: 10% of a number is that number ÷ 10.`,
          steps: [`${p}% = ${p}/100 = ${F.str(F.make(p, 100))}.`, `${F.str(F.make(p, 100))} × ${fmt(N0)} = ${fmt(ans)}.`, `Check with 10%: 10% of ${fmt(N0)} is ${fmt(N0 / 10)}; ${p}% is ${fmt(p / 10)} × ${fmt(N0 / 10)} = ${fmt(ans)}.`],
        };
      }
      if (rng.chance(0.5)) {
        const p = rng.pick([10, 20, 25, 40, 50, 75, 5]);
        const W = (100 / gcd(p, 100)) * rng.int(1, 20);
        const part = (p * W) / 100;
        return {
          prompt: `${fmt(part)} is ${p}% of what number?`, answer: num(W),
          hint: `If ${p}% is ${fmt(part)}, find 1% first (or 100%).`,
          steps: [`${p}% → ${fmt(part)}.`, `1% → ${fmt(part)} ÷ ${p} = ${fmt(part / p)}.`, `100% → ${fmt(part / p)} × 100 = ${fmt(W)}.`],
        };
      }
      const price = rng.int(4, 30) * 5, off = rng.pick([10, 20, 25, 30, 40, 50]);
      const disc = (price * off) / 100;
      return {
        prompt: `A jacket costs $${price}. It is on sale for ${off}% off. What is the sale price, in dollars?`,
        answer: num(price - disc), hint: 'Find the discount (the percent of the price), then subtract it from the original price.',
        steps: [`Discount: ${off}% of $${price} = $${fmt(disc)}.`, `Sale price: $${price} − $${fmt(disc)} = $${fmt(price - disc)}.`],
      };
    },
  });

  S.push({
    id: 'g6_integers', name: 'Negative Numbers & Absolute Value', standard: '6.NS.5-7', domain: 'Grade 6: The Number System', grade: 6, weight: 0.9,
    prereqs: ['coordinate'],
    gen(level, rng) {
      if (level === 1) {
        const nums = retry(() => [rng.int(-15, -1), rng.int(-15, -1), rng.int(-15, 10), rng.int(-9, 9)], (a) => new Set(a).size === 4);
        const ask = rng.pick(['greatest', 'least']);
        const ans = ask === 'greatest' ? Math.max(...nums) : Math.min(...nums);
        return {
          prompt: `Which number is the ${ask}?`, answer: mc(rng, String(ans), nums.map(String)),
          hint: 'On a number line, numbers get bigger as you move right. A negative number with a bigger digit is FARTHER left, so it is smaller (−9 < −2).',
          steps: [`In order from least to greatest: ${nums.slice().sort((a, b) => a - b).join(', ')}.`, `The ${ask} is ${ans}.`],
        };
      }
      if (level === 2) {
        const a = rng.int(2, 40), b = rng.int(2, 40);
        if (rng.chance(0.5)) return { prompt: `What is |−${a}|?`, answer: num(a), hint: 'Absolute value is the distance from 0. Distance is never negative.', steps: [`−${a} is ${a} units away from 0.`, `|−${a}| = ${a}.`] };
        return { prompt: `What is |−${a}| + |${b}|?`, answer: num(a + b), hint: 'Find each absolute value first (distance from 0), then add.', steps: [`|−${a}| = ${a} and |${b}| = ${b}.`, `${a} + ${b} = ${a + b}.`] };
      }
      if (level === 3) {
        const a = rng.int(1, 20), b = rng.int(1, 20);
        return {
          prompt: `On a number line, how far apart are −${a} and ${b}?`, answer: num(a + b),
          hint: 'The numbers are on opposite sides of 0. Add their distances from 0.',
          steps: [`−${a} is ${a} units from 0; ${b} is ${b} units from 0.`, `${a} + ${b} = ${a + b} units.`],
        };
      }
      if (level === 4) {
        if (rng.chance(0.5)) {
          const t = -rng.int(2, 15), up = rng.int(3, 25);
          return {
            prompt: `At 6 a.m. the temperature was ${t}°F. By noon it had risen ${up} degrees. What was the temperature at noon, in °F? (Type a minus sign for a negative number.)`,
            answer: num(t + up), hint: 'Start at the first temperature on a number line and move up (right).',
            steps: [`Start at ${t}. Rising ${up}: ${t} + ${up}.`, `${t + up < 0 ? `Moving ${up} up from ${t} still leaves you ${-(t + up)} below 0` : `It takes ${-t} degrees to reach 0, then ${up + t} more`}.`, `Temperature: ${t + up}°F.`],
          };
        }
        const d = rng.int(20, 90), r = rng.int(5, 60);
        return {
          prompt: `A diver is at −${d} feet (below sea level). She swims up ${r} feet. What is her new position, in feet? (Type a minus sign for a negative number.)`,
          answer: num(-d + r), hint: 'Below sea level is negative. Swimming up means adding.',
          steps: [`−${d} + ${r} = ${-d + r}.`, `${-d + r < 0 ? `She is still ${d - r} feet below sea level` : -d + r === 0 ? 'She is at sea level' : `She is ${r - d} feet above sea level`}.`],
        };
      }
      const a = rng.int(2, 20), b = rng.int(2, 20);
      const forms = [
        { p: `${a} + (−${b})`, v: a - b, s: [`Adding a negative is the same as subtracting: ${a} − ${b}.`] },
        { p: `−${a} − ${b}`, v: -a - b, s: [`Start at −${a} and move ${b} more to the left.`, `Both go negative, so add the sizes and keep the minus: −(${a} + ${b}).`] },
        { p: `−${a} − (−${b})`, v: -a + b, s: [`Subtracting a negative is the same as adding: −${a} + ${b}.`] },
        { p: `−${a} + ${b}`, v: -a + b, s: [`Start at −${a} and move ${b} to the right.`] },
      ];
      const f = rng.pick(forms);
      return { prompt: `${f.p} = ?  (Type a minus sign for a negative number.)`, answer: num(f.v), hint: 'Picture a number line. Adding moves right; subtracting moves left. Subtracting a negative moves right!', steps: [...f.s, `Answer: ${f.v}.`] };
    },
  });

  S.push({
    id: 'g6_equations', name: 'One-Step & Two-Step Equations', standard: '6.EE.5-7', domain: 'Grade 6: Expressions & Equations', grade: 6, weight: 1.1,
    prereqs: ['expressions'],
    gen(level, rng) {
      const v = rng.pick(['x', 'n', 'y', 'm']);
      if (level === 1) {
        const a = rng.int(3, 60), x = rng.int(2, 80);
        return { prompt: `${v} + ${a} = ${a + x}. What is ${v}?`, answer: num(x), hint: `Undo adding ${a} by subtracting ${a} from both sides.`, steps: [`Subtract ${a} from both sides: ${v} = ${a + x} − ${a}.`, `${v} = ${x}.`, `Check: ${x} + ${a} = ${a + x}. ✓`] };
      }
      if (level === 2) {
        const a = rng.int(2, 12), x = rng.int(2, 25);
        return { prompt: `${a}${v} = ${a * x}. What is ${v}?`, answer: num(x), hint: `${a}${v} means ${a} × ${v}. Undo multiplying by dividing both sides by ${a}.`, steps: [`Divide both sides by ${a}: ${v} = ${a * x} ÷ ${a}.`, `${v} = ${x}.`, `Check: ${a} × ${x} = ${a * x}. ✓`] };
      }
      if (level === 3) {
        if (rng.chance(0.5)) {
          const a = rng.int(3, 40), b = rng.int(2, 60);
          return { prompt: `${v} − ${a} = ${b}. What is ${v}?`, answer: num(a + b), hint: `Undo subtracting ${a} by adding ${a} to both sides.`, steps: [`Add ${a} to both sides: ${v} = ${b} + ${a}.`, `${v} = ${a + b}.`] };
        }
        const a = rng.int(2, 12), b = rng.int(2, 15);
        return { prompt: `${v} ÷ ${a} = ${b}. What is ${v}?`, answer: num(a * b), hint: `Undo dividing by ${a} by multiplying both sides by ${a}.`, steps: [`Multiply both sides by ${a}: ${v} = ${b} × ${a}.`, `${v} = ${a * b}.`] };
      }
      if (level === 4) {
        if (rng.chance(0.5)) {
          const a = rng.int(105, 950) / 100, x = rng.int(105, 950) / 100;
          return { prompt: `${v} + ${fmt(a)} = ${fmt(round(a + x, 2))}. What is ${v}?`, answer: num(x), hint: `Subtract ${fmt(a)} from both sides. Line up the decimal points.`, steps: [`${v} = ${fmt(round(a + x, 2))} − ${fmt(a)}.`, `${v} = ${fmt(x)}.`] };
        }
        const d = rng.int(2, 8), n = cp(rng, d), k = rng.int(2, 9);
        const rhs = n * k;
        const x = F.make(rhs * d, n);
        return {
          prompt: `(${n}/${d})${v} = ${rhs}. What is ${v}?`, answer: fracOf(x),
          hint: `Undo multiplying by ${n}/${d} by multiplying both sides by its reciprocal, ${d}/${n}.`,
          steps: [`Multiply both sides by ${d}/${n}: ${v} = ${rhs} × ${d}/${n}.`, `${v} = ${rhs * d}/${n} = ${F.str(x)}.`],
        };
      }
      const a = rng.int(2, 9), x = rng.int(2, 15), b = rng.int(1, 30);
      const minus = rng.chance(0.4) && a * x > b;
      const c = minus ? a * x - b : a * x + b;
      return {
        prompt: `${a}${v} ${minus ? '−' : '+'} ${b} = ${c}. What is ${v}?`, answer: num(x),
        hint: `Two steps: first undo the ${minus ? 'subtraction' : 'addition'}, then undo the multiplication.`,
        steps: [`${minus ? 'Add' : 'Subtract'} ${b} ${minus ? 'to' : 'from'} both sides: ${a}${v} = ${a * x}.`, `Divide both sides by ${a}: ${v} = ${x}.`, `Check: ${a} × ${x} ${minus ? '−' : '+'} ${b} = ${c}. ✓`],
      };
    },
  });

  S.push({
    id: 'g6_area', name: 'Area of Triangles, Parallelograms & Trapezoids', standard: '6.G.1', domain: 'Grade 6: Geometry', grade: 6, weight: 1.0,
    prereqs: ['volume', 'frac_mult'],
    gen(level, rng) {
      if (level === 1) {
        const l = rng.int(3, 25), w = rng.int(2, 15);
        if (rng.chance(0.5)) return { prompt: `A rectangular rug is ${l} ft long and ${w} ft wide. What is its area, in square feet?`, answer: num(l * w), hint: 'Area of a rectangle = length × width.', steps: [`${l} × ${w} = ${l * w} square feet.`] };
        return { prompt: `A rectangle has an area of ${l * w} square meters. Its length is ${l} m. What is its width, in meters?`, answer: num(w), hint: 'Area = length × width, so width = area ÷ length.', steps: [`${l * w} ÷ ${l} = ${w} m.`] };
      }
      if (level === 2) {
        const [b, h] = retry(() => [rng.int(3, 20), rng.int(3, 20)], ([b, h]) => (b * h) % 2 === 0);
        return { prompt: `A triangle has a base of ${b} cm and a height of ${h} cm. What is its area, in square centimeters?`, answer: num((b * h) / 2), hint: 'A triangle is half of a rectangle (or parallelogram): Area = (base × height) ÷ 2.', steps: [`base × height = ${b} × ${h} = ${b * h}.`, `Half of that: ${b * h} ÷ 2 = ${(b * h) / 2} square cm.`] };
      }
      if (level === 3) {
        const b = rng.int(4, 20), h = rng.int(3, 15);
        if (rng.chance(0.5)) return { prompt: `A parallelogram has a base of ${b} in. and a height of ${h} in. What is its area, in square inches?`, answer: num(b * h), hint: 'Cut off a triangle from one side and move it to the other: it becomes a rectangle. Area = base × height.', steps: [`${b} × ${h} = ${b * h} square inches.`] };
        const [bb, hh] = retry(() => [rng.int(3, 20), rng.int(3, 20)], ([x, y]) => (x * y) % 2 === 0);
        return { prompt: `A triangle has an area of ${(bb * hh) / 2} square feet and a base of ${bb} feet. What is its height, in feet?`, answer: num(hh), hint: 'Area = (base × height) ÷ 2. Work backwards: double the area, then divide by the base.', steps: [`Double the area: ${(bb * hh) / 2} × 2 = ${bb * hh}.`, `Divide by the base: ${bb * hh} ÷ ${bb} = ${hh} ft.`] };
      }
      if (level === 4) {
        const [b1, b2, h] = retry(() => [rng.int(3, 15), rng.int(5, 20), rng.int(2, 12)], ([a, b, h]) => a !== b && ((a + b) * h) % 2 === 0);
        return { prompt: `A trapezoid has parallel bases of ${b1} m and ${b2} m and a height of ${h} m. What is its area, in square meters?`, answer: num(((b1 + b2) * h) / 2), hint: 'Area of a trapezoid = (base 1 + base 2) × height ÷ 2.', steps: [`Add the bases: ${b1} + ${b2} = ${b1 + b2}.`, `Multiply by the height: ${b1 + b2} × ${h} = ${(b1 + b2) * h}.`, `Divide by 2: ${((b1 + b2) * h) / 2} square meters.`] };
      }
      if (rng.chance(0.5)) {
        const w = rng.int(3, 10) * 2, l = rng.int(4, 15), th = rng.int(2, 9);
        return {
          prompt: `A shape is made of a rectangle (${w} ft wide, ${l} ft tall) with a triangle on top. The triangle's base is the top of the rectangle (${w} ft) and its height is ${th} ft. What is the total area, in square feet?`,
          answer: num(w * l + (w * th) / 2), hint: 'Break the shape into a rectangle and a triangle. Find each area and add.',
          steps: [`Rectangle: ${w} × ${l} = ${w * l}.`, `Triangle: ${w} × ${th} ÷ 2 = ${(w * th) / 2}.`, `Total: ${w * l} + ${(w * th) / 2} = ${w * l + (w * th) / 2} square feet.`],
        };
      }
      const L = rng.int(10, 20), W = rng.int(8, 15), cl = rng.int(2, L - 4), cw = rng.int(2, W - 4);
      return {
        prompt: `A rectangular yard is ${L} m by ${W} m. A rectangular pool that is ${cl} m by ${cw} m is built in the yard. How many square meters of yard are NOT covered by the pool?`,
        answer: num(L * W - cl * cw), hint: 'Find the area of the whole yard, then subtract the area of the pool.',
        steps: [`Yard: ${L} × ${W} = ${L * W}.`, `Pool: ${cl} × ${cw} = ${cl * cw}.`, `Not covered: ${L * W} − ${cl * cw} = ${L * W - cl * cw} square meters.`],
      };
    },
  });

  S.push({
    id: 'g6_stats', name: 'Mean, Median & Range', standard: '6.SP.3-5', domain: 'Grade 6: Statistics & Probability', grade: 6, weight: 0.8,
    prereqs: ['decimals', 'divide'],
    gen(level, rng) {
      const list = (n, lo, hi) => Array.from({ length: n }, () => rng.int(lo, hi));
      const sorted = (a) => a.slice().sort((x, y) => x - y);
      if (level === 1) {
        const d = list(rng.int(5, 7), 10, 99), s = sorted(d);
        return { prompt: `What is the range of this data set? ${d.join(', ')}`, answer: num(s[s.length - 1] - s[0]), hint: 'Range = greatest value − least value.', steps: [`Greatest: ${s[s.length - 1]}. Least: ${s[0]}.`, `${s[s.length - 1]} − ${s[0]} = ${s[s.length - 1] - s[0]}.`] };
      }
      if (level === 2) {
        const d = list(rng.pick([5, 7, 9]), 1, 50), s = sorted(d), m = s[(s.length - 1) / 2];
        return { prompt: `What is the median of this data set? ${d.join(', ')}`, answer: num(m), hint: 'Put the numbers in order first! The median is the middle number.', steps: [`In order: ${s.join(', ')}.`, `There are ${s.length} numbers; the middle one is number ${(s.length + 1) / 2}: ${m}.`] };
      }
      if (level === 3) {
        const n = rng.int(4, 6);
        const d = retry(() => list(n, 5, 40), (a) => a.reduce((p, q) => p + q, 0) % n === 0);
        const sum = d.reduce((p, q) => p + q, 0);
        return { prompt: `What is the mean (average) of this data set? ${d.join(', ')}`, answer: num(sum / n), hint: 'Mean = add all the values, then divide by how many values there are.', steps: [`Sum: ${d.join(' + ')} = ${sum}.`, `There are ${n} values: ${sum} ÷ ${n} = ${sum / n}.`] };
      }
      if (level === 4) {
        const d = retry(() => list(rng.pick([4, 6, 8]), 1, 60), (a) => new Set(a).size === a.length), s = sorted(d);
        const i = s.length / 2, m = (s[i - 1] + s[i]) / 2;
        return { prompt: `What is the median of this data set? ${d.join(', ')}`, answer: num(m), hint: 'Order the numbers. With an even count there are TWO middle numbers — the median is halfway between them.', steps: [`In order: ${s.join(', ')}.`, `The two middle numbers are ${s[i - 1]} and ${s[i]}.`, `(${s[i - 1]} + ${s[i]}) ÷ 2 = ${fmt(m)}.`] };
      }
      const { M, four, fifth } = retry(() => {
        const M = rng.int(78, 92), four = list(4, 70, 100);
        return { M, four, fifth: 5 * M - four.reduce((p, q) => p + q, 0) };
      }, (o) => o.fifth >= 50 && o.fifth <= 100);
      const sum4 = four.reduce((p, q) => p + q, 0);
      return {
        prompt: `The mean of Noah's 5 test scores is ${M}. Four of the scores are ${four.join(', ')}. What is the fifth score?`, answer: num(fifth),
        hint: 'If the mean of 5 scores is the average, then the TOTAL of all 5 scores = mean × 5.',
        steps: [`Total of all 5: ${M} × 5 = ${5 * M}.`, `Total of the four: ${four.join(' + ')} = ${sum4}.`, `Fifth score: ${5 * M} − ${sum4} = ${fifth}.`],
      };
    },
  });

  function factorList(n) { const f = []; for (let i = 1; i <= n; i++) if (n % i === 0) f.push(i); return f; }
  S.push({
    id: 'g6_factors', name: 'GCF, LCM & Prime Factorization', standard: '6.NS.4', domain: 'Grade 6: The Number System', grade: 6, weight: 0.8,
    prereqs: ['frac_addsub', 'multiply'],
    gen(level, rng) {
      const gcfPair = () => retry(() => { const g0 = rng.int(2, 12), p = rng.int(2, 9), q = rng.int(2, 9); return [g0 * p, g0 * q, g0]; }, ([a, b]) => a !== b && a <= 100 && b <= 100);
      if (level === 1) {
        const [a, b] = gcfPair(), G = gcd(a, b);
        const fa = factorList(a), fb = factorList(b);
        return { prompt: `What is the greatest common factor (GCF) of ${a} and ${b}?`, answer: num(G), hint: 'List the factors of each number. Find the biggest one they share.', steps: [`Factors of ${a}: ${fa.join(', ')}.`, `Factors of ${b}: ${fb.join(', ')}.`, `Common factors: ${fa.filter((x) => fb.includes(x)).join(', ')}. The greatest is ${G}.`] };
      }
      if (level === 2) {
        const [a, b] = retry(() => [rng.int(3, 15), rng.int(3, 15)], ([a, b]) => a !== b && a % b !== 0 && b % a !== 0);
        const L = lcm(a, b);
        const ma = Array.from({ length: L / a }, (_, i) => a * (i + 1)), mb = Array.from({ length: L / b }, (_, i) => b * (i + 1));
        return { prompt: `What is the least common multiple (LCM) of ${a} and ${b}?`, answer: num(L), hint: 'List multiples of each number until you find the first one they share.', steps: [`Multiples of ${a}: ${ma.join(', ')}.`, `Multiples of ${b}: ${mb.join(', ')}.`, `The first one in both lists is ${L}.`] };
      }
      if (level === 3) {
        if (rng.chance(0.5)) {
          const [a, b] = gcfPair(), G = gcd(a, b);
          return { prompt: `A teacher has ${a} pencils and ${b} erasers. She wants to make identical kits with no supplies left over. What is the greatest number of kits she can make?`, answer: num(G), hint: '"Greatest number of identical groups with nothing left over" → greatest common factor.', steps: [`We need the GCF of ${a} and ${b}.`, `Common factors of ${a} and ${b}: ${factorList(a).filter((x) => b % x === 0).join(', ')}.`, `GCF = ${G}, so ${G} kits (each with ${a / G} pencils and ${b / G} erasers).`] };
        }
        const [a, b] = rng.pick([[8, 12], [6, 10], [8, 10], [6, 8], [10, 12], [6, 9], [4, 6], [12, 16]]);
        const L = lcm(a, b);
        return { prompt: `Hot dogs come in packs of ${a}. Buns come in packs of ${b}. What is the smallest number of hot dogs you can buy so that you have exactly the same number of hot dogs and buns?`, answer: num(L), hint: '"Smallest number that both fit into" → least common multiple.', steps: [`Multiples of ${a}: ${Array.from({ length: L / a }, (_, i) => a * (i + 1)).join(', ')}.`, `Multiples of ${b}: ${Array.from({ length: L / b }, (_, i) => b * (i + 1)).join(', ')}.`, `LCM = ${L} (${L / a} packs of hot dogs and ${L / b} packs of buns).`] };
      }
      if (level === 4) {
        const [a, b] = gcfPair(), G = gcd(a, b);
        if (rng.chance(0.5)) return { prompt: `Use the distributive property and the GCF: ${a} + ${b} = ? × (${a / G} + ${b / G}). What number goes in the blank?`, answer: num(G), hint: 'What number can you multiply by each number in the parentheses to get the original numbers?', steps: [`GCF of ${a} and ${b} is ${G}.`, `${G} × ${a / G} = ${a} and ${G} × ${b / G} = ${b}.`, `So ${a} + ${b} = ${G} × (${a / G} + ${b / G}).`] };
        return { prompt: `${a} + ${b} = ${G} × (${a / G} + ?). What number goes in the blank?`, answer: num(b / G), hint: `Divide ${b} by ${G}.`, steps: [`${G} × ? = ${b} → ? = ${b} ÷ ${G} = ${b / G}.`, `Check: ${G} × (${a / G} + ${b / G}) = ${G} × ${a / G + b / G} = ${a + b}. ✓`] };
      }
      const { a, b, p, c } = retry(() => ({ a: rng.int(1, 4), b: rng.int(0, 2), p: rng.pick([5, 7]), c: rng.int(0, 1) }), (o) => o.a + o.b + o.c >= 3);
      const n = Math.pow(2, a) * Math.pow(3, b) * Math.pow(p, c);
      const term = (base, e) => (e === 0 ? null : e === 1 ? `${base}` : `${base}^${e}`);
      const show = (A, B, C, P = p) => [term(2, A), term(3, B), term(P, C)].filter(Boolean).join(' × ');
      const correct = show(a, b, c);
      // same value, but 4 or 9 is not prime
      const notPrime = a >= 2 ? ['4', term(2, a - 2), term(3, b), term(p, c)].filter(Boolean).join(' × ')
        : b >= 2 ? [term(2, a), '9', term(3, b - 2), term(p, c)].filter(Boolean).join(' × ') : null;
      const distractors = [notPrime, show(a + 1, b, c), show(Math.max(1, a - 1), b + 1, c), show(a, b, c ? 0 : 1)].filter((s) => s && s !== correct);
      const tree = [];
      let m = n;
      for (const q of [2, 3, 5, 7]) while (m % q === 0) { tree.push(`${m} ÷ ${q} = ${m / q}`); m /= q; }
      return {
        prompt: `Which is the prime factorization of ${n}?`, answer: mc(rng, correct, distractors),
        hint: 'Keep dividing by the smallest prime (2, then 3, then 5, 7…) until you reach 1. Every factor must be PRIME.',
        steps: [...tree, `Primes used: ${correct}. Check: it multiplies to ${n} and every factor is prime.`],
      };
    },
  });

  // ---------- registry ----------
  const BY_ID = Object.fromEntries(S.map((s) => [s.id, s]));
  const LEVEL_LABELS = { 1: 'Warm-up', 2: 'On grade', 3: 'NJSLA ready', 4: 'Advanced', 5: 'Grade 6 challenge' };
  const G6_LEVEL_LABELS = { 1: 'Gr 6 intro', 2: 'Gr 6 basic', 3: 'Gr 6 on grade', 4: 'Gr 6 advanced', 5: 'Gr 6+ challenge' };

  function generate(skillId, level, seed) {
    const skill = BY_ID[skillId];
    const rng = U.makeRng(seed);
    const q = skill.gen(level, rng);
    return {
      id: String(seed),
      skillId,
      level,
      prompt: q.prompt,
      answer: q.answer,
      answerText: U.answerText(q.answer),
      hint: q.hint,
      steps: q.steps,
    };
  }

  NJ.skills = { list: S, byId: BY_ID, generate, LEVEL_LABELS, G6_LEVEL_LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
