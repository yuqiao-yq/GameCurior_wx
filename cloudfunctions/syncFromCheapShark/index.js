// cloudfunctions/syncFromCheapShark/index.js
// 从 CheapShark 公开 API 同步实时打折信息
// 文档：https://apidocs.cheapshark.com/
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

// 美元 → 人民币 汇率（简易，可后续接实时汇率接口）
const USD_TO_CNY = 7.2;

// ============ HTTP GET ============
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
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

// CheapShark store IDs
const STORE_NAME = {
  1: 'steam',
  7: 'gog',
  25: 'epic',
  11: 'humble',
};

// ============ 标准化 CheapShark 数据 ============
function normalize(raw) {
  const storeKey = STORE_NAME[raw.storeID] || `store_${raw.storeID}`;
  const steamId = raw.steamAppID || null;
  const sale = Number(raw.salePrice);
  const normal = Number(raw.normalPrice);
  const savings = Math.round(Number(raw.savings || 0));

  return {
    externalIds: steamId ? { steam: String(steamId) } : {},
    name: raw.title,
    nameEn: raw.title,
    price: Math.round(sale * USD_TO_CNY * 100) / 100,
    originalPrice: Math.round(normal * USD_TO_CNY * 100) / 100,
    discount: savings,
    storeUrls: {
      [storeKey]: `https://www.cheapshark.com/redirect?dealID=${raw.dealID}`,
    },
    cover: steamId
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`
      : (raw.thumb || ''),
    headerImage: steamId
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`
      : (raw.thumb || ''),
  };
}

// ============ 智能 Upsert ============
async function upsertGame(data) {
  const now = new Date();

  // 没 Steam ID 的暂不处理（避免去重困难）
  if (!data.externalIds.steam) return 'skipped_no_steamid';

  const steamId = data.externalIds.steam;
  const { data: existing } = await gamesCol
    .where({ 'externalIds.steam': steamId })
    .limit(1)
    .get();

  if (existing.length === 0) {
    // 新增（信息有限，标记为 status=0 草稿，等待 SteamSpy/RAWG 补全）
    await gamesCol.add({
      data: {
        ...data,
        description: '',
        rating: 0,
        ratingCount: 0,
        tags: [],
        platforms: ['steam'],
        categoryId: '',
        developer: '',
        publisher: '',
        releasedAt: null,
        screenshots: [],
        videos: [],
        stats: { favCount: 0, viewCount: 0, steamOwners: 0, steamPositiveRate: 0 },
        dataSources: ['cheapshark'],
        status: 0,    // 信息不全，先草稿
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { cheapshark: now },
      },
    });
    return 'inserted';
  }

  // 已存在：CheapShark 是价格权威源，直接覆盖价格相关字段
  const old = existing[0];
  await gamesCol.doc(old._id).update({
    data: {
      price: data.price,
      originalPrice: data.originalPrice,
      discount: data.discount,
      storeUrls: { ...(old.storeUrls || {}), ...data.storeUrls },
      dataSources: Array.from(new Set([...(old.dataSources || []), 'cheapshark'])),
      updatedAt: now,
      'lastSyncedAt.cheapshark': now,
    },
  });
  return 'updated';
}

// ============ 主入口 ============
// event 参数：
//   - storeID: 商店 ID（默认 1=Steam）
//   - pageSize: 拉取数量（默认 30，最大 60）
//   - sortBy: 排序方式（Savings 折扣最大、Deal Rating 评级、Price）
//   - onSale: 仅拉取在打折中的
exports.main = async (event, context) => {
  const {
    storeID = '1',
    pageSize = 30,
    sortBy = 'Savings',
    onSale = '1',
  } = event;

  try {
    const params = new URLSearchParams({
      storeID: String(storeID),
      pageSize: String(pageSize),
      sortBy,
      onSale: String(onSale),
      desc: '1',
    }).toString();

    const url = `https://www.cheapshark.com/api/1.0/deals?${params}`;
    console.log('[CheapShark] GET', url);

    const list = await httpGet(url);

    const stats = { total: list.length, inserted: 0, updated: 0, skipped_no_steamid: 0, failed: 0, failures: [] };

    for (const item of list) {
      try {
        const normalized = normalize(item);
        const result = await upsertGame(normalized);
        stats[result] = (stats[result] || 0) + 1;
      } catch (e) {
        stats.failed++;
        stats.failures.push({ name: item.title, error: e.message });
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: { source: 'cheapshark', ...stats },
    };
  } catch (err) {
    console.error('[CheapShark] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
