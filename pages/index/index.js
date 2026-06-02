// pages/index/index.js
const cloud = require('../../utils/cloud.js');
const app = getApp();

Page({
  data: {
    banners: [],     // 首页 banner 轮播
    games: [],       // 云函数返回的游戏列表
    loading: true,
    bannersLoading: true,
    isMock: false,
    openid: '',
  },

  onLoad() {
    this.loginAndFetch();
  },

  async loginAndFetch() {
    // 并行执行登录 + 拉游戏 + 拉 banner
    this.fetchGameList();
    this.fetchHomeConfig();
    this.silentLogin();
  },

  /**
   * 拉首页配置（banner + 热搜词等）
   */
  async fetchHomeConfig() {
    this.setData({ bannersLoading: true });
    try {
      const data = await cloud.callFunction(
        'getHomeConfig',
        { includeBanners: true, includeHotKeywords: false },
        { showError: false }
      );
      this.setData({
        banners: data.banners || [],
        bannersLoading: false,
      });
    } catch (err) {
      console.warn('fetchHomeConfig fail:', err);
      this.setData({ bannersLoading: false });
    }
  },

  /**
   * 静默登录：调用云函数 login，拿到 openid + 用户信息
   */
  async silentLogin() {
    try {
      const data = await cloud.callFunction('login', {}, { showError: false });
      console.log('登录成功：', data);
      app.globalData.openid = data.openid;
      app.globalData.userInfo = data.user;
      this.setData({ openid: data.openid });
    } catch (err) {
      console.warn('登录失败（可忽略，云环境未配置）：', err.message);
    }
  },

  /**
   * 获取游戏列表
   */
  async fetchGameList() {
    this.setData({ loading: true });
    try {
      // 首页只拉前 10 条做"今日精选"展示，更多走榜单/搜索页（首屏体积 & 渲染压力）
      const data = await cloud.callFunction(
        'getGameList',
        { page: 1, pageSize: 10, sort: 'rating' },
        { showError: false }
      );
      this.setData({
        games: data.list || [],
        isMock: data.isMock || false,
        loading: false,
      });
    } catch (err) {
      console.warn('获取游戏列表失败（请检查云环境配置）：', err.message);
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    Promise.all([this.fetchGameList(), this.fetchHomeConfig()])
      .finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return {
      title: 'GameCurior - 发现你感兴趣的好玩游戏',
      path: '/pages/index/index',
    };
  },

  handleSearchTap() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  handleGameTap(e) {
    const { game } = e.currentTarget.dataset;
    if (!game || !game._id) {
      wx.showToast({ title: '游戏信息异常', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/game/detail/detail?id=${game._id}`,
    });
  },
});
