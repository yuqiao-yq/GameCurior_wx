// cloudfunctions/favorite/index.js
// 收藏相关操作：add / remove / list / updateStatus / toggle
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const favoritesCol = db.collection('favorites');
const gamesCol = db.collection('games');

// 收藏状态：0 想玩 / 1 在玩 / 2 玩过 / 3 弃坑
const STATUS_NAMES = ['想玩', '在玩', '玩过', '弃坑'];

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, gameId, status = 0 } = event;

  if (!action) {
    return { code: 1001, message: '缺少 action 参数', data: null };
  }

  try {
    switch (action) {
      // ============ 添加收藏 ============
      case 'add': {
        if (!gameId) return { code: 1001, message: '缺少 gameId', data: null };

        // 检查是否已收藏
        const existing = await favoritesCol
          .where({ _openid: OPENID, gameId })
          .limit(1)
          .get();

        if (existing.data.length > 0) {
          return { code: 2002, message: '已收藏过该游戏', data: { favorited: true, status: existing.data[0].status } };
        }

        await favoritesCol.add({
          data: {
            _openid: OPENID,
            gameId,
            status,
            createdAt: new Date(),
          },
        });

        // favCount + 1
        await gamesCol.doc(gameId).update({
          data: { 'stats.favCount': _.inc(1) },
        }).catch(() => {});

        return { code: 0, message: '收藏成功', data: { favorited: true, status } };
      }

      // ============ 取消收藏 ============
      case 'remove': {
        if (!gameId) return { code: 1001, message: '缺少 gameId', data: null };

        const res = await favoritesCol
          .where({ _openid: OPENID, gameId })
          .remove();

        // favCount - 1
        if (res.stats.removed > 0) {
          await gamesCol.doc(gameId).update({
            data: { 'stats.favCount': _.inc(-1) },
          }).catch(() => {});
        }

        return { code: 0, message: '已取消收藏', data: { favorited: false, removed: res.stats.removed } };
      }

      // ============ 切换收藏（前端最常用）============
      case 'toggle': {
        if (!gameId) return { code: 1001, message: '缺少 gameId', data: null };

        const existing = await favoritesCol
          .where({ _openid: OPENID, gameId })
          .limit(1)
          .get();

        if (existing.data.length > 0) {
          // 已收藏 → 取消
          await favoritesCol.where({ _openid: OPENID, gameId }).remove();
          await gamesCol.doc(gameId).update({
            data: { 'stats.favCount': _.inc(-1) },
          }).catch(() => {});
          return { code: 0, message: '已取消收藏', data: { favorited: false } };
        } else {
          // 未收藏 → 添加
          await favoritesCol.add({
            data: {
              _openid: OPENID,
              gameId,
              status,
              createdAt: new Date(),
            },
          });
          await gamesCol.doc(gameId).update({
            data: { 'stats.favCount': _.inc(1) },
          }).catch(() => {});
          return { code: 0, message: '收藏成功', data: { favorited: true, status } };
        }
      }

      // ============ 修改收藏状态（四态：想玩/在玩/玩过/弃坑）============
      case 'updateStatus': {
        if (!gameId) return { code: 1001, message: '缺少 gameId', data: null };
        if (status < 0 || status > 3) return { code: 1002, message: 'status 必须在 0-3', data: null };

        const existing = await favoritesCol
          .where({ _openid: OPENID, gameId })
          .limit(1)
          .get();

        if (existing.data.length === 0) {
          return { code: 2001, message: '尚未收藏', data: null };
        }

        await favoritesCol.doc(existing.data[0]._id).update({
          data: { status, updatedAt: new Date() },
        });

        return {
          code: 0,
          message: `已标记为「${STATUS_NAMES[status]}」`,
          data: { favorited: true, status },
        };
      }

      // ============ 我的收藏列表 ============
      case 'list': {
        const { page = 1, pageSize = 20, status: filterStatus } = event;

        const where = { _openid: OPENID };
        if (typeof filterStatus === 'number') where.status = filterStatus;

        // 1. 拉收藏记录
        const { data: favs } = await favoritesCol
          .where(where)
          .orderBy('createdAt', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get();

        if (favs.length === 0) {
          return { code: 0, message: 'ok', data: { list: [], page, pageSize, hasMore: false } };
        }

        // 2. 批量拉对应的游戏（用 inq）
        const gameIds = favs.map((f) => f.gameId);
        const { data: games } = await gamesCol
          .where({ _id: _.in(gameIds) })
          .field({
            name: true, cover: true, rating: true, price: true,
            originalPrice: true, discount: true, tags: true,
          })
          .get();

        const gameMap = {};
        games.forEach((g) => { gameMap[g._id] = g; });

        // 3. 合并：收藏记录 + 游戏信息
        const list = favs.map((f) => ({
          ...f,
          game: gameMap[f.gameId] || null,
          statusName: STATUS_NAMES[f.status] || '未知',
        })).filter((item) => item.game); // 过滤掉已被删除的游戏

        return {
          code: 0,
          message: 'ok',
          data: { list, page, pageSize, hasMore: favs.length === pageSize },
        };
      }

      default:
        return { code: 1003, message: `unknown action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[favorite] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
