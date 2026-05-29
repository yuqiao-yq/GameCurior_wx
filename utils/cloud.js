// utils/cloud.js
// 云开发调用统一封装：包含 loading、错误处理、统一返回结构

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @param {object} options 可选项
 *   - showLoading: 是否展示 loading（默认 false）
 *   - loadingText: loading 文案
 *   - showError: 失败时是否 toast 错误（默认 true）
 * @returns {Promise<any>} 云函数 result.data 部分
 */
function callFunction(name, data = {}, options = {}) {
  const {
    showLoading = false,
    loadingText = '加载中...',
    showError = true,
  } = options;

  if (showLoading) {
    wx.showLoading({ title: loadingText, mask: true });
  }

  return new Promise((resolve, reject) => {
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
          if (showError) {
            wx.showToast({ title: errMsg, icon: 'none', duration: 2000 });
          }
          reject(Object.assign(new Error(errMsg), { code: result.code }));
        }
      },
      fail: (err) => {
        console.error(`[cloud:${name}] fail`, err);
        if (showError) {
          wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        }
        reject(err);
      },
      complete: () => {
        if (showLoading) wx.hideLoading();
      },
    });
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
};
