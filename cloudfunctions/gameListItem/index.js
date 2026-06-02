// cloudfunctions/gameListItem/index.js
// 清单内游戏 + 评价管理：add / remove / updateReview / list
// 每个清单最多 100 个游戏，评价 ≤ 500 字 + 走内容安全审核
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const itemsCol = db.collection('gameListItems');
const listsCol = db.collection('gameLists');
const gamesCol = db.collection('games');

const MAX_ITEMS_PER_LIST = 100;
const REVIEW_MAX = 500;
const RATING_MIN = 0;     // 0 表示未评分
const RATING_MAX = 10;

// 集合自动初始化（与 gameList 函数共用，幂等）
let _ensured = false;
async function ensureCollections() {
  if (_ensured) return;
  const names = ['gameLists', 'gameListItems'];
  await Promise.all(
    names.map(async (n) => {
      try {
        await db.createCollection(n);
      } catch (e) {
        if (
          e.errCode !== -501001 &&
          !/already exist/i.test(e.errMsg || e.message || '')
        ) {
          console.warn('[gameListItem] createCollection failed:', n, e.message);
        }
      }
    })
  );
  _ensured = true;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action = 'list' } = event;

  if (!OPENID) {
    return { code: 1002, message: '未登录', data: null };
  }

  try { await ensureCollections(); } catch (e) {}

  try {
    switch (action) {
      case 'add':           return await handleAdd(event, OPENID);
      case 'remove':        return await handleRemove(event, OPENID);
      case 'updateReview':  return await handleUpdateReview(event, OPENID);
      case 'list':          return await handleList(event, OPENID);
      case 'inLists':       return await handleInLists(event, OPENID);
      default:
        return { code: 1001, message: `未知 action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[gameListItem] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};

// ============ add: 添加游戏到清单 ============
async function handleAdd(event, openid) {
  const { listId, gameId } = event;
  if (!listId || !gameId) {
    return { code: 1001, message: '缺少 listId 或 gameId', data: null };
  }

  // 校验清单归属
  const list = await listsCol.doc(listId).get().catch(() => null);
  if (!list || !list.data || list.data._openid !== openid) {
    return { code: 1003, message: '清单不存在或无权操作', data: null };
  }

  // 校验游戏存在
  const game = await gamesCol.doc(gameId).get().catch(() => null);
  if (!game || !game.data) {
    return { code: 2001, message: '游戏不存在', data: null };
  }

  // 去重：同一清单下同一游戏不能重复添加
  const existing = await itemsCol
    .where({ listId, gameId, _openid: openid })
    .limit(1)
    .get();
  if (existing.data.length > 0) {
    return {
      code: 0,
      message: 'ok (already exists)',
      data: { item: existing.data[0], isNew: false },
    };
  }

  // 容量上限
  const count = await itemsCol.where({ listId, _openid: openid }).count();
  if (count.total >= MAX_ITEMS_PER_LIST) {
    return {
      code: 1004,
      message: `单清单最多 ${MAX_ITEMS_PER_LIST} 款游戏`,
      data: null,
    };
  }

  const now = new Date();
  const result = await itemsCol.add({
    data: {
      _openid: openid,
      listId,
      gameId,
      rating: 0,
      review: '',
      addedAt: now,
      sort: now.getTime() / -1000,
    },
  });

  // 更新清单游戏数 + 时间戳
  await listsCol.doc(listId).update({
    data: {
      gameCount: _.inc(1),
      updatedAt: now,
    },
  });

  const item = await itemsCol.doc(result._id).get();
  return { code: 0, message: 'ok', data: { item: item.data, isNew: true } };
}

// ============ remove: 从清单移除游戏 ============
async function handleRemove(event, openid) {
  const { id, listId, gameId } = event;

  let target;
  if (id) {
    target = await itemsCol.doc(id).get().catch(() => null);
  } else if (listId && gameId) {
    const r = await itemsCol.where({ listId, gameId, _openid: openid }).limit(1).get();
    target = r.data.length > 0 ? { data: r.data[0] } : null;
  }
  if (!target || !target.data) {
    return { code: 2001, message: '游戏不在该清单', data: null };
  }
  if (target.data._openid !== openid) {
    return { code: 1003, message: '无权操作', data: null };
  }

  await itemsCol.doc(target.data._id).remove();
  // 更新清单游戏数
  await listsCol.doc(target.data.listId).update({
    data: { gameCount: _.inc(-1), updatedAt: new Date() },
  }).catch(() => {});

  return { code: 0, message: 'ok', data: { id: target.data._id } };
}

// ============ updateReview: 更新评分 + 评价 ============
async function handleUpdateReview(event, openid) {
  const { id, listId, gameId, rating, review } = event;

  // 定位条目
  let target;
  if (id) {
    target = await itemsCol.doc(id).get().catch(() => null);
  } else if (listId && gameId) {
    const r = await itemsCol.where({ listId, gameId, _openid: openid }).limit(1).get();
    target = r.data.length > 0 ? { data: r.data[0] } : null;
  }
  if (!target || !target.data) {
    return { code: 2001, message: '记录不存在', data: null };
  }
  if (target.data._openid !== openid) {
    return { code: 1003, message: '无权操作', data: null };
  }

  const patch = { updatedAt: new Date() };

  // 校验评分
  if (typeof rating === 'number') {
    if (rating < RATING_MIN || rating > RATING_MAX) {
      return {
        code: 1003,
        message: `评分需在 ${RATING_MIN}-${RATING_MAX} 之间`,
        data: null,
      };
    }
    patch.rating = Math.round(rating * 10) / 10; // 保留 1 位小数
  }

  // 校验评价文本
  if (typeof review === 'string') {
    const trimmed = review.trim();
    if (trimmed.length > REVIEW_MAX) {
      return {
        code: 1003,
        message: `评价不能超过 ${REVIEW_MAX} 字`,
        data: null,
      };
    }
    // 内容安全审核（非空才走）— fail-closed：审核服务异常时也拒绝写入
    if (trimmed) {
      let checkData = null;
      try {
        const res = await cloud.callFunction({
          name: 'contentCheck',
          data: { action: 'text', content: trimmed, scene: 2 }, // scene=2 评论
        });
        checkData = (res.result && res.result.data) || null;
      } catch (e) {
        console.error('[gameListItem:updateReview] contentCheck invoke error:', e.message);
      }
      // 没有结果 或 pass !== true → 拒绝
      if (!checkData || checkData.pass !== true) {
        const degraded = !checkData || checkData.degraded === true;
        return {
          code: degraded ? 5001 : 1005,
          message: (checkData && checkData.message) || (degraded ? '审核服务暂不可用，请稍后再试' : '评价包含违规内容'),
          data: null,
        };
      }
    }
    patch.review = trimmed;
  }

  await itemsCol.doc(target.data._id).update({ data: patch });
  // 同步更新 list 的 updatedAt
  await listsCol.doc(target.data.listId).update({
    data: { updatedAt: new Date() },
  }).catch(() => {});

  const updated = await itemsCol.doc(target.data._id).get();
  return { code: 0, message: 'ok', data: { item: updated.data } };
}

// ============ list: 清单内所有游戏（含 game 信息） ============
async function handleList(event, openid) {
  const { listId } = event;
  if (!listId) return { code: 1001, message: '缺少 listId', data: null };

  const items = await itemsCol
    .where({ listId, _openid: openid })
    .orderBy('sort', 'asc')
    .orderBy('addedAt', 'desc')
    .limit(100)
    .get();
  const data = items.data || [];
  if (data.length === 0) {
    return { code: 0, message: 'ok', data: { list: [] } };
  }

  const gameIds = data.map((i) => i.gameId);
  const games = await gamesCol
    .where({ _id: _.in(gameIds) })
    .field({
      name: true,
      cover: true,
      headerImage: true,
      rating: true,
      price: true,
      tags: true,
      description: true,
    })
    .get()
    .catch(() => ({ data: [] }));
  const gamesMap = (games.data || []).reduce((acc, g) => {
    acc[g._id] = g;
    return acc;
  }, {});

  return {
    code: 0,
    message: 'ok',
    data: {
      list: data.map((item) => ({ ...item, game: gamesMap[item.gameId] || null })),
    },
  };
}

// ============ inLists: 查询某个游戏在哪些清单里（用于详情页"加入清单" UI 高亮） ============
async function handleInLists(event, openid) {
  const { gameId } = event;
  if (!gameId) return { code: 1001, message: '缺少 gameId', data: null };

  const items = await itemsCol
    .where({ gameId, _openid: openid })
    .field({ listId: true })
    .get();
  const listIds = (items.data || []).map((i) => i.listId);

  return { code: 0, message: 'ok', data: { listIds } };
}
