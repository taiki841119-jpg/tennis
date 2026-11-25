/* かんたん版: ログイン不要・この端末だけ。人数 → クジ(タップで番号) → 番号で試合管理 */
(() => {
  const L = Logic;
  const KEY = 'tennis_simple_v1';
  const $app = document.getElementById('app');
  const $ = id => document.getElementById(id);

  let S = load() || { step: 'setup', n: 8, order: [], taken: [], data: null };
  let reveal = null; // 今表示中のカードの index

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
  }
  const num = p => (p ? p.name : '?');
  const byId = id => S.data.players.find(p => p.id === id);

  /* ---- 画面 ---- */
  function viewSetup() {
    return `<div class="wrap"><h1>🎾 かんたん版</h1>
      <div class="sub">ログイン不要。この端末だけで、番号で試合を管理します。</div>
      <div class="card"><h2>1. 参加人数</h2>
        <div class="stepper"><button data-a="dec">−</button><div class="num">${S.n}</div><button data-a="inc">＋</button></div>
        <button class="btn block" data-a="todraw">2. クジへ進む</button>
        <button class="btn ghost block gap" data-a="skipdraw">クジを使わず、すぐ試合管理へ</button></div>
      <div class="sub" style="text-align:center"><a class="btn ghost block" href="index.html" style="text-decoration:none">← トップ画面に戻る</a></div></div>`;
  }

  function viewDraw() {
    const left = S.taken.filter(t => !t).length;
    const cards = S.order.map((_, i) => S.taken[i]
      ? `<button class="cardx taken" disabled>済</button>`
      : `<button class="cardx" data-a="pick" data-i="${i}">?</button>`).join('');
    let h = `<div class="wrap"><h1>2. クジ</h1>
      <div class="sub">カードを1枚タップ → 自分の番号が出ます。覚えたら「隠す」を押して、次の人へ渡します。</div>
      <div class="card"><div class="sub" style="margin-bottom:8px">残り ${left} 枚</div><div class="grid">${cards}</div></div>
      <button class="btn block" data-a="toplay">3. 試合管理へ進む</button>
      <button class="btn ghost block gap" data-a="redraw">引き直す</button>
      <button class="btn ghost block gap" data-a="reset">最初に戻る</button></div>`;
    if (reveal !== null) {
      h += `<div class="overlay"><div>あなたの番号</div><div class="big">${S.order[reveal]}</div>
        <button class="btn" data-a="hide">覚えた → 隠す</button></div>`;
    }
    return h;
  }

  function nums(ids) { return ids.map(id => `<span>${num(byId(id))}</span>`).join(''); }

  function viewPlay() {
    const d = S.data;
    const done = d.rounds.filter(r => r.done);
    const planned = d.rounds.filter(r => !r.done);
    const act = L.activePlayers(d).length;
    const players = d.players.slice().sort((a, b) => +a.name - +b.name);
    let h = `<div class="wrap"><h1>3. 試合管理</h1>`;
    if (planned.length) {
      const cur = planned[0];
      h += `<div class="card"><h2><span class="rn">${done.length + 1}試合目</span>いまの対戦</h2>
        <div class="match"><div class="pair a">${nums(cur.a)}</div><div class="vs">VS</div><div class="pair b">${nums(cur.b)}</div>
        <div class="rest">休憩: ${cur.rest.length ? cur.rest.map(id => num(byId(id))).join('、') : 'なし'}</div></div>
        <div class="row gap"><button class="btn" data-a="finish">試合終了 → 次へ</button>
        <button class="btn ghost auto" data-a="reroll">🎲 再抽選</button></div></div>`;
    } else {
      h += `<div class="card"><div class="empty">${act < 4 ? `出場できる人が4人以上必要です(いま ${act} 人)。下のリストでオンにしてください。` : '対戦がありません。'}</div>
        ${act >= 4 ? `<button class="btn block" data-a="makeplan">対戦を作る</button>` : ''}</div>`;
    }
    h += `<div class="card"><h2>今日の参加者 (オン ${act} / ${players.length})</h2>
      <div class="sub" style="margin-bottom:8px">タップでオン/オフ。休憩や途中離脱はオフにします。</div>
      <div class="chips">${players.map(p => `<button class="chip tog ${p.status === 'active' ? 'on' : 'off'}" data-a="tog" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      <button class="chip" data-a="addp">＋ 追加参加</button></div></div>`;
    if (planned.length > 1) {
      h += `<div class="card"><h2>この先の予定</h2><table class="plan"><tr><th>#</th><th>ペアA</th><th>ペアB</th><th>休憩</th></tr>`;
      planned.slice(1).forEach((r, i) => {
        h += `<tr><td>${done.length + i + 2}</td><td>${r.a.map(id => num(byId(id))).join(' &amp; ')}</td>
          <td>${r.b.map(id => num(byId(id))).join(' &amp; ')}</td><td class="sub">${r.rest.map(id => num(byId(id))).join('、') || '-'}</td></tr>`;
      });
      h += `</table>
        <label class="f">先に作る試合数</label>
        <select data-a="planN">${[1, 3, 5, 8, 12].map(n => `<option value="${n}" ${n === (d.planCount || 3) ? 'selected' : ''}>${n}試合分</option>`).join('')}</select></div>`;
    }
    if (done.length) {
      h += `<details class="card"><summary>終了した試合 (${done.length})</summary><table class="plan gap"><tr><th>#</th><th>ペアA</th><th>ペアB</th></tr>`;
      done.slice().reverse().forEach((r, i) => {
        h += `<tr><td>${done.length - i}</td><td>${r.a.map(id => num(byId(id))).join(' &amp; ')}</td><td>${r.b.map(id => num(byId(id))).join(' &amp; ')}</td></tr>`;
      });
      h += `</table></details>`;
    }
    h += `<div class="card"><button class="btn warn block" data-a="reset">最初からやり直す</button></div></div>`;
    return h;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    $app.innerHTML = S.step === 'setup' ? viewSetup() : S.step === 'draw' ? viewDraw() : viewPlay();
  }

  /* ---- 操作 ---- */
  function newData() {
    const d = L.emptyData();
    L.addPlayers(d, Array.from({ length: S.n }, (_, i) => String(i + 1)));
    return d;
  }
  function startDraw() {
    S.order = L.shuffle(Array.from({ length: S.n }, (_, i) => i + 1));
    S.taken = S.order.map(() => false);
    S.step = 'draw'; reveal = null;
  }
  function startPlay() {
    S.data = newData();
    L.startPlan(S.data, 3);
    S.step = 'play';
  }
  function change() { save(); render(); }

  $app.addEventListener('change', e => {
    if (e.target.dataset.a === 'planN') { L.startPlan(S.data, +e.target.value); change(); }
  });
  $app.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b || b.tagName === 'SELECT') return;
    const a = b.dataset.a, d = S.data;
    switch (a) {
      case 'inc': if (S.n < 40) S.n++; return change();
      case 'dec': if (S.n > 4) S.n--; return change();
      case 'todraw': startDraw(); return change();
      case 'skipdraw': startPlay(); return change();
      case 'pick': reveal = +b.dataset.i; S.taken[reveal] = true; save(); return render();
      case 'hide': reveal = null; return change();
      case 'redraw': if (confirm('クジを引き直します。よろしいですか?')) { startDraw(); change(); } return;
      case 'toplay': {
        const left = S.taken.filter(t => !t).length;
        if (left && !confirm(`まだ引いていない人が ${left} 人います。このまま進みますか?`)) return;
        startPlay(); return change();
      }
      case 'finish': L.finishRound(d); return change();
      case 'reroll': L.replan(d); return change();
      case 'makeplan': L.startPlan(d, d.planCount || 3); return change();
      case 'tog': {
        const p = d.players.find(x => x.id === b.dataset.id);
        L.setStatus(d, p.id, p.status === 'active' ? 'rest' : 'active');
        if (L.activePlayers(d).length < 4) toast('出場者が4人未満です');
        return change();
      }
      case 'addp': {
        const next = Math.max(...d.players.map(p => +p.name)) + 1;
        L.addPlayers(d, [String(next)]); S.n = next;
        toast(`${next} 番が参加しました`); return change();
      }
      case 'reset': if (confirm('最初からやり直します。よろしいですか?')) { S = { step: 'setup', n: S.n, order: [], taken: [], data: null }; change(); } return;
    }
  });

  render();
})();
