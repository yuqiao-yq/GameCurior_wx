// pages/rank/rank.js
// 榜单页（占位）：后续做热门 / 新游 / 好评 / 降价四个子榜单
Page({
  data: {
    activeTab: 0,
    tabs: [
      { key: 'hot', label: '🔥 热门榜', desc: '近期最受关注的游戏' },
      { key: 'new', label: '🆕 新游榜', desc: '最新发售的好游戏' },
      { key: 'rating', label: '⭐ 好评榜', desc: '玩家评分最高' },
      { key: 'discount', label: '💰 降价榜', desc: '当前打折最狠' },
    ],
  },

  onLoad() {},

  handleTabChange(e) {
    const { index } = e.currentTarget.dataset;
    this.setData({ activeTab: index });
  },
});
