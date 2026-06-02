// pages/search/search.js
// 搜索页：搜索框 + 本地搜索历史 + 热搜推荐 + 实时联想
const cloud = require('../../utils/cloud.js');

const HISTORY_KEY = 'search:history';   // 本地缓存 key
const HISTORY_MAX = 10;                  // 历史最多保留条数
const SUGGEST_DEBOUNCE = 300;            // 联想 debounce 毫秒

Page({
  data: {
    keyword: '',
    history: [],         // 搜索历史（最新在前）
    hotKeywords: [],     // 热搜词
    suggestions: [],     // 联想结果
    showSuggest: false,  // 是否显示联想（输入框非空时）
    loadingHot: true,
  },

  onLoad() {
    this.loadHistory();
    this.fetchHotKeywords();
  },

  // ============ 本地历史 ============

  loadHistory() {
    const history = wx.getStorageSync(HISTORY_KEY) || [];
    this.setData({ history });
  },

  saveHistory(kw) {
    const word = String(kw || '').trim();
    if (!word) return;
    let history = wx.getStorageSync(HISTORY_KEY) || [];
    // 去重 + 最新置顶
    history = [word, ...history.filter((h) => h !== word)].slice(0, HISTORY_MAX);
    wx.setStorageSync(HISTORY_KEY, history);
    this.setData({ history });
  },

  // 删除单条
  handleRemoveHistory(e) {
    e.stopPropagation && e.stopPropagation();
    const { index } = e.currentTarget.dataset;
    const history = [...this.data.history];
    history.splice(index, 1);
    wx.setStorageSync(HISTORY_KEY, history);
    this.setData({ history });
  },

  // 清空所有
  handleClearHistory() {
    if (this.data.history.length === 0) return;
    wx.showModal({
      title: '提示',
      content: '确定清空全部搜索历史？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(HISTORY_KEY);
          this.setData({ history: [] });
        }
      },
    });
  },

  // ============ 热搜词 ============

  async fetchHotKeywords() {
    this.setData({ loadingHot: true });
    try {
      const data = await cloud.callFunction(
        'searchGames',
        { action: 'hot', limit: 10 },
        { showError: false }
      );
      this.setData({ hotKeywords: data.keywords || [] });
    } catch (err) {
      console.warn('fetchHotKeywords fail:', err);
    } finally {
      this.setData({ loadingHot: false });
    }
  },

  // ============ 输入框 ============

  handleInput(e) {
    const keyword = e.detail.value || '';
    this.setData({ keyword, showSuggest: !!keyword.trim() });
    this.debouncedSuggest(keyword);
  },

  // 简单 debounce 实现，避免每个按键都打云函数
  debouncedSuggest(keyword) {
    if (this._suggestTimer) clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => {
      this.fetchSuggestions(keyword);
    }, SUGGEST_DEBOUNCE);
  },

  async fetchSuggestions(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) {
      this.setData({ suggestions: [] });
      return;
    }
    try {
      const data = await cloud.callFunction(
        'searchGames',
        { action: 'suggest', keyword: kw, limit: 8 },
        { showError: false }
      );
      // 仅当 keyword 与当前输入一致时才更新，避免乱序
      if (kw === String(this.data.keyword || '').trim()) {
        this.setData({ suggestions: data.suggestions || [] });
      }
    } catch (err) {
      console.warn('fetchSuggestions fail:', err);
    }
  },

  // 清除输入框
  handleClearInput() {
    this.setData({ keyword: '', suggestions: [], showSuggest: false });
  },

  // 取消（返回上一页）
  handleCancel() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  // ============ 搜索动作 ============

  // 回车 / 提交
  handleConfirm(e) {
    const keyword = (e.detail && e.detail.value) || this.data.keyword;
    this.doSearch(keyword);
  },

  // 点击历史 / 热搜词
  handleQuickSearch(e) {
    const { keyword } = e.currentTarget.dataset;
    this.setData({ keyword });
    this.doSearch(keyword);
  },

  // 点击联想项：可能是游戏（有 _id），直接跳详情
  handleSuggestionTap(e) {
    const { item } = e.currentTarget.dataset;
    if (item && item._id) {
      // 把游戏名也存进历史
      this.saveHistory(item.name || this.data.keyword);
      wx.navigateTo({ url: `/pages/game/detail/detail?id=${item._id}` });
    } else {
      this.doSearch(this.data.keyword);
    }
  },

  doSearch(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }
    this.saveHistory(kw);
    wx.navigateTo({
      url: `/pages/search/result/result?keyword=${encodeURIComponent(kw)}`,
    });
  },
});
