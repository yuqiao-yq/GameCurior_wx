// pages/mine/mine.js
const cloud = require('../../utils/cloud.js');
const app = getApp();

Page({
  data: {
    openid: '',
    user: null,        // { nickname, avatar }
    stats: {
      favCount: 0,
      historyCount: 0,
    },
    loading: true,
  },

  onLoad() {
    this.refresh();
  },

  // 每次显示都刷新（用户从收藏页返回时数据可能变化）
  onShow() {
    if (!this.data.loading) this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      // 静默登录拿 openid + 用户信息
      const loginData = await cloud.callFunction('login', {}, { showError: false });
      app.globalData.openid = loginData.openid;
      app.globalData.userInfo = loginData.user;

      this.setData({
        openid: loginData.openid,
        user: loginData.user,
      });

      // 查收藏数（不阻塞，错误忽略）
      this.fetchStats();
    } catch (err) {
      console.warn('mine onLoad fail:', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async fetchStats() {
    try {
      const data = await cloud.callFunction(
        'favorite',
        { action: 'list', pageSize: 1 }, // 只是为了拿总数标记，list 已经够用
        { showError: false }
      );
      // 简化：暂时只显示是否有收藏
      this.setData({
        'stats.favCount': (data.list && data.list.length) || 0,
      });
    } catch (e) {
      console.warn('fetchStats fail:', e);
    }
  },

  // 跳收藏列表
  handleGotoFavorites() {
    wx.navigateTo({ url: '/pages/mine/favorites/favorites' });
  },

  // 跳浏览历史（待开发）
  handleGotoHistory() {
    wx.showToast({ title: '浏览历史功能开发中', icon: 'none' });
  },

  // 设置（待开发）
  handleGotoSetting() {
    wx.showToast({ title: '设置功能开发中', icon: 'none' });
  },

  // 关于我们
  handleAbout() {
    wx.showModal({
      title: 'GameCurior',
      content: '版本 0.1.0\n发现你感兴趣的好玩游戏\n\n数据来源：Steam 商店 / CheapShark',
      showCancel: false,
    });
  },

  // 用户信息编辑头像（小程序新规范用 chooseAvatar）
  async handleChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;
    // 上传头像到云存储
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const cloudPath = `avatar/${this.data.openid}_${Date.now()}.jpg`;
      const fileID = await cloud.uploadFile(cloudPath, avatarUrl);
      // 本地立刻更新（云端后续做用户信息更新接口）
      this.setData({ 'user.avatar': fileID });
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  // 输入昵称
  handleNicknameInput(e) {
    const { value } = e.detail;
    this.setData({ 'user.nickname': value });
    // TODO: 后续做用户信息更新云函数
  },
});
