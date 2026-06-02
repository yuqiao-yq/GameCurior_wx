// cloudfunctions/syncFromSteamSpy/index.js
// 从 SteamSpy 公开 API 同步热门游戏的销量、评分、价格
// 文档：https://steamspy.com/api.php
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

// ============ HTTP GET ============
function httpGet(url, timeout = 15000) {
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

// ============ 计算 SteamSpy 评分 ============
// SteamSpy 返回 positive / negative 评论数，换算 0-10 评分
function calcRating(positive, negative) {
  const total = (positive || 0) + (negative || 0);
  if (total < 10) return 0;
  const rate = positive / total;
  // 用 wilson score 简化版，映射到 10 分制
  return Math.round(rate * 100) / 10;
}

// ============ 标准化 SteamSpy 数据 ============
function normalize(raw) {
  const steam = String(raw.appid);
  const owners = raw.owners || ''; // "5,000,000 .. 10,000,000"
  const ownersAvg = (() => {
    const m = owners.match(/(\d[\d,]*)\s*\.\.\s*(\d[\d,]*)/);
    if (!m) return 0;
    const lo = parseInt(m[1].replace(/,/g, ''), 10);
    const hi = parseInt(m[2].replace(/,/g, ''), 10);
    return Math.round((lo + hi) / 2);
  })();
  const rating = calcRating(raw.positive, raw.negative);
  const positiveRate = (raw.positive + raw.negative > 0)
    ? raw.positive / (raw.positive + raw.negative)
    : 0;

  return {
    externalIds: { steam },
    name: raw.name,       // 英文名（如游戏库已有中文名，不会覆盖）
    nameEn: raw.name,
    developer: raw.developer || '',
    publisher: raw.publisher || '',
    price: raw.price ? Number(raw.price) / 100 : 0,           // 单位：美分 → 元
    originalPrice: raw.initialprice ? Number(raw.initialprice) / 100 : 0,
    discount: raw.discount ? Number(raw.discount) : 0,
    tags: raw.tags ? Object.keys(raw.tags).slice(0, 10) : [], // 取前 10 个标签
    stats: {
      steamOwners: ownersAvg,
      steamPositiveRate: Math.round(positiveRate * 100) / 100,
    },
    rating,
    ratingCount: (raw.positive || 0) + (raw.negative || 0),
    storeUrls: {
      steam: `https://store.steampowered.com/app/${steam}/`,
    },
    cover: `https://cdn.akamai.steamstatic.com/steam/apps/${steam}/library_600x900.jpg`,
    headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${steam}/header.jpg`,
  };
}

// ============ 智能 Upsert（不覆盖中文 / seed 字段） ============
async function upsertGame(data) {
  const now = new Date();
  const steamId = data.externalIds.steam;

  const { data: existing } = await gamesCol
    .where({ 'externalIds.steam': steamId })
    .limit(1)
    .get();

  if (existing.length === 0) {
    // 新增
    await gamesCol.add({
      data: {
        ...data,
        description: '',
        screenshots: [],
        videos: [],
        platforms: ['steam'],
        categoryId: '',
        releasedAt: null,
        dataSources: ['steamspy'],
        status: 1,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { steamspy: now },
      },
    });
    return 'inserted';
  }

  // 已存在：智能合并
  const old = existing[0];
  const hasSeed = (old.dataSources || []).includes('seed');

  const merged = {
    // 中文字段：seed 已写过则不覆盖
    name: hasSeed ? old.name : data.name,
    nameEn: data.nameEn,
    developer: old.developer || data.developer,
    publisher: old.publisher || data.publisher,
    // 价格：CheapShark 优先于 SteamSpy（同步顺序：先 cheapshark 后 steamspy 时不覆盖）
    price: (old.dataSources || []).includes('cheapshark') ? old.price : data.price,
    originalPrice: (old.dataSources || []).includes('cheapshark') ? old.originalPrice : data.originalPrice,
    // 评分：SteamSpy 是权威源，覆盖
    rating: data.rating || old.rating,
    ratingCount: data.ratingCount,
    // 标签合并
    tags: Array.from(new Set([...(old.tags || []), ...data.tags])),
    'stats.steamOwners': data.stats.steamOwners,
    'stats.steamPositiveRate': data.stats.steamPositiveRate,
    storeUrls: { ...data.storeUrls, ...(old.storeUrls || {}) },
    cover: old.cover || data.cover,
    headerImage: old.headerImage || data.headerImage,
    dataSources: Array.from(new Set([...(old.dataSources || []), 'steamspy'])),
    updatedAt: now,
    'lastSyncedAt.steamspy': now,
  };

  await gamesCol.doc(old._id).update({ data: merged });
  return 'updated';
}

// ============ 主入口 ============
// event.request 支持：
//   - top100in2weeks（默认，近 2 周热门）
//   - top100owned（拥有量最高）
//   - top100forever（历史最高）
exports.main = async (event, context) => {
  const { request = 'top100in2weeks', limit = 30 } = event;

  try {
    console.log(`[SteamSpy] 拉取 ${request}`);
    const url = `https://steamspy.com/api.php?request=${request}`;
    const raw = await httpGet(url);

    // SteamSpy 返回的是 { appid: { ...game } } 对象
    const list = Object.values(raw).slice(0, limit);

    const stats = { total: list.length, inserted: 0, updated: 0, failed: 0, failures: [] };

    for (const item of list) {
      try {
        const normalized = normalize(item);
        const result = await upsertGame(normalized);
        stats[result]++;
      } catch (e) {
        stats.failed++;
        stats.failures.push({ name: item.name, error: e.message });
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: { source: 'steamspy', request, ...stats },
    };
  } catch (err) {
    console.error('[SteamSpy] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
