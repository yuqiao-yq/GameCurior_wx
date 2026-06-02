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

    // 2. 并发查"是否已收藏" + "相关游戏"（这两个结果要返回给前端）
    //    浏览历史上报"发后即忘"，不进 Promise.all，避免阻塞响应也避免与上面两项的解构顺序耦合
    const userCtxP = favoritesCol
      .where({ _openid: OPENID, gameId: id })
      .limit(1)
      .get()
      .then((r) => ({ favorited: r.data.length > 0, favoriteStatus: r.data[0] && r.data[0].status }))
      .catch(() => ({ favorited: false, favoriteStatus: null }));

    // 相关游戏（同类目 / 同标签，按评分倒序）
    // 注：微信云数据库的"或"应使用 _.or([...])，不能写 Mongo 风格的 $or 字符串 key
    const tags = gameData.tags || [];
    const orClauses = [];
    if (gameData.categoryId) orClauses.push({ categoryId: gameData.categoryId });
    if (tags.length) orClauses.push({ tags: _.in(tags) });

    const relatedP = orClauses.length
      ? gamesCol
          .where(_.and([
            { _id: _.neq(id), status: 1 },
            orClauses.length === 1 ? orClauses[0] : _.or(orClauses),
          ]))
          .orderBy('rating', 'desc')
          .limit(5)
          .field({ name: true, cover: true, rating: true, price: true, tags: true })
          .get()
          .then((r) => r.data)
          .catch(() => [])
      : Promise.resolve([]);

    // 浏览历史上报（先删旧记录再插入，去重）+ 累加 viewCount
    // 失败不影响主响应；与上面两个查询并发，但作为独立 promise，避免再次卷入解构顺序
    const historyP = reportHistory
      ? (async () => {
          try {
            await historyCol
              .where({ _openid: OPENID, gameId: id })
              .remove()
              .catch(() => {});
            await historyCol.add({
              data: { _openid: OPENID, gameId: id, viewedAt: new Date() },
            });
            await gamesCol.doc(id).update({
              data: { 'stats.viewCount': _.inc(1) },
            });
          } catch (e) {
            console.warn('[history] report failed:', e.message);
          }
        })()
      : Promise.resolve();

    // 等三个并发任务都结束（history 结果不需要，仅等其完成 / 失败不阻塞响应内容）
    const [userCtx, related] = await Promise.all([userCtxP, relatedP, historyP]);

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
