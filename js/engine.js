/*
 * Adaptive engine.
 *
 * Each skill tracks a level (1-5) and a rating (recent accuracy, 0-1).
 *  - 2 first-try correct answers in a row at the current level  -> level up
 *  - 2 misses in a row                                          -> level down
 *  - A correct "Challenge" question (asked one level higher)    -> jump up to that level
 * Grade 6 skills unlock once their Grade 5 prerequisites reach level 4.
 *
 * Every day gets 10 questions:
 *   2 Keep Sharp  - spaced review of strong skills (warm-up)
 *   3 Fix It      - skills missed recently / weakest skills
 *   3 Level Up    - skills still climbing, at the current level
 *   2 Challenge   - one level above current level (Grade 6 skills preferred once unlocked)
 * Questions are generated just-in-time, so a level change earlier in the session
 * affects later questions the same day.
 */
(function (g) {
  'use strict';
  const NJ = (g.NJ = g.NJ || {});
  const U = NJ.util;
  const SK = NJ.skills;

  const DAILY = 10;
  const START_LEVEL = { 5: 3, 6: 1 };
  const UNLOCK_LEVEL = 4;
  const MAX_PER_SKILL = 2;

  function newState(name = 'Hridaan') {
    return { version: 1, name, skills: {}, days: {}, missed: [], streak: { count: 0, last: null } };
  }

  function skillState(state, id) {
    if (!state.skills[id]) {
      const sk = SK.byId[id];
      state.skills[id] = { level: START_LEVEL[sk.grade], rating: 0.5, attempts: 0, correct: 0, up: 0, down: 0, lastSeen: null, recent: [], maxLevel: START_LEVEL[sk.grade] };
    }
    return state.skills[id];
  }

  function isUnlocked(state, skill) {
    if (skill.grade === 5) return true;
    return (skill.prereqs || []).every((p) => { const st = skillState(state, p); return st.level >= UNLOCK_LEVEL && st.rating >= 0.6; });
  }

  function unlockedSkills(state) { return SK.list.filter((s) => isUnlocked(state, s)); }

  // outcome: 'correct' (first try), 'retry' (correct on second try), 'wrong'
  function recordResult(state, q, outcome, dayKey) {
    const st = skillState(state, q.skillId);
    const score = outcome === 'correct' ? 1 : outcome === 'retry' ? 0.5 : 0;
    const before = st.level;
    const challenge = q.role === 'challenge' && q.level > st.level;
    // challenge misses count less against the rating; it's a stretch question
    const w = challenge && score < 1 ? 0.15 : 0.3;
    st.rating = U.round(st.rating * (1 - w) + score * w, 4);
    st.attempts += 1;
    if (outcome === 'correct') st.correct += 1;
    st.recent = [...st.recent, score].slice(-10);
    st.lastSeen = dayKey;

    if (challenge) {
      if (outcome === 'correct') { st.level = q.level; st.up = 0; st.down = 0; }
      // a missed challenge does not lower the level
    } else if (outcome === 'correct') {
      st.down = 0;
      if (q.level >= st.level) st.up += 1;
      if (st.up >= 2 && st.level < 5) { st.level += 1; st.up = 0; }
    } else if (outcome === 'retry') {
      st.up = 0;
    } else {
      st.up = 0;
      if (q.level <= st.level) st.down += 1;
      if (st.down >= 2 && st.level > 1) { st.level -= 1; st.down = 0; }
    }
    st.maxLevel = Math.max(st.maxLevel || 0, st.level);
    return { before, after: st.level };
  }

  function daysSince(state, id, today) {
    const st = skillState(state, id);
    if (!st.lastSeen) return 999;
    return U.dayNumber(today) - U.dayNumber(st.lastSeen);
  }

  function recentMissSkills(state, today) {
    const t = U.dayNumber(today);
    const seen = new Set();
    const out = [];
    for (let i = state.missed.length - 1; i >= 0; i--) {
      const m = state.missed[i];
      if (t - U.dayNumber(m.date) > 7 || m.date === today) continue;
      if (!seen.has(m.skillId)) { seen.add(m.skillId); out.push(m.skillId); }
    }
    return out;
  }

  // Build the list of 10 {skillId, role} slots for a day.
  function planDay(state, today, count = DAILY, existing = []) {
    const rng = U.makeRng(`plan-${today}-${existing.length}`);
    const pool = unlockedSkills(state);
    const used = {};
    existing.forEach((p) => { used[p.skillId] = (used[p.skillId] || 0) + 1; });
    const can = (id) => (used[id] || 0) < MAX_PER_SKILL;
    const take = (id, role) => { used[id] = (used[id] || 0) + 1; return { skillId: id, role }; };
    const jitter = () => rng.next() * 0.3;
    const st = (s) => skillState(state, s.id);
    const plan = { keep: [], fix: [], level: [], challenge: [] };
    const want = count === DAILY ? { keep: 2, fix: 3, challenge: 2 } : { keep: 0, fix: Math.floor(count / 3), challenge: Math.ceil(count / 3) };

    // Fix It: recently missed, then weakest attempted skills
    const fixCands = [
      ...recentMissSkills(state, today).map((id) => SK.byId[id]).filter((s) => s && isUnlocked(state, s)),
      ...pool.filter((s) => st(s).attempts > 0 && st(s).rating < 0.7).sort((a, b) => st(a).rating - st(b).rating),
    ];
    for (const s of fixCands) {
      if (plan.fix.length >= want.fix) break;
      if (can(s.id) && !plan.fix.some((p) => p.skillId === s.id)) plan.fix.push(take(s.id, 'fix'));
    }

    // Keep Sharp: strong skills not seen for a while
    const keepCands = pool
      .filter((s) => st(s).attempts > 0 && st(s).rating >= 0.75)
      .sort((a, b) => daysSince(state, b.id, today) - daysSince(state, a.id, today) + (jitter() - 0.15));
    for (const s of keepCands) {
      if (plan.keep.length >= want.keep) break;
      if (can(s.id) && !plan.fix.some((p) => p.skillId === s.id)) plan.keep.push(take(s.id, 'keep'));
    }

    // Challenge: prefer Grade 6 skills once unlocked, else strongest climbing skills
    const climbScore = (s) => s.weight * (1 + Math.min(daysSince(state, s.id, today), 7) / 7) * (st(s).attempts === 0 ? 1.5 : 1) + jitter();
    const chalCands = pool
      .filter((s) => st(s).level < 5 && st(s).attempts >= 2 && st(s).rating >= 0.6)
      .sort((a, b) => (b.grade - a.grade) * 2 + (st(b).rating - st(a).rating) + (climbScore(b) - climbScore(a)) * 0.3);
    for (const s of chalCands) {
      if (plan.challenge.length >= want.challenge) break;
      if (can(s.id) && !plan.fix.some((p) => p.skillId === s.id)) plan.challenge.push(take(s.id, 'challenge'));
    }

    // Level Up: fill the rest, favoring heavier NJSLA weight, staleness and new skills
    const remaining = () => count - plan.keep.length - plan.fix.length - plan.challenge.length - plan.level.length;
    let guard = 0;
    while (remaining() > 0 && guard++ < 100) {
      const cands = pool.filter((s) => can(s.id)).sort((a, b) => climbScore(b) - climbScore(a));
      if (!cands.length) break;
      // avoid repeating a skill already in today's plan when a fresh one exists
      const fresh = cands.find((s) => !used[s.id]);
      plan.level.push(take((fresh || cands[0]).id, 'level'));
    }
    // order: warm-up review -> fix -> level up -> challenge
    return [...plan.keep, ...plan.fix, ...plan.level, ...plan.challenge];
  }

  function getDay(state, today) {
    if (!state.days[today]) {
      state.days[today] = { plan: planDay(state, today), questions: [], extra: 0 };
    }
    return state.days[today];
  }

  function addBonus(state, today, n = 5) {
    const day = getDay(state, today);
    day.plan.push(...planDay(state, today, n, day.plan));
    day.extra += n;
    return day;
  }

  // Generate (or return) question i of today, at the skill's current level.
  function questionAt(state, today, i) {
    const day = getDay(state, today);
    if (day.questions[i]) return day.questions[i];
    const slot = day.plan[i];
    if (!slot) return null;
    const st = skillState(state, slot.skillId);
    const level = slot.role === 'challenge' ? Math.min(5, st.level + 1) : st.level;
    const q = SK.generate(slot.skillId, level, `${today}#${i}#${slot.skillId}#${level}`);
    q.role = slot.role;
    q.tries = [];
    q.outcome = null;
    day.questions[i] = q;
    return q;
  }

  function currentIndex(state, today) {
    const day = getDay(state, today);
    for (let i = 0; i < day.plan.length; i++) {
      const q = day.questions[i];
      if (!q || !q.outcome) return i;
    }
    return day.plan.length;
  }

  function dayScore(day, onlyCore = true) {
    const qs = day.questions.slice(0, onlyCore ? DAILY : undefined).filter((q) => q && q.outcome);
    const pts = qs.reduce((s, q) => s + (q.outcome === 'correct' ? 1 : q.outcome === 'retry' ? 0.5 : 0), 0);
    return { answered: qs.length, firstTry: qs.filter((q) => q.outcome === 'correct').length, points: pts };
  }

  function updateStreak(state, today) {
    const s = state.streak;
    if (s.last === today) return;
    if (s.last && U.dayNumber(today) - U.dayNumber(s.last) === 1) s.count += 1;
    else s.count = 1;
    s.last = today;
  }

  // Submit an answer for question i. Returns feedback for the UI.
  function submit(state, today, i, input) {
    const q = questionAt(state, today, i);
    if (q.outcome) return { done: true, outcome: q.outcome };
    const res = U.checkAnswer(q.answer, input);
    if (res.invalid || res.nearly) return { ...res, retryFree: true };
    q.tries.push(String(input));
    const canRetry = q.answer.type !== 'choice' || q.answer.choices.length > 2;
    if (res.correct) {
      q.outcome = q.tries.length === 1 ? 'correct' : 'retry';
    } else if (q.tries.length === 1 && canRetry) {
      return { correct: false, hint: q.hint, tryAgain: true };
    } else {
      q.outcome = 'wrong';
    }
    const change = recordResult(state, q, q.outcome, today);
    q.levelChange = change.after - change.before;
    q.newLevel = change.after;
    if (q.outcome !== 'correct') {
      state.missed.push({ date: today, skillId: q.skillId, level: q.level, prompt: q.prompt, answerText: q.answerText, given: q.tries.slice(), steps: q.steps, outcome: q.outcome });
      if (state.missed.length > 300) state.missed = state.missed.slice(-300);
    }
    const day = getDay(state, today);
    if (dayScore(day).answered >= DAILY) { updateStreak(state, today); day.completed = true; }
    return { correct: res.correct, outcome: q.outcome, steps: q.steps, answerText: q.answerText, levelChange: q.levelChange, newLevel: change.after };
  }

  function levelLabel(skillId, level) {
    const sk = SK.byId[skillId];
    return (sk.grade === 6 ? SK.G6_LEVEL_LABELS : SK.LEVEL_LABELS)[level];
  }

  // Overall readiness summary per domain (for the parent dashboard)
  function summary(state) {
    const rows = SK.list.map((s) => {
      const st = skillState(state, s.id);
      return { id: s.id, name: s.name, standard: s.standard, domain: s.domain, grade: s.grade, unlocked: isUnlocked(state, s), level: st.level, label: levelLabel(s.id, st.level), rating: st.rating, attempts: st.attempts, accuracy: st.attempts ? st.correct / st.attempts : null, prereqs: s.prereqs || [] };
    });
    const g5 = rows.filter((r) => r.grade === 5);
    const g5Avg = g5.reduce((s, r) => s + r.level, 0) / g5.length;
    return { rows, g5Avg, unlockedG6: rows.filter((r) => r.grade === 6 && r.unlocked).length };
  }

  NJ.engine = { DAILY, newState, skillState, isUnlocked, unlockedSkills, planDay, getDay, addBonus, questionAt, currentIndex, submit, recordResult, dayScore, levelLabel, summary };
})(typeof globalThis !== 'undefined' ? globalThis : this);
