const base = process.env.API_BASE || "http://localhost:4177";

const merc = {
  id: `smoke_${Date.now()}`,
  class: "warrior",
  level: 12,
  base: {
    strength: 90,
    agility: 42,
    intelligence: 38,
    constitution: 77,
    willpower: 55,
    spirit: 40
  }
};

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function assert(name, pass) {
  if (!pass) throw new Error(`${name}: FAIL`);
  console.log(`${name}: PASS`);
}

(async () => {
  const health = await request("/api/health");
  assert("后端健康检查", health.ok === true);

  const uploaded = await request("/api/leaderboard", {
    method: "POST",
    body: { user: "联机自检玩家", merc, power: 1288 }
  });
  assert("英雄上传排行榜", uploaded.entry && uploaded.entry.user === "联机自检玩家");

  const board = await request("/api/leaderboard");
  const target = board.leaderboard.find((entry) => entry.id === uploaded.entry.id);
  assert("排行榜可读取上传英雄", Boolean(target));

  const arena = await request("/api/arena/challenge", {
    method: "POST",
    body: { entryId: uploaded.entry.id, attacker: merc, power: 1300 }
  });
  assert("好友切磋有结果", typeof arena.record.won === "boolean");

  const bossBefore = await request("/api/world-boss");
  const bossAttack = await request("/api/world-boss/attack", {
    method: "POST",
    body: { party: [merc] }
  });
  assert("世界 Boss 扣血", bossAttack.boss.hp < bossBefore.boss.hp || bossAttack.defeated === true);

  console.log("ONLINE_SMOKE_DONE");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
