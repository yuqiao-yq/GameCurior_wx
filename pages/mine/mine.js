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

      // 拉一次最新的 userProfile（覆盖 login 返回的可能过时数据）
      this.fetchProfile();
    } catch (err) {
      console.warn('mine onLoad fail:', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 拉最新的用户资料（兜底）
  async fetchProfile() {
    try {
      const data = await cloud.callFunction(
        'userProfile',
        { action: 'get' },
        { showError: false }
      );
      if (data && data.user) {
        this.setData({ user: data.user });
        app.globalData.userInfo = data.user;
      }
    } catch (e) {
      // 忽略
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

  // 跳浏览历史
  handleGotoHistory() {
    wx.navigateTo({ url: '/pages/mine/history/history' });
  },

  // 设置
  handleGotoSetting() {
    wx.navigateTo({ url: '/pages/mine/setting/setting' });
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
  // 1. 上传到云存储
  // 2. 调 userProfile.update 保存到云端
  async handleChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;

    const originalAvatar = this.data.user && this.data.user.avatar;
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const cloudPath = `avatar/${this.data.openid}_${Date.now()}.jpg`;
      const fileID = await cloud.uploadFile(cloudPath, avatarUrl);
      // 乐观更新
      this.setData({ 'user.avatar': fileID });

      // 保存到云端
      try {
        await cloud.callFunction(
          'userProfile',
          { action: 'update', avatar: fileID },
          { showError: false }
        );
        wx.hideLoading();
        wx.showToast({ title: '头像已更新', icon: 'success' });
      } catch (err) {
        // 保存失败回滚
        this.setData({ 'user.avatar': originalAvatar });
        wx.hideLoading();
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  // 点击昵称区域：弹 modal 编辑
  handleEditNickname() {
    const current = (this.data.user && this.data.user.nickname) || '';
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入昵称（最多 24 字）',
      content: current,
      confirmText: '保存',
      confirmColor: '#5b3aa8',
      success: (res) => {
        if (res.confirm) {
          const trimmed = String(res.content || '').trim();
          if (!trimmed) {
            wx.showToast({ title: '昵称不能为空', icon: 'none' });
            return;
          }
          if (trimmed === current) return; // 没变
          this.saveNickname(trimmed, current);
        }
      },
    });
  },

  // 保存昵称（含内容安全审核）
  async saveNickname(nickname, original) {
    // 乐观更新
    this.setData({ 'user.nickname': nickname });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const data = await cloud.callFunction(
        'userProfile',
        { action: 'update', nickname },
        { showError: false }
      );
      wx.hideLoading();
      // 校验返回结果
      if (data && data.user) {
        this.setData({ user: data.user });
        app.globalData.userInfo = data.user;
        wx.showToast({ title: '昵称已更新', icon: 'success' });
      }
    } catch (err) {
      wx.hideLoading();
      // 回滚
      this.setData({ 'user.nickname': original });
      // userProfile 的业务错误（如 1004 违规、1003 长度）会带 message
      const msg = (err && err.message) || '保存失败';
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    }
  },
});
