// cloudfunctions/contentCheck/index.js
// 内容安全审核：包装微信开放接口 msgSecCheck（V2）+ imgSecCheck
// 调用方式：
//   action='text' → 校验文本（昵称、评论等）
//   action='image' → 校验图片（fileID 必须为云存储文件）
// 返回结构：{ pass: boolean, riskType?: string, label?: number, message: string }
//
// 重要：本函数依赖云函数调用 openapi 的能力，需在 config.json 声明 permissions.openapi
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 内容安全 label 含义
const LABEL_MAP = {
  100: '正常',
  10001: '广告',
  20001: '时政',
  20002: '色情',
  20003: '辱骂',
  20006: '违法犯罪',
  20008: '欺诈',
  20012: '低俗',
  20013: '版权',
  21000: '其他',
};

// scene 枚举：1=资料；2=评论；3=论坛；4=社交日志
const DEFAULT_SCENE = 1;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action = 'text' } = event;

  try {
    switch (action) {
      case 'text':
        return await checkText(event, OPENID);
      case 'image':
        return await checkImage(event, OPENID);
      default:
        return { code: 1001, message: `未知 action: ${action}`, data: null };
    }
  } catch (err) {
    console.error('[contentCheck] fatal:', err);
    // 失败时降级放行（避免内容安全接口异常完全阻塞业务）
    return {
      code: 0,
      message: 'check failed but pass (degraded)',
      data: { pass: true, message: '审核接口异常，已放行', degraded: true },
    };
  }
};

// ============ 文本检测 ============
async function checkText(event, openid) {
  const { content = '', scene = DEFAULT_SCENE } = event;
  const text = String(content || '').trim();

  if (!text) {
    return {
      code: 1001,
      message: '内容为空',
      data: { pass: false, message: '内容不能为空' },
    };
  }

  // 微信 msgSecCheck V2 要求文本不超过 2500 字节
  if (text.length > 2500) {
    return {
      code: 1002,
      message: '内容过长',
      data: { pass: false, message: '内容长度不能超过 2500 字' },
    };
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid,
      scene,
      content: text,
    });

    // V2 返回结构：{ errcode: 0, result: { suggest, label }, detail: [...] }
    const suggest = (result.result && result.result.suggest) || 'pass';
    const label = (result.result && result.result.label) || 100;
    const pass = suggest === 'pass';

    return {
      code: 0,
      message: 'ok',
      data: {
        pass,
        suggest,                          // pass / risky / review
        label,                            // 100=正常，其它见 LABEL_MAP
        riskType: LABEL_MAP[label] || '未知',
        message: pass ? '内容合规' : `检测到${LABEL_MAP[label] || '违规'}内容，请修改`,
        detail: result.detail || [],
      },
    };
  } catch (err) {
    // errCode=87014 表示包含违规内容（V1 时代行为；V2 改成 suggest=risky）
    if (err && err.errCode === 87014) {
      return {
        code: 0,
        message: 'ok',
        data: {
          pass: false,
          suggest: 'risky',
          riskType: '违规',
          message: '检测到违规内容，请修改',
        },
      };
    }
    throw err;
  }
}

// ============ 图片检测 ============
// 注：imgSecCheck 需要图片可公开访问，云存储 fileID 也支持
async function checkImage(event, openid) {
  const { fileID } = event;
  if (!fileID) {
    return {
      code: 1001,
      message: '缺少 fileID',
      data: { pass: false, message: '请提供云存储 fileID' },
    };
  }

  try {
    // 先把 fileID 下载下来转 buffer
    const file = await cloud.downloadFile({ fileID });
    const buffer = file.fileContent;

    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: 'image/jpeg',
        value: buffer,
      },
    });

    // 老接口：errcode=0 表示通过
    return {
      code: 0,
      message: 'ok',
      data: {
        pass: true,
        message: '图片合规',
        raw: result,
      },
    };
  } catch (err) {
    if (err && err.errCode === 87014) {
      return {
        code: 0,
        message: 'ok',
        data: {
          pass: false,
          riskType: '违规',
          message: '图片包含违规内容，请更换',
        },
      };
    }
    throw err;
  }
}
