// pages/index/index.js
const cloud = require('../../utils/cloud.js');
const app = getApp();

Page({
  data: {
    appName: 'GameCurior',
    slogan: '发现你感兴趣的好玩游戏',
    features: [
      { icon: '🔥', title: '热门榜单', desc: '查看当下最热门的作品', action: 'rank' },
      { icon: '🏷️', title: '游戏分类', desc: '按类型寻找好游戏', action: 'category' },
      { icon: '⭐', title: '我的收藏', desc: '收藏喜欢的游戏随时查看', action: 'favorites' },
    ],
    games: [],     // 云函数返回的游戏列表
    loading: true,
    isMock: false, // 是否走 mock 数据
    openid: '',    // 登录后的 openid
  },

  onLoad() {
    this.loginAndFetch();
  },

  async loginAndFetch() {
    // 并行执行登录和获取列表（互不依赖）
    this.fetchGameList();
    this.silentLogin();
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
      const data = await cloud.callFunction(
        'getGameList',
        // TODO: 后续做列表页 / 榜单页后，首页 pageSize 改回 10，加"查看更多"跳转
        { page: 1, pageSize: 50, sort: 'rating' },
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
    this.fetchGameList().finally(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return {
      title: 'GameCurior - 发现你感兴趣的好玩游戏',
      path: '/pages/index/index',
    };
  },

  handleFeatureTap(e) {
    const { index } = e.currentTarget.dataset;
    const item = this.data.features[index];

    // 路由分发：TabBar 页面用 switchTab，普通页面用 navigateTo
    switch (item.action) {
      case 'rank':
        wx.switchTab({ url: '/pages/rank/rank' });
        break;
      case 'category':
        wx.switchTab({ url: '/pages/category/category' });
        break;
      case 'favorites':
        wx.navigateTo({ url: '/pages/mine/favorites/favorites' });
        break;
      default:
        wx.showToast({ title: `${item.title} 功能开发中`, icon: 'none' });
    }
  },

  handleSearchTap() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  handlePrimaryTap() {
    wx.showToast({
      title: '开始探索吧！',
      icon: 'success',
    });
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
