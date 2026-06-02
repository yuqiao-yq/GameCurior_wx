// components/privacy-popup/privacy-popup.js
// 首次启动隐私协议同意弹窗
// 使用本地缓存标记 'privacy:agreed' 判断是否已同意

const PRIVACY_KEY = 'privacy:agreed';
const PRIVACY_VERSION = '2026-05-29'; // 协议版本号；升级后强制重新同意

Component({
  data: {
    visible: false,
    version: PRIVACY_VERSION,
  },

  lifetimes: {
    attached() {
      this.checkAgreement();
    },
  },

  methods: {
    // 检查是否需要弹出
    checkAgreement() {
      try {
        const record = wx.getStorageSync(PRIVACY_KEY);
        // 没记录 或 版本不一致 → 重新弹出
        if (!record || record.version !== PRIVACY_VERSION) {
          this.setData({ visible: true });
        }
      } catch (e) {
        this.setData({ visible: true });
      }
    },

    // 用户同意
    handleAgree() {
      try {
        wx.setStorageSync(PRIVACY_KEY, {
          version: PRIVACY_VERSION,
          agreedAt: Date.now(),
        });
      } catch (e) {
        console.warn('persist privacy agreement failed:', e);
      }
      this.setData({ visible: false });
      this.triggerEvent('agree');
    },

    // 用户拒绝
    handleReject() {
      wx.showModal({
        title: '提示',
        content: '您需要同意《用户协议》和《隐私政策》后才能继续使用本小程序。',
        confirmText: '查看协议',
        cancelText: '退出',
        success: (res) => {
          if (res.cancel) {
            // 微信小程序退出
            wx.exitMiniProgram && wx.exitMiniProgram({ fail: () => {} });
          }
          // confirm 时不动作，保持弹窗
        },
      });
    },

    // 查看用户协议
    handleViewAgreement() {
      wx.navigateTo({ url: '/pages/legal/agreement/agreement' });
    },

    // 查看隐私政策
    handleViewPrivacy() {
      wx.navigateTo({ url: '/pages/legal/privacy/privacy' });
    },

    // 阻止穿透
    handleStop() {},
  },
});
