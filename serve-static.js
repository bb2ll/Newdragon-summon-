const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const dataFile = path.join(dataDir, "server-state.json");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const classNames = {
  warrior: "战士",
  rogue: "盗贼",
  mage: "法师"
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function spreadAttrs(total, cls) {
  const main = cls === "warrior" ? "strength" : cls === "rogue" ? "agility" : "intelligence";
  const attrs = { strength: 24, agility: 24, intelligence: 24, constitution: 24, willpower: 24, spirit: 24 };
  attrs[main] = Math.max(30, total - 120);
  return attrs;
}

function npc(user, cls, level, power, total) {
  return {
    id: uid("npc"),
    user,
    merc: { id: uid("merc"), class: cls, level, base: spreadAttrs(total, cls) },
    power,
    time: Date.now() - level * 1000
  };
}

function defaultState() {
  return {
    leaderboard: [
      npc("城堡游侠 5", "mage", 6, 707, 201),
      npc("城堡游侠 4", "warrior", 5, 652, 196),
      npc("城堡游侠 3", "mage", 4, 934, 277),
      npc("城堡游侠 2", "rogue", 3, 812, 236),
      npc("城堡游侠 1", "warrior", 2, 593, 194)
    ],
    arenaHistory: [],
    trades: [],
    accounts: [],
    sessions: [],
    worldBoss: {
      name: "深渊古龙",
      level: 10,
      maxHp: 117000,
      hp: 117000,
      attack: 3900,
      participants: {},
      defeated: false,
      updatedAt: Date.now()
    }
  };
}

function loadServerState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    parsed.accounts ||= [];
    parsed.sessions ||= [];
    parsed.trades ||= [];
    parsed.arenaHistory ||= [];
    parsed.leaderboard ||= defaultState().leaderboard;
    parsed.worldBoss ||= defaultState().worldBoss;
    return parsed;
  } catch {
    const state = defaultState();
    saveServerState(state);
    return state;
  }
}

function saveServerState(state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2), "utf8");
}

let serverState = loadServerState();

function send(res, code, body, type = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Auth-Token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    ...extraHeaders
  });
  res.end(body);
}

function json(res, code, body) {
  send(res, code, JSON.stringify(body), "application/json; charset=utf-8");
}

function staticCacheHeaders(filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(16)}"`;
  const immutableTypes = new Set([".png", ".mp4"]);
  const revalidateTypes = new Set([".js", ".css"]);
  const cacheControl = immutableTypes.has(ext)
    ? "public, max-age=2592000, immutable"
    : revalidateTypes.has(ext)
      ? "public, max-age=86400, must-revalidate"
      : ext === ".html"
        ? "no-store"
        : "public, max-age=3600, must-revalidate";
  return {
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString()
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
  });
}

function totalAttr(merc) {
  return Object.values(merc.base || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function normalizeMercenary(input) {
  const merc = input && typeof input === "object" ? input : {};
  const cls = ["warrior", "rogue", "mage"].includes(merc.class) ? merc.class : "warrior";
  const base = merc.base && typeof merc.base === "object" ? merc.base : {};
  return {
    id: String(merc.id || uid("merc")),
    class: cls,
    level: Math.max(1, Math.min(99, Number(merc.level || 1))),
    quality: String(merc.quality || "normal").slice(0, 20),
    qualityName: String(merc.qualityName || "普通卡").slice(0, 20),
    base: {
      strength: Math.max(1, Number(base.strength || 1)),
      agility: Math.max(1, Number(base.agility || 1)),
      intelligence: Math.max(1, Number(base.intelligence || 1)),
      constitution: Math.max(1, Number(base.constitution || base.stamina || 1)),
      willpower: Math.max(1, Number(base.willpower || base.will || 1)),
      spirit: Math.max(1, Number(base.spirit || 1))
    }
  };
}

function upsertLeaderboard(user, merc, power) {
  const entry = {
    id: uid("board"),
    user: String(user || "本地玩家").slice(0, 20),
    merc,
    power: Math.max(1, Number(power || 1)),
    time: Date.now()
  };
  serverState.leaderboard = serverState.leaderboard
    .filter((item) => !(item.user === entry.user && item.merc.id === entry.merc.id))
    .concat(entry)
    .sort((a, b) => b.merc.level - a.merc.level || b.power - a.power)
    .slice(0, 50);
  saveServerState(serverState);
  return entry;
}

function classCounter(a, b) {
  if ((a === "warrior" && b === "rogue") || (a === "rogue" && b === "mage") || (a === "mage" && b === "warrior")) return 1.15;
  return 1;
}

function resolveArena(attacker, defenderEntry) {
  const attackerPower = Number(attacker.power || 1) * classCounter(attacker.merc.class, defenderEntry.merc.class);
  const defenderPower = Number(defenderEntry.power || 1);
  const chance = Math.max(0.08, Math.min(0.92, attackerPower / (attackerPower + defenderPower)));
  const won = Math.random() < chance;
  const record = {
    id: uid("arena"),
    time: Date.now(),
    attacker: `${classNames[attacker.merc.class]} LV.${attacker.merc.level}`,
    defender: `${defenderEntry.user} 的 ${classNames[defenderEntry.merc.class]} LV.${defenderEntry.merc.level}`,
    won,
    chance
  };
  serverState.arenaHistory.push(record);
  serverState.arenaHistory = serverState.arenaHistory.slice(-100);
  if (won) {
    defenderEntry.user = String(attacker.user || "本地玩家").slice(0, 20);
    defenderEntry.merc = normalizeMercenary(attacker.merc);
    defenderEntry.power = Math.max(1, Number(attacker.power || totalAttr(attacker.merc)));
    defenderEntry.time = Date.now();
  }
  serverState.leaderboard = serverState.leaderboard
    .sort((a, b) => b.merc.level - a.merc.level || b.power - a.power)
    .slice(0, 50);
  saveServerState(serverState);
  return record;
}

function attackWorldBoss(party) {
  if (serverState.worldBoss.defeated || serverState.worldBoss.hp <= 0) {
    serverState.worldBoss.hp = serverState.worldBoss.maxHp;
    serverState.worldBoss.defeated = false;
    serverState.worldBoss.participants = {};
  }
  const members = Array.isArray(party) ? party.slice(0, 50).map(normalizeMercenary) : [];
  const power = members.reduce((sum, merc) => sum + totalAttr(merc) * (1 + merc.level * 0.14), 0);
  const damage = Math.max(1, Math.round(power * (0.75 + Math.random() * 0.35)));
  serverState.worldBoss.hp = Math.max(0, serverState.worldBoss.hp - damage);
  serverState.worldBoss.defeated = serverState.worldBoss.hp <= 0;
  serverState.worldBoss.updatedAt = Date.now();
  members.forEach((merc) => {
    const key = merc.id;
    serverState.worldBoss.participants[key] = (serverState.worldBoss.participants[key] || 0) + damage / Math.max(1, members.length);
  });
  saveServerState(serverState);
  return {
    boss: serverState.worldBoss,
    damage,
    defeated: serverState.worldBoss.defeated,
    rewardGold: serverState.worldBoss.defeated ? 100000 + members.length * 5000 : Math.round(damage * 0.6),
    rewardPrimary: serverState.worldBoss.defeated ? 100 + members.length * 10 : 0
  };
}

function listTrades(searchParams) {
  const classFilter = searchParams.get("class") || "all";
  const minLevel = Math.max(1, Number(searchParams.get("minLevel") || 1));
  const attribute = ["strength", "agility", "intelligence", "constitution", "willpower", "spirit"].includes(searchParams.get("attribute")) ? searchParams.get("attribute") : "strength";
  const minAttribute = Math.max(0, Number(searchParams.get("minAttribute") || 0));
  return (serverState.trades || [])
    .filter((trade) => trade.status === "listed" && (classFilter === "all" || trade.merc.class === classFilter) && trade.merc.level >= minLevel && Number(trade.merc.base[attribute] || 0) >= minAttribute)
    .sort((a, b) => b.merc.level - a.merc.level || b.power - a.power || a.price - b.price);
}

function createTrade(body) {
  const merc = normalizeMercenary(body.merc);
  const trade = {
    id: uid("trade"),
    seller: String(body.seller || "匿名玩家").slice(0, 20),
    merc,
    power: Math.max(1, Number(body.power || totalAttr(merc))),
    price: Math.max(1, Math.floor(Number(body.price || 0))),
    status: "listed",
    listedAt: Date.now()
  };
  serverState.trades ||= [];
  serverState.trades = serverState.trades.filter((item) => !(item.seller === trade.seller && item.merc.id === trade.merc.id && item.status === "listed"));
  serverState.trades.unshift(trade);
  serverState.trades = serverState.trades.slice(0, 200);
  saveServerState(serverState);
  return trade;
}

function buyTrade(id, buyer) {
  const trade = (serverState.trades || []).find((item) => item.id === id && item.status === "listed");
  if (!trade) return null;
  if (trade.seller === buyer) throw new Error("不能购买自己上架的英雄");
  trade.status = "sold";
  trade.buyer = String(buyer || "匿名玩家").slice(0, 20);
  trade.soldAt = Date.now();
  saveServerState(serverState);
  return trade;
}

function sanitizeCredentials(body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username) throw new Error("用户名不能为空");
  if (!password) throw new Error("密码不能为空");
  return { username: username.slice(0, 60), password };
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  serverState.sessions = (serverState.sessions || []).filter((session) => session.username !== username).concat({ token, username, createdAt: Date.now() }).slice(-200);
  saveServerState(serverState);
  return token;
}

function publicAuthPayload(account, token) {
  return {
    ok: true,
    token,
    username: account.username,
    giftPending: Boolean(account.giftPending),
    state: account.state || null
  };
}

function registerAccount(body) {
  const { username, password } = sanitizeCredentials(body);
  if ((serverState.accounts || []).some((account) => account.username === username)) throw new Error("该用户名已存在");
  const account = {
    username,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    giftPending: true,
    state: null
  };
  serverState.accounts.push(account);
  const token = createSession(username);
  saveServerState(serverState);
  return publicAuthPayload(account, token);
}

function loginAccount(body) {
  const { username, password } = sanitizeCredentials(body);
  const account = (serverState.accounts || []).find((item) => item.username === username);
  if (!account || account.passwordHash !== hashPassword(password)) throw new Error("用户名或密码错误");
  account.updatedAt = Date.now();
  const token = createSession(username);
  saveServerState(serverState);
  return publicAuthPayload(account, token);
}

function requireSession(req) {
  const token = String(req.headers["x-auth-token"] || "");
  if (!token) throw new Error("请先登录");
  const session = (serverState.sessions || []).find((item) => item.token === token);
  if (!session) throw new Error("登录状态已失效");
  const account = (serverState.accounts || []).find((item) => item.username === session.username);
  if (!account) throw new Error("账号不存在");
  return { token, session, account };
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return json(res, 200, { ok: true, online: Math.max(12, (serverState.sessions || []).length), message: "后端已启动" });
    }

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(req);
      return json(res, 200, registerAccount(body));
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      return json(res, 200, loginAccount(body));
    }

    if (req.method === "GET" && pathname === "/api/auth/session") {
      const { account, token } = requireSession(req);
      return json(res, 200, publicAuthPayload(account, token));
    }

    if (req.method === "GET" && pathname === "/api/account/state") {
      const { account } = requireSession(req);
      return json(res, 200, { ok: true, state: account.state || null, giftPending: Boolean(account.giftPending) });
    }

    if (req.method === "POST" && pathname === "/api/account/state") {
      const { account } = requireSession(req);
      const body = await readBody(req);
      account.state = body.state && typeof body.state === "object" ? body.state : null;
      account.giftPending = false;
      account.updatedAt = Date.now();
      saveServerState(serverState);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/leaderboard") {
      return json(res, 200, { leaderboard: serverState.leaderboard, arenaHistory: serverState.arenaHistory.slice(-20) });
    }

    if (req.method === "POST" && pathname === "/api/leaderboard") {
      const body = await readBody(req);
      const merc = normalizeMercenary(body.merc);
      const entry = upsertLeaderboard(body.user, merc, body.power);
      return json(res, 200, { entry, leaderboard: serverState.leaderboard });
    }

    if (req.method === "POST" && pathname === "/api/arena/challenge") {
      const body = await readBody(req);
      const defender = serverState.leaderboard.find((entry) => entry.id === body.entryId);
      if (!defender) return json(res, 404, { error: "找不到挑战目标" });
      const attackerMerc = normalizeMercenary(body.attacker);
      const record = resolveArena(
        { user: String(body.user || "本地玩家"), merc: attackerMerc, power: Number(body.power || totalAttr(attackerMerc)) },
        defender
      );
      return json(res, 200, { record, arenaHistory: serverState.arenaHistory.slice(-20), leaderboard: serverState.leaderboard });
    }

    if (req.method === "GET" && pathname === "/api/trades") {
      const query = new URL(req.url, "http://localhost").searchParams;
      return json(res, 200, { trades: listTrades(query) });
    }

    if (req.method === "POST" && pathname === "/api/trades") {
      const body = await readBody(req);
      return json(res, 201, { trade: createTrade(body) });
    }

    const buyMatch = pathname.match(/^\/api\/trades\/([^/]+)\/buy$/);
    if (req.method === "POST" && buyMatch) {
      const body = await readBody(req);
      const trade = buyTrade(buyMatch[1], String(body.buyer || "匿名玩家"));
      if (!trade) return json(res, 404, { error: "该交易已结束" });
      return json(res, 200, { trade });
    }

    if (req.method === "GET" && pathname === "/api/world-boss") {
      return json(res, 200, { boss: serverState.worldBoss });
    }

    if (req.method === "POST" && pathname === "/api/world-boss/attack") {
      const body = await readBody(req);
      return json(res, 200, attackWorldBoss(body.party));
    }

    return json(res, 404, { error: "接口不存在" });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

function serveFile(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, safePath));
  if (!filePath.startsWith(root)) return send(res, 403, "Forbidden");
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) return send(res, 404, "Not found");
    const headers = staticCacheHeaders(filePath, stat);
    if (req.headers["if-none-match"] === headers.ETag) {
      return send(res, 304, "", mime[path.extname(filePath).toLowerCase()] || "application/octet-stream", headers);
    }
    fs.readFile(filePath, (err, data) => {
      if (err) return send(res, 404, "Not found");
      send(res, 200, data, mime[path.extname(filePath).toLowerCase()] || "application/octet-stream", headers);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);
  return serveFile(req, res, pathname);
});

server.listen(port, host, () => {
  console.log(`Dungeon Mercenary running at http://localhost:${port}`);
  console.log(`API health: http://localhost:${port}/api/health`);
  console.log(`Data directory: ${dataDir}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
