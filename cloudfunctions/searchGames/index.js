// cloudfunctions/searchGames/index.js
// 搜索游戏：支持关键词模糊匹配（name / nameEn / tags）+ 热搜词 + 搜索联想
// 多 action 路由：search / hot / suggest
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const gamesCol = db.collection('games');

// ============ 常量 ============
const DEFAULT_HOT_KEYWORDS = [
  'Roguelike',
  '独立',
  '动作',
  'RPG',
  '模拟经营',
  '策略',
  '冒险',
  '解谜',
];

// 转义正则元字符，避免用户输入 . * + 等导致正则报错
function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============ action 路由 ============
exports.main = async (event, context) => {
  const { action = 'search' } = event;

  try {
    switch (action) {
      case 'hot':
        return await handleHot(event);
      case 'suggest':
        return await handleSuggest(event);
      case 'search':
      default:
        return await handleSearch(event);
    }
  } catch (err) {
    console.error('[searchGames] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};

// ============ search：关键词搜索 ============
async function handleSearch(event) {
  const {
    keyword = '',
    page = 1,
    pageSize = 20,
    sort = 'rating', // rating / new / hot
  } = event;

  const kw = String(keyword || '').trim();
  if (!kw) {
    return {
      code: 1001,
      message: '关键词不能为空',
      data: { list: [], page, pageSize, hasMore: false, keyword: '' },
    };
  }

  const safeKw = escapeRegExp(kw);
  const reg = db.RegExp({ regexp: safeKw, options: 'i' });

  // 排序映射（复用 getGameList 风格）
  const SORT_MAP = {
    rating: { field: 'rating', order: 'desc' },
    new: { field: 'releasedAt', order: 'desc' },
    hot: { field: 'stats.viewCount', order: 'desc' },
  };
  const sortConfig = SORT_MAP[sort] || SORT_MAP.rating;

  // 多字段模糊匹配：name / nameEn / tags（数组内包含）
  const query = gamesCol.where(
    _.and([
      { status: 1 },
      _.or([{ name: reg }, { nameEn: reg }, { tags: reg }]),
    ])
  );

  const { data } = await query
    .orderBy(sortConfig.field, sortConfig.order)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .field({
      name: true,
      nameEn: true,
      cover: true,
      headerImage: true,
      rating: true,
      price: true,
      originalPrice: true,
      tags: true,
      description: true,
      categoryId: true,
    })
    .get();

  return {
    code: 0,
    message: 'ok',
    data: {
      list: data || [],
      page,
      pageSize,
      hasMore: (data || []).length === pageSize,
      keyword: kw,
    },
  };
}

// ============ hot：热搜词 ============
// 策略：取浏览量最高的 8 款游戏的标签 + 名称，合并去重；
// 若数据库无数据，回退默认热搜词。
async function handleHot(event) {
  const { limit = 10 } = event;

  try {
    const { data } = await gamesCol
      .where({ status: 1 })
      .orderBy('stats.viewCount', 'desc')
      .limit(8)
      .field({ name: true, tags: true })
      .get();

    if (!data || data.length === 0) {
      return {
        code: 0,
        message: 'ok (default)',
        data: { keywords: DEFAULT_HOT_KEYWORDS.slice(0, limit) },
      };
    }

    // 收集名称 + 标签，去重后截取 limit 个
    const set = new Set();
    data.forEach((g) => {
      if (g.name) set.add(g.name);
      (g.tags || []).forEach((t) => t && set.add(t));
    });

    const keywords = Array.from(set).slice(0, limit);
    return {
      code: 0,
      message: 'ok',
      data: { keywords },
    };
  } catch (err) {
    console.warn('[searchGames:hot] fallback to default:', err.message);
    return {
      code: 0,
      message: 'ok (default fallback)',
      data: { keywords: DEFAULT_HOT_KEYWORDS.slice(0, limit) },
    };
  }
}

// ============ suggest：搜索联想 ============
// 根据已输入前缀，返回最多 N 个匹配的游戏名（用于实时联想）
async function handleSuggest(event) {
  const { keyword = '', limit = 8 } = event;
  const kw = String(keyword || '').trim();

  if (!kw) {
    return { code: 0, message: 'ok', data: { suggestions: [] } };
  }

  const safeKw = escapeRegExp(kw);
  // 联想通常用前缀匹配，但中文输入时用包含匹配更合理
  const reg = db.RegExp({ regexp: safeKw, options: 'i' });

  try {
    const { data } = await gamesCol
      .where(_.and([
        { status: 1 },
        _.or([{ name: reg }, { nameEn: reg }]),
      ]))
      .orderBy('rating', 'desc')
      .limit(limit)
      .field({ _id: true, name: true, nameEn: true, cover: true })
      .get();

    return {
      code: 0,
      message: 'ok',
      data: { suggestions: data || [] },
    };
  } catch (err) {
    console.warn('[searchGames:suggest] error:', err.message);
    return { code: 0, message: 'ok', data: { suggestions: [] } };
  }
}
