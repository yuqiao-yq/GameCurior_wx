// cloudfunctions/gameList/index.js
// 游戏清单（GameList）管理：create / update / delete / list / detail
// 一个用户最多 20 个清单，清单名称需内容安全审核
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const listsCol = db.collection('gameLists');
const itemsCol = db.collection('gameListItems');
const gamesCol = db.collection('games');

const MAX_LISTS_PER_USER = 20;
const NAME_MAX = 30;
const DESC_MAX = 200;

// 集合不存在时自动创建（避免新环境首次使用报错）
async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    console.log('[gameList] auto-created collection:', name);
  } catch (e) {
    // -501001 = collection already exist；忽略
    if (e.errCode === -501001 || /already exist/i.test(e.errMsg || e.message || '')) {
      return;
    }
    console.warn('[gameList] createCollection failed:', e.message);
  }
}

// 入口处主动 ensure（首次启动幂等）
let _ensured = false;
async function ensureCollections() {
  if (_ensured) return;
  await Promise.all([
    ensureCollection('gameLists'),
    ensureCollection('gameListItems'),
  ]);
  _ensured = true;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action = 'list' } = event;

  if (!OPENID) {
    return { code: 1002, message: '未登录', data: null };
  }

  // 首次启动：确保集合存在
  try { await ensureCollections(); } catch (e) {}

  try {
    switch (action) {
      case 'list':   return await handleList(event, OPENID);
      case 'detail': return await handleDetail(event, OPENID);
      case 'create': return await handleCreate(event, OPENID);
      case 'update': return await handleUpdate(event, OPENID);
      case 'delete': return await handleDelete(event, OPENID);
      default:
        return { code: 1001, message: `未知 action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[gameList] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};

// ============ list: 我的所有清单 ============
async function handleList(event, openid) {
  const { page = 1, pageSize = 20 } = event;
  const { data } = await listsCol
    .where({ _openid: openid })
    .orderBy('sort', 'asc')
    .orderBy('updatedAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  // 对于没显式设置 cover 的清单，自动取最新加入游戏的封面
  const list = await Promise.all(
    (data || []).map(async (l) => {
      if (l.cover) return l;
      // 拉一张游戏封面兜底
      try {
        const item = await itemsCol
          .where({ listId: l._id, _openid: openid })
          .orderBy('addedAt', 'desc')
          .limit(1)
          .get();
        if (item.data.length === 0) return l;
        const game = await gamesCol.doc(item.data[0].gameId)
          .field({ cover: true, headerImage: true })
          .get()
          .catch(() => null);
        if (game && game.data) {
          return { ...l, _autoCover: game.data.cover || game.data.headerImage || '' };
        }
      } catch (e) {}
      return l;
    })
  );

  return {
    code: 0,
    message: 'ok',
    data: {
      list,
      page,
      pageSize,
      hasMore: list.length === pageSize,
    },
  };
}

// ============ detail: 清单详情 + items ============
async function handleDetail(event, openid) {
  const { id, withItems = true } = event;
  if (!id) return { code: 1001, message: '缺少 id', data: null };

  const listRes = await listsCol.doc(id).get().catch(() => null);
  if (!listRes || !listRes.data) {
    return { code: 2001, message: '清单不存在', data: null };
  }
  const list = listRes.data;
  // 权限：仅本人可读（未来公开分享 V2 时调整）
  if (list._openid !== openid) {
    return { code: 1003, message: '无权访问该清单', data: null };
  }

  if (!withItems) {
    return { code: 0, message: 'ok', data: { list, items: [] } };
  }

  // 拉所有 items + 关联 games
  const itemsRes = await itemsCol
    .where({ listId: id, _openid: openid })
    .orderBy('sort', 'asc')
    .orderBy('addedAt', 'desc')
    .limit(100)
    .get();

  const items = itemsRes.data || [];
  if (items.length === 0) {
    return { code: 0, message: 'ok', data: { list, items: [] } };
  }

  const gameIds = items.map((i) => i.gameId).filter(Boolean);
  let gamesMap = {};
  if (gameIds.length > 0) {
    const gamesRes = await gamesCol
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
      .get()
      .catch(() => ({ data: [] }));
    gamesMap = (gamesRes.data || []).reduce((acc, g) => {
      acc[g._id] = g;
      return acc;
    }, {});
  }

  // 合并 game 信息（找不到的标记 missing）
  const merged = items.map((item) => ({
    ...item,
    game: gamesMap[item.gameId] || null,
  }));

  return { code: 0, message: 'ok', data: { list, items: merged } };
}

// ============ create: 新建清单 ============
async function handleCreate(event, openid) {
  const { name, description = '', cover = '' } = event;

  // 校验
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    return { code: 1001, message: '清单名称不能为空', data: null };
  }
  if (trimmedName.length > NAME_MAX) {
    return { code: 1003, message: `名称不能超过 ${NAME_MAX} 字`, data: null };
  }
  const trimmedDesc = String(description || '').trim();
  if (trimmedDesc.length > DESC_MAX) {
    return { code: 1003, message: `简介不能超过 ${DESC_MAX} 字`, data: null };
  }

  // 数量上限
  const countRes = await listsCol.where({ _openid: openid }).count();
  if (countRes.total >= MAX_LISTS_PER_USER) {
    return {
      code: 1004,
      message: `单用户最多 ${MAX_LISTS_PER_USER} 个清单，请先清理`,
      data: null,
    };
  }

  // 内容安全审核（名称 + 简介）
  const auditText = `${trimmedName}\n${trimmedDesc}`;
  const checkResult = await safeCheck(auditText, openid);
  if (!checkResult.pass) {
    return {
      // 1005 = 审核不通过；5001 = 审核服务暂不可用（fail-closed），便于前端做重试提示
      code: checkResult.degraded ? 5001 : 1005,
      message: checkResult.message || '清单内容包含违规',
      data: null,
    };
  }

  const now = new Date();
  const result = await listsCol.add({
    data: {
      _openid: openid,
      name: trimmedName,
      description: trimmedDesc,
      cover,
      coverGameId: '',
      gameCount: 0,
      status: 1,
      sort: now.getTime() / -1000, // 负数让最新排前
      createdAt: now,
      updatedAt: now,
    },
  });

  const created = await listsCol.doc(result._id).get();
  return { code: 0, message: 'ok', data: { list: created.data } };
}

// ============ update: 编辑清单 ============
async function handleUpdate(event, openid) {
  const { id, name, description, cover, coverGameId } = event;
  if (!id) return { code: 1001, message: '缺少 id', data: null };

  const existing = await listsCol.doc(id).get().catch(() => null);
  if (!existing || !existing.data || existing.data._openid !== openid) {
    return { code: 1003, message: '清单不存在或无权修改', data: null };
  }

  const patch = { updatedAt: new Date() };
  const auditParts = [];

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) return { code: 1001, message: '名称不能为空', data: null };
    if (trimmed.length > NAME_MAX) {
      return { code: 1003, message: `名称不能超过 ${NAME_MAX} 字`, data: null };
    }
    patch.name = trimmed;
    auditParts.push(trimmed);
  }
  if (typeof description === 'string') {
    const trimmed = description.trim();
    if (trimmed.length > DESC_MAX) {
      return { code: 1003, message: `简介不能超过 ${DESC_MAX} 字`, data: null };
    }
    patch.description = trimmed;
    auditParts.push(trimmed);
  }
  if (typeof cover === 'string') patch.cover = cover;
  if (typeof coverGameId === 'string') patch.coverGameId = coverGameId;

  // 走内容安全审核
  if (auditParts.length > 0) {
    const auditText = auditParts.join('\n');
    const checkResult = await safeCheck(auditText, openid);
    if (!checkResult.pass) {
      return {
        code: checkResult.degraded ? 5001 : 1005,
        message: checkResult.message || '内容包含违规',
        data: null,
      };
    }
  }

  await listsCol.doc(id).update({ data: patch });
  const updated = await listsCol.doc(id).get();
  return { code: 0, message: 'ok', data: { list: updated.data } };
}

// ============ delete: 删除清单（含所有 items） ============
async function handleDelete(event, openid) {
  const { id } = event;
  if (!id) return { code: 1001, message: '缺少 id', data: null };

  const existing = await listsCol.doc(id).get().catch(() => null);
  if (!existing || !existing.data || existing.data._openid !== openid) {
    return { code: 1003, message: '清单不存在或无权删除', data: null };
  }

  // 先删 items（循环删除 1000 条限制）
  for (let i = 0; i < 10; i++) {
    const r = await itemsCol.where({ listId: id, _openid: openid }).remove();
    if (!r.stats || r.stats.removed === 0) break;
  }
  // 再删 list
  await listsCol.doc(id).remove();
  return { code: 0, message: 'ok', data: { id } };
}

// ============ 内容安全审核（云函数互调） ============
// fail-closed：审核服务异常时拒绝写入。文案区分"违规"与"审核不可用"，
// 便于前端给出"稍后重试"提示而不是"内容违规"误导。
async function safeCheck(content, openid) {
  if (!content || !content.trim()) return { pass: true };
  try {
    const res = await cloud.callFunction({
      name: 'contentCheck',
      data: { action: 'text', content, scene: 1 },
    });
    const data = (res.result && res.result.data) || {};
    return {
      pass: data.pass === true,
      degraded: data.degraded === true,
      message: data.message || (data.degraded ? '审核服务暂不可用，请稍后再试' : '内容包含违规内容'),
    };
  } catch (e) {
    // 云函数互调本身异常（网络/部署）也按 fail-closed 处理
    console.error('[gameList] contentCheck invoke error:', e.message);
    return {
      pass: false,
      degraded: true,
      message: '审核服务暂不可用，请稍后再试',
    };
  }
}
