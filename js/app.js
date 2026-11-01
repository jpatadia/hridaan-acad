/* UI: daily session, feedback with hints + step-by-step guides, parent dashboard. */
(function () {
  'use strict';
  const { util: U, skills: SK, engine: E } = window.NJ;
  const KEY = 'njsla-coach-v1';
  const app = document.getElementById('app');

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked or corrupt */ }
    return E.newState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  let state = load();
  let view = 'home';
  let feedback = null; // feedback for the question on screen
  const today = () => U.dayKey();

  // ---------- math text rendering ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function rich(s) {
    return esc(s)
      .replace(/(\d+)\/(\d+)/g, '<span class="frac"><span>$1</span><span>$2</span></span>')
      .replace(/\^(\d+)/g, '<sup>$1</sup>')
      .replace(/-(\d)/g, '−$1')
      .replace(/\n/g, '<br>');
  }

  const ROLE = {
    keep: { label: 'Warm-up', cls: 'keep', why: 'Review of a skill you are strong in' },
    fix: { label: 'Fix it', cls: 'fix', why: 'You missed this kind recently — let’s fix it' },
    level: { label: 'Level up', cls: '', why: 'Answer 2 in a row to level up' },
    challenge: { label: '⭐ Challenge', cls: 'challenge', why: 'One level above you — get it right to jump up!' },
  };

  // ---------- views ----------
  function render() {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === view || (view === 'quiz' && b.dataset.nav === 'home')));
    if (view === 'home') renderHome();
    else if (view === 'quiz') renderQuiz();
    else if (view === 'progress') renderProgress();
    else if (view === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  function dotsHtml(day, cur) {
    return `<div class="dots">${day.plan.map((p, i) => {
      const q = day.questions[i];
      const cls = q && q.outcome ? q.outcome : '';
      const sym = q && q.outcome ? (q.outcome === 'correct' ? '✓' : q.outcome === 'retry' ? '½' : '✗') : (p.role === 'challenge' ? '★' : i + 1);
      return `<div class="dot ${cls} ${i === cur ? 'current' : ''}" title="${ROLE[p.role].label}">${sym}</div>`;
    }).join('')}</div>`;
  }

  function renderHome() {
    const t = today();
    const day = E.getDay(state, t);
    save();
    const sc = E.dayScore(day);
    const idx = E.currentIndex(state, t);
    const doneCore = sc.answered >= E.DAILY;
    const allDone = idx >= day.plan.length;
    const sum = E.summary(state);
    const ready = Math.round((sum.g5Avg / 5) * 100);
    const streak = state.streak.last && U.dayNumber(t) - U.dayNumber(state.streak.last) <= 1 ? state.streak.count : 0;

    let action;
    if (!doneCore) {
      action = `<button class="btn big" data-act="start">${sc.answered ? `Continue (question ${idx + 1})` : 'Start today’s 10 questions'}</button>`;
    } else if (!allDone) {
      action = `<button class="btn big" data-act="start">Continue bonus questions</button>`;
    } else {
      action = `<button class="btn big secondary" data-act="bonus">⭐ 5 bonus challenge questions</button>`;
    }

    app.innerHTML = `
      <div class="card">
        <h1>Hi ${esc(state.name)}! 👋</h1>
        <p class="muted">${doneCore ? `Today’s mission is complete — ${sc.firstTry} of ${E.DAILY} right on the first try. ${sc.firstTry >= 8 ? 'Outstanding! 🏆' : sc.firstTry >= 6 ? 'Great work! 💪' : 'The ones you missed will come back to help you master them.'}` : 'Your 10 questions for today are ready. Some are review, some fix tricky spots, and the ⭐ ones are challenges.'}</p>
        ${dotsHtml(day, doneCore ? -1 : idx)}
        <div class="row">${action}</div>
      </div>
      <div class="stats">
        <div class="stat"><b>🔥 ${streak}</b><span>day streak</span></div>
        <div class="stat"><b>${ready}%</b><span>Grade 5 mastery (avg level ${sum.g5Avg.toFixed(1)} / 5)</span></div>
        <div class="stat"><b>${sum.unlockedG6} / 6</b><span>Grade 6 skills unlocked</span></div>
        <div class="stat"><b>${sc.points}</b><span>points today</span></div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2>How it works</h2>
        <ul class="legend">
          <li><span class="tag keep">Warm-up</span> review skills you are strong at so you don't forget them.</li>
          <li><span class="tag fix">Fix it</span> skills you missed recently.</li>
          <li><span class="tag">Level up</span> 2 right in a row = next level. Levels go: Warm-up → On grade → NJSLA ready → Advanced → Grade 6 challenge.</li>
          <li><span class="tag challenge">⭐ Challenge</span> one level above you. Get it right and you jump up!</li>
          <li>Wrong answer? You get a hint and a second try. Still stuck? You'll see the full step-by-step solution.</li>
        </ul>
      </div>`;
  }

  function renderQuiz() {
    const t = today();
    const day = E.getDay(state, t);
    let i = E.currentIndex(state, t);
    if (feedback && feedback.index != null) i = feedback.index; // keep showing the answered question
    if (i >= day.plan.length) { renderSummary(); return; }
    const q = E.questionAt(state, t, i);
    save();
    const role = ROLE[q.role];
    const sk = SK.byId[q.skillId];
    const resolved = !!q.outcome;
    const total = day.plan.length;

    let answerHtml;
    if (q.answer.type === 'choice') {
      const tried = q.tries.map(Number);
      answerHtml = `<div class="choices">${q.answer.choices.map((c, k) => {
        const isCorrect = resolved && k === q.answer.correct;
        const disabled = resolved || tried.includes(k);
        return `<button class="choice ${isCorrect ? 'is-correct' : ''}" data-choice="${k}" ${disabled ? 'disabled' : ''}>${rich(c)}</button>`;
      }).join('')}</div>`;
    } else {
      answerHtml = `
        <form class="answer-row" id="ansForm" autocomplete="off">
          <input id="ans" type="text" inputmode="text" placeholder="Your answer" ${resolved ? 'disabled' : ''} aria-label="Your answer">
          <button class="btn" ${resolved ? 'disabled' : ''}>Check</button>
        </form>
        <div class="typing-help">Type whole numbers (1200), decimals (3.75), fractions (3/4), or mixed numbers (2 1/3 — a space between). Use - for negative numbers.</div>`;
    }

    app.innerHTML = `
      <div class="card">
        <div class="row spread">
          <span class="muted small">Question ${i + 1} of ${total}${i >= E.DAILY ? ' (bonus)' : ''}</span>
          <span class="tag ${role.cls}" title="${esc(role.why)}">${role.label}</span>
        </div>
        ${dotsHtml(day, i)}
        <div class="muted small">${esc(sk.name)} · ${esc(sk.standard)} · ${esc(E.levelLabel(q.skillId, q.level))}</div>
        <div class="prompt">${rich(q.prompt)}</div>
        ${answerHtml}
        <div id="fb">${feedbackHtml(q)}</div>
      </div>`;

    const input = document.getElementById('ans');
    if (input && !resolved) input.focus();
    const form = document.getElementById('ansForm');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) answer(i, input.value); });
    app.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => answer(i, Number(b.dataset.choice))));
    const next = document.getElementById('nextBtn');
    if (next) next.focus();
  }

  function stepsHtml(steps) { return `<ol class="steps">${steps.map((s) => `<li>${rich(s)}</li>`).join('')}</ol>`; }

  function feedbackHtml(q) {
    const f = feedback && feedback.qid === q.id ? feedback : null;
    const nextBtn = `<div class="row" style="margin-top:14px"><button class="btn" id="nextBtn" data-act="next">Next →</button></div>`;
    if (!q.outcome) {
      if (!f) return '';
      if (f.tryAgain) return `<div class="feedback warn"><div class="title">Not quite — try once more!</div>💡 <b>Hint:</b> ${rich(q.hint)}</div>`;
      if (f.message) return `<div class="feedback warn">${rich(f.message)}</div>`;
      return '';
    }
    const lvl = q.levelChange > 0
      ? `<div class="levelup">🚀 Level up! ${esc(SK.byId[q.skillId].name)} is now “${esc(E.levelLabel(q.skillId, q.newLevel))}”.</div>`
      : q.levelChange < 0 ? `<div class="muted small" style="margin-top:6px">We'll practice this skill at an easier level for a bit, then climb back up.</div>` : '';
    if (q.outcome === 'correct') {
      return `<div class="feedback good"><div class="title">${q.role === 'challenge' ? '⭐ Challenge crushed!' : 'Correct! 🎉'}</div>${lvl}
        <details><summary>See how to solve it</summary>${stepsHtml(q.steps)}</details></div>${nextBtn}`;
    }
    if (q.outcome === 'retry') {
      return `<div class="feedback good"><div class="title">Got it on the second try! 👍</div>
        <details open><summary>Check the steps so you get it the first time next time</summary>${stepsHtml(q.steps)}</details></div>${nextBtn}`;
    }
    const given = q.tries.map((t) => (q.answer.type === 'choice' ? q.answer.choices[Number(t)] : t));
    return `<div class="feedback bad"><div class="title">Let’s learn this one together 🧠</div>
      <div>You answered: ${given.map((g) => `<b>${rich(g)}</b>`).join(' then ')}. The correct answer is <b>${rich(q.answerText)}</b>.</div>
      <h3>Step-by-step guide</h3>${stepsHtml(q.steps)}
      <div class="muted small" style="margin-top:8px">A question like this will come back in “Fix it” so you can master it.</div>${lvl}</div>${nextBtn}`;
  }

  function answer(i, input) {
    const t = today();
    const q = E.questionAt(state, t, i);
    const r = E.submit(state, t, i, input);
    save();
    feedback = { ...r, qid: q.id, index: q.outcome ? i : null };
    renderQuiz();
  }

  function renderSummary() {
    const t = today();
    const day = E.getDay(state, t);
    const sc = E.dayScore(day, false);
    const qs = day.questions.filter(Boolean);
    const ups = qs.filter((q) => q.levelChange > 0);
    app.innerHTML = `
      <div class="card">
        <h1>${sc.firstTry >= qs.length * 0.8 ? '🏆' : '🎯'} Done for today!</h1>
        <p>${sc.firstTry} of ${qs.length} right on the first try · ${sc.points} points</p>
        ${dotsHtml(day, -1)}
        ${ups.length ? `<p class="levelup">🚀 Level ups: ${[...new Set(ups.map((q) => SK.byId[q.skillId].name))].map(esc).join(', ')}</p>` : ''}
        <h3>Review</h3>
        ${qs.map((q, k) => `<div class="missed-item"><b>${k + 1}.</b> ${q.outcome === 'correct' ? '✅' : q.outcome === 'retry' ? '🟡' : '❌'} ${rich(q.prompt)}
          ${q.outcome !== 'correct' ? `<details><summary>Answer: ${rich(q.answerText)} — see steps</summary>${stepsHtml(q.steps)}</details>` : ''}</div>`).join('')}
        <div class="row" style="margin-top:16px">
          <button class="btn secondary" data-act="bonus">⭐ 5 bonus challenge questions</button>
          <button class="btn" data-act="home">Back to home</button>
        </div>
      </div>`;
  }

  function renderProgress() {
    const sum = E.summary(state);
    const domains = [...new Set(sum.rows.map((r) => r.domain))];
    const days = Object.keys(state.days).sort().slice(-14);
    const hist = days.map((d) => ({ d, s: E.dayScore(state.days[d]) }));
    const recentMissed = state.missed.slice(-25).reverse();
    const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

    const rowHtml = (r) => {
      if (!r.unlocked) {
        return `<tr class="locked"><td>🔒 ${esc(r.name)}<div class="small">${esc(r.standard)}</div></td><td colspan="3" class="small">Unlocks when ${r.prereqs.map((p) => esc(SK.byId[p].name)).join(' + ')} reach${r.prereqs.length > 1 ? '' : 'es'} “Advanced” (level 4)</td></tr>`;
      }
      return `<tr><td>${esc(r.name)}<div class="small muted">${esc(r.standard)}</div></td>
        <td><div class="lvl"><div class="bar"><i style="width:${r.level * 20}%"></i></div><span class="small">${r.level} · ${esc(r.label)}</span></div></td>
        <td>${r.attempts ? pct(r.accuracy) : '<span class="small muted">not tried yet</span>'}</td><td>${r.attempts}</td></tr>`;
    };

    app.innerHTML = `
      <div class="card">
        <h2>Progress for ${esc(state.name)}</h2>
        <div class="stats">
          <div class="stat"><b>${sum.g5Avg.toFixed(1)} / 5</b><span>avg Grade 5 level (3 = NJSLA ready)</span></div>
          <div class="stat"><b>${sum.rows.filter((r) => r.grade === 5 && r.attempts >= 3 && r.level >= 3 && r.rating >= 0.6).length} / ${sum.rows.filter((r) => r.grade === 5).length}</b><span>Grade 5 skills proven NJSLA-ready or above (3+ tries)</span></div>
          <div class="stat"><b>${sum.unlockedG6} / 6</b><span>Grade 6 skills unlocked</span></div>
          <div class="stat"><b>${Object.values(state.days).filter((d) => d.completed).length}</b><span>days completed</span></div>
        </div>
        ${hist.length ? `<h3>First-try score, last ${hist.length} day(s)</h3>
          <div class="history">${hist.map((h) => `<div class="col" style="height:${Math.max(4, h.s.firstTry * 9)}%"><span>${h.s.firstTry}</span></div>`).join('')}</div>
          <div class="history-labels">${hist.map((h) => `<span>${h.d.slice(5)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card">
        <h2>Skills</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Skill</th><th>Level</th><th>First-try</th><th>Tries</th></tr></thead>
          <tbody>${domains.map((d) => `<tr><th colspan="4" style="padding-top:16px">${esc(d)}</th></tr>${sum.rows.filter((r) => r.domain === d).map(rowHtml).join('')}`).join('')}</tbody>
        </table></div>
        <p class="small muted">Levels: 1 Warm-up · 2 On grade · 3 NJSLA ready · 4 Advanced · 5 Grade 6 challenge. Grade 6 skills unlock automatically.</p>
      </div>
      <div class="card">
        <h2>Recently missed questions</h2>
        ${recentMissed.length ? recentMissed.map((m) => `<div class="missed-item">
          <div class="small muted">${esc(m.date)} · ${esc(SK.byId[m.skillId] ? SK.byId[m.skillId].name : m.skillId)} · level ${m.level} · ${m.outcome === 'retry' ? 'right on 2nd try' : 'missed'}</div>
          <div>${rich(m.prompt)}</div>
          <details><summary>Answer ${rich(m.answerText)} (typed: ${m.given.map((g) => esc(g)).join(', ')}) — steps</summary>${stepsHtml(m.steps)}</details>
        </div>`).join('') : '<p class="muted">Nothing missed yet.</p>'}
      </div>`;
  }

  function renderSettings() {
    app.innerHTML = `
      <div class="card">
        <h2>Settings</h2>
        <label>Student name<br><input type="text" class="name-input" id="nameIn" value="${esc(state.name)}"></label>
        <button class="btn secondary" data-act="saveName" style="margin-left:8px">Save</button>
      </div>
      <div class="card">
        <h2>Backup & move to another device</h2>
        <p class="muted small">Progress lives in this browser only. Export a backup file now and then, and import it to continue on another device.</p>
        <div class="row">
          <button class="btn secondary" data-act="export">⬇️ Export progress</button>
          <label class="btn secondary" style="display:inline-block">⬆️ Import progress<input type="file" id="importIn" accept="application/json,.json" hidden></label>
        </div>
      </div>
      <div class="card">
        <h2>Start over</h2>
        <p class="muted small">Erases all progress in this browser.</p>
        <button class="btn danger" data-act="reset">Reset all progress</button>
      </div>`;
    document.getElementById('importIn').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        try {
          const s = JSON.parse(txt);
          if (!s || !s.skills || !s.days) throw new Error('not a progress file');
          state = s; save(); alert('Progress imported!'); view = 'home'; render();
        } catch (err) { alert('That file could not be imported: ' + err.message); }
      });
    });
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { view = nav.dataset.nav; feedback = null; render(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'start') { view = 'quiz'; feedback = null; render(); }
    else if (a === 'next') { feedback = null; renderQuiz(); window.scrollTo(0, 0); }
    else if (a === 'bonus') { E.addBonus(state, today(), 5); save(); view = 'quiz'; feedback = null; render(); }
    else if (a === 'home') { view = 'home'; render(); }
    else if (a === 'saveName') { state.name = document.getElementById('nameIn').value.trim() || 'Student'; save(); alert('Saved!'); }
    else if (a === 'export') {
      const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `njsla-progress-${today()}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (a === 'reset') {
      if (confirm('Erase ALL progress? This cannot be undone.')) { const n = state.name; state = E.newState(n); save(); view = 'home'; render(); }
    }
  });

  render();
})();
