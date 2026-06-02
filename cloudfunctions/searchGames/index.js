// cloudfunctions/searchGames/index.js
// 搜索游戏：支持关键词模糊匹配（name / nameEn / tags）+ 热搜词 + 搜索联想
// 多 action 路由：search / hot / suggest
// search 支持 includeExternal=true → 同时调 CheapShark 拉取外部结果（含 Steam Store 数据）
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const gamesCol = db.collection('games');

// 美元 → 人民币（简易，与 syncFromCheapShark 保持一致）
const USD_TO_CNY = 7.2;

// CheapShark 搜索接口超时（5s，外部源不能拖累整体响应）
const EXTERNAL_TIMEOUT = 5000;

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
    includeExternal = false, // 是否同时拉外部数据源（CheapShark）
  } = event;

  const kw = String(keyword || '').trim();
  if (!kw) {
    return {
      code: 1001,
      message: '关键词不能为空',
      data: { list: [], page, pageSize, hasMore: false, keyword: '', external: [] },
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

  // 并发：本地查询 + 外部搜索（外部仅在 page=1 时触发）
  const localPromise = query
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
      externalIds: true,
    })
    .get();

  const externalPromise = (includeExternal && page === 1)
    ? searchExternalCheapShark(kw).catch((e) => {
        console.warn('[searchGames:external] failed:', e.message);
        return [];
      })
    : Promise.resolve([]);

  const [localRes, externalRaw] = await Promise.all([localPromise, externalPromise]);
  const localData = localRes.data || [];

  // 过滤外部结果：去掉已经在本地存在的（按 steamAppID 比对）
  const localSteamIds = new Set(
    localData
      .map((g) => g.externalIds && g.externalIds.steam)
      .filter(Boolean)
      .map(String)
  );
  const externalList = externalRaw.filter(
    (item) => !item._steamAppId || !localSteamIds.has(String(item._steamAppId))
  );

  return {
    code: 0,
    message: 'ok',
    data: {
      list: localData,
      external: externalList,
      page,
      pageSize,
      hasMore: localData.length === pageSize,
      keyword: kw,
    },
  };
}

// ============ 外部源：CheapShark 搜索 ============
// 文档：https://apidocs.cheapshark.com/#tag/Games/operation/getGames
// 返回格式：[{ gameID, steamAppID, cheapest, cheapestDealID, external, thumb }]
async function searchExternalCheapShark(keyword) {
  const url = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(keyword)}&limit=20`;
  const list = await httpGet(url, EXTERNAL_TIMEOUT);
  if (!Array.isArray(list)) return [];

  return list.map((raw) => {
    const steamId = raw.steamAppID ? String(raw.steamAppID) : null;
    const usd = parseFloat(raw.cheapest);
    return {
      // 用前缀避免与本地 _id 冲突；前端据此识别外部条目
      _id: `ext_cs_${raw.gameID}`,
      _external: true,
      _source: 'cheapshark',
      _externalId: String(raw.gameID),
      _steamAppId: steamId,
      name: raw.external || '',
      nameEn: raw.external || '',
      // 优先用 Steam CDN 图（清晰度好），fallback 到 CheapShark 缩略图
      cover: steamId
        ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`
        : (raw.thumb || ''),
      headerImage: steamId
        ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`
        : (raw.thumb || ''),
      price: Number.isFinite(usd) ? Math.round(usd * USD_TO_CNY * 100) / 100 : null,
      tags: ['Steam'],
      description: '来自 Steam 商店的搜索结果，点击添加到库后查看详细信息',
    };
  });
}

// ============ HTTP GET（与 sync 系列函数保持一致的请求头与超时机制） ============
function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const options = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (buf += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
  });
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
