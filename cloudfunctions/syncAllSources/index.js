// cloudfunctions/syncAllSources/index.js
// ⚠️ 云函数互调有 3 秒默认超时（SCF 限制）：
//   - 同步等待 cloud.callFunction，超过 3 秒会被父函数判定为失败
//   - 但子函数实际还在云端继续跑，最终能完成
//
// 因此本函数采用「异步触发 + 立即返回」模式：
//   - 触发所有子函数（fire-and-forget）
//   - 立即返回触发列表
//   - 实际结果请到各个子函数的「日志」标签查看
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYNC_PIPELINE = [
  { name: 'initGames', params: {} },
  // SteamSpy 被 Cloudflare 拦截腾讯云 IP，功能由 syncFromSteamStore 替代
  { name: 'syncFromSteamSpy', params: { request: 'top100in2weeks', limit: 30 } },
  // CheapShark 提供实时打折信息
  { name: 'syncFromCheapShark', params: { storeID: '1', pageSize: 30, sortBy: 'Savings' } },
  // SteamStore 是主力数据源，限制为 3 个 / 次，多跑几次能逐步覆盖
  // 太大会让单个 sync 函数 60s 跑不完（每个 appid 最坏含重试要 30+s）
  { name: 'syncFromSteamStore', params: { limit: 3, delayMs: 500 } },
  // ⚠️ RAWG 全部暂时禁用：api.rawg.io 走 Cloudflare 节点（108.160.170.26）国内不可达
  //    本地 + 腾讯云函数出口都 Destination Host Unreachable，非代码可解
  //    后续若有海外节点 / 代理通道可恢复（取消下方 6 行注释 + 启用 syncFromRAWG 部署）
  //
  // { name: 'syncFromRAWG', params: { mode: 'enrich', pageSize: 10 } },
  // { name: 'syncFromRAWG', params: { mode: 'platform', platformId: 7,   pageSize: 20, ordering: '-added' } }, // Switch
  // { name: 'syncFromRAWG', params: { mode: 'platform', platformId: 187, pageSize: 20, ordering: '-added' } }, // PS5
  // { name: 'syncFromRAWG', params: { mode: 'platform', platformId: 18,  pageSize: 20, ordering: '-added' } }, // PS4
  // { name: 'syncFromRAWG', params: { mode: 'platform', platformId: 186, pageSize: 20, ordering: '-added' } }, // Xbox Series
  // { name: 'syncFromRAWG', params: { mode: 'platform', platformId: 1,   pageSize: 20, ordering: '-added' } }, // Xbox One
  // ===== IGDB（主机平台 + 冷门 / 日韩独占）=====
  // IGDB 平台 ID：Switch=130 / PS5=167 / PS4=48 / Xbox Series=169 / Xbox One=49
  // 函数内部循环 5 个平台，一次调用搞定，避免再加 5 行调度
  { name: 'syncFromIGDB', params: { platforms: [130, 167, 48, 169, 49], limitPerPlatform: 30 } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.main = async (event, context) => {
  const { only = [], skip = [] } = event;

  const pipeline = SYNC_PIPELINE.filter((step) => {
    if (only.length > 0 && !only.includes(step.name)) return false;
    if (skip.includes(step.name)) return false;
    return true;
  });

  const triggered = [];

  for (const step of pipeline) {
    console.log(`[syncAllSources] 异步触发 ${step.name}`, JSON.stringify(step.params));
    try {
      // 关键：不 await，立即触发；用 .then/.catch 记录最终结果到日志
      cloud
        .callFunction({ name: step.name, data: step.params })
        .then((r) => {
          console.log(
            `[syncAllSources] [${step.name}] 已完成:`,
            JSON.stringify(r.result || r).slice(0, 500)
          );
        })
        .catch((e) => {
          // ESOCKETTIMEDOUT 是预期内的（云函数互调 3 秒限制），不算错误
          // 子函数实际还在执行
          if (e.message && (e.message.includes('TIMED') || e.message.includes('timed out'))) {
            console.log(`[syncAllSources] [${step.name}] 父函数超时返回（子函数仍在执行）`);
          } else {
            console.warn(`[syncAllSources] [${step.name}] 触发失败:`, e.message);
          }
        });

      triggered.push({
        name: step.name,
        status: 'triggered',
        params: step.params,
      });

      // 间隔 1500ms 避免同时启动多个云函数（含同函数多次触发，如 syncFromRAWG 跑 6 次会撞 SCF 单函数并发上限）
      await sleep(1500);
    } catch (err) {
      console.error(`[syncAllSources] [${step.name}] 同步触发异常:`, err.message);
      triggered.push({
        name: step.name,
        status: 'error',
        error: err.message,
      });
    }
  }

  return {
    code: 0,
    message: '所有任务已异步触发，请到各云函数「日志」标签查看实际执行结果',
    data: {
      total: triggered.length,
      triggered,
      hint: '云函数互调有 3 秒同步超时（SCF 限制），故采用异步触发模式。如需查看每个 sync 的详细结果，请进入「云函数 → 选中 → 日志」查看。',
      checkAfter: '1-2 分钟后',
    },
  };
};
