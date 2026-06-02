// cloudfunctions/getHomeConfig/index.js
// 首页配置聚合接口：banners + hotKeywords + featured
// 一次调用拿到首页所有运营位数据，避免前端发多次请求
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const bannersCol = db.collection('banners');
const gamesCol = db.collection('games');

// ============ Mock 数据（数据库空时兜底，便于演示） ============
const MOCK_BANNERS = [
  {
    _id: 'mock_banner_1',
    title: '夏日特惠',
    subtitle: '热门游戏低至 3 折',
    image: 'https://cdn.akamai.steamstatic.com/steam/clusters/sale_summersale2024/c8be4a4b09d5a9e0e83b9e26/page_bg_english.jpg?t=1718719200',
    bgColor: '#ff7d00',
    linkType: 'external',
    linkValue: 'https://store.steampowered.com/sale/summersale',
    sort: 1,
  },
  {
    _id: 'mock_banner_2',
    title: 'Indie 精选周',
    subtitle: '独立游戏好评榜单',
    image: 'https://cdn.akamai.steamstatic.com/steam/clusters/indie_curators/c9ed8c8e3d0c5e72b3c5d4ce/page_bg_english.jpg',
    bgColor: '#5b3aa8',
    linkType: 'rank',
    linkValue: 'rating',
    sort: 2,
  },
  {
    _id: 'mock_banner_3',
    title: '🎮 GameCurior',
    subtitle: '发现你感兴趣的好玩游戏',
    image: '',
    bgColor: '#667eea',
    linkType: 'none',
    linkValue: '',
    sort: 3,
  },
];

const DEFAULT_HOT_KEYWORDS = ['Roguelike', '独立', 'RPG', '模拟', '动作'];

// ============ 主入口 ============
exports.main = async (event, context) => {
  const {
    includeBanners = true,
    includeHotKeywords = true,
    includeFeatured = false, // 默认不带，避免与 getGameList 重复
    featuredLimit = 6,
  } = event;

  // 并发拉取
  const tasks = [];

  if (includeBanners) {
    tasks.push(
      fetchBanners().catch((e) => {
        console.warn('[getHomeConfig:banners] fail:', e.message);
        return MOCK_BANNERS;
      })
    );
  } else {
    tasks.push(Promise.resolve([]));
  }

  if (includeHotKeywords) {
    tasks.push(
      fetchHotKeywords().catch((e) => {
        console.warn('[getHomeConfig:hotKeywords] fail:', e.message);
        return DEFAULT_HOT_KEYWORDS;
      })
    );
  } else {
    tasks.push(Promise.resolve([]));
  }

  if (includeFeatured) {
    tasks.push(
      fetchFeatured(featuredLimit).catch((e) => {
        console.warn('[getHomeConfig:featured] fail:', e.message);
        return [];
      })
    );
  } else {
    tasks.push(Promise.resolve([]));
  }

  try {
    const [banners, hotKeywords, featured] = await Promise.all(tasks);

    return {
      code: 0,
      message: 'ok',
      data: {
        banners,
        hotKeywords,
        featured,
        isMock: banners === MOCK_BANNERS, // 标记是否走的 mock
      },
    };
  } catch (err) {
    console.error('[getHomeConfig] fatal:', err);
    return {
      code: 0,
      message: 'ok (fallback)',
      data: {
        banners: MOCK_BANNERS,
        hotKeywords: DEFAULT_HOT_KEYWORDS,
        featured: [],
        isMock: true,
      },
    };
  }
};

// ============ 拉取 banners ============
// 条件：status=1 且当前时间在 [startAt, endAt] 之间（startAt/endAt 不存在则视为不限制）
async function fetchBanners() {
  const now = new Date();

  // 拉所有 status=1 的，在内存里过滤时间范围（条件复合 + null 判断走云端不易写）
  const { data } = await bannersCol
    .where({ status: 1 })
    .orderBy('sort', 'asc')
    .limit(20)
    .get();

  const filtered = (data || []).filter((b) => {
    if (b.startAt && new Date(b.startAt) > now) return false;
    if (b.endAt && new Date(b.endAt) < now) return false;
    return true;
  });

  if (filtered.length === 0) return MOCK_BANNERS;
  return filtered;
}

// ============ 拉取热搜词 ============
// 与 searchGames action=hot 相同的策略
async function fetchHotKeywords() {
  try {
    const { data } = await gamesCol
      .where({ status: 1 })
      .orderBy('stats.viewCount', 'desc')
      .limit(8)
      .field({ tags: true })
      .get();

    if (!data || data.length === 0) return DEFAULT_HOT_KEYWORDS;

    const set = new Set();
    data.forEach((g) => (g.tags || []).forEach((t) => t && set.add(t)));
    return Array.from(set).slice(0, 8);
  } catch (e) {
    return DEFAULT_HOT_KEYWORDS;
  }
}

// ============ 拉取精选游戏（首页推荐位） ============
// 策略：评分倒序，可后续替换为编辑精选 / AI 推荐
async function fetchFeatured(limit) {
  const { data } = await gamesCol
    .where({ status: 1 })
    .orderBy('rating', 'desc')
    .limit(limit)
    .field({
      name: true,
      cover: true,
      headerImage: true,
      rating: true,
      price: true,
      tags: true,
      description: true,
    })
    .get();

  return data || [];
}
