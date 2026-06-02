// cloudfunctions/initBanners/index.js
// 一键导入示例 banner 数据，便于新环境快速演示
// 调用方式：在云开发控制台 → 云函数 → 云端测试 → 调用，不带参数
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const bannersCol = db.collection('banners');

// ============ 示例 Banner（覆盖 4 种 linkType） ============
const SEED_BANNERS = [
  {
    title: '🔥 热门榜单',
    subtitle: '近期最受关注的游戏 TOP 10',
    image: '',
    bgColor: '#f53f3f',
    gradient: 'linear-gradient(135deg, #ff7d00 0%, #f53f3f 100%)',
    linkType: 'rank',
    linkValue: 'hot',
    sort: 1,
    status: 1,
  },
  {
    title: '💰 降价好游',
    subtitle: '当前打折最狠，错过等半年',
    image: '',
    bgColor: '#5b3aa8',
    gradient: 'linear-gradient(135deg, #f5576c 0%, #f093fb 100%)',
    linkType: 'rank',
    linkValue: 'discount',
    sort: 2,
    status: 1,
  },
  {
    title: '⭐ 编辑精选',
    subtitle: '玩家口碑爆棚的好游戏',
    image: '',
    bgColor: '#1b2838',
    gradient: 'linear-gradient(135deg, #667eea 0%, #5b3aa8 100%)',
    linkType: 'rank',
    linkValue: 'rating',
    sort: 3,
    status: 1,
  },
  {
    title: '🆕 新游速递',
    subtitle: '最新发售作品，第一时间体验',
    image: '',
    bgColor: '#13c2c2',
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    linkType: 'rank',
    linkValue: 'new',
    sort: 4,
    status: 1,
  },
];

exports.main = async (event, context) => {
  const { mode = 'add' } = event; // add 仅追加 / reset 清空再插入

  try {
    let cleared = 0;

    if (mode === 'reset') {
      // 清空所有现有 banner（小心使用）
      for (let i = 0; i < 10; i++) {
        const r = await bannersCol.where({ _id: db.command.exists(true) }).remove();
        const removed = (r.stats && r.stats.removed) || 0;
        cleared += removed;
        if (removed === 0) break;
      }
    }

    const now = new Date();
    const results = [];
    for (const banner of SEED_BANNERS) {
      // 按 title 去重，避免重复插入
      const exists = await bannersCol.where({ title: banner.title }).limit(1).get();
      if (exists.data.length > 0) {
        results.push({ title: banner.title, action: 'skipped' });
        continue;
      }

      const inserted = await bannersCol.add({
        data: { ...banner, createdAt: now, updatedAt: now },
      });
      results.push({ title: banner.title, action: 'inserted', _id: inserted._id });
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        mode,
        cleared,
        results,
        summary: {
          total: results.length,
          inserted: results.filter((r) => r.action === 'inserted').length,
          skipped: results.filter((r) => r.action === 'skipped').length,
        },
      },
    };
  } catch (err) {
    console.error('[initBanners] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
