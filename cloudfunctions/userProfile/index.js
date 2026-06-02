// cloudfunctions/userProfile/index.js
// 用户资料：get / update
// 更新昵称前会调用 contentCheck 云函数做内容安全审核
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const usersCol = db.collection('users');

const NICKNAME_MAX = 24;       // 微信昵称上限
const NICKNAME_MIN = 1;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action = 'get' } = event;

  if (!OPENID) {
    return { code: 1002, message: '未登录', data: null };
  }

  try {
    switch (action) {
      case 'get':
        return await handleGet(OPENID);
      case 'update':
        return await handleUpdate(event, OPENID);
      default:
        return { code: 1001, message: `未知 action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[userProfile] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};

// ============ get ============
async function handleGet(openid) {
  const { data } = await usersCol.where({ _openid: openid }).limit(1).get();
  return {
    code: 0,
    message: 'ok',
    data: { user: data[0] || null },
  };
}

// ============ update ============
async function handleUpdate(event, openid) {
  const { nickname, avatar } = event;
  const update = {};

  // 1. 校验昵称
  if (typeof nickname === 'string') {
    const trimmed = nickname.trim();
    if (trimmed.length < NICKNAME_MIN || trimmed.length > NICKNAME_MAX) {
      return {
        code: 1003,
        message: `昵称长度需在 ${NICKNAME_MIN}-${NICKNAME_MAX} 之间`,
        data: { pass: false },
      };
    }

    // 调内容安全审核 — fail-closed：审核服务异常时拒绝写入
    let checkData = null;
    try {
      const checkRes = await cloud.callFunction({
        name: 'contentCheck',
        data: { action: 'text', content: trimmed, scene: 1 },
      });
      checkData = (checkRes.result && checkRes.result.data) || null;
    } catch (e) {
      console.error('[userProfile:update] contentCheck invoke error:', e.message);
    }
    if (!checkData || checkData.pass !== true) {
      const degraded = !checkData || checkData.degraded === true;
      return {
        code: degraded ? 5001 : 1004,
        message: (checkData && checkData.message) || (degraded ? '审核服务暂不可用，请稍后再试' : '昵称包含违规内容'),
        data: { pass: false, riskType: checkData && checkData.riskType, degraded },
      };
    }

    update.nickname = trimmed;
  }

  // 2. 头像
  if (typeof avatar === 'string' && avatar) {
    update.avatar = avatar;
  }

  if (Object.keys(update).length === 0) {
    return {
      code: 1005,
      message: '没有可更新的字段',
      data: { pass: false },
    };
  }

  update.updatedAt = new Date();

  // 3. 写库（upsert：若 users 中无记录，先插入）
  const existing = await usersCol.where({ _openid: openid }).limit(1).get();
  if (existing.data.length === 0) {
    await usersCol.add({
      data: {
        _openid: openid,
        nickname: update.nickname || '玩家',
        avatar: update.avatar || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  } else {
    await usersCol.doc(existing.data[0]._id).update({ data: update });
  }

  // 4. 返回最新数据
  const { data } = await usersCol.where({ _openid: openid }).limit(1).get();
  return {
    code: 0,
    message: 'ok',
    data: { pass: true, user: data[0] || null },
  };
}
