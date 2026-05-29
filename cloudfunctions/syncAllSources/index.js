// cloudfunctions/syncAllSources/index.js
// 一键聚合所有数据源
// 推荐执行顺序：
//   1. initGames        → 写入中文化的种子数据（建立基线）
//   2. syncFromSteamSpy → 拉热门，补全销量/评分/英文名
//   3. syncFromRAWG     → 补全截图/视频/标签（耗 API 配额）
//   4. syncFromCheapShark → 最后跑，覆盖实时价格
//
// 也可以设置定时触发器（建议每天凌晨跑 CheapShark 即可）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYNC_PIPELINE = [
  { name: 'initGames', params: {}, skipIfNotReady: false },
  { name: 'syncFromSteamSpy', params: { request: 'top100in2weeks', limit: 30 } },
  { name: 'syncFromCheapShark', params: { storeID: '1', pageSize: 30, sortBy: 'Savings' } },
  { name: 'syncFromRAWG', params: { mode: 'enrich', pageSize: 10 }, skipIfNotReady: true },
];

async function callSubFunction(name, data) {
  const start = Date.now();
  try {
    const res = await cloud.callFunction({ name, data });
    return {
      name,
      ok: true,
      duration: Date.now() - start,
      result: res.result,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      duration: Date.now() - start,
      error: err.message,
    };
  }
}

exports.main = async (event, context) => {
  const { only = [], skip = [] } = event;
  // only: 仅执行指定的几个 ['initGames', 'syncFromCheapShark']
  // skip: 跳过指定的几个

  const pipeline = SYNC_PIPELINE.filter((step) => {
    if (only.length > 0 && !only.includes(step.name)) return false;
    if (skip.includes(step.name)) return false;
    return true;
  });

  const results = [];
  for (const step of pipeline) {
    console.log(`[syncAllSources] 开始 ${step.name}`);
    const r = await callSubFunction(step.name, step.params);
    results.push(r);
    console.log(`[syncAllSources] 结束 ${step.name}，耗时 ${r.duration}ms`);

    // RAWG 未配置 key 时不要阻塞流程
    if (!r.ok && step.skipIfNotReady) {
      console.warn(`[syncAllSources] ${step.name} 跳过：`, r.error);
    }
  }

  const summary = {
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };

  return {
    code: 0,
    message: 'ok',
    data: {
      summary,
      results,
    },
  };
};
