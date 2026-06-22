window.GameData = {
  classes: {
    warrior: {
      name: "战士",
      main: "strength",
      sub: "constitution",
      attack: "strength",
      color: "blue",
      idle: "./assets/heroes/hero_warrior_idle.png",
      summon: "./assets/heroes/hero_warrior_summon.png",
      weights: { strength: 0.22, agility: 0.14, intelligence: 0.12, constitution: 0.2, willpower: 0.2, spirit: 0.12 }
    },
    rogue: {
      name: "盗贼",
      main: "agility",
      sub: "strength",
      attack: "strength",
      color: "purple",
      idle: "./assets/heroes/hero_rogue_idle.png",
      summon: "./assets/heroes/hero_rogue_summon.png",
      weights: { strength: 0.2, agility: 0.24, intelligence: 0.14, constitution: 0.14, willpower: 0.16, spirit: 0.12 }
    },
    mage: {
      name: "法师",
      main: "intelligence",
      sub: "spirit",
      attack: "intelligence",
      color: "purple",
      idle: "./assets/heroes/hero_mage_idle.png",
      summon: "./assets/heroes/hero_mage_summon.png",
      weights: { strength: 0.11, agility: 0.14, intelligence: 0.24, constitution: 0.13, willpower: 0.18, spirit: 0.2 }
    }
  },
  attrLabels: {
    strength: "力量",
    agility: "敏捷",
    intelligence: "智力",
    constitution: "体质",
    willpower: "意志",
    spirit: "精神"
  },
  qualityTable: [
    { key: "legendary", name: "传奇卡", rate: 0.0008, total: [400, 420], main: [98, 100], color: "#ffb936" },
    { key: "qualified", name: "合格卡", rate: 0.04, total: [300, 399], main: [90, 97], color: "#b96cff" },
    { key: "excellent", name: "优良卡", rate: 0.1592, total: [270, 329], main: [80, 89], color: "#4aa8ff" },
    { key: "normal", name: "普通卡", rate: 0.6, total: [220, 289], main: [60, 79], color: "#55c271" },
    { key: "flawed", name: "残缺卡", rate: 0.2, total: [180, 239], main: [35, 69], color: "#9aa0a6" }
  ],
  workTypes: {
    odd: { name: "打零工", class: null, base: 0.01, desc: "无门槛基础工作" },
    patrol: { name: "防火墙巡逻", class: "warrior", mainMin: 86, subMin: 61, desc: "战士专属，力量与体质达标后开放" },
    infiltrate: { name: "暗网渗透", class: "rogue", mainMin: 86, subMin: 61, desc: "盗贼专属，敏捷与力量达标后开放" },
    archive: { name: "数据解析", class: "mage", mainMin: 86, subMin: 61, desc: "法师专属，智力与精神达标后开放" },
    abyss: { name: "深渊领域", class: null, totalMin: 401, base: 0.07, desc: "总属性极高佣兵可执行" }
  },
  levelMultipliers: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 25, 7: 50, 8: 75, 9: 100, 10: 200, 11: 300, 12: 500 },
  upgradeTable: {
    2: { gold: 20000, primary: 0, fail: 0 },
    3: { gold: 50000, primary: 0, fail: 0 },
    4: { gold: 150000, primary: 0, fail: 0 },
    5: { gold: 420000, primary: 4, fail: 0 },
    6: { gold: 900000, primary: 35, fail: 0.2 },
    7: { gold: 1800000, primary: 80, fail: 0.22 },
    8: { gold: 3800000, primary: 260, fail: 0.25 },
    9: { gold: 7000000, primary: 600, fail: 0.28 },
    10: { gold: 12000000, primary: 900, fail: 0.3 },
    11: { gold: 24000000, primary: 1600, fail: 0.4 },
    12: { gold: 48000000, primary: 3200, fail: 0.45 }
  },
  dungeons: {
    easy: {
      name: "简单",
      title: "遗骨回廊",
      enemyLevel: [1, 3],
      baseCost: 1000,
      perFloor: 500,
      reward: 1,
      success: 0.8,
      monsters: [
        { name: "骸骨守卫", attackType: "physical" },
        { name: "洞穴蜘蛛", attackType: "physical" },
        { name: "地穴蠕虫", attackType: "magic" }
      ],
      floors: ["灰烬门厅", "蛛网甬道", "腐土墓室", "断剑祭坛", "守墓者王庭"]
    },
    medium: {
      name: "中等",
      title: "诅咒地窟",
      enemyLevel: [3, 6],
      baseCost: 3500,
      perFloor: 1000,
      reward: 1.5,
      success: 0.6,
      monsters: [
        { name: "诅咒法师", attackType: "magic" },
        { name: "腐化骑士", attackType: "physical" },
        { name: "宝箱怪", attackType: "physical" }
      ],
      floors: ["低语书库", "黑铁囚廊", "贪欲宝库", "亡誓礼堂", "咒王密室"]
    },
    hard: {
      name: "困难",
      title: "深渊禁域",
      enemyLevel: [6, 9],
      baseCost: 8500,
      perFloor: 2000,
      reward: 1.9,
      success: 0.4,
      monsters: [
        { name: "石像魔", attackType: "physical", unlockFloor: 1 },
        { name: "深渊眼魔", attackType: "magic", unlockFloor: 1 },
        { name: "精英骸骨守卫", attackType: "physical", unlockFloor: 2 },
        { name: "血纹洞穴蜘蛛", attackType: "physical", unlockFloor: 2 },
        { name: "腐化地穴蠕虫", attackType: "magic", unlockFloor: 3 },
        { name: "黑咒法师", attackType: "magic", unlockFloor: 3 },
        { name: "深渊骑士", attackType: "physical", unlockFloor: 4 },
        { name: "贪欲宝箱怪", attackType: "physical", unlockFloor: 5 }
      ],
      floors: ["石翼前庭", "凝视长廊", "猩红熔窟", "无光王座", "深渊核心"]
    }
  },
  floorTiers: {
    1: { name: "灰阶", outline: "#9aa0a6", enemyMultiplier: 1 },
    2: { name: "翠阶", outline: "#55c271", enemyMultiplier: 1.12 },
    3: { name: "蓝阶", outline: "#4aa8ff", enemyMultiplier: 1.28 },
    4: { name: "紫阶", outline: "#a96cff", enemyMultiplier: 1.48 },
    5: { name: "金阶", outline: "#f2bd45", enemyMultiplier: 1.75 }
  },
  floorFactor: { 1: 1, 2: 1.15, 3: 1.35, 4: 1.6, 5: 1.9 },
  dragon: {
    name: "深渊古龙",
    costGold: 30000,
    costPrimary: 12,
    base: { hp: 117000, attack: 3900, defense: 650, resist: 650, agility: 195 },
    perMerc: { hp: 4680, attack: 98 }
  },
  nav: [
    { id: "home", label: "控制中心" },
    { id: "mercenaries", label: "佣兵管理" },
    { id: "work", label: "工作派遣" },
    { id: "dungeon", label: "数据迷宫" },
    { id: "dragon", label: "龙巢" },
    { id: "social", label: "互动区" },
    { id: "trade", label: "英雄交易" },
    { id: "settings", label: "设置" }
  ]
};
