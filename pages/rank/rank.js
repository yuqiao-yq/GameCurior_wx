// pages/rank/rank.js
// 榜单页：热门 / 新游 / 好评 / 降价 四个子榜单
// 每个 tab 独立分页缓存，切换时不重新拉取（除非主动下拉）
const cloud = require('../../utils/cloud.js');

const TABS = [
  { key: 'hot', label: '🔥 热门榜', desc: '近期最受关注的游戏', sort: 'hot' },
  { key: 'new', label: '🆕 新游榜', desc: '最新发售的好游戏', sort: 'new' },
  { key: 'rating', label: '⭐ 好评榜', desc: '玩家评分最高', sort: 'rating' },
  { key: 'discount', label: '💰 降价榜', desc: '当前打折最狠', sort: 'discount' },
];

const PAGE_SIZE = 20;

Page({
  data: {
    tabs: TABS,
    activeTab: 0,
    // 每个 tab 的状态缓存：{ list, page, hasMore, loading, inited }
    tabStates: TABS.map(() => ({
      list: [],
      page: 1,
      hasMore: true,
      loading: false,
      inited: false,
    })),
  },

  onLoad() {
    this.fetchTab(0, { reset: true });
  },

  // 切换 tab：若该 tab 还没数据，立刻拉一次
  handleTabChange(e) {
    const { index } = e.currentTarget.dataset;
    if (index === this.data.activeTab) return;
    this.setData({ activeTab: index });
    const state = this.data.tabStates[index];
    if (!state.inited) {
      this.fetchTab(index, { reset: true });
    }
  },

  async fetchTab(index, { reset = false }) {
    const state = this.data.tabStates[index];
    if (state.loading) return;
    if (!reset && !state.hasMore) return;

    const tab = TABS[index];
    const page = reset ? 1 : state.page;

    this.updateTabState(index, { loading: true });

    try {
      const data = await cloud.callFunction(
        'getGameList',
        { sort: tab.sort, page, pageSize: PAGE_SIZE },
        { showError: false }
      );
      const newList = data.list || [];
      const merged = reset ? newList : [...state.list, ...newList];

      this.updateTabState(index, {
        list: merged,
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false,
        inited: true,
      });
    } catch (err) {
      console.warn(`[rank:${tab.key}] fetch fail:`, err);
      this.updateTabState(index, { loading: false, inited: true });
    }
  },

  // 更新指定 tab 的状态（不可变更新）
  updateTabState(index, patch) {
    const tabStates = [...this.data.tabStates];
    tabStates[index] = { ...tabStates[index], ...patch };
    this.setData({ tabStates });
  },

  onPullDownRefresh() {
    this.fetchTab(this.data.activeTab, { reset: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    const { activeTab } = this.data;
    const state = this.data.tabStates[activeTab];
    if (state.hasMore && !state.loading) {
      this.fetchTab(activeTab, { reset: false });
    }
  },

  handleGameTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${id}` });
  },

  onShareAppMessage() {
    const tab = TABS[this.data.activeTab];
    return {
      title: `${tab.label} - GameCurior`,
      path: '/pages/rank/rank',
    };
  },
});
