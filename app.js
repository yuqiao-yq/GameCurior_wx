// app.js
App({
  onLaunch() {
    console.log('GameCurior 小程序启动');

    // ============================================================
    // 初始化微信云开发（CloudBase）
    // ⚠️ 重要：env 必须是你自己的云开发环境 ID
    //   1. 微信开发者工具顶部「云开发」→ 复制环境 ID
    //   2. 把下方 CLOUD_ENV_ID 替换为你的环境 ID
    // ============================================================
    const CLOUD_ENV_ID = 'cloud1-8g8jrsgc94538121'; // TODO: 替换为你的环境 ID

    if (!wx.cloud) {
      console.error('当前微信版本过低，无法使用云能力，请升级到最新版本');
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
