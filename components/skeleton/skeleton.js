// components/skeleton/skeleton.js
// 通用骨架屏：list / detail / grid 三种模式
Component({
  options: {
    multipleSlots: false,
    styleIsolation: 'isolated',
  },
  properties: {
    // list 游戏卡片列表 / detail 详情页 / grid 九宫格
    type: { type: String, value: 'list' },
    // 显示数量（list/grid 模式生效）
    count: { type: Number, value: 5 },
    // 是否启用闪烁动画
    animated: { type: Boolean, value: true },
    // 是否显示（外层 v-if 也可控制）
    visible: { type: Boolean, value: true },
  },
  data: {
    items: [],
  },
  observers: {
    'count': function (count) {
      // 提前生成空数组供 wx:for 使用
      this.setData({ items: new Array(Math.max(1, count)).fill(0) });
    },
  },
  lifetimes: {
    attached() {
      this.setData({ items: new Array(Math.max(1, this.data.count)).fill(0) });
    },
  },
});
