const { classes, attrLabels, qualityTable, workTypes, levelMultipliers, upgradeTable, dungeons, floorTiers, floorFactor, dragon, nav } = window.GameData;

const STORAGE_KEY = "dungeon_mercenary_unified_state";
const AUTH_KEY = "dungeon_mercenary_unified_auth";
const API_BASE = window.location.protocol === "file:" ? "http://localhost:4177" : window.location.origin;
const attrs = Object.keys(attrLabels);
const workCosts = { start: 80, stop: 5 };

let auth = loadAuth();
let authMode = "login";
let authMessage = "";
let authMessageType = "";
let authBusy = false;
let pendingSaveTimer = null;
let pendingSaveNonce = 0;
let state = loadState();
let summonGatePending = false;
let activeBattle = null;
let battleSettlementOpen = false;
let upgradeSequenceActive = false;
let upgradeResultOpen = false;
applyDebugRoute();

function loadAuth() {
  const saved = localStorage.getItem(AUTH_KEY);
  if (!saved) return { token: "", username: "" };
  try {
    const parsed = JSON.parse(saved);
    return { token: String(parsed.token || ""), username: String(parsed.username || "") };
  } catch {
    localStorage.removeItem(AUTH_KEY);
    return { token: "", username: "" };
  }
}

function storageKey(username = auth.username) {
  return `${STORAGE_KEY}_${String(username || "guest").toLowerCase()}`;
}

function loadState() {
  const saved = localStorage.getItem(storageKey());
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      parsed.lastTick = Date.now();
      return parsed;
    } catch {
      localStorage.removeItem(storageKey());
    }
  }
  return seedState();
}

function applyDebugRoute() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view && nav.some((item) => item.id === view)) {
    state.currentView = view;
  }
}

function seedState() {
  const initial = {
    primary: 1000,
    gold: 5000,
    currentView: "home",
    filters: { class: "all", status: "all", sort: "power" },
    workFilters: { class: "all", attribute: "all", minimum: 0, sort: "recommended" },
    selectedMercenaryId: null,
    selectedDungeon: "easy",
    selectedFloor: 1,
    selectedDragonIds: [],
    selectedTradeMercenaryId: null,
    tradeFilters: { class: "all", minLevel: 1, attribute: "strength", minAttribute: 0 },
    battleLog: ["等待选择佣兵与楼层。"],
    battleHistory: [],
    upgradeHistory: [],
    dragonLog: ["深渊古龙尚未开战。"],
    leaderboard: [],
    arenaHistory: [],
    worldBoss: null,
    worldBossQueue: [],
    sparring: { defenders: [], history: [], nextCycleAt: Date.now() + 86400000 },
    mailbox: [],
    online: false,
    dailyRecruitCount: 0,
    lastRecruitDate: new Date().toDateString(),
    dungeonDensity: { easy: 1, medium: 1, hard: 1 },
    dungeonRuns: { easy: 0, medium: 0, hard: 0 },
    densityNextRefreshAt: Date.now() + (45 + rand(0, 30)) * 60000,
    unlocked: { easy: 1, medium: 0, hard: 0 },
    settings: { sound: true, music: false, notifications: true, autosave: true },
    lastTick: Date.now(),
    mercenaries: []
  };
  initial.mercenaries.push(generateMercenary("warrior"));
  initial.mercenaries.push(generateMercenary("rogue"));
  initial.mercenaries.push(generateMercenary("mage"));
  initial.leaderboard = makeNpcLeaderboard();
  return initial;
}

function isLoggedIn() {
  return Boolean(auth.token && auth.username);
}

function setAuth(nextAuth) {
  auth = { token: String(nextAuth?.token || ""), username: String(nextAuth?.username || "") };
  if (auth.token) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}

function currentUserName() {
  return auth.username || "本地玩家";
}

function createGiftMercenary() {
  const merc = generateMercenary();
  merc.level = 9;
  merc.quality = "gift";
  merc.qualityName = "赠礼卡";
  attrs.forEach((attr) => {
    merc.base[attr] = clamp(merc.base[attr] + rand(8, 24), 28, 100);
  });
  return merc;
}

function buildNewAccountState() {
  const initial = seedState();
  initial.primary += 12;
  initial.gold += 180000;
  initial.mercenaries.unshift(createGiftMercenary());
  initial.selectedMercenaryId = initial.mercenaries[0]?.id || null;
  initial.battleLog = ["新账号注册完成，系统已发放一张 9 级随机赠礼卡。"];
  initial.dragonLog = ["?????????"];
  return initial;
}

function hydrateIncomingState(nextState) {
  state = nextState && typeof nextState === "object" ? nextState : seedState();
  state.lastTick = Date.now();
  applyDebugRoute();
}

function setSaveStateLabel(text) {
  const saveEl = document.querySelector("#saveState");
  if (saveEl) saveEl.textContent = text;
}

function scheduleCloudSave() {
  if (!auth.token) return;
  pendingSaveNonce += 1;
  const nonce = pendingSaveNonce;
  clearTimeout(pendingSaveTimer);
  setSaveStateLabel("同步中");
  pendingSaveTimer = setTimeout(async () => {
    const result = await apiRequest("/api/account/state", { method: "POST", body: { state }, quiet: true });
    if (nonce !== pendingSaveNonce) return;
    setSaveStateLabel(result?.ok ? "已同步" : "同步失败");
  }, 320);
}

function saveState() {
  if (!isLoggedIn()) return;
  state.lastTick = Date.now();
  localStorage.setItem(storageKey(), JSON.stringify(state));
  setSaveStateLabel("已保存");
  scheduleCloudSave();
}

function normalizeState() {
  state.leaderboard ||= makeNpcLeaderboard();
  state.arenaHistory ||= [];
  state.selectedDragonIds ||= [];
  state.worldBoss ||= null;
  state.worldBossQueue ||= [];
  state.sparring ||= { defenders: [], history: [], nextCycleAt: Date.now() + 86400000 };
  state.mailbox ||= [];
  state.online ||= false;
  state.workFilters ||= { class: "all", attribute: "all", minimum: 0, sort: "recommended" };
  state.battleHistory ||= [];
  state.upgradeHistory ||= [];
  state.tradeFilters ||= { class: "all", minLevel: 1, attribute: "strength", minAttribute: 0 };
  state.selectedTradeMercenaryId ||= null;
  state.dungeonDensity ||= { easy: 1, medium: 1, hard: 1 };
  state.dungeonRuns ||= { easy: 0, medium: 0, hard: 0 };
  state.densityNextRefreshAt ||= Date.now() + (45 + rand(0, 30)) * 60000;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function gaussian(mean = 230, stdev = 50) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rollQuality(random = Math.random()) {
  let cursor = 0;
  for (const quality of qualityTable) {
    cursor += quality.rate;
    if (random < cursor) return quality;
  }
  return qualityTable[qualityTable.length - 1];
}

function rebalanceAttributes(base, targetTotal, lockedKey) {
  let difference = targetTotal - attrs.reduce((sum, attr) => sum + base[attr], 0);
  const combatAttrs = ["strength", "agility", "intelligence"];
  const adjustable = attrs
    .filter((attr) => attr !== lockedKey)
    .sort((a, b) => Number(combatAttrs.includes(a)) - Number(combatAttrs.includes(b)));
  for (let pass = 0; pass < 4 && difference !== 0; pass += 1) {
    for (const attr of adjustable) {
      if (difference === 0) break;
      if (difference > 0) {
        const ceiling = combatAttrs.includes(attr) ? base[lockedKey] : 100;
        const increase = Math.min(difference, ceiling - base[attr]);
        base[attr] += increase;
        difference -= increase;
      } else {
        const decrease = Math.min(-difference, base[attr] - 20);
        base[attr] -= decrease;
        difference += decrease;
      }
    }
  }
  return base;
}

function generateMercenary(preferredClass) {
  const classKeys = Object.keys(classes);
  let cls = preferredClass || classKeys[rand(0, classKeys.length - 1)];
  const quality = rollQuality();
  const totalPool = rand(quality.total[0], quality.total[1]);
  const config = classes[cls];
  const base = {};
  let used = 0;
  attrs.forEach((attr, index) => {
    const jitter = 0.85 + Math.random() * 0.3;
    const value = index === attrs.length - 1 ? totalPool - used : Math.round(totalPool * config.weights[attr] * jitter);
    base[attr] = clamp(value, 20, 100);
    used += base[attr];
  });
  cls = decideClass(base);
  const mainKey = classes[cls].main;
  base[mainKey] = clamp(Math.max(base[mainKey], rand(quality.main[0], quality.main[1])), quality.main[0], quality.main[1]);
  ["strength", "agility", "intelligence"].forEach((attr) => {
    if (attr !== mainKey) base[attr] = Math.min(base[attr], base[mainKey]);
  });
  rebalanceAttributes(base, totalPool, mainKey);
  return {
    id: uid("merc"),
    class: cls,
    level: 1,
    status: "idle",
    base,
    quality: quality.key,
    qualityName: quality.name,
    createdAt: Date.now(),
    workStartTime: null,
    workType: null,
    lastClaimTime: null,
    todayBattles: 0,
    battleDate: new Date().toDateString(),
    uploaded: false
  };
}

function decideClass(base) {
  if (base.strength >= base.agility && base.strength >= base.intelligence) return "warrior";
  if (base.agility >= base.intelligence) return "rogue";
  return "mage";
}

function className(cls) {
  return classes[cls]?.name || cls;
}

function totalAttr(merc) {
  return attrs.reduce((sum, key) => sum + attrValue(merc, key), 0);
}

function mainAttr(merc) {
  return attrValue(merc, classes[merc.class].main);
}

function attrValue(merc, key) {
  const aliases = { constitution: "stamina", willpower: "will" };
  return Number(merc.base[key] ?? merc.base[aliases[key]] ?? 0);
}

function battlePower(merc) {
  return Math.floor(mainAttr(merc) * 5 + totalAttr(merc) * 2 + merc.level * 10);
}

function qualityName(merc) {
  return merc.qualityName || qualityTable.find((quality) => quality.key === merc.quality)?.name || "普通卡";
}

function qualityColor(merc) {
  return qualityTable.find((quality) => quality.key === merc.quality)?.color || "#55c271";
}

function getHero(merc, mode = "idle") {
  return classes[merc.class][mode];
}

function battleStage(heroClass, enemyName, caption = "自动战斗", heroAction = "idle", enemyAction = "idle") {
  const monsterMap = { "骸骨守卫": "skeleton", "洞穴蜘蛛": "spider", "地穴蠕虫": "worm", "诅咒法师": "curse", "腐化骑士": "knight", "宝箱怪": "mimic", "石像魔": "gargoyle", "深渊眼魔": "eye" };
  const opponentHero = Boolean(classes[enemyName]);
  const enemyClass = opponentHero ? `hero ${enemyName}` : enemyName === "深渊古龙" ? "dragon" : `monster ${monsterMap[enemyName] || "skeleton"}`;
  const enemyLabel = opponentHero ? className(enemyName) : enemyName;
  return `<div class="battle-stage"><div class="battle-fighter hero ${heroClass} ${heroAction}"><span>${className(heroClass)}</span></div><div class="battle-caption">${caption}</div><div class="battle-fighter ${enemyClass} ${enemyAction}"><span>${enemyLabel}</span></div></div>`;
}

function availableWork(merc) {
  const result = [{ key: "odd", ...workTypes.odd }];
  const config = classes[merc.class];
  const advancedKey = classWorkKey(merc);
  const classWork = workTypes[advancedKey];
  if (attrValue(merc, config.main) >= classWork.mainMin && attrValue(merc, config.sub) >= classWork.subMin) {
    result.push({ key: advancedKey, ...classWork });
  }
  if (totalAttr(merc) >= workTypes.abyss.totalMin) result.push({ key: "abyss", ...workTypes.abyss });
  return result;
}

function bestWork(merc) {
  const works = availableWork(merc);
  return works.find((w) => w.key === "abyss") || works[works.length - 1] || works[0];
}

function workCycleEarning(merc, workKey = merc.workType) {
  const config = classes[merc.class];
  const w = workTypes[workKey] || workTypes.odd;
  let base = w.base || 0.01;
  if (workKey === "patrol" || workKey === "infiltrate" || workKey === "archive") {
    base = 0.01 + (attrValue(merc, config.main) - 85) * 0.005;
  }
  if (workKey === "abyss") {
    base = 0.07 + (totalAttr(merc) - 401) * 0.0025;
  }
  return Math.max(0.01, base) * levelMultipliers[merc.level];
}

function hourlyEarning(merc) {
  return workCycleEarning(merc, bestWork(merc).key) * 120;
}

function idealHourlyEarning(merc) {
  const key = classWorkKey(merc);
  return workCycleEarning(merc, key) * 120;
}

function pendingEarning(merc) {
  if (merc.status !== "working" || !merc.workStartTime) return 0;
  const cycles = Math.floor((Date.now() - merc.workStartTime) / 30000);
  return Math.floor(workCycleEarning(merc, merc.workType) * adjustedWorkCycles(cycles) * 1000) / 1000;
}

function adjustedWorkCycles(cycles) {
  const dayCycles = 2880;
  const segments = [
    { end: 15 * dayCycles, rate: 1 },
    { end: 30 * dayCycles, rate: 0.8 },
    { end: 60 * dayCycles, rate: 0.4 },
    { end: Infinity, rate: 0.1 }
  ];
  let remaining = cycles;
  let start = 0;
  let adjustedCycles = 0;
  for (const segment of segments) {
    const count = Math.max(0, Math.min(remaining, segment.end - start));
    adjustedCycles += count * segment.rate;
    remaining -= count;
    start = segment.end;
    if (remaining <= 0) break;
  }
  return adjustedCycles;
}

function workDecayRate(merc) {
  if (!merc.workStartTime) return 1;
  const days = (Date.now() - merc.workStartTime) / 86400000;
  if (days >= 60) return 0.1;
  if (days >= 30) return 0.4;
  if (days >= 15) return 0.8;
  return 1;
}

function formatWorkDuration(startTime) {
  if (!startTime) return "0分钟";
  const seconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return `${Math.floor(seconds / 60)}分钟`;
  const days = Math.floor(hours / 24);
  return days ? `${days}天${hours % 24}小时` : `${hours}小时`;
}

function decayStatus(merc) {
  const rate = workDecayRate(merc);
  return rate === 1 ? "正常收益" : `收益 ${Math.round(rate * 100)}%`;
}

function maxDailyBattles(merc) {
  return merc.level >= 4 ? merc.level : 3;
}

function remainingDailyBattles(merc) {
  return Math.max(0, maxDailyBattles(merc) - Number(merc.todayBattles || 0));
}

function gaussianNumber(mean, stdev) {
  return gaussian(mean, stdev);
}

function densityLabel(value) {
  if (value >= 1.45) return "极度富饶";
  if (value >= 1.2) return "富饶";
  if (value >= 0.9) return "普通";
  if (value >= 0.7) return "偏贫瘠";
  return "贫瘠";
}

function refreshDungeonDensity(force = false) {
  const now = Date.now();
  if (!force && now < state.densityNextRefreshAt) return;
  const working = state.mercenaries.filter((m) => m.status === "working").length;
  const total = Math.max(1, state.mercenaries.length);
  const workFactor = working / total;
  ["easy", "medium", "hard"].forEach((difficulty) => {
    const recentRuns = Number(state.dungeonRuns[difficulty] || 0);
    const base = 0.92 + workFactor * 0.24 - Math.min(0.18, recentRuns * 0.015);
    const rolled = gaussianNumber(base, 0.12);
    state.dungeonDensity[difficulty] = clamp(Math.round(rolled * 100) / 100, 0.55, 1.65);
  });
  state.densityNextRefreshAt = now + (45 + rand(0, 30)) * 60000;
}

function primaryDropChance(difficulty, density) {
  const base = { easy: 0.18, medium: 0.26, hard: 0.34 }[difficulty] || 0.2;
  return clamp(base * (0.92 + density * 0.18), 0.12, 0.5);
}

function rollPrimaryDrop(difficulty, density) {
  if (Math.random() > primaryDropChance(difficulty, density)) return 0;
  let amount = clamp(Math.round(gaussianNumber(0.38, 0.1) * density * 1000) / 1000, 0.05, 0.8);
  if (difficulty === "medium") amount = clamp(Math.round(gaussianNumber(0.48, 0.12) * density * 1000) / 1000, 0.08, 1.2);
  if (difficulty === "hard") amount = clamp(Math.round(gaussianNumber(0.62, 0.15) * density * 1000) / 1000, 0.12, 1.6);
  const jackpotRoll = Math.random();
  if (jackpotRoll > 0.9985) return 3.2;
  if (jackpotRoll > 0.994) return 1.5;
  if (jackpotRoll > 0.982) return 0.8;
  return amount;
}

function rollGoldDrop(difficulty, floor, density) {
  const meanByDifficulty = { easy: 260, medium: 520, hard: 980 };
  const stdevByDifficulty = { easy: 90, medium: 160, hard: 280 };
  const floorBonus = 1 + (floor - 1) * 0.18;
  let amount = gaussianNumber((meanByDifficulty[difficulty] || 260) * floorBonus * density, stdevByDifficulty[difficulty] || 90);
  if (Math.random() > 0.992) amount *= 2.2;
  return Math.max(80, Math.round(amount));
}

function rollMonsterCount(floor = 1) {
  const weighted = [
    { count: 1, weight: 14 },
    { count: 2, weight: 24 },
    { count: 3, weight: 21 },
    { count: 4, weight: 15 },
    { count: 5, weight: 10 },
    { count: 6, weight: 7 },
    { count: 7, weight: 5 },
    { count: 8, weight: 4 }
  ];
  let cursor = Math.random() * weighted.reduce((sum, item) => sum + item.weight, 0);
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return Math.min(8, item.count + (floor >= 4 && Math.random() > 0.84 ? 1 : 0));
  }
  return 2;
}

function rollDungeonEnemyRoster(dungeon, floor, difficulty) {
  const count = rollMonsterCount(floor);
  const tier = floorTiers[floor];
  const pool = dungeon.monsters.filter((monster) => (monster.unlockFloor || 1) <= floor);
  return Array.from({ length: count }, (_, index) => {
    const monster = pool[rand(0, pool.length - 1)];
    const progress = floor <= 1 ? 0 : Math.min(1, (floor - 1 + index / Math.max(1, count - 1)) / 4);
    const level = clamp(Math.round(dungeon.enemyLevel[0] + (dungeon.enemyLevel[1] - dungeon.enemyLevel[0]) * progress + gaussianNumber(0, 0.35)), dungeon.enemyLevel[0], dungeon.enemyLevel[1]);
    return { data: monster, level, vitals: enemyVitals(level, tier, difficulty, monster) };
  });
}

function classWorkKey(merc) {
  return merc.class === "warrior" ? "patrol" : merc.class === "rogue" ? "infiltrate" : "archive";
}

function resetDailyCounters() {
  const today = new Date().toDateString();
  if (state.lastRecruitDate !== today) {
    state.lastRecruitDate = today;
    state.dailyRecruitCount = 0;
  }
  state.mercenaries.forEach((m) => {
    if (m.battleDate !== today) {
      m.battleDate = today;
      m.todayBattles = 0;
    }
  });
}

function workQualificationHint(merc) {
  const key = classWorkKey(merc);
  const work = workTypes[key];
  const config = classes[merc.class];
  const main = attrValue(merc, config.main);
  const sub = attrValue(merc, config.sub);
  if (totalAttr(merc) >= workTypes.abyss.totalMin) return "已达到深渊领域资格。";
  if (main >= work.mainMin && sub >= work.subMin) return `已满足${work.name}条件。`;
  const lacking = [];
  if (main < work.mainMin) lacking.push(`${attrLabels[config.main]}差 ${work.mainMin - main}`);
  if (sub < work.subMin) lacking.push(`${attrLabels[config.sub]}差 ${work.subMin - sub}`);
  return `距离${work.name}还差：${lacking.join("，")}。`;
}

function makeNpcLeaderboard() {
  return ["warrior", "rogue", "mage", "warrior", "mage"].map((cls, index) => {
    const merc = generateMercenary(cls);
    merc.level = 2 + index;
    return {
      id: uid("npc"),
      user: `城堡访客${index + 1}`,
      merc,
      power: battlePower(merc),
      time: Date.now() - index * 800000
    };
  });
}

function format(n, digits = 0) {
  return Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatPrimary(n) {
  return format(n, 3);
}

function moneyEnough(gold, primary = 0) {
  return state.gold >= gold && state.primary >= primary;
}

function spend(gold, primary = 0) {
  if (!moneyEnough(gold, primary)) return false;
  state.gold -= gold;
  state.primary -= primary;
  return true;
}

function addToast(message) {
  const region = document.querySelector("#toastRegion");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function html(strings, ...values) {
  return strings.map((s, i) => s + (values[i] ?? "")).join("");
}

function button(label, action, variant = "", disabled = false) {
  return `<button class="game-button ${variant}" data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function renderAuthGate() {
  const gate = document.querySelector("#authGate");
  if (!gate) return;
  if (isLoggedIn()) {
    gate.innerHTML = "";
    return;
  }
  gate.innerHTML = html`
    <div class="auth-shell">
      <section class="auth-hero">
        <span class="auth-mark">D</span>
        <div>
          <h2>登录你的佣兵团账号</h2>
          <p>注册后会立刻得到一张 9 级随机英雄卡。之后你的进度会跟着账号走，不再只留在当前浏览器。</p>
        </div>
        <div class="auth-feature-grid">
          <div class="auth-feature"><strong>新号赠礼</strong><span>自动发放 9 级随机职业卡，开局就能直接上阵。</span></div>
          <div class="auth-feature"><strong>账号分存档</strong><span>不同账号互不影响，联机测试时也更清楚。</span></div>
          <div class="auth-feature"><strong>迷宫继续打</strong><span>登录后原有玩法不变，直接进入酒馆继续经营。</span></div>
          <div class="auth-feature"><strong>适合联机测试</strong><span>部署到 Docker 后，可以用不同账号分别验证上传、挑战和交易。</span></div>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-tabs">
          <button class="auth-tab ${authMode === "login" ? "active" : ""}" data-auth-tab="login">登录</button>
          <button class="auth-tab ${authMode === "register" ? "active" : ""}" data-auth-tab="register">注册</button>
        </div>
        <h3>${authMode === "login" ? "欢迎回来" : "创建新账号"}</h3>
        <p>${authMode === "login" ? "输入用户名和密码，继续你的佣兵团进度。" : "用户名和密码长度不做限制，注册成功后立刻送你一张 9 级随机卡。"}</p>
        ${authMode === "register" ? `<div class="auth-gift-note">注册奖励：1 张 9 级随机职业赠礼卡，属性随机，注册后自动入库。</div>` : ""}
        <form class="auth-form" data-auth-form="${authMode}">
          <label class="auth-field"><span>用户名</span><input name="username" autocomplete="username" required></label>
          <label class="auth-field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
          <button class="game-button success auth-submit" type="submit" ${authBusy ? "disabled" : ""}>${authBusy ? "处理中..." : authMode === "login" ? "进入游戏" : "注册并进入"}</button>
        </form>
        <div class="auth-message ${authMessageType}">${authMessage || ""}</div>
      </section>
    </div>`;
}

function updateAuthShell() {
  document.body.classList.toggle("auth-locked", !isLoggedIn());
  const accountName = document.querySelector("#accountName");
  if (accountName) accountName.textContent = auth.username || "未登录";
  const logoutButton = document.querySelector("#logoutButton");
  if (logoutButton) logoutButton.hidden = !isLoggedIn();
  renderAuthGate();
}

function render() {
  updateAuthShell();
  if (!isLoggedIn()) return;
  normalizeState();
  resetDailyCounters();
  refreshDungeonDensity();
  tickWork(false);
  document.querySelector("#primaryAmount").textContent = formatPrimary(state.primary);
  document.querySelector("#goldAmount").textContent = format(state.gold, 3);
  document.querySelector("#onlineCount").textContent = state.online ? "已联机" : "本地";
  const mailCount = document.querySelector("#mailCount");
  if (mailCount) mailCount.textContent = state.mailbox.filter((mail) => !mail.read).length;
  renderNav();
  renderHome();
  renderMercenaries();
  renderWork();
  renderDungeon();
  renderDragon();
  renderSocial();
  renderTrade();
  renderSettings();
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${state.currentView}`));
  saveState();
}

function renderNav() {
  document.querySelector("#mainNav").innerHTML = nav
    .map((item) => `<button class="nav-button ${state.currentView === item.id ? "active" : ""}" data-nav="${item.id}">${item.label}</button>`)
    .join("");
}

function renderHome() {
  const total = state.mercenaries.length;
  const idle = state.mercenaries.filter((m) => m.status === "idle").length;
  const working = state.mercenaries.filter((m) => m.status === "working").length;
  const maxPower = state.mercenaries.reduce((m, x) => Math.max(m, battlePower(x)), 0);
  document.querySelector("#view-home").innerHTML = html`
    <div class="page-title home-title">
      <div><h2>佣兵大厅</h2><p>从召唤门迎接新的伙伴，再派遣他们探索迷宫与龙巢。</p></div>
    </div>
    <div class="metric-row home-metrics">
      <div class="metric"><span>佣兵总数</span><strong>${total}</strong></div>
      <div class="metric"><span>空闲</span><strong>${idle}</strong></div>
      <div class="metric"><span>工作中</span><strong>${working}</strong></div>
      <div class="metric"><span>最高战力</span><strong>${format(maxPower)}</strong></div>
    </div>
    <button class="summon-gate" data-action="summon-gate" ${state.dailyRecruitCount >= 30 || state.primary < 1 ? "disabled" : ""}>
      <img src="./assets/backgrounds/summon_gate_home.png" alt="通往异界城堡的发光召唤门">
      <span class="summon-gate-shade"></span>
      <span class="summon-gate-copy"><small>每日 ${state.dailyRecruitCount}/30 · 每次消耗 1 B</small><strong>开启召唤门</strong></span>
    </button>
    <div class="home-folds">
      <details class="home-disclosure">
        <summary><span><img src="./assets/icons/icon_treasure_chest.png" alt="">今日行动</span><strong>招募 ${state.dailyRecruitCount}/30 · 迷宫 ${state.unlocked.easy}/5</strong></summary>
        <div class="list disclosure-body">
          <div class="row"><span>每日招募</span><strong>${state.dailyRecruitCount}/30</strong></div>
          <div class="row"><span>简单迷宫</span><strong>已解锁 ${state.unlocked.easy}/5 层</strong></div>
          <div class="row"><span>中等迷宫</span><strong>已解锁 ${state.unlocked.medium}/5 层</strong></div>
          <div class="row"><span>困难迷宫</span><strong>已解锁 ${state.unlocked.hard}/5 层</strong></div>
        </div>
      </details>
      <details class="home-disclosure">
        <summary><span><img src="./assets/icons/icon_victory_banner.png" alt="">推荐步骤</span><strong>召唤 → 工作 → 升级 → 挑战</strong></summary>
        <div class="list disclosure-body">
          <div class="row"><span>1. 招募并筛出高主属性佣兵</span><small>战士/盗贼/法师</small></div>
          <div class="row"><span>2. 派遣工作积累碎金</span><small>30 秒为 1 周期</small></div>
          <div class="row"><span>3. 用碎金升级，承担爆卡风险</span><small>LV.5 后风险明显</small></div>
          <div class="row"><span>4. 通关迷宫并挑战深渊古龙</span><small>LV.10 解锁</small></div>
        </div>
      </details>
    </div>`;
}

function renderMercenaries() {
  const list = filteredMercenaries();
  document.querySelector("#view-mercenaries").innerHTML = html`
    <div class="page-title">
      <div><h2>佣兵管理</h2><p>招募、筛选、查看详情、升级和派遣都从这里开始。召唤结果按职业展示。</p></div>
      <div>${button(`招募 (1B) ${state.dailyRecruitCount}/30`, "recruit", "success", state.dailyRecruitCount >= 30 || state.primary < 1)}</div>
    </div>
    <div class="toolbar panel">
      <div class="button-row">
        <select class="select" data-filter="class">
          ${["all", "warrior", "rogue", "mage"].map((c) => `<option value="${c}" ${state.filters.class === c ? "selected" : ""}>${c === "all" ? "全部职业" : className(c)}</option>`).join("")}
        </select>
        <select class="select" data-filter="status">
          ${["all", "idle", "working", "battling"].map((s) => `<option value="${s}" ${state.filters.status === s ? "selected" : ""}>${statusText(s)}</option>`).join("")}
        </select>
        <select class="select" data-filter="sort">
          ${["power", "level", "total", "hourly"].map((s) => `<option value="${s}" ${state.filters.sort === s ? "selected" : ""}>${sortText(s)}</option>`).join("")}
        </select>
      </div>
      ${button("重置筛选", "reset-filters")}
    </div>
    ${list.length ? `<div class="merc-grid">${list.map(mercCard).join("")}</div>` : `<div class="empty">没有符合条件的佣兵。</div>`}`;
}

function filteredMercenaries() {
  let list = [...state.mercenaries];
  if (state.filters.class !== "all") list = list.filter((m) => m.class === state.filters.class);
  if (state.filters.status !== "all") list = list.filter((m) => m.status === state.filters.status);
  const sorters = {
    power: (a, b) => battlePower(b) - battlePower(a),
    level: (a, b) => b.level - a.level,
    total: (a, b) => totalAttr(b) - totalAttr(a),
    hourly: (a, b) => hourlyEarning(b) - hourlyEarning(a)
  };
  return list.sort(sorters[state.filters.sort]);
}

function mercCard(merc, options = {}) {
  const selected = options.selectable && state.selectedMercenaryId === merc.id;
  return `<article class="merc-card merc-card-showcase ${selected ? "selected" : ""}" ${options.selectable ? `data-select-merc="${merc.id}"` : ""}>
    <div class="merc-art-frame"><img class="hero-portrait" src="${getHero(merc)}" alt="${className(merc.class)}"></div>
    <div class="merc-showcase-info">
      <div class="merc-showcase-heading"><h3 class="class-title ${merc.class}">${className(merc.class)}</h3><span class="level-plate">LV.${merc.level}</span></div>
      <div class="merc-showcase-badges"><span class="quality-badge" style="--quality:${qualityColor(merc)}">${qualityName(merc)}</span><span class="status-badge">${statusText(merc.status)}</span></div>
      <div class="merc-showcase-metrics"><span>战力 <b>${format(battlePower(merc))}</b></span><span>总属性 <b>${totalAttr(merc)}</b></span></div>
      <div class="stat-list merc-showcase-stats">${attrs.map((a) => `<div class="stat-line"><span>${attrLabels[a]}</span><strong>${merc.base[a]}</strong></div>`).join("")}</div>
      <div class="button-row merc-action-row">
        ${button("详情", `detail:${merc.id}`)}
        ${button("升级", `upgrade:${merc.id}`, "success", merc.status !== "idle" || merc.level >= 12)}
        ${button("派遣", `prepare-start-work:${merc.id}`, "success", merc.status !== "idle")}
      </div>
    </div>
  </article>`;
}

function renderWork() {
  const working = state.mercenaries.filter((m) => m.status === "working");
  const idle = filteredIdleWorkers();
  const totalPending = working.reduce((s, m) => s + pendingEarning(m), 0);
  const sampleStats = [85, 90, 95, 100];
  const sampleLevels = [1, 5, 9, 12];
  document.querySelector("#view-work").innerHTML = html`
    <div class="page-title">
      <div><h2>工作派遣</h2><p>安排空闲佣兵持续赚取碎金。工作期间佣兵不能出战或升级。</p></div>
      <div class="button-row">${button(`一键领取 ${format(totalPending, 3)}G`, "claim-all", "success", totalPending <= 0)}${button(`一键派遣 ${idle.length}人`, "prepare-dispatch-filtered", "success", idle.length === 0)}</div>
    </div>
    <div class="work-summary">
      <div><span>工作中</span><strong>${working.length}</strong></div>
      <div><span>符合筛选的空闲佣兵</span><strong>${idle.length}</strong></div>
      <div><span>待领取</span><strong>${format(totalPending, 3)} G</strong></div>
      <div><span>结算周期</span><strong>30 秒</strong></div>
    </div>
    <div class="work-rules panel">
      <div class="work-rule-heading">
        <h3 class="panel-title"><img src="./assets/icons/icon_treasure_chest.png" alt="">工作岗位</h3>
        <span>自动优先：深渊领域 → 职业工作 → 打零工</span>
      </div>
      <div class="work-type-grid">${Object.entries(workTypes).map(([key, job]) => workTypeCard(key, job)).join("")}</div>
      <p class="work-note">开始工作每名佣兵消耗 ${workCosts.start} G 碎金，退出工作结算时消耗 ${workCosts.stop} G 碎金；连续工作15、30、60天后，当前收益分别降至80%、40%、10%。</p>
      <div class="work-rate-card">
        <strong>职业工作收益速查</strong>
        <table class="rate-table">
          <thead><tr><th>主属性</th><th>LV.1</th><th>LV.5</th><th>LV.9</th><th>LV.12</th></tr></thead>
          <tbody>${sampleStats.map((main) => `<tr><td>${main}</td>${sampleLevels.map((level) => `<td>${format((0.01 + Math.max(0, main - 85) * 0.005) * levelMultipliers[level] * 120, 3)} G</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="toolbar panel work-toolbar">
      <div class="work-filter-group">
        <label>职业<select class="select" data-work-filter="class">
          ${["all", "warrior", "rogue", "mage"].map((c) => `<option value="${c}" ${state.workFilters.class === c ? "selected" : ""}>${c === "all" ? "全部职业" : className(c)}</option>`).join("")}
        </select></label>
        <label>属性<select class="select" data-work-filter="attribute">
          <option value="all" ${state.workFilters.attribute === "all" ? "selected" : ""}>全部属性</option>
          ${attrs.map((a) => `<option value="${a}" ${state.workFilters.attribute === a ? "selected" : ""}>${attrLabels[a]}</option>`).join("")}
        </select></label>
        <label>最低值<select class="select" data-work-filter="minimum" ${state.workFilters.attribute === "all" ? "disabled" : ""}>
          ${[0, 65, 85].map((n) => `<option value="${n}" ${Number(state.workFilters.minimum) === n ? "selected" : ""}>${n ? `≥ ${n}` : "不限"}</option>`).join("")}
        </select></label>
        <label>排序<select class="select" data-work-filter="sort">
          <option value="recommended" ${state.workFilters.sort === "recommended" ? "selected" : ""}>推荐收益</option>
          <option value="attribute" ${state.workFilters.sort === "attribute" ? "selected" : ""}>所选属性</option>
          <option value="level" ${state.workFilters.sort === "level" ? "selected" : ""}>佣兵等级</option>
        </select></label>
      </div>
      ${button("重置筛选", "reset-work-filters")}
    </div>
    <div class="grid work-columns">
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_gold_coin.png" alt="">工作中</h3>
        <div class="list">${working.length ? working.map(workRow).join("") : `<div class="empty">暂无工作中的佣兵。</div>`}</div>
      </div>
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_treasure_chest.png" alt="">空闲佣兵</h3>
        <div class="list">${idle.length ? idle.map(idleWorkRow).join("") : `<div class="empty">暂无空闲佣兵。</div>`}</div>
      </div>
    </div>`;
}

function workRow(merc) {
  return `<div class="row work-merc-row">
    <img src="${getHero(merc)}" alt="${className(merc.class)}">
    <div class="work-merc-info"><strong>${className(merc.class)} LV.${merc.level}</strong><small>${workTypes[merc.workType]?.name || "工作"} · ${formatWorkDuration(merc.workStartTime)}</small><span class="decay ${workDecayRate(merc) < 1 ? "reduced" : ""}">${decayStatus(merc)} · 待领 ${format(pendingEarning(merc), 3)} G</span></div>
    <div class="button-row">${button("领取", `claim:${merc.id}`, "success")}${button(`退出 (${workCosts.stop}G)`, `prepare-stop-work:${merc.id}`, "danger")}</div>
  </div>`;
}

function idleWorkRow(merc) {
  const job = bestWork(merc);
  const config = classes[merc.class];
  const advancedKey = classWorkKey(merc);
  const advancedUnlocked = availableWork(merc).some((item) => item.key === advancedKey);
  const currentHourly = hourlyEarning(merc);
  const advancedHourly = format(idealHourlyEarning(merc), 3);
  return `<div class="row work-merc-row">
    <img src="${getHero(merc)}" alt="${className(merc.class)}">
    <div class="work-merc-info"><strong>${className(merc.class)} LV.${merc.level}</strong><small>当前可做：${job.name} · 时薪 ${format(currentHourly, 3)} G</small><span>${attrLabels[config.main]} ${attrValue(merc, config.main)} · ${attrLabels[config.sub]} ${attrValue(merc, config.sub)} · 总属性 ${totalAttr(merc)}</span><span>${advancedUnlocked ? `职业岗位已解锁，职业时薪 ${advancedHourly} G。` : `${workQualificationHint(merc)} 达标后职业时薪约 ${advancedHourly} G。`}</span></div>
    ${button(`开始工作 (${workCosts.start}G)`, `prepare-start-work:${merc.id}`, "success")}
  </div>`;
}

function workTypeCard(key, job) {
  const detail = key === "odd"
    ? "无门槛 · 0.01 G/周期"
    : key === "abyss"
      ? `总属性 ≥ ${job.totalMin} · 0.07 G起/周期`
      : `${className(job.class)} · 主属性 ≥ ${job.mainMin} · 副属性 ≥ ${job.subMin}`;
  return `<div class="work-type"><strong>${job.name}</strong><span>${detail}</span><small>${job.desc}</small></div>`;
}

function filteredIdleWorkers() {
  const filters = state.workFilters;
  let list = state.mercenaries.filter((m) => m.status === "idle");
  if (filters.class !== "all") list = list.filter((m) => m.class === filters.class);
  if (filters.attribute !== "all" && Number(filters.minimum) > 0) {
    list = list.filter((m) => attrValue(m, filters.attribute) >= Number(filters.minimum));
  }
  const sorters = {
    recommended: (a, b) => hourlyEarning(b) - hourlyEarning(a),
    attribute: (a, b) => filters.attribute === "all" ? totalAttr(b) - totalAttr(a) : attrValue(b, filters.attribute) - attrValue(a, filters.attribute),
    level: (a, b) => b.level - a.level
  };
  return list.sort(sorters[filters.sort] || sorters.recommended);
}

function renderDungeon() {
  const idle = state.mercenaries.filter((m) => m.status === "idle");
  const selected = state.mercenaries.find((m) => m.id === state.selectedMercenaryId);
  const cost = entryCost(state.selectedDungeon, state.selectedFloor);
  const dungeon = dungeons[state.selectedDungeon];
  const tier = floorTiers[state.selectedFloor];
  const density = state.dungeonDensity[state.selectedDungeon] || 1;
  document.querySelector("#view-dungeon").innerHTML = html`
    <div class="page-title dungeon-page-title">
      <div><h2>数据迷宫</h2><p>每场会连续遭遇多只怪物。击败每只怪物后立即掉落碎金或主币，英雄会带着当前血量继续前进。</p></div>
    </div>
    <div class="dungeon-layout">
      <section class="panel dungeon-config">
        <h3 class="panel-title"><img src="./assets/icons/icon_floor_stairs.png" alt="">挑战配置</h3>
        <div class="dungeon-option-label">难度选择</div>
        <div class="button-row dungeon-option-row">
          ${Object.entries(dungeons).map(([key, d]) => `<button class="game-button ${state.selectedDungeon === key ? "success" : ""}" data-difficulty="${key}" ${state.unlocked[key] <= 0 ? "disabled" : ""}>${d.name} · ${d.title}</button>`).join("")}
        </div>
        <div class="dungeon-option-label">楼层选择</div>
        <div class="button-row dungeon-floor-row">
          ${[1, 2, 3, 4, 5].map((f) => `<button class="game-button ${state.selectedFloor === f ? "success" : ""}" data-floor="${f}" ${f > state.unlocked[state.selectedDungeon] ? "disabled" : ""}>${f}层 · ${dungeon.floors[f - 1]}</button>`).join("")}
        </div>
        <div class="dungeon-stage-summary" style="--monster-outline:${tier.outline}">
          <strong>${dungeon.title} · ${dungeon.floors[state.selectedFloor - 1]}</strong>
          <span>${tier.name}怪物 · 本层强度 ×${tier.enemyMultiplier.toFixed(2)} · 富饶度 ${density.toFixed(2)}（${densityLabel(density)}）</span>
        </div>
        <h3 class="panel-title dungeon-heroes-title"><img src="./assets/icons/icon_attack_sword.png" alt="">英雄选择</h3>
        <div class="dungeon-hero-grid">${idle.length ? idle.map((m) => dungeonHeroCard(m)).join("") : `<div class="empty">没有空闲英雄可以出战。</div>`}</div>
        <div class="dungeon-start-row">${button(`开始自动战斗 · ${format(cost)}G`, "start-battle", "success", !selected || selected.status !== "idle" || state.gold < cost)}</div>
      </section>
      <aside class="panel dungeon-history">
        <h3 class="panel-title"><img src="./assets/icons/icon_victory_banner.png" alt="">挑战历史</h3>
        <div class="history-head"><span>结果</span><span>击败</span><span>奖励</span></div>
        <div class="history-list">${(state.battleHistory || []).slice(-8).reverse().map((item) => `<div class="history-row ${item.won ? "won" : "lost"}"><strong>${item.won ? "胜利" : "失败"}</strong><span>${item.defeated || 0}/${item.totalEnemies || 0}</span><span>${format(item.gold || 0)}G / ${formatPrimary(item.primary || 0)}B</span></div>`).join("") || `<div class="empty">暂无已完成挑战。</div>`}</div>
      </aside>
    </div>`;
}

function dungeonHeroCard(merc) {
  const selected = state.selectedMercenaryId === merc.id;
  return `<article class="dungeon-hero-card ${selected ? "selected" : ""}" data-select-merc="${merc.id}"><img src="${getHero(merc)}" alt="${className(merc.class)}"><div><h4>${className(merc.class)} <small>LV.${merc.level}</small></h4><div class="tag-row"><span class="tag">${qualityName(merc)}</span><span class="tag">战力 ${format(battlePower(merc))}</span><span class="tag">剩余 ${remainingDailyBattles(merc)} 次</span></div><div class="dungeon-hero-stats">${attrs.map((a) => `<span>${attrLabels[a]} ${merc.base[a]}</span>`).join("")}</div></div></article>`;
}

function renderDragon() {
  const selectable = state.mercenaries;
  const selected = state.selectedDragonIds.map((id) => state.mercenaries.find((m) => m.id === id)).filter(Boolean).slice(0, 10);
  const boss = state.worldBoss || { hp: dragon.base.hp, maxHp: dragon.base.hp, attack: dragon.base.attack };
  const queue = state.worldBossQueue || [];
  const queuedMe = queue.find((item) => item.user === currentUserName());
  document.querySelector("#view-dragon").innerHTML = html`
    <div class="page-title"><div><h2>世界 Boss · 龙巢</h2><p>每位玩家可放置最多 10 名英雄等待百人集结；工作与数据迷宫不受影响，满 100 位玩家后系统自动开战并通过信箱结算。</p></div><div class="button-row">${button("全选 10 名", "dragon-select-all", "", selectable.length === 0)}${button(queuedMe ? "更新等待队伍" : "加入世界 Boss 等待", "world-boss-queue", "danger", selected.length === 0)}</div></div>
    <section class="world-boss-hero panel"><div class="world-boss-video"><img src="./assets/backgrounds/bg_dragon_lair.png" alt="巨龙战斗动画占位图"><span>巨龙战斗前动画 · 即将接入</span></div><div class="world-boss-status"><h3>深渊古龙</h3><div class="progress"><span style="width:${Math.max(0, boss.hp / boss.maxHp * 100)}%"></span></div><p>生命 ${format(boss.hp)} / ${format(boss.maxHp)} · 攻击 ${format(boss.attack)}</p><div class="world-boss-count"><b>${queue.length}</b><span>/ 100 位玩家已集结</span></div><small>${queuedMe ? `你已放入 ${queuedMe.party.length} 名英雄，等待系统自动组队。` : "选择英雄后加入等待队伍。"}</small></div></section>
    <div class="panel world-boss-roster"><h3 class="panel-title"><img src="./assets/icons/icon_victory_banner.png" alt="">选择等待组队的英雄 <small>${selected.length}/10</small></h3><p class="muted">这些英雄仅登记为世界 Boss 候选，不会改变工作、迷宫或其他玩法中的可用状态。</p><div class="merc-grid">${selectable.length ? selectable.map(dragonSelectCard).join("") : `<div class="empty">暂无可供登记的英雄。</div>`}</div></div>`;
}

function dragonSelectCard(merc) {
  const checked = state.selectedDragonIds.includes(merc.id);
  return `<article class="merc-card ${checked ? "selected" : ""}" data-dragon-merc="${merc.id}">
    <img class="hero-portrait" src="${getHero(merc)}" alt="${className(merc.class)}">
    <div><h3>${className(merc.class)}</h3><div class="tag-row"><span class="tag">LV.${merc.level}</span><span class="tag">战力 ${format(battlePower(merc))}</span><span class="tag">${statusText(merc.status)}</span></div><small>${checked ? "已加入等待队伍" : "点击加入等待队伍"}</small></div>
  </article>`;
}

function renderSocial() {
  const uploadable = state.mercenaries.filter((m) => m.status === "idle");
  const sorted = [...state.leaderboard].sort((a, b) => b.merc.level - a.merc.level || b.power - a.power);
  const sparring = state.sparring || { defenders: [], history: [], nextCycleAt: Date.now() + 86400000 };
  const defendable = state.mercenaries.filter((m) => m.status !== "trading");
  document.querySelector("#view-social").innerHTML = html`
    <div class="page-title">
      <div><h2>排行榜</h2><p>上传英雄进入荣誉大厅，胜利后会自动同步替换目标；下方可参与按日结算的擂台切磋。</p></div>
      <div class="button-row">${button("刷新排行", "refresh-board", "success")}${button("重置排行", "reset-board", "danger")}</div>
    </div>
    <div class="grid two">
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_victory_banner.png" alt="">英雄排行榜</h3>
        <div class="list">${sorted.map(boardRow).join("")}</div>
      </div>
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_badge_currency.png" alt="">上传英雄</h3>
        <p class="muted" style="margin:0 0 14px">挑战胜利后会自动用当前出战英雄替换排行榜目标，无需再额外点同步。</p>
        <div class="list">${uploadable.length ? uploadable.map(uploadRow).join("") : `<div class="empty">没有空闲英雄可上传。</div>`}</div>
        <h3 class="panel-title" style="margin-top:18px">挑战记录</h3>
        <div class="list">${state.arenaHistory.length ? state.arenaHistory.slice(-6).reverse().map(arenaHistoryRow).join("") : `<div class="empty">暂无挑战记录。</div>`}</div>
      </div>
    </div>
    <section class="sparring-panel panel"><div class="sparring-heading"><div><h3 class="panel-title"><img src="./assets/icons/icon_attack_sword.png" alt="">擂台切磋</h3><p>守擂英雄会自动同步到服务器；攻擂点击后直接确认，胜负和席位变更均通过信箱通知。</p></div><span>本轮结算：${new Date(sparring.nextCycleAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div><div class="grid two"><div><h4>攻擂</h4><div class="list">${sparring.defenders.length ? sparring.defenders.slice(0, 8).map(sparringRow).join("") : `<div class="empty">擂台暂未开放守擂英雄。</div>`}</div></div><div><h4>守擂</h4><p class="muted">选择一名英雄后立即同步。英雄仍可工作或进入数据迷宫。</p><div class="list">${defendable.length ? defendable.slice(0, 6).map(defendRow).join("") : `<div class="empty">暂无可登记英雄。</div>`}</div></div></div></section>`;
}

function renderTrade() {
  const filters = state.tradeFilters;
  const idle = state.mercenaries.filter((merc) => merc.status === "idle");
  const selected = idle.find((merc) => merc.id === state.selectedTradeMercenaryId) || idle[0];
  if (selected && !state.selectedTradeMercenaryId) state.selectedTradeMercenaryId = selected.id;
  document.querySelector("#view-trade").innerHTML = html`
    <div class="page-title"><div><h2>英雄交易</h2><p>在服务器交易所上架空闲英雄，按职业、等级与指定属性筛选其他玩家的英雄。</p></div><div class="button-row">${button("刷新交易所", "trade-refresh", "success")}</div></div>
    <div class="grid two">
      <div class="panel"><h3 class="panel-title"><img src="./assets/icons/icon_treasure_chest.png" alt="">上架英雄</h3><div class="trade-merc-list">${idle.length ? idle.map((merc) => `<button class="trade-merc ${selected?.id === merc.id ? "selected" : ""}" data-trade-merc="${merc.id}"><img src="${getHero(merc)}" alt="${className(merc.class)}"><span><strong>${className(merc.class)} LV.${merc.level}</strong><small>${qualityName(merc)} · 战力 ${format(battlePower(merc))}</small></span></button>`).join("") : `<div class="empty">没有空闲英雄可上架。</div>`}</div><div class="trade-listing-form"><label>售价（G）<input class="select" id="tradePrice" type="number" min="1" value="${Math.max(1000, selected ? battlePower(selected) * 8 : 1000)}"></label>${button("上架所选英雄", "trade-list", "success", !selected || !state.online)}</div><small class="muted">交易需要后端连接；已上架的英雄会暂时不能参与工作和战斗。</small></div>
      <div class="panel"><h3 class="panel-title"><img src="./assets/icons/icon_badge_currency.png" alt="">交易所筛选</h3><div class="trade-filter-row"><select class="select" data-trade-filter="class">${["all", "warrior", "rogue", "mage"].map((item) => `<option value="${item}" ${filters.class === item ? "selected" : ""}>${item === "all" ? "全部职业" : className(item)}</option>`).join("")}</select><input class="select" data-trade-filter="minLevel" type="number" min="1" max="12" value="${filters.minLevel}"><select class="select" data-trade-filter="attribute">${attrs.map((attr) => `<option value="${attr}" ${filters.attribute === attr ? "selected" : ""}>${attrLabels[attr]}</option>`).join("")}</select><input class="select" data-trade-filter="minAttribute" type="number" min="0" max="100" value="${filters.minAttribute}"></div><div id="tradeResults" class="list"><div class="empty">正在读取交易所……</div></div></div>
    </div>`;
  refreshTradeListings();
}

function tradeListingRow(entry) {
  const merc = entry.merc;
  return `<div class="row trade-row"><div><strong>${entry.seller} · ${className(merc.class)} LV.${merc.level}</strong><br><small>${attrLabels[state.tradeFilters.attribute]} ${attrValue(merc, state.tradeFilters.attribute)} · 总属性 ${totalAttr(merc)} · 战力 ${format(entry.power)}</small></div><div><strong class="trade-price">${format(entry.price)} G</strong>${button("购买", `trade-buy:${entry.id}`, "success", entry.seller === currentUserName() || state.gold < entry.price)}</div></div>`;
}

async function refreshTradeListings() {
  const filters = state.tradeFilters;
  const query = new URLSearchParams({ class: filters.class, minLevel: filters.minLevel, attribute: filters.attribute, minAttribute: filters.minAttribute });
  const result = await apiRequest(`/api/trades?${query.toString()}`);
  const target = document.querySelector("#tradeResults");
  if (!target) return;
  if (!result) return target.innerHTML = `<div class="empty">交易所暂时不可用。</div>`;
  target.innerHTML = result.trades.length ? result.trades.map(tradeListingRow).join("") : `<div class="empty">没有符合当前筛选条件的英雄。</div>`;
}

async function listSelectedTradeMercenary() {
  const merc = state.mercenaries.find((item) => item.id === state.selectedTradeMercenaryId && item.status === "idle");
  const price = Number(document.querySelector("#tradePrice")?.value || 0);
  if (!merc || price < 1) return addToast("请选择空闲英雄并填写有效售价。");
  const result = await apiRequest("/api/trades", { method: "POST", body: { seller: currentUserName(), merc, power: battlePower(merc), price } });
  if (!result) return addToast("上架失败，请检查后端连接。");
  merc.status = "trading";
  state.selectedTradeMercenaryId = null;
  addToast("英雄已上架到交易所。");
  render();
}

async function buyTradeMercenary(id) {
  const priceText = document.querySelector(`[data-action="trade-buy:${id}"]`)?.closest(".trade-row")?.querySelector(".trade-price")?.textContent || "";
  const knownPrice = Number(priceText.replace(/[^0-9.]/g, ""));
  if (knownPrice && state.gold < knownPrice) return addToast("碎金不足，无法购买该英雄。");
  const result = await apiRequest(`/api/trades/${id}/buy`, { method: "POST", body: { buyer: currentUserName() } });
  if (!result?.trade) return addToast("购买失败，该英雄可能已被其他玩家买走。");
  if (state.gold < result.trade.price) return addToast("碎金不足，无法购买该英雄。");
  state.gold -= result.trade.price;
  const merc = { ...result.trade.merc, id: uid("merc"), status: "idle", createdAt: Date.now(), todayBattles: 0, battleDate: new Date().toDateString(), uploaded: false, quality: result.trade.merc.quality || "normal", qualityName: result.trade.merc.qualityName || "普通卡" };
  state.mercenaries.push(merc);
  addToast("交易完成，英雄已加入佣兵团。");
  render();
}

function arenaHistoryRow(history) {
  if (typeof history === "string") return `<div class="row"><span>${history}</span></div>`;
  return `<div class="row"><span>${history.attacker} 挑战 ${history.defender}：${history.won ? "胜利" : "失败"}</span></div>`;
}

function boardRow(entry) {
  return `<div class="row">
    <div><strong>${entry.user} · ${className(entry.merc.class)} LV.${entry.merc.level}</strong><br><small>战力 ${format(entry.power)} · 总属性 ${totalAttr(entry.merc)}</small></div>
    ${button("发起挑战", `arena:${entry.id}`, "danger")}
  </div>`;
}

function uploadRow(merc) {
  return `<div class="row">
    <div><strong>${className(merc.class)} LV.${merc.level}</strong><br><small>战力 ${format(battlePower(merc))}</small></div>
    ${button(merc.uploaded ? "已上传" : "上传英雄", `upload:${merc.id}`, "success", merc.uploaded)}
  </div>`;
}

function renderSettings() {
  document.querySelector("#view-settings").innerHTML = html`
    <div class="page-title"><div><h2>游戏设置</h2><p>保存设置、存档管理和测试资源发放集中在这里。</p></div></div>
    <div class="grid two">
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_magic_resist_rune.png" alt="">偏好设置</h3>
        ${["sound:音效", "music:音乐", "notifications:通知", "autosave:自动保存"].map((item) => {
          const [key, label] = item.split(":");
          return `<label class="row"><span>${label}</span><input type="checkbox" data-setting="${key}" ${state.settings[key] ? "checked" : ""}></label>`;
        }).join("")}
      </div>
      <div class="panel">
        <h3 class="panel-title"><img src="./assets/icons/icon_defeat_broken_shield.png" alt="">存档与调试</h3>
        <div class="button-row">
          ${button("少量资源", "grant-small")}
          ${button("中等资源", "grant-medium")}
          ${button("大量资源", "grant-large")}
          ${button("巨量资源", "grant-huge", "danger")}
          ${button("重置游戏", "reset-game", "danger")}
          ${button("删除存档", "delete-save", "danger")}
        </div>
      </div>
    </div>`;
}

function statusText(status) {
  return { all: "全部状态", idle: "空闲", working: "工作中", battling: "战斗中", trading: "交易中" }[status] || status;
}

function sortText(sort) {
  return { power: "战斗力", level: "等级", total: "总属性", hourly: "时薪" }[sort] || sort;
}

function recruit() {
  resetDailyCounters();
  if (state.dailyRecruitCount >= 30) return addToast("今日招募次数已达上限。");
  if (state.primary < 1) return addToast("主币不足，无法招募。");
  state.primary -= 1;
  state.dailyRecruitCount += 1;
  const merc = generateMercenary();
  state.mercenaries.push(merc);
  openRecruitModal(merc);
  render();
}

function openSummonGate() {
  resetDailyCounters();
  if (state.dailyRecruitCount >= 30) return addToast("今日招募次数已达上限。");
  if (state.primary < 1) return addToast("主币不足，无法开启召唤门。");
  summonGatePending = true;
  openModal(`<div class="summon-cinematic">
    <video id="summonGateVideo" autoplay playsinline muted preload="auto">
      <source src="./assets/media/summon_animation_02.mp4" type="video/mp4">
    </video>
    <div class="summon-cinematic-bar"><span>召唤门正在开启……</span>${button("跳过动画", "summon-finish")}</div>
  </div>`);
  const video = document.querySelector("#summonGateVideo");
  const finishTimer = setTimeout(finishSummonGate, 3500);
  const tuneVideoLength = () => {
    if (!video?.duration || !Number.isFinite(video.duration)) return;
    video.playbackRate = Math.max(1, video.duration / 3.5);
  };
  video?.addEventListener("loadedmetadata", tuneVideoLength, { once: true });
  video?.addEventListener("ended", finishSummonGate, { once: true });
  video?.addEventListener("ended", () => clearTimeout(finishTimer), { once: true });
  video?.play().catch(() => addToast("动画未能自动播放，可点击跳过继续召唤。"));
}

function finishSummonGate() {
  if (!summonGatePending) return;
  summonGatePending = false;
  closeModal();
  recruit();
}

function openRecruitModal(merc) {
  openModal(`<div class="modal-header"><h2>召唤成功：${className(merc.class)}</h2><button class="game-button" data-action="close-modal">关闭</button></div>
    <div class="summon-hero">
      <img src="${getHero(merc, "summon")}" alt="${className(merc.class)}">
      <div>
        <div class="tag-row"><span class="tag ${classes[merc.class].color}">LV.${merc.level}</span><span class="tag" style="border-color:${qualityColor(merc)};color:${qualityColor(merc)}">${qualityName(merc)}</span><span class="tag">战力 ${format(battlePower(merc))}</span><span class="tag">总属性 ${totalAttr(merc)}</span></div>
        <div class="stat-list">${attrs.map((a) => `<div class="stat-line"><span>${attrLabels[a]}</span><strong>${merc.base[a]}</strong></div>`).join("")}</div>
      </div>
    </div>`);
}

function openDetail(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc) return;
  const attributeColors = { strength: "#ee8b3a", agility: "#77b94d", intelligence: "#6464e8", constitution: "#e9b838", willpower: "#a65ed3", spirit: "#58c7ca" };
  openModal(`<div class="hero-detail-view">
    <div class="hero-detail-title"><span class="detail-class-mark">✧</span><h2 class="class-title ${merc.class}">${className(merc.class)}</h2><span class="level-plate">LV.${merc.level}</span><button class="game-button detail-close" data-action="close-modal">关闭</button></div>
    <div class="hero-detail-layout">
      <section class="hero-attribute-panel"><h3>属性</h3><div class="hero-attribute-list">${attrs.map((a) => `<div class="hero-attribute-row"><span class="attribute-icon" style="--attribute:${attributeColors[a]}">${attrLabels[a].slice(0, 1)}</span><b>${attrLabels[a]}</b><i><em style="width:${merc.base[a]}%;--attribute:${attributeColors[a]}"></em></i><strong>${merc.base[a]}</strong></div>`).join("")}</div><div class="hero-detail-footer"><span>🎁 ${qualityName(merc)}</span><span>▣ ${statusText(merc.status)}</span><span>⚔ 战力 ${format(battlePower(merc))}</span><span>⬡ 总属性 ${totalAttr(merc)}</span></div></section>
      <section class="hero-detail-art"><img src="${getHero(merc)}" alt="${className(merc.class)}"></section>
    </div>
  </div>`, "modal-hero-detail");
}

function sparringRow(entry) {
  return `<div class="row"><div><strong>${entry.user} · ${className(entry.merc.class)} LV.${entry.merc.level}</strong><br><small>战力 ${format(entry.power)} · 自动结算中</small></div>${button("攻擂", `sparring-challenge:${entry.id}`, "danger", entry.user === currentUserName())}</div>`;
}

function defendRow(merc) {
  return `<div class="row"><div><strong>${className(merc.class)} LV.${merc.level}</strong><br><small>战力 ${format(battlePower(merc))} · ${statusText(merc.status)}</small></div>${button("守擂", `sparring-defend:${merc.id}`, "success")}</div>`;
}

async function queueWorldBoss() {
  const party = state.selectedDragonIds.map((id) => state.mercenaries.find((merc) => merc.id === id)).filter(Boolean).slice(0, 10);
  if (!party.length) return addToast("请先选择至少一名英雄。");
  const result = await apiRequest("/api/world-boss/queue", { method: "POST", body: { party } });
  if (!result) return addToast("世界 Boss 等待队伍同步失败。");
  state.worldBossQueue = result.queue || [];
  addToast(result.resolved ? "百人队伍已自动结算，请查看信箱。" : `已同步 ${party.length} 名英雄，等待百人组队。`);
  refreshMailbox();
  render();
}

async function setSparringDefense(id) {
  const merc = state.mercenaries.find((item) => item.id === id);
  if (!merc) return;
  const result = await apiRequest("/api/sparring/defend", { method: "POST", body: { merc, power: battlePower(merc) } });
  if (!result) return addToast("守擂同步失败，请检查联机状态。");
  state.sparring = result.sparring;
  addToast("守擂英雄已自动同步到服务器。");
  refreshMailbox();
  render();
}

async function challengeSparring(id) {
  const attacker = state.mercenaries.filter((merc) => merc.status !== "trading").sort((a, b) => battlePower(b) - battlePower(a))[0];
  if (!attacker) return addToast("没有可用于攻擂的英雄。");
  const result = await apiRequest("/api/sparring/challenge", { method: "POST", body: { entryId: id, attacker, power: battlePower(attacker) } });
  if (!result) return addToast("攻擂同步失败，请检查联机状态。");
  state.sparring = result.sparring;
  addToast(result.record.won ? "攻擂成功，已自动接替守擂位置。" : "本次攻擂未能取胜，结果已同步。");
  refreshMailbox();
  render();
}

function openUpgrade(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc) return;
  const next = merc.level + 1;
  const cost = upgradeTable[next];
  if (!cost) return addToast("已经达到最高等级。");
  const failPercent = Math.round(cost.fail * 100);
  const destruction = merc.level >= 4 && cost.fail > 0;
  openModal(`<div class="upgrade-panel">
    <div class="modal-header"><h2>英雄升级仪式</h2><button class="game-button" data-action="close-modal">取消</button></div>
    <div class="upgrade-hero"><img src="${getHero(merc)}" alt="${className(merc.class)}"><div><p>${className(merc.class)} · ${qualityName(merc)}</p><strong>LV.${merc.level} <i>→</i> LV.${next}</strong><small>战斗力 ${battlePower(merc)} · 升级后收益倍率 ${levelMultipliers[next]}x</small></div></div>
    <div class="upgrade-details">
      <div><span>成功率</span><strong class="upgrade-chance ${cost.fail ? "risky" : ""}">${100 - failPercent}%</strong></div>
      <div><span>失败率</span><strong class="upgrade-risk">${failPercent}%</strong></div>
      <div><span>碎金消耗</span><strong>${format(cost.gold)} G</strong></div>
      <div><span>主币消耗</span><strong>${cost.primary} B</strong></div>
    </div>
    <p class="upgrade-warning">${destruction ? "失败将销毁该英雄，请确认后继续。" : cost.fail ? "失败会扣除本次消耗，但英雄将被保留。" : "本次升级必定成功。"}</p>
    <div class="upgrade-actions">${button("开始升级", `confirm-upgrade:${id}`, "success", !moneyEnough(cost.gold, cost.primary))}${button("取消", "close-modal")}</div>
  </div>`, "modal-upgrade");
}

function rollUpgradeFailure(failRate, randomValue = Math.random()) {
  return failRate > 0 && randomValue < failRate;
}

function performUpgrade(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc) return;
  if (merc.status !== "idle") return addToast("工作中的佣兵不能升级。");
  const next = merc.level + 1;
  const cost = upgradeTable[next];
  if (!cost || !spend(cost.gold, cost.primary)) return addToast("资源不足，无法升级。");
  const failed = rollUpgradeFailure(cost.fail);
  upgradeSequenceActive = true;
  openModal(`<div class="upgrade-animation ${failed ? "fail" : "success"}"><div class="upgrade-effect"></div><p>${className(merc.class)} 正在突破 LV.${next}……</p><strong>${failed ? "命运正在撕裂契约" : "能量正在汇聚"}</strong></div>`, "modal-upgrade-animation");
  setTimeout(() => finishUpgrade({ id, mercenaryName: className(merc.class), next, cost, failed, destroy: merc.level >= 4 && failed }), 1900);
}

function finishUpgrade(result) {
  const merc = state.mercenaries.find((m) => m.id === result.id);
  if (result.failed && result.destroy) state.mercenaries = state.mercenaries.filter((m) => m.id !== result.id);
  else if (!result.failed && merc) merc.level = result.next;
  state.upgradeHistory.push({ ...result, time: Date.now() });
  state.upgradeHistory = state.upgradeHistory.slice(-100);
  upgradeSequenceActive = false;
  addToast(result.failed ? (result.destroy ? "升级失败，英雄已爆卡。" : "升级失败，英雄保留。") : `升级成功，达到 LV.${result.next}。`);
  render();
  upgradeResultOpen = true;
  const resultText = result.failed ? "fail" : "success";
  const detail = result.failed ? (result.destroy ? "升级失败，英雄契约已经破碎。" : "升级失败，本次消耗已扣除。") : `${result.mercenaryName} 成功提升至 LV.${result.next}。`;
  openModal(`<div class="upgrade-result ${resultText}"><div class="upgrade-effect"></div><div class="upgrade-result-word">${resultText}</div><p>${detail}</p><button class="game-button success" data-action="return-mercenaries">返回佣兵管理</button></div>`, "modal-upgrade-result");
}

function confirmWorkStart(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc || merc.status !== "idle") return;
  openModal(`<div class="confirm-cost"><h2>确认开始工作</h2><p>派遣 <strong>${className(merc.class)} LV.${merc.level}</strong> 进入 ${bestWork(merc).name}，需要支付 <b>${format(workCosts.start)} G</b> 碎金作为安排费用。</p><div class="button-row">${button("确认派遣", `confirm-start-work:${id}`, "success", state.gold < workCosts.start)}${button("暂不派遣", "close-modal")}</div></div>`);
}

function startWork(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc || merc.status !== "idle") return;
  if (!spend(workCosts.start, 0)) return addToast("碎金不足，无法支付工作安排费用。");
  const job = bestWork(merc);
  merc.status = "working";
  merc.workType = job.key;
  merc.workStartTime = Date.now();
  merc.lastClaimTime = Date.now();
  if (state.selectedMercenaryId === id) state.selectedMercenaryId = null;
  state.selectedDragonIds = state.selectedDragonIds.filter((selectedId) => selectedId !== id);
  addToast(`${className(merc.class)}开始${job.name}。`);
  render();
}

function confirmDispatchFiltered() {
  const targets = filteredIdleWorkers();
  if (!targets.length) return addToast("当前筛选下没有可派遣的空闲佣兵。");
  const totalCost = targets.length * workCosts.start;
  openModal(`<div class="confirm-cost"><h2>确认一键打工</h2><p>将派遣 <strong>${targets.length}</strong> 名佣兵开始工作，共需支付 <b>${format(totalCost)} G</b> 碎金安排费用。</p><div class="button-row">${button("确认派遣", "confirm-dispatch-filtered", "success", state.gold < totalCost)}${button("暂不派遣", "close-modal")}</div></div>`);
}

function dispatchFiltered() {
  const targets = filteredIdleWorkers();
  const totalCost = targets.length * workCosts.start;
  if (!targets.length) return addToast("当前筛选下没有可派遣的空闲佣兵。");
  if (!spend(totalCost, 0)) return addToast("碎金不足，无法支付工作安排费用。");
  const now = Date.now();
  targets.forEach((merc) => {
    merc.status = "working";
    merc.workType = bestWork(merc).key;
    merc.workStartTime = now;
    merc.lastClaimTime = now;
  });
  const ids = new Set(targets.map((merc) => merc.id));
  if (ids.has(state.selectedMercenaryId)) state.selectedMercenaryId = null;
  state.selectedDragonIds = state.selectedDragonIds.filter((id) => !ids.has(id));
  addToast(`已自动派遣 ${targets.length} 名佣兵。`);
  render();
}

function claimWork(id, stop = false) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc || merc.status !== "working") return;
  if (stop && !spend(workCosts.stop, 0)) return addToast("碎金不足，无法支付退出工作费用。");
  const amount = pendingEarning(merc);
  state.gold += amount;
  merc.workStartTime = Date.now();
  merc.lastClaimTime = Date.now();
  if (stop) {
    merc.status = "idle";
    merc.workType = null;
    merc.workStartTime = null;
  }
  addToast(`领取 ${format(amount, 3)} G。`);
  render();
}

function confirmStopWork(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc || merc.status !== "working") return;
  openModal(`<div class="confirm-cost"><h2>确认退出工作</h2><p>结束 <strong>${className(merc.class)} LV.${merc.level}</strong> 的工作并结算收益，需要支付 <b>${format(workCosts.stop)} G</b> 碎金退出费用。</p><div class="button-row">${button("确认退出", `confirm-stop-work:${id}`, "danger", state.gold < workCosts.stop)}${button("继续工作", "close-modal")}</div></div>`);
}

function tickWork(showToast = true) {
  let changed = false;
  state.mercenaries.forEach((m) => {
    if (m.status === "working" && pendingEarning(m) > 0) changed = true;
  });
  if (changed && showToast) render();
}

function claimAll() {
  let total = 0;
  state.mercenaries.forEach((m) => {
    if (m.status === "working") {
      total += pendingEarning(m);
      m.workStartTime = Date.now();
      m.lastClaimTime = Date.now();
    }
  });
  state.gold += total;
  addToast(`一键领取 ${format(total, 3)} G。`);
  render();
}

function entryCost(diff, floor) {
  const d = dungeons[diff];
  return d.baseCost + (floor - 1) * d.perFloor;
}

function battleVitals(merc) {
  const scale = 1 + 0.2 * (merc.level - 1);
  const attackAttr = classes[merc.class].attack === "intelligence" ? attrValue(merc, "intelligence") : attrValue(merc, "strength");
  return {
    maxHp: Math.floor(5 * attrValue(merc, "constitution") * scale),
    attack: Math.floor(attackAttr * scale),
    defense: Math.floor(attrValue(merc, "willpower") * scale),
    resist: Math.floor(attrValue(merc, "spirit") * scale),
    agility: attrValue(merc, "agility"),
    attackType: classes[merc.class].attack === "intelligence" ? "magic" : "physical"
  };
}

function enemyVitals(enemyLevel, tier, difficulty, enemyData) {
  const difficultyBonus = { easy: 1, medium: 1.5, hard: 2.5 };
  const bonus = (difficultyBonus[difficulty] || 1) * tier.enemyMultiplier;
  const levelFactor = 1 + (enemyLevel - 1) * 0.3;
  return {
    maxHp: Math.floor(100 * levelFactor * bonus * 2.34),
    attack: Math.floor(20 * levelFactor * bonus * 1.95),
    defense: Math.floor(10 * levelFactor * bonus * 1.3),
    resist: Math.floor(10 * levelFactor * bonus * 1.3),
    agility: Math.floor((50 + enemyLevel * 5 * bonus) * 1.3),
    attackType: enemyData?.attackType === "magic" ? "magic" : "physical"
  };
}

function battleStrike(attacker, defender) {
  const hitRate = clamp(attacker.agility / (attacker.agility + defender.agility / 2), 0.35, 0.98);
  if (Math.random() > hitRate) return { damage: 0, critical: false, hit: false, hitRate };
  const variance = 0.5 + Math.random();
  const guard = attacker.attackType === "magic" ? defender.resist : defender.defense;
  const damage = Math.max(1, Math.floor(attacker.attack * variance * 100 / (guard + 100)));
  return { damage, critical: false, hit: true, hitRate };
}

function renderBattleModal() {
  if (!activeBattle) return;
  const battle = activeBattle;
  const heroPercent = Math.max(0, Math.round((battle.hero.hp / battle.hero.maxHp) * 100));
  const enemyPercent = Math.max(0, Math.round((battle.enemy.hp / battle.enemy.maxHp) * 100));
  openModal(`<div class="battle-modal" aria-live="polite">
    <div class="modal-header"><h2>${battle.title || "自动战斗"}</h2><span class="battle-lock">战斗进行中</span></div>
    <div class="battle-round">第 ${battle.round} 回合 · ${battle.phase === "hero" ? "英雄行动" : "怪物行动"}</div>
    <div class="battle-health-row">
      <div class="battle-health hero-health"><div><strong>${battle.heroLabel || `${className(battle.merc.class)} LV.${battle.merc.level}`}</strong><b>${battle.hero.hp} / ${battle.hero.maxHp}</b></div><div class="battle-health-bar"><span style="width:${heroPercent}%"></span></div></div>
      <div class="battle-health enemy-health"><div><strong>${battle.enemyLabel || `${battle.enemy.data.name} LV.${battle.enemy.level}`}</strong><b>${battle.enemy.hp} / ${battle.enemy.maxHp}</b></div><div class="battle-health-bar"><span style="width:${enemyPercent}%"></span></div></div>
    </div>
    ${battleStage(battle.heroClass || battle.merc.class, battle.enemyVisualName || battle.enemy.data.name, battle.caption, battle.heroAction, battle.enemyAction)}
    <div class="battle-feed">${battle.feed.slice(-4).map((line) => `<p>${line}</p>`).join("")}</div>
    <p class="battle-note">${battle.note || "双方按敏捷决定先后手；每次攻击单独计算命中，以及物理或魔法伤害。"}</p>
  </div>`, "modal-battle");
}

let battleReturnAction = "return-dungeon";

function finishDungeonBattle() {
  const battle = activeBattle;
  if (!battle) return;
  const won = battle.enemyIndex >= battle.enemies.length - 1 && battle.enemy.hp <= 0;
  state.gold += battle.totalGold;
  state.primary += battle.totalPrimary;
  if (won) unlockNext();
  state.dungeonRuns[battle.difficulty] = Number(state.dungeonRuns[battle.difficulty] || 0) + 1;
  state.lastBattleVisual = { heroClass: battle.merc.class, enemyName: battle.enemy.data.name, heroAction: won ? "attack" : "death", enemyAction: won ? "death" : "attack", caption: won ? "战斗胜利" : "挑战失败" };
  state.battleLog = [
    `${className(battle.merc.class)}进入${battle.dungeon.title}·${battle.dungeon.floors[battle.floor - 1]}，连续遭遇 ${battle.totalEnemies} 只怪物。`,
    ...battle.feed.slice(-6),
    `${won ? "完成整场迷宫" : "中途倒下"}，累计获得 ${format(battle.totalGold)} G 与 ${formatPrimary(battle.totalPrimary)} B。`
  ];
  state.battleHistory.push({ won, rounds: battle.round, gold: battle.totalGold, primary: battle.totalPrimary, time: Date.now(), defeated: battle.defeatedEnemies, totalEnemies: battle.totalEnemies });
  state.battleHistory = state.battleHistory.slice(-30);
  activeBattle = null;
  addToast(won ? "迷宫挑战胜利。" : "迷宫挑战结束。");
  render();
  battleSettlementOpen = true;
  battleReturnAction = "return-dungeon";
  openBattleSettlement({ won, rounds: battle.round, gold: battle.totalGold, primary: battle.totalPrimary, enemyName: `${battle.defeatedEnemies}/${battle.totalEnemies} 只怪物`, returnAction: "return-dungeon", returnLabel: "返回数据迷宫" });
}

function openBattleSettlement(result) {
  const rewards = result.won
    ? `<div class="settlement-rewards"><p>获得奖励</p><strong>${format(result.gold)} G</strong><strong>${formatPrimary(result.primary)} B</strong></div>`
    : `<div class="settlement-rewards"><p>本次保留掉落</p><strong>${format(result.gold)} G</strong><strong>${formatPrimary(result.primary)} B</strong></div>`;
  openModal(`<div class="battle-settlement ${result.won ? "win" : "lose"}">
    <div class="settlement-mark">${result.won ? "WIN" : "FAIL"}</div>
    <h2>${result.title || (result.won ? "战斗胜利" : "战斗结束")}</h2>
    <p class="settlement-summary">${result.enemyName} · 共 ${result.rounds} 回合</p>
    ${rewards}
    <button class="game-button success settlement-return" data-action="${result.returnAction || battleReturnAction}">${result.returnLabel || "返回数据迷宫"}</button>
  </div>`, "modal-settlement");
}

function settleDungeonDrop(battle) {
  const density = battle.density;
  const gold = rollGoldDrop(battle.difficulty, battle.floor, density);
  const primary = rollPrimaryDrop(battle.difficulty, density);
  battle.totalGold += gold;
  battle.totalPrimary = Math.round((battle.totalPrimary + primary) * 1000) / 1000;
  battle.defeatedEnemies += 1;
  battle.feed.push(`击败第 ${battle.enemyIndex + 1} 只怪物，掉落 ${format(gold)} G${primary > 0 ? ` 与 ${formatPrimary(primary)} B` : ""}。`);
}

function moveToNextDungeonEnemy(battle) {
  battle.enemyIndex += 1;
  if (battle.enemyIndex >= battle.enemies.length) return finishDungeonBattle();
  const nextEnemy = battle.enemies[battle.enemyIndex];
  battle.enemy = { ...nextEnemy.vitals, hp: nextEnemy.vitals.maxHp, data: nextEnemy.data, level: nextEnemy.level };
  battle.enemyLabel = `${nextEnemy.data.name} LV.${nextEnemy.level} · 第 ${battle.enemyIndex + 1}/${battle.totalEnemies} 只`;
  battle.enemyVisualName = nextEnemy.data.name;
  battle.phase = battle.hero.agility >= battle.enemy.agility ? "hero" : "enemy";
  battle.heroAction = "idle";
  battle.enemyAction = "idle";
  battle.caption = `新的怪物出现 · ${battle.enemyIndex + 1}/${battle.totalEnemies}`;
  battle.feed.push(`${nextEnemy.data.name} LV.${nextEnemy.level} 继续拦路，英雄保留当前血量迎战。`);
  renderBattleModal();
  setTimeout(advanceBattle, 720);
}

function finishScriptedBattle() {
  const battle = activeBattle;
  if (!battle) return;
  const result = battle.result || { won: false, gold: 0, primary: 0 };
  if (typeof battle.applyResult === "function") battle.applyResult(result);
  const returnAction = battle.returnAction || "return-social";
  const returnLabel = battle.returnLabel || "返回互动区";
  const title = battle.settlementTitle || (result.won ? "战斗胜利" : "战斗结束");
  const enemyName = battle.enemyLabel || battle.enemyName || "对手";
  activeBattle = null;
  render();
  battleSettlementOpen = true;
  battleReturnAction = returnAction;
  openBattleSettlement({ won: result.won, rounds: battle.round, gold: result.gold || 0, primary: result.primary || 0, enemyName, returnAction, returnLabel, title });
}

function advanceScriptedBattle() {
  const battle = activeBattle;
  if (!battle) return;
  const step = battle.steps[battle.stepIndex];
  if (!step) return finishScriptedBattle();
  battle.round += 1;
  if (step.actor === "hero") {
    battle.phase = "hero";
    battle.heroAction = "attack";
    battle.enemyAction = step.enemyHp <= 0 ? "death" : "hit";
    battle.enemy.hp = step.enemyHp;
  } else {
    battle.phase = "enemy";
    battle.enemyAction = "attack";
    battle.heroAction = step.heroHp <= 0 ? "death" : "hit";
    battle.hero.hp = step.heroHp;
  }
  battle.caption = step.caption;
  battle.feed.push(step.text);
  renderBattleModal();
  battle.stepIndex += 1;
  if ((step.heroHp <= 0 || step.enemyHp <= 0) && battle.stepIndex >= battle.steps.length) return setTimeout(finishScriptedBattle, 900);
  setTimeout(() => {
    if (!activeBattle) return;
    battle.heroAction = "idle";
    battle.enemyAction = "idle";
    renderBattleModal();
    setTimeout(advanceScriptedBattle, 650);
  }, 780);
}

function advanceBattle() {
  const battle = activeBattle;
  if (!battle) return;
  if (battle.kind === "scripted") return advanceScriptedBattle();
  const heroActs = battle.phase === "hero";
  if (heroActs) battle.round += 1;
  const attacker = heroActs ? battle.hero : battle.enemy;
  const defender = heroActs ? battle.enemy : battle.hero;
  const result = battleStrike(attacker, defender);
  const attackerName = heroActs ? className(battle.merc.class) : battle.enemy.data.name;
  const defenderName = heroActs ? battle.enemy.data.name : className(battle.merc.class);
  if (result.hit) {
    defender.hp = Math.max(0, defender.hp - result.damage);
    battle.feed.push(`${attackerName}攻击${defenderName}，造成 ${result.damage} 点伤害。`);
  } else {
    battle.feed.push(`${attackerName}的攻击被${defenderName}闪避。`);
  }
  battle.heroAction = heroActs ? "attack" : defender.hp <= 0 ? "death" : "hit";
  battle.enemyAction = heroActs ? defender.hp <= 0 ? "death" : "hit" : "attack";
  battle.caption = result.hit ? `攻击命中 · ${result.damage}` : "攻击落空";
  renderBattleModal();
  if (defender.hp <= 0) {
    if (battle.kind === "dungeon" && heroActs) {
      settleDungeonDrop(battle);
      return setTimeout(() => moveToNextDungeonEnemy(battle), 980);
    }
    if (battle.kind === "dungeon") return setTimeout(finishDungeonBattle, 980);
    battle.result = { ...(battle.result || {}), won: heroActs };
    return setTimeout(finishScriptedBattle, 980);
  }
  setTimeout(() => {
    if (!activeBattle) return;
    battle.phase = heroActs ? "enemy" : "hero";
    battle.heroAction = "idle";
    battle.enemyAction = "idle";
    battle.caption = battle.phase === "hero" ? "英雄准备进攻" : "怪物准备反击";
    renderBattleModal();
    setTimeout(advanceBattle, 720);
  }, 880);
}

function startBattle() {
  if (activeBattle) return;
  const merc = state.mercenaries.find((m) => m.id === state.selectedMercenaryId);
  if (!merc) return addToast("请选择出战佣兵。");
  if (merc.status !== "idle") return addToast("工作中的佣兵不能出战。");
  if (remainingDailyBattles(merc) <= 0) return addToast("该佣兵今日挑战次数已用尽。");
  const cost = entryCost(state.selectedDungeon, state.selectedFloor);
  if (!spend(cost, 0)) return addToast("碎金不足，无法进入迷宫。");
  merc.todayBattles += 1;
  const d = dungeons[state.selectedDungeon];
  const roster = rollDungeonEnemyRoster(d, state.selectedFloor, state.selectedDungeon);
  const hero = battleVitals(merc);
  const firstEnemy = roster[0];
  activeBattle = {
    kind: "dungeon",
    title: "数据迷宫 · 连续战斗",
    merc,
    heroClass: merc.class,
    heroLabel: `${className(merc.class)} LV.${merc.level}`,
    dungeon: d,
    floor: state.selectedFloor,
    difficulty: state.selectedDungeon,
    cost,
    round: 0,
    density: state.dungeonDensity[state.selectedDungeon] || 1,
    enemies: roster,
    totalEnemies: roster.length,
    enemyIndex: 0,
    defeatedEnemies: 0,
    totalGold: 0,
    totalPrimary: 0,
    phase: hero.agility >= firstEnemy.vitals.agility ? "hero" : "enemy",
    hero: { ...hero, hp: hero.maxHp },
    enemy: { ...firstEnemy.vitals, hp: firstEnemy.vitals.maxHp, data: firstEnemy.data, level: firstEnemy.level },
    enemyLabel: `${firstEnemy.data.name} LV.${firstEnemy.level} · 第 1/${roster.length} 只`,
    enemyVisualName: firstEnemy.data.name,
    heroAction: "idle",
    enemyAction: "idle",
    caption: "战斗即将开始",
    note: "击败每只怪物都会立刻掉落碎金或主币，英雄保持当前血量继续前进。",
    feed: [`${className(merc.class)}进入${d.title}，本次连续遭遇 ${roster.length} 只怪物。`, `${hero.agility >= firstEnemy.vitals.agility ? className(merc.class) : firstEnemy.data.name}取得先手。`]
  };
  renderBattleModal();
  setTimeout(advanceBattle, 760);
}

function unlockNext() {
  const diff = state.selectedDungeon;
  if (state.selectedFloor < 5) {
    state.unlocked[diff] = Math.max(state.unlocked[diff], state.selectedFloor + 1);
  } else if (diff === "easy") {
    state.unlocked.medium = Math.max(state.unlocked.medium, 1);
  } else if (diff === "medium") {
    state.unlocked.hard = Math.max(state.unlocked.hard, 1);
  }
}

async function startDragonBattle() {
  if (!state.mercenaries.some((m) => m.level >= 10)) return addToast("需要至少 1 名 LV.10 佣兵解锁龙巢。");
  const party = state.selectedDragonIds.map((id) => state.mercenaries.find((m) => m.id === id)).filter((merc) => merc?.status === "idle");
  if (!party.length) return addToast("请选择参战佣兵。");
  if (party.some((merc) => remainingDailyBattles(merc) <= 0)) return addToast("所选佣兵中有角色今日挑战次数已用尽。");
  if (!spend(dragon.costGold, dragon.costPrimary)) return addToast("资源不足，无法挑战古龙。");
  const remote = await apiRequest("/api/world-boss/attack", {
    method: "POST",
    body: { party }
  });
  const partyPower = party.reduce((s, m) => s + battlePower(m), 0);
  const heroStats = party.reduce((acc, merc) => {
    const vitals = battleVitals(merc);
    acc.maxHp += vitals.maxHp;
    acc.attack += vitals.attack;
    acc.defense += vitals.defense;
    acc.resist += vitals.resist;
    acc.agility = Math.max(acc.agility, vitals.agility);
    return acc;
  }, { maxHp: 0, attack: 0, defense: 0, resist: 0, agility: 0 });
  const bossState = remote?.boss || state.worldBoss || { hp: dragon.base.hp, maxHp: dragon.base.hp, attack: dragon.base.attack };
  const result = remote
    ? { won: Boolean(remote.defeated), gold: remote.rewardGold, primary: remote.rewardPrimary, damage: remote.damage, hpLeft: bossState.hp, maxHp: bossState.maxHp }
    : (() => {
        const dragonPower = 6500 + party.length * 720;
        const chance = clamp(partyPower / (partyPower + dragonPower), 0.08, 0.78);
        const won = Math.random() < chance;
        return { won, gold: won ? 100000 + (party.length - 1) * 5000 : 0, primary: won ? 100 + (party.length - 1) * 10 : 0, damage: Math.round(partyPower * (won ? 0.95 : 0.42)), hpLeft: won ? 0 : Math.max(1, dragon.base.hp - Math.round(partyPower * 0.42)), maxHp: dragon.base.hp };
      })();
  party.forEach((m) => {
    m.todayBattles += 1;
  });
  activeBattle = {
    kind: "scripted",
    title: "龙巢 · 深渊古龙",
    round: 0,
    phase: "hero",
    heroClass: party[0]?.class || "warrior",
    heroLabel: `佣兵团 · ${party.length} 人`,
    hero: { ...heroStats, hp: heroStats.maxHp },
    enemy: { maxHp: bossState.maxHp, hp: bossState.maxHp, data: { name: "深渊古龙" }, level: 12 },
    enemyLabel: "深渊古龙 LV.12",
    enemyVisualName: "深渊古龙",
    heroAction: "idle",
    enemyAction: "idle",
    caption: "龙战即将开始",
    note: "龙巢战会显示佣兵团总血量与古龙血量，结算奖励以联机结果为准。",
    feed: [`${party.length} 名佣兵进入龙巢，总战力 ${format(partyPower)}。`],
    steps: [
      { actor: "hero", enemyHp: Math.max(0, bossState.maxHp - Math.max(1, Math.round(result.damage * 0.55))), heroHp: heroStats.maxHp, caption: "佣兵团发起猛攻", text: `佣兵团连续压制古龙，累计造成 ${format(Math.max(1, Math.round(result.damage * 0.55)))} 点伤害。` },
      { actor: "enemy", enemyHp: Math.max(0, bossState.maxHp - Math.max(1, Math.round(result.damage * 0.55))), heroHp: Math.max(1, heroStats.maxHp - Math.round(bossState.attack * (result.won ? 0.18 : 0.42))), caption: "古龙反击", text: "古龙张开双翼，以龙息横扫战场。" },
      { actor: "hero", enemyHp: result.won ? 0 : Math.max(1, result.hpLeft), heroHp: result.won ? Math.max(1, heroStats.maxHp - Math.round(bossState.attack * 0.18)) : Math.max(0, heroStats.maxHp - Math.round(bossState.attack * 0.65)), caption: result.won ? "深渊古龙倒下" : "古龙仍在咆哮", text: result.won ? `最终一击命中，古龙被击败，获得 ${format(result.gold)} G 与 ${formatPrimary(result.primary)} B。` : `本轮造成 ${format(result.damage)} 点总伤害，古龙剩余 ${format(result.hpLeft)} / ${format(result.maxHp)}。` }
    ],
    stepIndex: 0,
    result,
    returnAction: "return-dragon",
    returnLabel: "返回龙巢",
    settlementTitle: result.won ? "龙战胜利" : "龙战结算",
    applyResult: (finalResult) => {
      if (remote) state.worldBoss = remote.boss;
      state.lastDragonCaption = finalResult.won ? "深渊古龙倒下" : "龙息横扫战场";
      state.lastDragonAction = finalResult.won ? "death" : "attack";
      state.gold += finalResult.gold;
      state.primary += finalResult.primary;
      state.dragonLog = [
        `${party.length} 名佣兵挑战深渊古龙。`,
        finalResult.won ? `古龙被击败，获得 ${format(finalResult.gold)} G 与 ${formatPrimary(finalResult.primary)} B。` : `造成 ${format(result.damage)} 点伤害，获得 ${format(finalResult.gold)} G。`,
        remote ? `古龙剩余 ${format(result.hpLeft)} / ${format(result.maxHp)}。` : "古龙仍盘踞在深渊。"
      ];
      addToast(finalResult.won ? "龙战胜利。" : "龙战结算完成。");
    }
  };
  renderBattleModal();
  setTimeout(advanceBattle, 720);
}

async function uploadHero(id) {
  const merc = state.mercenaries.find((m) => m.id === id);
  if (!merc) return;
  merc.uploaded = true;
  const remote = await apiRequest("/api/leaderboard", {
    method: "POST",
    body: { user: currentUserName(), merc: { ...merc, base: { ...merc.base } }, power: battlePower(merc) }
  });
  if (remote) {
    state.leaderboard = remote.leaderboard;
    addToast("英雄已上传到联机排行榜。");
  } else {
    state.leaderboard.push({ id: uid("board"), user: currentUserName(), merc: { ...merc, base: { ...merc.base } }, power: battlePower(merc), time: Date.now() });
    addToast("英雄已上传到本地排行榜。");
  }
  render();
}

async function arenaChallenge(entryId) {
  const entry = state.leaderboard.find((e) => e.id === entryId);
  const attacker = state.mercenaries.filter((m) => m.status === "idle").sort((a, b) => battlePower(b) - battlePower(a))[0];
  if (!entry || !attacker) return addToast("没有空闲英雄可以挑战。");
  const remote = await apiRequest("/api/arena/challenge", {
    method: "POST",
    body: { entryId, attacker, power: battlePower(attacker), user: currentUserName() }
  });
  if (remote) {
    activeBattle = createArenaBattle(attacker, entry, {
      won: remote.record.won,
      history: remote.arenaHistory,
      leaderboard: remote.leaderboard,
      remote: true
    });
    renderBattleModal();
    return setTimeout(advanceBattle, 720);
  }
  const mult = classCounter(attacker.class, entry.merc.class);
  const atk = battlePower(attacker) * (0.9 + Math.random() * 0.2) * mult;
  const def = entry.power * (0.9 + Math.random() * 0.2);
  const won = atk > def;
  activeBattle = createArenaBattle(attacker, entry, { won, remote: false });
  renderBattleModal();
  setTimeout(advanceBattle, 720);
}

function classCounter(a, b) {
  if ((a === "warrior" && b === "rogue") || (a === "rogue" && b === "mage") || (a === "mage" && b === "warrior")) return 1.15;
  return 1;
}

function createArenaBattle(attacker, entry, options) {
  const hero = battleVitals(attacker);
  const enemyMerc = { ...entry.merc, class: entry.merc.class, level: entry.merc.level, base: { ...entry.merc.base } };
  const enemy = battleVitals(enemyMerc);
  const heroAfterHit = Math.max(1, hero.maxHp - Math.round(enemy.attack * (options.won ? 0.14 : 0.35)));
  const enemyAfterHit = Math.max(0, enemy.maxHp - Math.round(hero.attack * (options.won ? 1.1 : 0.48)));
  return {
    kind: "scripted",
    title: "互动区 · 荣誉对决",
    round: 0,
    phase: "hero",
    merc: attacker,
    heroClass: attacker.class,
    heroLabel: `${className(attacker.class)} LV.${attacker.level}`,
    hero: { ...hero, hp: hero.maxHp },
    enemy: { ...enemy, hp: enemy.maxHp, data: { name: className(entry.merc.class) }, level: entry.merc.level },
    enemyLabel: `${entry.user} · ${className(entry.merc.class)} LV.${entry.merc.level}`,
    enemyVisualName: entry.merc.class,
    heroAction: "idle",
    enemyAction: "idle",
    caption: "荣誉对决开始",
    note: "胜利后会自动用当前出战英雄替换排行榜上的目标，避免再让你手动同步一次。",
    feed: [`${className(attacker.class)}向${entry.user}发起挑战。`],
    steps: [
      { actor: "hero", enemyHp: enemyAfterHit, heroHp: hero.maxHp, caption: "先手突击", text: `${className(attacker.class)}率先出手，压低了对方血量。` },
      { actor: "enemy", enemyHp: enemyAfterHit, heroHp: heroAfterHit, caption: "对手反击", text: `${entry.user}的守擂英雄立刻还击。` },
      { actor: "hero", enemyHp: options.won ? 0 : Math.max(1, enemy.maxHp - Math.round(hero.attack * 0.32)), heroHp: options.won ? heroAfterHit : 0, caption: options.won ? "挑战胜利" : "挑战失败", text: options.won ? "最后一击命中，排行榜守擂英雄被替换。" : "对手顶住了攻势，本次挑战失败。" }
    ],
    stepIndex: 0,
    result: { won: options.won, gold: 0, primary: 0 },
    returnAction: "return-social",
    returnLabel: "返回互动区",
    settlementTitle: options.won ? "互动区挑战胜利" : "互动区挑战失败",
    applyResult: () => {
      state.lastArenaVisual = { leftClass: attacker.class, rightClass: entry.merc.class, caption: options.won ? "挑战胜利！" : "挑战失败" };
      if (options.remote) {
        state.arenaHistory = options.history || [];
        if (options.leaderboard) state.leaderboard = options.leaderboard;
      } else {
        state.arenaHistory.push(`${className(attacker.class)}挑战${entry.user}的${className(entry.merc.class)}：${options.won ? "胜利" : "失败"}`);
        if (options.won) {
          state.leaderboard = state.leaderboard.map((item) => item.id === entry.id ? { ...item, user: currentUserName(), merc: { ...attacker, base: { ...attacker.base } }, power: battlePower(attacker), time: Date.now() } : item);
        }
      }
      if (options.won) attacker.uploaded = true;
      addToast(options.won ? "互动区挑战胜利，已自动替换榜单目标。" : "互动区挑战失败。");
    }
  };
}

async function refreshOnlineData(showToast = false) {
  const health = await apiRequest("/api/health");
  state.online = Boolean(health && health.ok);
  if (!state.online) {
    if (showToast) addToast("后端未连接，当前使用本地模式。");
    return render();
  }
  const board = await apiRequest("/api/leaderboard");
  if (board) {
    state.leaderboard = board.leaderboard;
    state.arenaHistory = board.arenaHistory;
  }
  const boss = await apiRequest("/api/world-boss");
  if (boss) { state.worldBoss = boss.boss; state.worldBossQueue = boss.queue || []; }
  const sparring = await apiRequest("/api/sparring", { quiet: true });
  if (sparring) state.sparring = sparring.sparring;
  await refreshMailbox(false);
  if (showToast) addToast("联机数据已刷新。");
  render();
}

async function refreshMailbox(shouldRender = false) {
  if (!isLoggedIn()) return;
  const result = await apiRequest("/api/mail", { quiet: true });
  if (!result) return;
  state.mailbox = result.mail || [];
  const count = document.querySelector("#mailCount");
  if (count) count.textContent = state.mailbox.filter((mail) => !mail.read).length;
  if (shouldRender) render();
}

function openMailbox() {
  const mails = state.mailbox || [];
  openModal(`<div class="mailbox"><div class="modal-header"><h2>信箱</h2><div class="button-row">${button("全部已读", "read-all-mail")}${button("关闭", "close-modal")}</div></div><p class="muted">世界 Boss、排行榜和英雄交易的动态会投递到这里。</p><div class="mail-list">${mails.length ? mails.map((mail) => `<button class="mail-row ${mail.read ? "read" : "unread"}" data-action="read-mail:${mail.id}"><strong>${mail.title}</strong><span>${mail.content}</span><small>${new Date(mail.time).toLocaleString("zh-CN")}</small></button>`).join("") : `<div class="empty">暂时没有新邮件。</div>`}</div></div>`, "modal-mailbox");
}

async function readMail(id) {
  const result = await apiRequest("/api/mail/read", { method: "POST", body: { id } });
  if (!result) return;
  state.mailbox = result.mail || [];
  openMailbox();
  const count = document.querySelector("#mailCount");
  if (count) count.textContent = state.mailbox.filter((mail) => !mail.read).length;
}

async function apiRequest(path, options = {}) {
  try {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (auth.token) headers["X-Auth-Token"] = auth.token;
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "??????");
    return payload;
  } catch (error) {
    if (!options.quiet) {
      authMessage = error.message || "请求失败";
      authMessageType = "error";
    }
    state.online = false;
    return null;
  }
}

async function attemptSessionRestore() {
  if (!auth.token) return false;
  const session = await apiRequest("/api/auth/session", { quiet: true });
  if (!session?.ok) {
    setAuth(null);
    hydrateIncomingState(seedState());
    return false;
  }
  setAuth(session);
  authMessage = "";
  authMessageType = "";
  const fallbackState = session.giftPending ? buildNewAccountState() : seedState();
  hydrateIncomingState(session.state || loadState() || fallbackState);
  if (session.giftPending && !session.state) saveState();
  return true;
}

async function runAuthAction(mode, form) {
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  if (!username || !password) {
    authMessage = "???????????";
    authMessageType = "error";
    renderAuthGate();
    return;
  }
  authBusy = true;
  authMessage = "";
  authMessageType = "";
  renderAuthGate();
  const result = await apiRequest(`/api/auth/${mode}`, { method: "POST", body: { username, password }, quiet: true });
  authBusy = false;
  if (!result?.ok) {
    authMessage = result?.error || (mode === "login" ? "?????" : "?????");
    authMessageType = "error";
    renderAuthGate();
    return;
  }
  setAuth(result);
  authMode = "login";
  authMessage = mode === "register" ? "?????9 ????????" : "?????";
  authMessageType = "success";
  const baseState = result.state || (result.giftPending ? buildNewAccountState() : loadState()) || seedState();
  hydrateIncomingState(baseState);
  render();
  if (result.giftPending && !result.state) saveState();
  refreshOnlineData(false);
}

function signOut() {
  clearTimeout(pendingSaveTimer);
  setAuth(null);
  hydrateIncomingState(seedState());
  authMode = "login";
  authBusy = false;
  authMessage = "???????";
  authMessageType = "success";
  closeModal();
  render();
}

async function bootstrap() {
  updateAuthShell();
  const restored = await attemptSessionRestore();
  if (!restored && !isLoggedIn()) {
    render();
    return;
  }
  render();
  runSmokeTestIfRequested();
  runVisualAuditIfRequested();
  runSummonProbabilityAuditIfRequested();
  refreshOnlineData(false);
}

function openModal(content, modifier = "") {
  const layer = document.querySelector("#modalLayer");
  layer.innerHTML = `<div class="modal ${modifier}">${content}</div>`;
  layer.classList.add("open");
}

function closeModal() {
  const layer = document.querySelector("#modalLayer");
  layer.classList.remove("open");
  layer.innerHTML = "";
}

document.addEventListener("click", (event) => {
  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) {
    authMode = authTab.dataset.authTab;
    authMessage = "";
    authMessageType = "";
    renderAuthGate();
    return;
  }
  const lockedAction = event.target.closest("[data-action]")?.dataset.action;
  if (lockedAction === "sign-out") return signOut();
  if (!isLoggedIn()) return;
  if (activeBattle || upgradeSequenceActive || (battleSettlementOpen && !["return-dungeon", "return-dragon", "return-social"].includes(lockedAction)) || (upgradeResultOpen && lockedAction !== "return-mercenaries")) return;
  const navTarget = event.target.closest("[data-nav]");
  if (navTarget) {
    state.currentView = navTarget.dataset.nav;
    render();
    return;
  }
  const tradeMerc = event.target.closest("[data-trade-merc]");
  if (tradeMerc) {
    state.selectedTradeMercenaryId = tradeMerc.dataset.tradeMerc;
    return render();
  }
  const selectMerc = event.target.closest("[data-select-merc]");
  if (selectMerc) {
    state.selectedMercenaryId = selectMerc.dataset.selectMerc;
    render();
    return;
  }
  const dragonMerc = event.target.closest("[data-dragon-merc]");
  if (dragonMerc) {
    const id = dragonMerc.dataset.dragonMerc;
    state.selectedDragonIds = state.selectedDragonIds.includes(id) ? state.selectedDragonIds.filter((x) => x !== id) : [...state.selectedDragonIds, id].slice(0, 10);
    render();
    return;
  }
  const difficulty = event.target.closest("[data-difficulty]");
  if (difficulty) {
    state.selectedDungeon = difficulty.dataset.difficulty;
    state.selectedFloor = Math.min(state.selectedFloor, state.unlocked[state.selectedDungeon] || 1);
    render();
    return;
  }
  const floor = event.target.closest("[data-floor]");
  if (floor) {
    state.selectedFloor = Number(floor.dataset.floor);
    render();
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (action === "recruit") return recruit();
  if (action === "summon-gate") return openSummonGate();
  if (action === "summon-finish") return finishSummonGate();
  if (action === "trade-refresh") return refreshTradeListings();
  if (action === "trade-list") return listSelectedTradeMercenary();
  if (action.startsWith("trade-buy:")) return buyTradeMercenary(action.split(":")[1]);
  if (action === "reset-filters") {
    state.filters = { class: "all", status: "all", sort: "power" };
    return render();
  }
  if (action === "reset-work-filters") {
    state.workFilters = { class: "all", attribute: "all", minimum: 0, sort: "recommended" };
    return render();
  }
  if (action === "close-modal") return closeModal();
  if (action === "open-mailbox") return openMailbox();
  if (action === "read-all-mail") return readMail("all");
  if (action.startsWith("read-mail:")) return readMail(action.split(":")[1]);
  if (action.startsWith("detail:")) return openDetail(action.split(":")[1]);
  if (action.startsWith("upgrade:")) return openUpgrade(action.split(":")[1]);
  if (action.startsWith("confirm-upgrade:")) return performUpgrade(action.split(":")[1]);
  if (action.startsWith("prepare-start-work:")) return confirmWorkStart(action.split(":")[1]);
  if (action.startsWith("confirm-start-work:")) { closeModal(); return startWork(action.split(":")[1]); }
  if (action.startsWith("start-work:")) return confirmWorkStart(action.split(":")[1]);
  if (action.startsWith("claim:")) return claimWork(action.split(":")[1]);
  if (action.startsWith("prepare-stop-work:")) return confirmStopWork(action.split(":")[1]);
  if (action.startsWith("confirm-stop-work:")) { closeModal(); return claimWork(action.split(":")[1], true); }
  if (action.startsWith("stop-work:")) return confirmStopWork(action.split(":")[1]);
  if (action === "claim-all") return claimAll();
  if (action === "prepare-dispatch-filtered" || action === "dispatch-filtered") return confirmDispatchFiltered();
  if (action === "confirm-dispatch-filtered") { closeModal(); return dispatchFiltered(); }
  if (action === "start-battle") return startBattle();
  if (action === "return-mercenaries") {
    upgradeResultOpen = false;
    closeModal();
    state.currentView = "mercenaries";
    return render();
  }
  if (action === "return-dungeon") {
    battleSettlementOpen = false;
    closeModal();
    state.currentView = "dungeon";
    return render();
  }
  if (action === "return-dragon") {
    battleSettlementOpen = false;
    closeModal();
    state.currentView = "dragon";
    return render();
  }
  if (action === "return-social") {
    battleSettlementOpen = false;
    closeModal();
    state.currentView = "social";
    return render();
  }
  if (action === "dragon-select-all") {
    state.selectedDragonIds = state.mercenaries.slice(0, 10).map((m) => m.id);
    return render();
  }
  if (action === "world-boss-queue") return queueWorldBoss();
  if (action === "dragon-start") return startDragonBattle();
  if (action === "refresh-board") return refreshOnlineData(true);
  if (action === "reset-board") {
    state.leaderboard = makeNpcLeaderboard();
    return render();
  }
  if (action.startsWith("upload:")) return uploadHero(action.split(":")[1]);
  if (action.startsWith("arena:")) return arenaChallenge(action.split(":")[1]);
  if (action.startsWith("sparring-defend:")) return setSparringDefense(action.split(":")[1]);
  if (action.startsWith("sparring-challenge:")) return challengeSparring(action.split(":")[1]);
  if (action.startsWith("grant-")) return grant(action.replace("grant-", ""));
  if (action === "reset-game") {
    hydrateIncomingState(seedState());
    return render();
  }
  if (action === "delete-save") {
    localStorage.removeItem(storageKey());
    hydrateIncomingState(seedState());
    return render();
  }
});

document.addEventListener("submit", (event) => {
  const authForm = event.target.closest("[data-auth-form]");
  if (!authForm) return;
  event.preventDefault();
  const mode = authForm.dataset.authForm;
  runAuthAction(mode, new FormData(authForm));
});

document.addEventListener("change", (event) => {
  const workFilter = event.target.closest("[data-work-filter]");
  if (workFilter) {
    const key = workFilter.dataset.workFilter;
    state.workFilters[key] = key === "minimum" ? Number(workFilter.value) : workFilter.value;
    if (key === "attribute" && workFilter.value === "all") state.workFilters.minimum = 0;
    return render();
  }
  const tradeFilter = event.target.closest("[data-trade-filter]");
  if (tradeFilter) {
    const key = tradeFilter.dataset.tradeFilter;
    state.tradeFilters[key] = ["minLevel", "minAttribute"].includes(key) ? Number(tradeFilter.value || 0) : tradeFilter.value;
    return refreshTradeListings();
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filters[filter.dataset.filter] = filter.value;
    render();
  }
  const setting = event.target.closest("[data-setting]");
  if (setting) {
    state.settings[setting.dataset.setting] = setting.checked;
    render();
  }
});

function grant(size) {
  const values = {
    small: [1000, 100],
    medium: [50000, 500],
    large: [1000000, 1000],
    huge: [100000000, 5000]
  }[size];
  if (!values) return;
  state.gold += values[0];
  state.primary += values[1];
  addToast("资源已发放。");
  render();
}

setInterval(() => tickWork(true), 30000);
bootstrap();

window.GameTest = {
  summon(count = 1000) {
    return Array.from({ length: count }, () => generateMercenary());
  },
  summarizeSummons(count = 1000) {
    return this.summon(count).reduce((summary, merc) => {
      summary[qualityName(merc)] = (summary[qualityName(merc)] || 0) + 1;
      return summary;
    }, {});
  },
  qualityTable,
  rollUpgradeFailure
};

async function runSmokeTestIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("qa") !== "smoke") return;
  const results = [];
  const record = (name, pass, detail = "") => results.push({ name, pass, detail });

  try {
    const beforeCount = state.mercenaries.length;
    const beforePrimary = state.primary;
    recruit();
    record("招募会新增佣兵并消耗 1 主币", state.mercenaries.length === beforeCount + 1 && state.primary === beforePrimary - 1);

    const idle = state.mercenaries.find((m) => m.status === "idle");
    startWork(idle.id);
    const working = state.mercenaries.find((m) => m.id === idle.id);
    record("开始工作会绑定工作状态和工作类型", working.status === "working" && Boolean(working.workType));

    const beforeGold = state.gold;
    working.workStartTime = Date.now() - 60000;
    claimWork(working.id);
    record("领取工作收益会增加碎金", state.gold > beforeGold);

    grant("large");
    const upgradeTarget = state.mercenaries.find((m) => m.status === "idle" && m.level < 12);
    const beforeLevel = upgradeTarget.level;
    const beforeUpgradeGold = state.gold;
    performUpgrade(upgradeTarget.id);
    const upgraded = state.mercenaries.find((m) => m.id === upgradeTarget.id);
    record("升级失败率会按概率命中", rollUpgradeFailure(0.5, 0.1) && !rollUpgradeFailure(0.5, 0.9));
    record("升级流程会消耗资源并进入结算", state.gold < beforeUpgradeGold || !upgraded || upgraded.level >= beforeLevel);

    state.selectedMercenaryId = state.mercenaries.find((m) => m.status === "idle")?.id || null;
    const battleGold = state.gold;
    startBattle();
    record("迷宫挑战会消耗入场费并写入战斗日志", state.gold !== battleGold && state.battleLog.length >= 3);

    const uploadTarget = state.mercenaries.find((m) => m.status === "idle");
    if (uploadTarget) await uploadHero(uploadTarget.id);
    record("排行榜上传会写入或更新英雄", Boolean(uploadTarget?.uploaded && state.leaderboard.some((entry) => entry.merc.id === uploadTarget.id)));
  } catch (error) {
    record("自检执行过程", false, error.message);
  }

  const panel = document.createElement("section");
  panel.id = "qaSmokePanel";
  panel.className = "panel";
  panel.style.margin = "16px auto";
  panel.style.width = "min(1480px, calc(100vw - 32px))";
  panel.innerHTML = `<h2>QA Smoke Test</h2>${results.map((r) => `<div class="row"><span>${r.name}</span><strong>${r.pass ? "PASS" : "FAIL"}</strong><small>${r.detail || ""}</small></div>`).join("")}`;
  document.body.appendChild(panel);
  saveState();
}

function runVisualAuditIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("audit") !== "detail") return;
  const firstMercenary = state.mercenaries[0];
  if (!firstMercenary) return;
  state.currentView = "mercenaries";
  render();
  openDetail(firstMercenary.id);
}

function runSummonProbabilityAuditIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("qa") !== "summon") return;
  const count = 1000;
  const sample = Array.from({ length: count }, () => generateMercenary());
  const summary = sample.reduce((result, merc) => {
    result[qualityName(merc)] = (result[qualityName(merc)] || 0) + 1;
    return result;
  }, {});
  const attributeViolations = sample.filter((merc) => {
    const quality = qualityTable.find((item) => item.key === merc.quality);
    const total = totalAttr(merc);
    const main = mainAttr(merc);
    return !quality || total < quality.total[0] || total > quality.total[1] + 20 || main < quality.main[0] || main > quality.main[1];
  }).length;
  const validationSummary = {};
  for (let index = 0; index < 100000; index += 1) {
    const merc = generateMercenary();
    validationSummary[qualityName(merc)] = (validationSummary[qualityName(merc)] || 0) + 1;
  }
  const panel = document.createElement("section");
  panel.id = "summonAuditPanel";
  panel.className = "panel";
  panel.style.margin = "16px auto";
  panel.style.width = "min(1480px, calc(100vw - 32px))";
  panel.innerHTML = `<h2>1000次实际召唤测试</h2><div class="list">${qualityTable.map((quality) => `<div class="row"><span>${quality.name}</span><strong data-quality-count="${quality.key}">${summary[quality.name] || 0}</strong><small>理论均值 ${(quality.rate * count).toFixed(2)} · 十万次验证折算每千次 ${((validationSummary[quality.name] || 0) / 100).toFixed(2)}</small></div>`).join("")}<div class="row"><span>属性档位异常</span><strong>${attributeViolations}</strong><small>目标为 0</small></div></div>`;
  document.body.appendChild(panel);
}
