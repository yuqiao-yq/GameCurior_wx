// cloudfunctions/getGameDetail/index.js
// 获取游戏详情 + 上报浏览历史 + 返回用户上下文（是否已收藏）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const gamesCol = db.collection('games');
const historyCol = db.collection('history');
const favoritesCol = db.collection('favorites');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { id, reportHistory = true } = event;

  if (!id) {
    return { code: 1001, message: '缺少参数 id', data: null };
  }

  try {
    // 1. 查游戏详情
    const game = await gamesCol.doc(id).get().catch(() => null);
    if (!game || !game.data) {
      return { code: 2001, message: '游戏不存在或已下架', data: null };
    }
    const gameData = game.data;

    // 2. 并发查"是否已收藏" + 上报浏览历史
    const tasks = [];

    // 2a. 查收藏状态
    tasks.push(
      favoritesCol
        .where({ _openid: OPENID, gameId: id })
        .limit(1)
        .get()
        .then((r) => ({ favorited: r.data.length > 0, favoriteStatus: r.data[0] && r.data[0].status }))
        .catch(() => ({ favorited: false, favoriteStatus: null }))
    );

    // 2b. 找相关游戏（同类目 / 同标签，按评分倒序）
    tasks.push(
      gamesCol
        .where({
          _id: _.neq(id),
          status: 1,
          $or: gameData.categoryId
            ? [{ categoryId: gameData.categoryId }, { tags: _.in(gameData.tags || []) }]
            : [{ tags: _.in(gameData.tags || []) }],
        })
        .orderBy('rating', 'desc')
        .limit(5)
        .field({ name: true, cover: true, rating: true, price: true, tags: true })
        .get()
        .then((r) => r.data)
        .catch(() => [])
    );

    // 2c. 上报浏览历史（先删旧记录再插入，去重）+ 累加 viewCount
    if (reportHistory) {
      tasks.push(
        (async () => {
          try {
            // 删旧的同 gameId 历史
            await historyCol
              .where({ _openid: OPENID, gameId: id })
              .remove()
              .catch(() => {});
            // 插新的
            await historyCol.add({
              data: {
                _openid: OPENID,
                gameId: id,
                viewedAt: new Date(),
              },
            });
            // viewCount + 1
            await gamesCol.doc(id).update({
              data: { 'stats.viewCount': _.inc(1) },
            });
          } catch (e) {
            console.warn('[history] report failed:', e.message);
          }
        })()
      );
    }

    const [userCtx, related] = await Promise.all(tasks);

    return {
      code: 0,
      message: 'ok',
      data: {
        game: gameData,
        userContext: userCtx,
        related,
      },
    };
  } catch (err) {
    console.error('[getGameDetail] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
