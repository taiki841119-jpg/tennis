/* テニス乱数表: 組み合わせロジック (1コート想定 / ダブルス)
 * ブラウザでも node でも読み込める。
 *
 * data = {
 *   roster:  [{id, name}],
 *   players: [{id, name, status:'active'|'rest'|'left', base, no}],
 *   rounds:  [{id, a:[id,id], b:[id,id], rest:[id...], done:bool}],
 *   drawn: bool, planOn: bool, planCount: number
 * }
 */
const Logic = (() => {
  const uid = () => Math.random().toString(36).slice(2, 9);
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  function emptyData() {
    return { roster: [], players: [], rounds: [], drawn: false, planOn: false, planCount: 3 };
  }

  const activePlayers = d => d.players.filter(p => p.status === 'active');
  const doneRounds = d => d.rounds.filter(r => r.done);

  function computeStats(players, rounds) {
    const plays = {}, partner = {}, opp = {};
    players.forEach(p => (plays[p.id] = 0));
    for (const r of rounds) {
      [...r.a, ...r.b].forEach(id => { if (id in plays) plays[id]++; });
      for (const pr of [r.a, r.b]) {
        const k = key(pr[0], pr[1]);
        partner[k] = (partner[k] || 0) + 1;
      }
      for (const x of r.a) for (const y of r.b) {
        const k = key(x, y);
        opp[k] = (opp[k] || 0) + 1;
      }
    }
    return { plays, partner, opp };
  }

  const effPlays = (p, st) => (p.base || 0) + (st.plays[p.id] || 0);

  function playStreak(rounds, id) {
    let n = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].a.includes(id) || rounds[i].b.includes(id)) n++; else break;
    }
    return n;
  }
  function restStreak(rounds, id) {
    let n = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].a.includes(id) || rounds[i].b.includes(id)) break; else n++;
    }
    return n;
  }

  function combos(arr, k) {
    const out = [];
    (function rec(s, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = s; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  }
  function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** rounds(それまでの履歴)を踏まえて次の1試合を作る。4人未満なら null */
  function genRound(d, rounds, rng = Math.random) {
    const act = activePlayers(d);
    if (act.length < 4) return null;
    const st = computeStats(d.players, rounds);
    const last = rounds[rounds.length - 1];
    const playedLast = new Set(last ? [...last.a, ...last.b] : []);

    // 優先度: 出場回数(少ない方が先) → 直前に休んだ人を優先 → 2連続以上出た人は後回し
    const scored = shuffle(act, rng).map(p => ({
      p,
      k: effPlays(p, st) - (last && !playedLast.has(p.id) ? 0.5 : 0) + (playStreak(rounds, p.id) >= 2 ? 0.25 : 0),
    })).sort((x, y) => x.k - y.k);

    const cut = scored[3].k;
    const must = scored.filter(s => s.k < cut).map(s => s.p.id);
    let tie = scored.filter(s => s.k === cut).map(s => s.p.id);
    if (tie.length > 12) tie = tie.slice(0, 12);
    const need = 4 - must.length;

    let best = null;
    for (const c of combos(tie, need)) {
      const four = must.concat(c);
      const [w, x, y, z] = four;
      const pairings = [[[w, x], [y, z]], [[w, y], [x, z]], [[w, z], [x, y]]];
      for (const [A, B] of pairings) {
        let cost = rng() * 0.9; // 同点時のランダム性
        cost += 4 * ((st.partner[key(A[0], A[1])] || 0) + (st.partner[key(B[0], B[1])] || 0));
        for (const u of A) for (const v of B) cost += (st.opp[key(u, v)] || 0);
        if (!best || cost < best.cost) best = { cost, A, B };
      }
    }
    let { A, B } = best;
    if (rng() < 0.5) [A, B] = [B, A];
    const playing = new Set([...A, ...B]);
    return {
      id: uid(), a: A.slice(), b: B.slice(),
      rest: act.map(p => p.id).filter(id => !playing.has(id)),
      done: false,
    };
  }

  /** 終了済み試合 + n試合分の予定を作って返す */
  function genPlan(d, n, rng = Math.random) {
    const all = doneRounds(d);
    for (let i = 0; i < n; i++) {
      const r = genRound(d, all, rng);
      if (!r) break;
      all.push(r);
    }
    return all;
  }

  /** 予定試合を全部作り直す(乱数表の作成・再抽選) */
  function replan(d, rng = Math.random) {
    d.rounds = d.planOn ? genPlan(d, d.planCount || 3, rng) : doneRounds(d);
  }

  /** 現在の試合(最初の未終了試合)を、離脱者だけ代役に替えて返す。作れなければ null */
  function fixCurrent(d, rng = Math.random) {
    const cur = d.rounds.find(r => !r.done);
    const act = activePlayers(d);
    if (!cur || act.length < 4) return null;
    const actIds = new Set(act.map(p => p.id));
    const ids = [...cur.a, ...cur.b];
    const out = ids.filter(id => !actIds.has(id));
    const r = { ...cur, a: cur.a.slice(), b: cur.b.slice() };
    if (out.length) {
      const st = computeStats(d.players, doneRounds(d));
      const spare = shuffle(act.filter(p => !ids.includes(p.id)), rng)
        .sort((x, y) => effPlays(x, st) - effPlays(y, st));
      for (const o of out) {
        const s = spare.shift();
        if (!s) return null;
        const side = r.a.includes(o) ? r.a : r.b;
        side[side.indexOf(o)] = s.id;
      }
    }
    const playing = new Set([...r.a, ...r.b]);
    r.rest = act.map(p => p.id).filter(id => !playing.has(id));
    return r;
  }

  /** 参加状況が変わったとき: 今の試合は極力そのまま(離脱者のみ代役)、先の予定だけ作り直す */
  function replanKeep(d, rng = Math.random) {
    if (!d.planOn) { d.rounds = doneRounds(d); return; }
    const cur = fixCurrent(d, rng);
    if (!cur) { replan(d, rng); return; }
    const all = doneRounds(d).concat([cur]);
    for (let i = 1; i < (d.planCount || 3); i++) {
      const r = genRound(d, all, rng);
      if (!r) break;
      all.push(r);
    }
    d.rounds = all;
  }

  function avgEff(d) {
    const act = activePlayers(d);
    if (!act.length) return 0;
    const st = computeStats(d.players, doneRounds(d));
    return act.reduce((s, p) => s + effPlays(p, st), 0) / act.length;
  }
  function nextNo(d) {
    const used = new Set(d.players.filter(p => p.status !== 'left' && p.no).map(p => p.no));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  /* ---- 参加者操作 ---- */
  function splitNames(text) {
    return String(text || '').split(/[\n,、，]+/).map(s => s.trim()).filter(Boolean);
  }
  function setStatus(d, id, v, noReplan) {
    const p = d.players.find(x => x.id === id);
    if (!p || p.status === v) return;
    if (v === 'active') {
      // 復帰者が連続出場で有利にならないよう、出場回数を平均まで引き上げる
      const avg = avgEff(d);
      const st = computeStats(d.players, doneRounds(d));
      const own = effPlays(p, st);
      if (own < avg) p.base = (p.base || 0) + Math.round(avg - own);
      if (d.drawn && !p.no) p.no = nextNo(d);
    }
    if (v === 'left') p.no = null;
    p.status = v;
    if (!noReplan) replanKeep(d);
  }
  function addPlayers(d, names) {
    for (const raw of names) {
      const name = String(raw).trim();
      if (!name) continue;
      const ex = d.players.find(p => p.name === name);
      if (ex) { if (ex.status !== 'active') setStatus(d, ex.id, 'active', true); continue; }
      const base = Math.round(avgEff(d));
      d.players.push({ id: uid(), name, status: 'active', base, no: d.drawn ? nextNo(d) : null });
    }
    replanKeep(d);
  }
  function draw(d) {
    const live = shuffle(d.players.filter(p => p.status !== 'left'));
    live.forEach((p, i) => (p.no = i + 1));
    d.players.filter(p => p.status === 'left').forEach(p => (p.no = null));
    d.drawn = true;
  }
  function startPlan(d, n) { d.planOn = true; d.planCount = n; replan(d); }
  function stopPlan(d) { d.planOn = false; replan(d); }
  /** 試合終了: 先に作った予定表は変えず、末尾に1試合ずつ足す */
  function finishRound(d) {
    const r = d.rounds.find(x => !x.done);
    if (r) r.done = true;
    if (!d.planOn) return;
    const next = fixCurrent(d);
    if (next) d.rounds[d.rounds.indexOf(d.rounds.find(x => !x.done))] = next;
    while (d.rounds.filter(x => !x.done).length < (d.planCount || 3)) {
      const g = genRound(d, d.rounds);
      if (!g) break;
      d.rounds.push(g);
    }
  }
  function newSession(d) {
    d.players = []; d.rounds = []; d.drawn = false; d.planOn = false;
  }
  function addRoster(d, names) {
    for (const n of names) {
      if (n && !d.roster.some(r => r.name === n)) d.roster.push({ id: uid(), name: n });
    }
  }
  function removeRoster(d, id) { d.roster = d.roster.filter(r => r.id !== id); }

  return {
    uid, emptyData, activePlayers, doneRounds, computeStats, effPlays, playStreak, restStreak,
    genRound, genPlan, replan, replanKeep, splitNames, setStatus, addPlayers, draw, startPlan, stopPlan,
    finishRound, newSession, addRoster, removeRoster, shuffle,
  };
})();

if (typeof module !== 'undefined') module.exports = Logic;
