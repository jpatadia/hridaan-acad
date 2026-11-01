/* UI: daily session, feedback with hints + step-by-step guides, parent dashboard. */
(function () {
  'use strict';
  const { util: U, skills: SK, engine: E, sync: S } = window.NJ;
  const KEY = 'njsla-coach-v1';
  const SYNC_KEY = 'njsla-coach-sync';
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

  // A real change (answer, bonus, settings): timestamp it, save, and sync.
  function touch() {
    state.updatedAt = Date.now();
    save();
    schedulePush();
  }

  // ---------- cloud sync (optional) ----------
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch (e) { return null; }
  }
  function saveCfg() {
    try { if (cfg) localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); else localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
  }
  let cfg = loadCfg(); // { token, gistId, role: 'student' | 'viewer', lastSync }
  let syncStatus = { kind: cfg ? 'idle' : 'off', msg: '' };
  let chain = Promise.resolve();
  let pushTimer = null;
  const isViewer = () => !!(cfg && cfg.role === 'viewer');

  function setStatus(kind, msg = '') {
    syncStatus = { kind, msg };
    const el = document.getElementById('syncBadge');
    if (!el) return;
    const time = cfg && cfg.lastSync ? new Date(cfg.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const text = { off: '', idle: '☁️ Sync on', syncing: '⏳ Syncing…', ok: `☁️ Synced ${time}`, error: '⚠️ Not synced' }[kind];
    el.textContent = text;
    el.title = msg || (isViewer() ? 'Parent view: showing progress from the practice device' : 'Progress is backed up to your GitHub account');
    el.hidden = kind === 'off';
    el.className = `sync-badge ${kind}`;
  }

  function syncNow() {
    if (!cfg) return Promise.resolve();
    chain = chain.then(async () => {
      if (!cfg) return;
      setStatus('syncing');
      try {
        if (!cfg.gistId) {
          cfg.gistId = await S.findGist(cfg.token);
          if (!cfg.gistId) {
            if (isViewer()) throw new Error('No saved progress found yet. Turn on sync on the practice device first.');
            cfg.gistId = await S.createGist(cfg.token, E.compactState(state, today()));
          }
          saveCfg();
        }
        const remote = await S.read(cfg.token, cfg.gistId);
        if (isViewer()) {
          state = remote;
        } else {
          const merged = E.compactState(E.mergeStates(state, remote), today());
          if (JSON.stringify(merged) !== JSON.stringify(remote)) await S.write(cfg.token, cfg.gistId, merged);
          state = merged;
        }
        save();
        cfg.lastSync = Date.now();
        saveCfg();
        setStatus('ok');
        if (view !== 'quiz') render(); // never redraw mid-question (would wipe typing)
      } catch (e) {
        setStatus('error', e.message === 'offline' ? 'Offline — progress is saved here and will sync when back online.' : e.message);
        if (view === 'settings') render();
      }
    });
    return chain;
  }

  function schedulePush() {
    if (!cfg || isViewer()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 1500);
  }

  async function connect(token, role, gistId = null) {
    cfg = { token: token.trim(), role, gistId, lastSync: null };
    saveCfg();
    await syncNow();
    if (syncStatus.kind === 'error') {
      const msg = syncStatus.msg;
      cfg = null; saveCfg(); setStatus('off');
      render();
      alert('Could not turn on sync: ' + msg);
      return false;
    }
    return true;
  }

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
    if (isViewer()) { renderViewerHome(); return; }
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

  function renderViewerHome() {
    const t = today();
    const day = state.days[t];
    const sc = day ? E.dayScore(day) : { answered: 0, firstTry: 0, points: 0 };
    const sum = E.summary(state);
    const streak = state.streak.last && U.dayNumber(t) - U.dayNumber(state.streak.last) <= 1 ? state.streak.count : 0;
    const last = Object.keys(state.days).filter((k) => E.dayScore(state.days[k]).answered > 0).sort().pop();
    app.innerHTML = `
      <div class="card">
        <span class="tag">Parent view</span>
        <h1 style="margin-top:8px">${esc(state.name)}’s day</h1>
        <p class="muted">${sc.answered >= E.DAILY ? `Finished today’s 10 — ${sc.firstTry} right on the first try.` : sc.answered ? `In progress: ${sc.answered} of ${E.DAILY} answered, ${sc.firstTry} right on the first try.` : `Hasn’t started today’s questions yet.${last ? ` Last practiced ${esc(last)}.` : ''}`}</p>
        ${day ? dotsHtml(day, -1) : ''}
        <div class="row"><button class="btn secondary" data-act="sync">🔄 Refresh</button><button class="btn" data-nav="progress">See full progress →</button></div>
      </div>
      <div class="stats">
        <div class="stat"><b>🔥 ${streak}</b><span>day streak</span></div>
        <div class="stat"><b>${sum.g5Avg.toFixed(1)} / 5</b><span>avg Grade 5 level (3 = NJSLA ready)</span></div>
        <div class="stat"><b>${sum.unlockedG6} / 6</b><span>Grade 6 skills unlocked</span></div>
        <div class="stat"><b>${Object.values(state.days).filter((d) => d.completed).length}</b><span>days completed</span></div>
      </div>`;
  }

  function renderQuiz() {
    if (isViewer()) { view = 'home'; renderViewerHome(); return; }
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
    touch();
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
      ${syncCardHtml()}
      <div class="card">
        <h2>Backup file</h2>
        <p class="muted small">Save a copy of all progress as a file, or restore one. (With sync on, this is optional.)</p>
        <div class="row">
          <button class="btn secondary" data-act="export">⬇️ Export progress</button>
          <label class="btn secondary" style="display:inline-block">⬆️ Import progress<input type="file" id="importIn" accept="application/json,.json" hidden></label>
        </div>
      </div>
      <div class="card" ${isViewer() ? 'hidden' : ''}>
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
          state = s; state.resetAt = Date.now(); touch(); alert('Progress imported!'); view = 'home'; render();
        } catch (err) { alert('That file could not be imported: ' + err.message); }
      });
    });
  }

  function syncCardHtml() {
    if (!cfg) {
      return `<div class="card" id="syncCard">
        <h2>☁️ Sync between devices</h2>
        <p class="small">Practice on one device (like ${esc(state.name)}’s laptop) and check progress from another (like your phone). Progress is stored in a private file in <b>your GitHub account</b>. It’s free and needs no new accounts.</p>
        <ol class="small setup-steps">
          <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=NJSLA%20Math%20Coach" target="_blank" rel="noopener">Open this GitHub page</a> (sign in if asked). The “gist” box is already ticked; leave every other box empty. Pick an expiration (1 year is fine), click <b>Generate token</b>, and copy the key it shows (starts with <code>ghp_</code>).</li>
          <li>Paste the key here, choose what this device is for, and tap <b>Turn on sync</b>.</li>
          <li>Then use <b>Copy setup link</b> to connect your other devices without typing the key again.</li>
        </ol>
        <input type="password" class="name-input wide" id="tokenIn" placeholder="Paste your GitHub key (ghp_…)" autocomplete="off">
        <div class="role-pick">
          <label><input type="radio" name="role" value="student" checked> <b>Practice device</b>: ${esc(state.name)} practices here</label>
          <label><input type="radio" name="role" value="viewer"> <b>Parent view</b>: only check progress here (read-only)</label>
        </div>
        <button class="btn" data-act="connect">Turn on sync</button>
      </div>`;
    }
    const when = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'not yet';
    return `<div class="card" id="syncCard">
      <h2>☁️ Sync between devices</h2>
      <p class="small">This device: <b>${isViewer() ? 'Parent view (read-only)' : 'Practice device'}</b> · Last synced: ${esc(when)}</p>
      ${syncStatus.kind === 'error' ? `<div class="feedback warn small">${esc(syncStatus.msg)}</div>` : ''}
      <div class="row" style="margin-top:12px">
        <button class="btn secondary" data-act="sync">🔄 Sync now</button>
        <button class="btn danger" data-act="disconnect">Turn off sync on this device</button>
      </div>
      <h3>Connect another device</h3>
      <p class="small muted">Copy a link and open it on the other device. It includes your sync key, so only send it to yourself (for example, text or email it to yourself).</p>
      <div class="row">
        <button class="btn secondary" data-act="link-viewer">📋 Copy setup link: parent view</button>
        <button class="btn secondary" data-act="link-student">📋 Copy setup link: practice device</button>
      </div>
      <input type="text" class="name-input wide" id="linkOut" readonly hidden style="margin-top:10px">
    </div>`;
  }

  function copyLink(role) {
    const link = S.makeSetupLink(cfg, role);
    const out = document.getElementById('linkOut');
    out.hidden = false; out.value = link; out.select();
    const done = () => alert(`Link copied. Open it on the ${role === 'viewer' ? 'parent' : 'practice'} device's browser.`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => {});
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
    else if (a === 'bonus') { E.addBonus(state, today(), 5); touch(); view = 'quiz'; feedback = null; render(); }
    else if (a === 'home') { view = 'home'; render(); }
    else if (a === 'saveName') { state.name = document.getElementById('nameIn').value.trim() || 'Student'; touch(); alert('Saved!'); }
    else if (a === 'sync') { syncNow(); }
    else if (a === 'connect') {
      const token = document.getElementById('tokenIn').value;
      const role = (document.querySelector('input[name=role]:checked') || {}).value || 'student';
      if (!token.trim()) { alert('Paste your GitHub key first.'); return; }
      if (role === 'viewer' && Object.values(state.skills).some((x) => x.attempts > 0) && !confirm('This device has its own practice progress. Parent view will show the synced progress instead. Continue?')) return;
      connect(token, role).then((ok) => { if (ok) { alert(role === 'viewer' ? 'Sync is on. This device now shows progress from the practice device.' : 'Sync is on. Progress will be saved after every answer.'); view = role === 'viewer' ? 'home' : 'settings'; render(); } });
    } else if (a === 'disconnect') {
      if (confirm('Turn off sync on this device? Progress stays saved in your GitHub account and on your other devices.')) { cfg = null; saveCfg(); setStatus('off'); render(); }
    } else if (a === 'link-viewer') copyLink('viewer');
    else if (a === 'link-student') copyLink('student');
    else if (a === 'export') {
      const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `njsla-progress-${today()}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (a === 'reset') {
      if (confirm(`Erase ALL progress${cfg ? ' on every synced device' : ''}? This cannot be undone.`)) { const n = state.name; state = E.newState(n); state.resetAt = Date.now(); touch(); view = 'home'; render(); }
    }
  });

  // keep in sync when the app is reopened or the connection comes back
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (pushTimer) { clearTimeout(pushTimer); syncNow(); } });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (isViewer() && document.visibilityState === 'visible') syncNow(); }, 120000);
  document.getElementById('syncBadge').addEventListener('click', () => { view = 'settings'; render(); });

  // opened from a setup link? (on load, or pasted into an already-open tab)
  function handleSetupLink() {
    const fromLink = S.readSetupLink(location.hash);
    if (!fromLink) return false;
    history.replaceState(null, '', location.pathname + location.search); // remove the key from the address bar
    view = 'home';
    render();
    if (confirm(fromLink.role === 'viewer' ? 'Set up this device as PARENT VIEW (read-only progress)?' : 'Set up this device as a PRACTICE device?')) {
      connect(fromLink.token, fromLink.role, fromLink.gistId).then((ok) => { if (ok) { view = 'home'; render(); } });
    }
    return true;
  }
  window.addEventListener('hashchange', handleSetupLink);
  if (!handleSetupLink()) {
    render();
    setStatus(syncStatus.kind);
    syncNow();
  }
})();
