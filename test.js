const L = require('./logic.js');

function run(n, rounds) {
  const d = L.emptyData();
  L.addPlayers(d, Array.from({ length: n }, (_, i) => 'P' + (i + 1)));
  L.startPlan(d, 3);
  let maxRest = 0, maxPlay = 0;
  for (let i = 0; i < rounds; i++) {
    L.finishRound(d);
    for (const p of d.players) {
      maxRest = Math.max(maxRest, L.restStreak(L.doneRounds(d), p.id));
      maxPlay = Math.max(maxPlay, L.playStreak(L.doneRounds(d), p.id));
    }
  }
  const st = L.computeStats(d.players, L.doneRounds(d));
  const plays = Object.values(st.plays);
  const pc = Object.values(st.partner);
  console.log(`N=${n} rounds=${rounds} plays min/max=${Math.min(...plays)}/${Math.max(...plays)} maxRestStreak=${maxRest} maxPlayStreak=${maxPlay} partner count min/max=${Math.min(...pc)}/${Math.max(...pc)}`);
}
[4, 5, 6, 7, 8, 9, 10, 12].forEach(n => run(n, 30));

// 途中参加・休憩・離脱
const d = L.emptyData();
L.addPlayers(d, ['A', 'B', 'C', 'D', 'E', 'F']);
L.startPlan(d, 3);
for (let i = 0; i < 6; i++) L.finishRound(d);
L.addPlayers(d, ['G']);                 // 途中参加
const a = d.players.find(p => p.name === 'A');
L.setStatus(d, a.id, 'rest');           // 休憩
for (let i = 0; i < 4; i++) L.finishRound(d);
L.setStatus(d, a.id, 'active');         // 復帰
L.setStatus(d, d.players.find(p => p.name === 'B').id, 'left'); // 離脱
for (let i = 0; i < 4; i++) L.finishRound(d);
const st = L.computeStats(d.players, L.doneRounds(d));
for (const p of d.players) console.log(p.name, p.status, 'plays', st.plays[p.id], 'base', p.base, 'eff', L.effPlays(p, st));
const gr = d.rounds.filter(r => !r.done);
console.log('planned', gr.length, gr.every(r => ![...r.a, ...r.b].includes(d.players.find(p => p.name === 'B').id)) ? 'B excluded OK' : 'B INCLUDED BUG');
// 4人未満
L.setStatus(d, d.players.find(p => p.name === 'C').id, 'left');
L.setStatus(d, d.players.find(p => p.name === 'D').id, 'left');
L.setStatus(d, d.players.find(p => p.name === 'E').id, 'left');
console.log('active', L.activePlayers(d).length, 'planned', d.rounds.filter(r => !r.done).length);
L.draw(d);
console.log('numbers', d.players.map(p => p.name + ':' + p.no).join(' '));
