// utils/cloud.js
// 云开发调用统一封装：包含 loading、错误处理、网络错误自动重试、统一返回结构

// 可重试的错误关键词（网络抖动、超时、临时连接失败）
const RETRIABLE_KEYWORDS = [
  'timeout',
  'TIMEOUT',
  'network',
  'NETWORK',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'request:fail',
  'cloud function service error',
];

function isRetriable(err) {
  if (!err) return false;
  const message = err.message || err.errMsg || '';
  return RETRIABLE_KEYWORDS.some((kw) => String(message).includes(kw));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 调用云函数（含自动重试 + 统一错误处理）
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @param {object} options 可选项
 *   - showLoading: 是否展示 loading（默认 false）
 *   - loadingText: loading 文案
 *   - showError: 失败时是否 toast 错误（默认 true）
 *   - retry: 网络错误重试次数（默认 1，可设 0 关闭）
 *   - retryDelay: 重试间隔（默认 600ms，指数退避）
 * @returns {Promise<any>} 云函数 result.data 部分
 */
function callFunction(name, data = {}, options = {}) {
  const {
    showLoading = false,
    loadingText = '加载中...',
    showError = true,
    retry = 1,
    retryDelay = 600,
  } = options;

  if (showLoading) {
    wx.showLoading({ title: loadingText, mask: true });
  }

  const invoke = (attempt) =>
    new Promise((resolve, reject) => {
      if (!wx.cloud) {
        const msg = '当前微信版本过低，无法使用云能力';
        if (showError) wx.showToast({ title: msg, icon: 'none' });
        return reject(new Error(msg));
      }

      wx.cloud.callFunction({
        name,
        data,
        success: (res) => {
          const result = res.result || {};
          // 业务约定：{ code, message, data }
          if (result.code === 0) {
            resolve(result.data);
          } else {
            const errMsg = result.message || '请求失败';
            // 业务错误不重试（如违规、参数错误），直接抛
            if (showError) {
              wx.showToast({ title: errMsg, icon: 'none', duration: 2000 });
            }
            reject(Object.assign(new Error(errMsg), { code: result.code }));
          }
        },
        fail: (err) => {
          // 网络错误：尝试重试
          if (attempt < retry && isRetriable(err)) {
            console.warn(`[cloud:${name}] ${err.errMsg || err.message}, retry ${attempt + 1}/${retry}`);
            // 指数退避：第 1 次 600ms，第 2 次 1200ms
            sleep(retryDelay * (attempt + 1))
              .then(() => invoke(attempt + 1))
              .then(resolve)
              .catch(reject);
            return;
          }
          console.error(`[cloud:${name}] fail`, err);
          if (showError) {
            wx.showToast({ title: '网络异常，请重试', icon: 'none' });
          }
          reject(err);
        },
      });
    });

  return invoke(0).finally(() => {
    if (showLoading) wx.hideLoading();
  });
}

/**
 * 获取云数据库实例（用于客户端直读简单数据）
 */
function db() {
  return wx.cloud.database();
}

/**
 * 上传文件到云存储
 * @param {string} cloudPath 云端路径，如 'avatar/xxx.jpg'
 * @param {string} filePath 本地文件路径
 */
function uploadFile(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res.fileID),
      fail: reject,
    });
  });
}

module.exports = {
  callFunction,
  db,
  uploadFile,
  // 暴露工具方法，便于其他模块判断
  isRetriable,
};
