// cloudfunctions/history/index.js
// 浏览历史：list / clear / remove
// 注：report（上报浏览历史）已在 getGameDetail 内完成，本函数仅做读取与维护
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const historyCol = db.collection('history');
const gamesCol = db.collection('games');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action = 'list' } = event;

  if (!OPENID) {
    return { code: 1002, message: '未登录', data: null };
  }

  try {
    switch (action) {
      case 'list':
        return await handleList(event, OPENID);
      case 'count':
        return await handleCount(OPENID);
      case 'clear':
        return await handleClear(OPENID);
      case 'remove':
        return await handleRemove(event, OPENID);
      default:
        return { code: 1001, message: `未知 action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[history] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};

// ============ list：分页拉取浏览历史 ============
// 通过两次查询合并 game 信息（避免 lookup 在云数据库实现差异）
async function handleList(event, openid) {
  const { page = 1, pageSize = 20 } = event;

  // 1. 拉历史记录
  const { data: histories } = await historyCol
    .where({ _openid: openid })
    .orderBy('viewedAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  if (!histories || histories.length === 0) {
    return {
      code: 0,
      message: 'ok',
      data: { list: [], page, pageSize, hasMore: false },
    };
  }

  // 2. 批量拉对应 game 数据
  const gameIds = histories.map((h) => h.gameId).filter(Boolean);
  let gamesMap = {};
  if (gameIds.length > 0) {
    try {
      const { data: games } = await gamesCol
        .where({ _id: _.in(gameIds) })
        .field({
          name: true,
          nameEn: true,
          cover: true,
          headerImage: true,
          rating: true,
          price: true,
          tags: true,
          description: true,
        })
        .get();
      gamesMap = (games || []).reduce((acc, g) => {
        acc[g._id] = g;
        return acc;
      }, {});
    } catch (e) {
      console.warn('[history:list] fetch games fail:', e.message);
    }
  }

  // 3. 合并：保留浏览顺序，附上 game 字段（找不到的 game 仍保留历史记录但标记 missing）
  const list = histories.map((h) => ({
    _id: h._id,
    gameId: h.gameId,
    viewedAt: h.viewedAt,
    game: gamesMap[h.gameId] || null,
  }));

  return {
    code: 0,
    message: 'ok',
    data: {
      list,
      page,
      pageSize,
      hasMore: histories.length === pageSize,
    },
  };
}

// ============ count：浏览历史总数（用于"我的"页统计） ============
async function handleCount(openid) {
  const { total } = await historyCol.where({ _openid: openid }).count();
  return { code: 0, message: 'ok', data: { total } };
}

// ============ clear：清空全部浏览历史 ============
async function handleClear(openid) {
  // 云数据库 where().remove() 单次最多删 1000 条，循环删干净
  let totalRemoved = 0;
  for (let i = 0; i < 100; i++) {
    const { stats } = await historyCol.where({ _openid: openid }).remove();
    const removed = (stats && stats.removed) || 0;
    totalRemoved += removed;
    if (removed === 0) break;
  }

  return {
    code: 0,
    message: 'ok',
    data: { removed: totalRemoved },
  };
}

// ============ remove：删除单条 ============
async function handleRemove(event, openid) {
  const { id, gameId } = event;
  if (!id && !gameId) {
    return { code: 1001, message: '缺少 id 或 gameId', data: null };
  }

  const where = { _openid: openid };
  if (id) where._id = id;
  else where.gameId = gameId;

  const { stats } = await historyCol.where(where).remove();
  return {
    code: 0,
    message: 'ok',
    data: { removed: (stats && stats.removed) || 0 },
  };
}
