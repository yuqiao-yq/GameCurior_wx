// cloudfunctions/importGame/index.js
// 把外部数据源（CheapShark / Steam Store）的游戏导入本地 games 集合
// 入参：{ source: 'cheapshark', externalId: '<CheapShark gameID>' }
// 返回：{ _id: 新/已有游戏的 _id, isNew: boolean, game: {...} }
//
// 实现流程：
//   1. 通过 CheapShark `/api/1.0/games?id=xxx` 拿 steamAppID
//   2. 用 steamAppID 调 Steam Store appdetails（cc=cn, l=schinese）拿完整中文数据
//   3. 归一化 + 去重检查 + upsert
//   4. 若 Steam Store 调用失败，退化用 CheapShark 最小数据建草稿记录
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

const USD_TO_CNY = 7.2;
const STEAM_TIMEOUT = 12000;
const CHEAPSHARK_TIMEOUT = 8000;

// ============ HTTP GET ============
function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const options = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
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

// ============ 归一化 Steam Store 数据（复用 syncFromSteamStore 的逻辑） ============
function normalizeSteamData(steamData) {
  const steamId = String(steamData.steam_appid);
  const priceInfo = steamData.price_overview || {};
  const isFree = steamData.is_free === true;
  const price = isFree ? 0 : (priceInfo.final ? priceInfo.final / 100 : 0);
  const originalPrice = isFree ? 0 : (priceInfo.initial ? priceInfo.initial / 100 : 0);
  const discount = priceInfo.discount_percent || 0;

  const screenshots = (steamData.screenshots || [])
    .slice(0, 8)
    .map((s) => s.path_full || s.path_thumbnail);

  const videos = (steamData.movies || []).slice(0, 2).map((m) => ({
    url: (m.mp4 && m.mp4['480']) || (m.webm && m.webm['480']) || '',
    cover: m.thumbnail || '',
    name: m.name || '',
  }));

  const tags = Array.from(new Set([
    ...(steamData.genres || []).map((g) => g.description),
    ...(steamData.categories || []).slice(0, 5).map((c) => c.description),
  ])).filter(Boolean).slice(0, 10);

  const platforms = ['steam'];
  if (steamData.platforms) {
    if (steamData.platforms.windows) platforms.push('pc');
    if (steamData.platforms.mac) platforms.push('mac');
    if (steamData.platforms.linux) platforms.push('linux');
  }

  let releasedAt = null;
  if (steamData.release_date && !steamData.release_date.coming_soon && steamData.release_date.date) {
    releasedAt = steamData.release_date.date;
  }

  return {
    externalIds: { steam: steamId },
    name: steamData.name,        // Steam Store cc=cn 时返回的就是中文名
    nameEn: steamData.name,
    description: steamData.short_description || '',
    detailedDescription: steamData.detailed_description || '',
    cover: `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`,
    headerImage: steamData.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`,
    screenshots,
    videos,
    price,
    originalPrice,
    discount,
    isFree,
    tags,
    platforms,
    developer: (steamData.developers && steamData.developers[0]) || '',
    publisher: (steamData.publishers && steamData.publishers[0]) || '',
    releasedAt,
    storeUrls: { steam: `https://store.steampowered.com/app/${steamId}/` },
    supportedLanguages: steamData.supported_languages || '',
    metacritic: (steamData.metacritic && steamData.metacritic.score) || 0,
    rating: (steamData.metacritic && steamData.metacritic.score) ? steamData.metacritic.score / 10 : 0,
  };
}

// ============ 归一化 CheapShark 单游戏详情（退化方案） ============
function normalizeCheapShark(detail, externalId) {
  const info = detail.info || {};
  const cheapest = detail.cheapestPriceEver || {};
  const steamId = info.steamAppID ? String(info.steamAppID) : null;

  return {
    externalIds: steamId ? { steam: steamId, cheapshark: externalId } : { cheapshark: externalId },
    name: info.title || '未知游戏',
    nameEn: info.title || '',
    description: '',
    cover: steamId
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`
      : (info.thumb || ''),
    headerImage: steamId
      ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`
      : (info.thumb || ''),
    price: cheapest.price ? Math.round(parseFloat(cheapest.price) * USD_TO_CNY * 100) / 100 : 0,
    originalPrice: 0,
    discount: 0,
    tags: ['Steam'],
    platforms: ['steam'],
    storeUrls: steamId
      ? { steam: `https://store.steampowered.com/app/${steamId}/` }
      : {},
    rating: 0,
    screenshots: [],
    videos: [],
  };
}

// ============ 主入口 ============
exports.main = async (event, context) => {
  const { source, externalId } = event;

  if (!externalId) {
    return { code: 1001, message: '缺少 externalId', data: null };
  }
  if (source !== 'cheapshark') {
    return { code: 1002, message: `暂不支持 source=${source}`, data: null };
  }

  try {
    // 1. CheapShark 详情接口，拿到 steamAppID
    const detailUrl = `https://www.cheapshark.com/api/1.0/games?id=${encodeURIComponent(externalId)}`;
    const detail = await httpGet(detailUrl, CHEAPSHARK_TIMEOUT);

    if (!detail || !detail.info) {
      return { code: 2001, message: '外部数据源未找到该游戏', data: null };
    }

    const steamId = detail.info.steamAppID ? String(detail.info.steamAppID) : null;

    // 2. 先做去重：如果 games 集合中已有这个 steamId / cheapsharkId，直接返回
    const dedupConditions = [];
    if (steamId) dedupConditions.push({ 'externalIds.steam': steamId });
    dedupConditions.push({ 'externalIds.cheapshark': String(externalId) });

    const existing = await gamesCol
      .where(db.command.or(dedupConditions))
      .limit(1)
      .get();

    if (existing.data.length > 0) {
      return {
        code: 0,
        message: 'ok (already exists)',
        data: { _id: existing.data[0]._id, isNew: false, game: existing.data[0] },
      };
    }

    // 3. 尝试用 Steam Store 拉完整数据（中文），失败则退化用 CheapShark 数据
    let normalized;
    let dataSources = ['cheapshark'];

    if (steamId) {
      try {
        const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${steamId}&cc=cn&l=schinese`;
        const json = await httpGet(steamUrl, STEAM_TIMEOUT);
        const item = json && json[steamId];
        if (item && item.success && item.data) {
          normalized = normalizeSteamData(item.data);
          // 把 cheapshark id 也写进去，方便后续同步价格
          normalized.externalIds.cheapshark = String(externalId);
          dataSources = ['steamstore', 'cheapshark'];
        }
      } catch (e) {
        console.warn('[importGame] steam store fetch failed, fallback to cheapshark:', e.message);
      }
    }

    if (!normalized) {
      normalized = normalizeCheapShark(detail, externalId);
    }

    // 4. 写入 games 集合
    const now = new Date();
    const insertData = {
      ...normalized,
      categoryId: '',
      ratingCount: 0,
      stats: { favCount: 0, viewCount: 0, reviewCount: 0 },
      dataSources,
      status: 1,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: dataSources.reduce((acc, s) => {
        acc[s] = now;
        return acc;
      }, {}),
    };

    const result = await gamesCol.add({ data: insertData });

    return {
      code: 0,
      message: 'ok',
      data: {
        _id: result._id,
        isNew: true,
        sources: dataSources,
        game: { _id: result._id, ...insertData },
      },
    };
  } catch (err) {
    console.error('[importGame] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
