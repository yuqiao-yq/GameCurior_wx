// cloudfunctions/getGameList/index.js
// 获取游戏列表
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

const SORT_MAP = {
  rating: { field: 'rating', order: 'desc' },
  new: { field: 'releasedAt', order: 'desc' },
  hot: { field: 'stats.viewCount', order: 'desc' },
  // 降价榜：按当前价格升序（实际可结合 originalPrice 计算折扣，这里简化）
  discount: { field: 'price', order: 'asc' },
  // 销量榜：按 owners 估算（来自 SteamSpy）
  sales: { field: 'stats.owners', order: 'desc' },
};

// Mock 数据：用于云数据库尚未录入时的演示
const MOCK_GAMES = [
  {
    _id: 'mock_1',
    name: 'Hades',
    nameEn: 'Hades',
    cover: 'https://images.weserv.nl/?url=upload.wikimedia.org/wikipedia/en/c/cc/Hades_cover_art.jpg',
    rating: 9.6,
    price: 79,
    originalPrice: 98,
    tags: ['Roguelike', '动作', '独立'],
    description: '一款超凡的 roguelike 地牢爬行游戏，由制作 Bastion、Transistor 的 Supergiant Games 出品。',
  },
  {
    _id: 'mock_2',
    name: '空洞骑士',
    nameEn: 'Hollow Knight',
    cover: 'https://images.weserv.nl/?url=upload.wikimedia.org/wikipedia/en/0/04/Hollow_Knight_first_cover_art.webp',
    rating: 9.8,
    price: 45,
    originalPrice: 75,
    tags: ['类银河战士恶魔城', '独立', '困难'],
    description: '在被遗忘的废墟中，揭开虫之王国的秘密。',
  },
  {
    _id: 'mock_3',
    name: '星露谷物语',
    nameEn: 'Stardew Valley',
    cover: 'https://images.weserv.nl/?url=upload.wikimedia.org/wikipedia/en/f/fd/Logo_of_Stardew_Valley.png',
    rating: 9.7,
    price: 41,
    originalPrice: 56,
    tags: ['模拟经营', '种田', '治愈'],
    description: '继承爷爷的旧农场，开启全新的乡村生活。',
  },
];

exports.main = async (event, context) => {
  const {
    page = 1,
    pageSize = 20,
    categoryId,
    sort = 'rating',
    keyword,
    tag, // 按单个标签筛选
  } = event;

  try {
    const _ = db.command;
    const where = { status: 1 };
    if (categoryId) where.categoryId = categoryId;
    if (tag) where.tags = tag; // MongoDB 数组字段直接匹配元素

    // 降价榜需要额外过滤：必须有价格且有折扣
    if (sort === 'discount') {
      where.price = _.gt(0);
      where.originalPrice = _.gt(0);
    }
    // 新游榜过滤：必须有发售时间
    if (sort === 'new') {
      where.releasedAt = _.exists(true).and(_.neq(null));
    }

    const sortConfig = SORT_MAP[sort] || SORT_MAP.rating;

    let query = gamesCol.where(where);
    if (keyword) {
      // 简单模糊匹配（生产环境建议接入云开发的全文搜索或自建 ES）
      query = gamesCol.where({
        ...where,
        name: db.RegExp({ regexp: keyword, options: 'i' }),
      });
    }

    const { data } = await query
      .orderBy(sortConfig.field, sortConfig.order)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    // 如果数据库还没数据，返回 mock 演示
    const list = data && data.length > 0 ? data : MOCK_GAMES;

    return {
      code: 0,
      message: 'ok',
      data: {
        list,
        page,
        pageSize,
        hasMore: list.length === pageSize,
        isMock: data.length === 0,
      },
    };
  } catch (err) {
    console.error('[getGameList] error:', err);
    // 失败时也返回 mock，保证前端可演示
    return {
      code: 0,
      message: 'ok (mock fallback)',
      data: {
        list: MOCK_GAMES,
        page: 1,
        pageSize: MOCK_GAMES.length,
        hasMore: false,
        isMock: true,
      },
    };
  }
};
