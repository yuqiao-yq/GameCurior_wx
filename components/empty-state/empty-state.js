// components/empty-state/empty-state.js
// 通用空态 / 错误态组件
// 预设场景：empty / error / network / no-result / no-favorite / no-history
// 可通过 icon/title/desc/actionText 完全自定义

const PRESETS = {
  empty:       { icon: '📭', title: '暂无数据', desc: '稍后再来看看吧' },
  error:       { icon: '😢', title: '加载失败',   desc: '请稍后重试', actionText: '重新加载' },
  network:     { icon: '📡', title: '网络异常',   desc: '请检查网络后重试', actionText: '重试' },
  'no-result': { icon: '🔍', title: '没有找到相关内容', desc: '换个关键词试试' },
  'no-favorite': { icon: '⭐', title: '还没有收藏',     desc: '在游戏详情页点击收藏，方便随时回来' },
  'no-history':  { icon: '📜', title: '还没有浏览记录', desc: '去首页发现你感兴趣的游戏吧' },
};

Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    type: { type: String, value: 'empty' },         // 预设类型
    icon: { type: String, value: '' },               // 自定义图标 emoji
    title: { type: String, value: '' },              // 自定义标题
    desc: { type: String, value: '' },               // 自定义描述
    actionText: { type: String, value: '' },         // 操作按钮文案，为空则不显示按钮
    actionTheme: { type: String, value: 'primary' }, // primary / outline
    compact: { type: Boolean, value: false },        // 紧凑模式（小尺寸）
  },
  data: {
    resolved: { icon: '📭', title: '', desc: '', actionText: '' },
  },
  observers: {
    'type, icon, title, desc, actionText': function () {
      this.resolve();
    },
  },
  lifetimes: {
    attached() {
      this.resolve();
    },
  },
  methods: {
    resolve() {
      const preset = PRESETS[this.data.type] || PRESETS.empty;
      this.setData({
        resolved: {
          icon: this.data.icon || preset.icon,
          title: this.data.title || preset.title,
          desc: this.data.desc || preset.desc,
          actionText: this.data.actionText || preset.actionText || '',
        },
      });
    },
    handleAction() {
      this.triggerEvent('action');
    },
  },
});
