// app.js

// 本地环境配置（CLOUD_ENV_ID 等）。
// utils/env.js 不入版本控制，新人请复制 utils/env.example.js → utils/env.js 并填入自己的环境 ID。
let ENV;
try {
  ENV = require('./utils/env.js');
} catch (e) {
  console.error('[env] 缺少 utils/env.js，请按 utils/env.example.js 创建后填入云开发环境 ID');
  ENV = {};
}

App({
  onLaunch() {
    console.log('GameCurior 小程序启动');

    const CLOUD_ENV_ID = ENV.CLOUD_ENV_ID;

    if (!wx.cloud) {
      console.error('当前微信版本过低，无法使用云能力，请升级到最新版本');
    } else if (!CLOUD_ENV_ID || CLOUD_ENV_ID === 'your-cloud-env-id-here') {
      console.error('[cloud] CLOUD_ENV_ID 未配置，云能力不可用');
    } else {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true, // 在控制台记录用户访问记录
      });
      console.log('云开发初始化完成，env =', CLOUD_ENV_ID);
    }

    // 获取系统信息（示例）
    try {
      const systemInfo = wx.getSystemInfoSync();
      this.globalData.systemInfo = systemInfo;
    } catch (e) {
      console.error('获取系统信息失败', e);
    }
  },

  onShow() {
    // 小程序从后台进入前台时触发
  },

  onHide() {
    // 小程序从前台进入后台时触发
  },

  onError(msg) {
    console.error('小程序发生错误：', msg);
  },

  globalData: {
    userInfo: null,
    systemInfo: null,
    openid: null, // 登录后填充
  },
});
