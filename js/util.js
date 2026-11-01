/* Shared helpers: seeded random numbers, fractions, formatting, answer checking. */
(function (g) {
  'use strict';
  const NJ = (g.NJ = g.NJ || {});

  // ---------- Seeded random numbers (same seed => same questions) ----------
  function hashString(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const r = mulberry32(typeof seed === 'number' ? seed : hashString(String(seed)));
    return {
      next: r,
      int(a, b) { return a + Math.floor(r() * (b - a + 1)); },
      pick(arr) { return arr[Math.floor(r() * arr.length)]; },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      chance(p) { return r() < p; },
    };
  }

  // ---------- Number helpers ----------
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
  function round(x, places = 6) {
    const p = Math.pow(10, places);
    const r = Math.round((x + (x >= 0 ? 1 : -1) * Number.EPSILON) * p) / p;
    return Object.is(r, -0) ? 0 : r;
  }
  function fmt(x) {
    return round(x, 6).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  // Value of a place, e.g. 10^-2 = 0.01
  function pow10(e) { return round(Math.pow(10, e), 10); }

  // ---------- Fractions ----------
  const F = {
    make(n, d) {
      if (d === 0) throw new Error('zero denominator');
      if (d < 0) { n = -n; d = -d; }
      const k = gcd(n, d) || 1;
      return { n: n / k, d: d / k };
    },
    fromMixed(w, n, d) { return F.make(w * d + n, d); },
    add(a, b) { return F.make(a.n * b.d + b.n * a.d, a.d * b.d); },
    sub(a, b) { return F.make(a.n * b.d - b.n * a.d, a.d * b.d); },
    mul(a, b) { return F.make(a.n * b.n, a.d * b.d); },
    div(a, b) { return F.make(a.n * b.d, a.d * b.n); },
    val(a) { return a.n / a.d; },
    // Simplest written form: whole number, proper fraction, or mixed number
    str(a) {
      const f = F.make(a.n, a.d);
      if (f.d === 1) return String(f.n);
      const sign = f.n < 0 ? '-' : '';
      const n = Math.abs(f.n);
      if (n > f.d) return `${sign}${Math.floor(n / f.d)} ${n % f.d}/${f.d}`;
      return `${sign}${n}/${f.d}`;
    },
    // Improper form, e.g. 7/3 (still simplified)
    improper(a) {
      const f = F.make(a.n, a.d);
      return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`;
    },
    raw(n, d) { return `${n}/${d}`; },
    mixed(w, n, d) { return w ? (n ? `${w} ${n}/${d}` : `${w}`) : `${n}/${d}`; },
  };

  // ---------- Parsing what the student typed ----------
  // Returns { n, d, simplest } as an exact fraction, or null if not understood.
  function parseAnswer(input) {
    if (input == null) return null;
    let s = String(input).trim()
      .replace(/[−–—]/g, '-') // unicode minus/dashes
      .replace(/,/g, '')
      .replace(/^\$\s*/, '')
      .replace(/\s+/g, ' ');
    // drop trailing units or symbols like "cm", "sq ft", "%", "°"
    s = s.replace(/[^0-9]+$/, '').trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(-?)(\d+)$/))) {
      return { n: (m[1] ? -1 : 1) * parseInt(m[2], 10), d: 1, simplest: true };
    }
    if ((m = s.match(/^(-?)(\d*)\.(\d+)$/))) {
      const sign = m[1] ? -1 : 1;
      const k = m[3].length;
      const d = Math.pow(10, k);
      const n = parseInt((m[2] || '0') + m[3], 10);
      const f = F.make(sign * n, d);
      return { n: f.n, d: f.d, simplest: true };
    }
    if ((m = s.match(/^(-?)(\d+) ?\/ ?(\d+)$/))) {
      const n = parseInt(m[2], 10), d = parseInt(m[3], 10);
      if (d === 0) return null;
      const f = F.make((m[1] ? -1 : 1) * n, d);
      return { n: f.n, d: f.d, simplest: gcd(n, d) === 1 && d !== 1 };
    }
    if ((m = s.match(/^(-?)(\d+) (\d+) ?\/ ?(\d+)$/))) {
      const w = parseInt(m[2], 10), n = parseInt(m[3], 10), d = parseInt(m[4], 10);
      if (d === 0) return null;
      const f = F.make((m[1] ? -1 : 1) * (w * d + n), d);
      return { n: f.n, d: f.d, simplest: gcd(n, d) === 1 && n < d && n > 0 };
    }
    return null;
  }

  // Check an answer. Returns { correct, nearly, message }.
  function checkAnswer(answer, input) {
    if (answer.type === 'choice') {
      return { correct: Number(input) === answer.correct };
    }
    const p = parseAnswer(input);
    if (!p) {
      return { correct: false, invalid: true, message: 'I could not read that answer. Use digits, a decimal like 2.5, a fraction like 3/4, or a mixed number like 2 1/3.' };
    }
    if (answer.type === 'number') {
      const ok = Math.abs(p.n / p.d - answer.value) < 1e-9;
      return { correct: ok };
    }
    if (answer.type === 'fraction') {
      const equal = p.n * answer.d === answer.n * p.d;
      if (!equal) return { correct: false };
      if (answer.simplest && !p.simplest) {
        return { correct: false, nearly: true, message: 'That is equal to the right answer, but it is not in simplest form. Simplify it and try again!' };
      }
      return { correct: true };
    }
    return { correct: false };
  }

  function answerText(answer) {
    if (answer.type === 'choice') return answer.choices[answer.correct];
    if (answer.type === 'number') return fmt(answer.value);
    if (answer.type === 'fraction') return F.str(answer);
    return '';
  }

  // ---------- Dates ----------
  function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function dayNumber(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  NJ.util = { hashString, makeRng, gcd, lcm, round, fmt, pow10, F, parseAnswer, checkAnswer, answerText, dayKey, dayNumber };
})(typeof globalThis !== 'undefined' ? globalThis : this);
