// cloudfunctions/initGames/index.js
// 一键导入精选游戏种子数据 + 分类数据
const cloud = require('wx-server-sdk');
const seeds = require('./seeds.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 分类种子数据
const CATEGORIES = [
  { _id: 'cat_action', name: '动作', icon: '⚔️', sort: 1 },
  { _id: 'cat_rpg', name: '角色扮演', icon: '🧙', sort: 2 },
  { _id: 'cat_indie', name: '独立', icon: '✨', sort: 3 },
  { _id: 'cat_sim', name: '模拟经营', icon: '🌾', sort: 4 },
  { _id: 'cat_strategy', name: '策略', icon: '🏛️', sort: 5 },
  { _id: 'cat_puzzle', name: '解谜', icon: '🧩', sort: 6 },
  { _id: 'cat_adventure', name: '冒险', icon: '🗺️', sort: 7 },
  { _id: 'cat_sandbox', name: '沙盒', icon: '🔨', sort: 8 },
  { _id: 'cat_casual', name: '休闲', icon: '🎲', sort: 9 },
];

// ============ Upsert：按 externalIds.steam 智能合并 ============
async function upsertGame(col, game) {
  const now = new Date();
  const steamId = game.externalIds.steam;

  const { data: existing } = await col
    .where({ 'externalIds.steam': steamId })
    .limit(1)
    .get();

  if (existing.length === 0) {
    // 新增
    await col.add({
      data: {
        ...game,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { seed: now },
      },
    });
    return 'inserted';
  }

  // 已存在：合并策略——种子只补缺失字段，不覆盖已被其他源更新过的价格/评分
  const old = existing[0];
  const merged = {
    // 中文字段：种子优先（最稳）
    name: game.name,
    nameEn: game.nameEn,
    description: old.description && old.description.length > game.description.length
      ? old.description
      : game.description,
    cover: old.cover || game.cover,
    headerImage: old.headerImage || game.headerImage,
    screenshots: (old.screenshots && old.screenshots.length > 0) ? old.screenshots : game.screenshots,
    // 价格 / 评分：如果其他源已同步过则不覆盖
    price: hasSource(old, 'cheapshark') ? old.price : game.price,
    originalPrice: hasSource(old, 'cheapshark') ? old.originalPrice : game.originalPrice,
    discount: hasSource(old, 'cheapshark') ? old.discount : game.discount,
    rating: hasSource(old, 'steamspy') ? old.rating : game.rating,
    storeUrls: { ...game.storeUrls, ...(old.storeUrls || {}) },
    // 标签合并去重
    tags: Array.from(new Set([...(old.tags || []), ...game.tags])),
    platforms: Array.from(new Set([...(old.platforms || []), ...game.platforms])),
    categoryId: old.categoryId || game.categoryId,
    developer: old.developer || game.developer,
    publisher: old.publisher || game.publisher,
    releasedAt: old.releasedAt || game.releasedAt,
    dataSources: Array.from(new Set([...(old.dataSources || []), 'seed'])),
    updatedAt: now,
    'lastSyncedAt.seed': now,
  };

  await col.doc(old._id).update({ data: merged });
  return 'updated';
}

function hasSource(doc, source) {
  return Array.isArray(doc.dataSources) && doc.dataSources.includes(source);
}

// ============ 主入口 ============
exports.main = async (event, context) => {
  const { dryRun = false } = event;

  const stats = {
    categories: { upserted: 0, failed: 0 },
    games: { inserted: 0, updated: 0, failed: 0 },
    failures: [],
  };

  try {
    // 1. 导入分类（用 doc().set() 实现 upsert：存在则覆盖、不存在则创建，可指定自定义 _id）
    const catCol = db.collection('categories');
    for (const cat of CATEGORIES) {
      if (dryRun) continue;
      try {
        const { _id, ...catData } = cat; // ⚠️ update/set 时 data 不能包含 _id
        await catCol.doc(_id).set({
          data: { ...catData, updatedAt: new Date() },
        });
        stats.categories.upserted++;
      } catch (e) {
        console.warn('[initGames] category error:', cat._id, e.message);
        stats.categories.failed++;
      }
    }

    // 2. 导入游戏
    const gamesCol = db.collection('games');
    for (const game of seeds) {
      if (dryRun) continue;
      try {
        const result = await upsertGame(gamesCol, game);
        stats.games[result]++;
      } catch (e) {
        stats.games.failed++;
        stats.failures.push({ name: game.name, error: e.message });
        console.error('[initGames] game error:', game.name, e.message);
      }
    }

    return {
      code: 0,
      message: dryRun ? 'dry run, no data written' : 'done',
      data: {
        ...stats,
        totalSeeds: seeds.length,
        totalCategories: CATEGORIES.length,
      },
    };
  } catch (err) {
    console.error('[initGames] fatal:', err);
    return {
      code: 5000,
      message: err.message,
      data: stats,
    };
  }
};
