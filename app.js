/* テニス乱数表 UI / 同期 */
(() => {
  const L = Logic;
  const CFG = window.CONFIG || {};
  const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const $app = document.getElementById('app');

  /* ---------- ストレージ (cloud: Supabase RPC / local: localStorage) ---------- */
  async function rpc(fn, args) {
    const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error('通信エラー ' + r.status);
    return r.json();
  }
  const lk = n => 'tennis_local_group_' + n;
  const Store = CLOUD ? {
    create: (n, p) => rpc('create_group', { p_name: n, p_pass: p, p_data: L.emptyData() }),
    get: (n, p) => rpc('get_group', { p_name: n, p_pass: p }),
    save: (n, p, data, ver) => rpc('save_group', { p_name: n, p_pass: p, p_data: data, p_version: ver }),
  } : {
    async create(n, p) {
      if (localStorage.getItem(lk(n))) return { ok: false, error: 'exists' };
      const rec = { pass: p, data: L.emptyData(), version: 1 };
      localStorage.setItem(lk(n), JSON.stringify(rec));
      return { ok: true, data: rec.data, version: 1 };
    },
    async get(n, p) {
      const s = localStorage.getItem(lk(n));
      if (!s) return { ok: false, error: 'not_found' };
      const rec = JSON.parse(s);
      if (rec.pass !== p) return { ok: false, error: 'bad_password' };
      return { ok: true, data: rec.data, version: rec.version };
    },
    async save(n, p, data, ver) {
      const rec = JSON.parse(localStorage.getItem(lk(n)) || 'null');
      if (!rec || rec.pass !== p) return { ok: false, error: 'bad_password' };
      if (rec.version !== ver) return { ok: false, error: 'conflict', data: rec.data, version: rec.version };
      rec.data = data; rec.version = ver + 1;
      localStorage.setItem(lk(n), JSON.stringify(rec));
      return { ok: true, version: rec.version };
    },
  };

  /* ---------- アプリ状態 ---------- */
  const app = {
    group: '', pass: '', data: null, version: 0,
    tab: 'match', sel: new Set(), showNo: true, planN: 3,
    sync: 'ok', busy: 0, loginErr: '',
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  /* ---------- 変更の適用(競合時は最新を取って再適用) ---------- */
  let queue = Promise.resolve();
  function mutate(fn) {
    queue = queue.then(async () => {
      app.busy++;
      try {
        fn(app.data); render();           // 先に画面へ反映
        for (let i = 0; i < 5; i++) {
          const res = await Store.save(app.group, app.pass, app.data, app.version);
          if (res.ok) { app.version = res.version; app.sync = 'ok'; return; }
          if (res.error === 'conflict') {
            app.data = res.data; app.version = res.version;
            fn(app.data); render();         // 最新データに再適用
            continue;
          }
          throw new Error(res.error || 'save_failed');
        }
        throw new Error('競合が解消できませんでした');
      } catch (e) {
        app.sync = 'err'; toast('保存に失敗: ' + e.message);
        await pull(true);
      } finally { app.busy--; render(); }
    });
    return queue;
  }

  async function pull(force) {
    try {
      const res = await Store.get(app.group, app.pass);
      if (!res.ok) { app.sync = 'err'; return; }
      app.sync = 'ok';
      if (res.version !== app.version) {
        const ae = document.activeElement;
        const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.value;
        if (!force && typing) return; // 入力中は上書きしない
        app.data = res.data; app.version = res.version; render();
      }
    } catch (e) { app.sync = 'err'; render(); }
  }
  setInterval(() => { if (app.data && !app.busy && !document.hidden) pull(false); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && app.data && !app.busy) pull(false); });

  /* ---------- ログイン ---------- */
  async function login(name, pass, create) {
    name = name.trim();
    if (!name || !pass) { app.loginErr = 'グループ名と合言葉を入力してください'; return render(); }
    try {
      let res = create ? await Store.create(name, pass) : await Store.get(name, pass);
      if (!res.ok) {
        app.loginErr = { exists: 'そのグループ名は既に使われています', not_found: 'グループが見つかりません', bad_password: '合言葉が違います' }[res.error] || ('エラー: ' + res.error);
        return render();
      }
      app.group = name; app.pass = pass; app.data = res.data; app.version = res.version; app.loginErr = '';
      lsSet('tennis_login', JSON.stringify({ name, pass }));
      render();
    } catch (e) { app.loginErr = '通信に失敗しました: ' + e.message; render(); }
  }
  function logout() {
    lsSet('tennis_login', ''); app.data = null; app.group = ''; app.pass = ''; app.sel.clear(); render();
  }

  /* ---------- 描画 ---------- */
  const nm = (p, d) => p ? (app.showNo && d.drawn && p.no ? `<span class="no">${p.no}</span>` : '') + esc(p.name) : '?';
  const byId = (d, id) => d.players.find(p => p.id === id);

  function renderLogin() {
    return `<div class="wrap">
      <h1>🎾 テニス乱数表</h1>
      <div class="sub">グループ名と合言葉で、メンバーだけが見られる名簿・対戦表を作れます。</div>
      ${CLOUD ? '' : '<div class="card sub">⚠ ローカルモード: データはこの端末のブラウザ内にだけ保存されます。複数端末で共有するには README の手順で Supabase を設定してください。</div>'}
      <div class="card">
        <label class="f">グループ名</label><input id="g" autocomplete="off" placeholder="例: 日曜テニス会">
        <label class="f">合言葉(簡易パスワード)</label><input id="p" type="password" autocomplete="off">
        ${app.loginErr ? `<div class="gap" style="color:var(--warn)">${esc(app.loginErr)}</div>` : ''}
        <div class="row gap">
          <button class="btn" data-act="login">入る</button>
          <button class="btn ghost" data-act="create">新しく作る</button>
        </div>
      </div>
      <div class="sub" style="text-align:center"><a class="btn ghost block" href="index.html" style="text-decoration:none">← トップ画面に戻る</a></div></div>`;
  }

  function matchCard(r, d) {
    const pr = ids => ids.map(id => `<span>${nm(byId(d, id), d)}</span>`).join('');
    return `<div class="match">
      <div class="pair a">${pr(r.a)}</div><div class="vs">VS</div><div class="pair b">${pr(r.b)}</div>
      <div class="rest">休憩: ${r.rest.length ? r.rest.map(id => nm(byId(d, id), d)).join('、') : 'なし'}</div></div>`;
  }

  /** 今日の参加者: 名簿+参加者を並べ、タップでオン/オフ(休憩・離脱・参加) */
  function todayCard(d) {
    const inP = new Set(d.players.map(p => p.name));
    const items = d.players.map(p => ({ name: p.name, id: p.id, on: p.status === 'active', no: p.no }))
      .concat(d.roster.filter(r => !inP.has(r.name)).map(r => ({ name: r.name, id: '', on: false, no: null })));
    items.sort((a, b) => b.on - a.on || a.name.localeCompare(b.name, 'ja'));
    const onN = items.filter(i => i.on).length;
    return `<div class="card"><h2>今日の参加者 (オン ${onN} / ${items.length})</h2>
      <div class="sub" style="margin-bottom:8px">タップでオン/オフ。休憩や途中離脱はオフ、参加・復帰はオンにします。</div>
      ${items.length ? `<div class="chips">${items.map(i => `<button class="chip ${i.on ? 'on' : ''}" data-act="tog" data-id="${i.id}" data-name="${esc(i.name)}">${app.showNo && d.drawn && i.no ? `${i.no} ` : ''}${esc(i.name)}</button>`).join('')}</div>`
        : '<div class="empty">名簿か「参加者」タブで追加してください。</div>'}</div>`;
  }

  function renderMatch(d) {
    const done = d.rounds.filter(r => r.done);
    const planned = d.rounds.filter(r => !r.done);
    const act = L.activePlayers(d).length;
    let h = '';
    if (!d.planOn || !planned.length) {
      h += `<div class="card"><h2>対戦を作る</h2>`;
      if (act < 4) h += `<div class="empty">出場できる人が4人以上必要です(現在 ${act} 人)。<br>「参加者」タブで追加してください。</div>`;
      else h += `<div class="sub">現在の出場者 ${act} 人で、ペアと対戦相手を乱数で決めます。</div>
        <label class="f">何試合分の乱数表を先に作る?</label>
        <select id="planN">${[1, 3, 5, 8, 12].map(n => `<option value="${n}" ${n === app.planN ? 'selected' : ''}>${n}試合分</option>`).join('')}</select>
        <button class="btn block gap" data-act="startplan">乱数表を作成</button>`;
      h += `</div>`;
    } else {
      const cur = planned[0];
      h += `<div class="card"><h2><span class="rn">${done.length + 1}試合目</span>いまの対戦</h2>${matchCard(cur, d)}
        <div class="row gap"><button class="btn" data-act="finish">試合終了 → 次へ</button>
        <button class="btn ghost auto" data-act="reroll">🎲 再抽選</button></div></div>`;
      if (planned.length > 1) {
        h += `<div class="card"><h2>この先の予定</h2><table class="plan"><tr><th>#</th><th>ペアA</th><th>ペアB</th><th>休憩</th></tr>`;
        planned.slice(1).forEach((r, i) => {
          h += `<tr><td>${done.length + i + 2}</td><td>${r.a.map(id => nm(byId(d, id), d)).join('<br>')}</td>
            <td>${r.b.map(id => nm(byId(d, id), d)).join('<br>')}</td>
            <td class="sub">${r.rest.map(id => nm(byId(d, id), d)).join('<br>') || '-'}</td></tr>`;
        });
        h += `</table><div class="sub gap">※ 参加・休憩・抜けが変わると、予定は自動で作り直されます。</div></div>`;
      }
      h += `<div class="row"><button class="btn ghost sm" data-act="stopplan">乱数表を消す</button></div>`;
    }
    h += todayCard(d);
    if (done.length) {
      h += `<details class="card"><summary>終了した試合 (${done.length})</summary><table class="plan gap"><tr><th>#</th><th>ペアA</th><th>ペアB</th></tr>`;
      done.slice().reverse().forEach((r, i) => {
        h += `<tr><td>${done.length - i}</td><td>${r.a.map(id => nm(byId(d, id), d)).join(' &amp; ')}</td><td>${r.b.map(id => nm(byId(d, id), d)).join(' &amp; ')}</td></tr>`;
      });
      h += `</table></details>`;
    }
    return h;
  }

  function renderPlayers(d) {
    const doneR = L.doneRounds(d);
    const st = L.computeStats(d.players, doneR);
    const order = { active: 0, rest: 1, left: 2 };
    const list = d.players.slice().sort((a, b) => order[a.status] - order[b.status] || (a.no || 99) - (b.no || 99));
    const inSession = new Set(d.players.filter(p => p.status !== 'left').map(p => p.name));
    const avail = d.roster.filter(r => !inSession.has(r.name));
    let h = `<div class="card"><h2>参加者 (${L.activePlayers(d).length}人 出場可)</h2>`;
    if (!list.length) h += `<div class="empty">まだ誰もいません。下から追加してください。</div>`;
    for (const p of list) {
      const rs = L.restStreak(doneR, p.id);
      const label = { active: '', rest: '休憩中', left: '抜けた' }[p.status];
      const btns = p.status === 'active'
        ? `<button class="btn ghost sm" data-act="st" data-id="${p.id}" data-v="rest">休憩</button><button class="btn warn sm" data-act="st" data-id="${p.id}" data-v="left">抜ける</button>`
        : p.status === 'rest'
          ? `<button class="btn sm" data-act="st" data-id="${p.id}" data-v="active">復帰</button><button class="btn warn sm" data-act="st" data-id="${p.id}" data-v="left">抜ける</button>`
          : `<button class="btn sm" data-act="st" data-id="${p.id}" data-v="active">再参加</button>`;
      h += `<div class="plr ${p.status}"><div class="n">${p.no ? `<span class="no">${p.no}</span>` : ''}${esc(p.name)} ${label ? `<span class="sub">(${label})</span>` : ''}
        <small>出場 ${st.plays[p.id] || 0} 回${p.status === 'active' && rs > 0 ? ` ／ 連続休み ${rs}` : ''}</small></div>${btns}</div>`;
    }
    h += `</div>`;
    h += `<div class="card"><h2>名前を入力して追加</h2>
      <textarea id="addnames" placeholder="名前を入力(複数は改行かカンマ区切り)"></textarea>
      <div class="row gap"><label class="auto sub"><input type="checkbox" id="addroster" style="width:auto"> 名簿にも登録</label>
      <button class="btn" data-act="addnames">追加</button></div></div>`;
    if (d.roster.length) {
      h += `<div class="card"><h2>名簿から選んで追加</h2>`;
      if (!avail.length) h += `<div class="sub">名簿の全員が参加中です。</div>`;
      else h += `<div class="chips">${avail.map(r => `<button class="chip ${app.sel.has(r.id) ? 'on' : ''}" data-act="sel" data-id="${r.id}">${esc(r.name)}</button>`).join('')}</div>
        <div class="row gap"><button class="btn ghost" data-act="selall">全員選択</button><button class="btn" data-act="addsel">選んだ人を追加 (${[...app.sel].filter(id => avail.some(r => r.id === id)).length})</button></div>`;
      h += `</div>`;
    }
    h += `<div class="card"><h2>クジ(番号割り当て)</h2>
      <div class="sub">参加者にランダムで番号を振ります。${d.drawn ? '(引き済み。途中参加者には空き番号が付きます)' : ''}</div>
      <div class="row gap"><button class="btn" data-act="draw">${d.drawn ? '引き直す' : 'クジを引く'}</button>
      <label class="auto sub"><input type="checkbox" id="shno" style="width:auto" ${app.showNo ? 'checked' : ''}> 番号を表示</label></div></div>`;
    h += `<div class="card"><button class="btn warn block" data-act="newsession">新しいセッションを始める(参加者・履歴をクリア)</button></div>`;
    return h;
  }

  function renderRoster(d) {
    return `<div class="card"><h2>自分で登録</h2>
      <input id="selfname" autocomplete="off" placeholder="自分のイニシャル / ニックネーム">
      <div class="row gap"><label class="auto sub"><input type="checkbox" id="selfjoin" style="width:auto" checked> 今日の参加者にも入る</label>
      <button class="btn" data-act="selfreg">登録</button></div></div>
      <div class="card"><h2>グループ名簿 (${d.roster.length}人)</h2>
      ${d.roster.length ? `<div class="chips">${d.roster.map(r => `<button class="chip del" data-act="delroster" data-id="${r.id}">${esc(r.name)}</button>`).join('')}</div>
      <div class="sub gap">名前をタップすると名簿から削除します。</div>` : '<div class="empty">名簿は空です。</div>'}</div>
      <div class="card"><h2>一括で取り込み</h2>
      <textarea id="rosternames" placeholder="ニックネームを入力(複数は改行かカンマ区切り)"></textarea>
      <button class="btn block gap" data-act="addroster">まとめて登録</button>
      <div class="sub gap">名簿はグループ内の全員で共有されます。ニックネームだけを登録してください。</div></div>`;
  }

  function render() {
    if (!app.data) { $app.innerHTML = renderLogin(); return; }
    const d = app.data;
    const syncTxt = app.sync === 'err' ? '⚠ 同期エラー' : (CLOUD ? '● 同期中' : '● ローカル');
    const body = app.tab === 'match' ? renderMatch(d) : app.tab === 'players' ? renderPlayers(d) : renderRoster(d);
    const keep = document.activeElement && document.activeElement.id;
    $app.innerHTML = `<div class="topbar"><div class="t">🎾 ${esc(app.group)}</div><div class="s">${syncTxt}</div><button data-act="logout">退出</button></div>
      ${CLOUD ? '' : '<div class="banner">ローカルモード(この端末のみ)</div>'}
      <div class="wrap">${body}</div>
      <nav class="tabs">${[['match', '🎲 対戦'], ['players', '👥 参加者'], ['roster', '📒 名簿']].map(([k, l]) => `<button class="${app.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</nav>`;
    if (keep) { const el = document.getElementById(keep); if (el && el.tagName !== 'BUTTON') el.focus(); }
  }

  /* ---------- イベント ---------- */
  const val = id => (document.getElementById(id) || {}).value || '';
  $app.addEventListener('change', e => {
    if (e.target.id === 'planN') app.planN = +e.target.value;
    if (e.target.id === 'shno') { app.showNo = e.target.checked; lsSet('tennis_showno', app.showNo ? '1' : '0'); render(); }
  });
  $app.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.id === 'g' || e.target.id === 'p')) login(val('g'), val('p'), false);
  });
  $app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, v = b.dataset.v;
    const d = app.data;
    switch (act) {
      case 'login': return login(val('g'), val('p'), false);
      case 'create': return login(val('g'), val('p'), true);
      case 'logout': return logout();
      case 'tab': app.tab = v; return render();
      case 'startplan': { const n = +val('planN') || app.planN; app.planN = n; return mutate(x => L.startPlan(x, n)); }
      case 'stopplan': return mutate(x => L.stopPlan(x));
      case 'reroll': return mutate(x => L.replan(x));
      case 'finish': return mutate(x => L.finishRound(x));
      case 'st': return mutate(x => L.setStatus(x, id, v));
      case 'tog': {
        const name = b.dataset.name;
        return mutate(x => {
          const p = x.players.find(q => q.name === name);
          if (!p) L.addPlayers(x, [name]);
          else L.setStatus(x, p.id, p.status === 'active' ? 'rest' : 'active');
        });
      }
      case 'selfreg': {
        const names = L.splitNames(val('selfname')).slice(0, 1);
        if (!names.length) return toast('イニシャルを入力してください');
        const join = document.getElementById('selfjoin').checked;
        return mutate(x => { L.addRoster(x, names); if (join) L.addPlayers(x, names); }).then(() => toast(`${names[0]} を登録しました`));
      }
      case 'addnames': {
        const names = L.splitNames(val('addnames')); if (!names.length) return toast('名前を入力してください');
        const reg = document.getElementById('addroster').checked;
        return mutate(x => { L.addPlayers(x, names); if (reg) L.addRoster(x, names); });
      }
      case 'sel': app.sel.has(id) ? app.sel.delete(id) : app.sel.add(id); return render();
      case 'selall': {
        const inS = new Set(d.players.filter(p => p.status !== 'left').map(p => p.name));
        d.roster.filter(r => !inS.has(r.name)).forEach(r => app.sel.add(r.id)); return render();
      }
      case 'addsel': {
        const names = d.roster.filter(r => app.sel.has(r.id)).map(r => r.name);
        if (!names.length) return toast('名簿から選んでください');
        app.sel.clear(); return mutate(x => L.addPlayers(x, names));
      }
      case 'draw': return mutate(x => L.draw(x));
      case 'newsession':
        if (confirm('参加者と対戦履歴をクリアします(名簿は残ります)。よろしいですか?')) return mutate(x => L.newSession(x));
        return;
      case 'addroster': {
        const names = L.splitNames(val('rosternames')); if (!names.length) return toast('名前を入力してください');
        return mutate(x => L.addRoster(x, names));
      }
      case 'delroster': return mutate(x => L.removeRoster(x, id));
    }
  });

  /* ---------- 起動 ---------- */
  app.showNo = lsGet('tennis_showno', '1') !== '0';
  render();
  try {
    const s = JSON.parse(lsGet('tennis_login', '') || 'null');
    if (s && s.name) login(s.name, s.pass, false);
  } catch (e) { /* ignore */ }
})();
