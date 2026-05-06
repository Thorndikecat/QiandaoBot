/**
 * 二维码自动获取与解码
 *
 * 原理：超星二维码签到图片位于 /sign/qrcode?activeId=xxx，
 * 该端点无需特殊鉴权（和投影屏幕上的二维码一样，本身就是公开内容）。
 * 下载该图片后在本地解码即可提取 enc 参数，无需人工扫码。
 *
 * 注意：此功能未经真实签到活动验证（无活动时 enc 为 null），默认关闭。
 */
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { cookieSerialize, request } from './request';

export const QRCODE_IMAGE_URL = 'https://mobilelearn.chaoxing.com/sign/qrcode';

/**
 * 下载并解码超星二维码签到图片，提取 enc 参数
 * @returns enc 字符串，失败返回 null
 */
export const fetchAndDecodeQrEnc = async (
  activeId: string,
  cookies: BasicCookie,
): Promise<string | null> => {
  try {
    const result = await request(
      `${QRCODE_IMAGE_URL}?activeId=${activeId}`,
      {
        headers: {
          Cookie: cookieSerialize(cookies),
          Referer: 'https://mobilelearn.chaoxing.com/',
        },
        timeoutMs: 10000,
      },
    );

    if (result.statusCode !== 200 || !result.data) {
      console.log('[二维码] 获取图片失败 HTTP', result.statusCode);
      return null;
    }

    // jpeg-js 解码
    const raw = jpeg.decode(Buffer.from(result.data, 'binary'), { useTArray: true });

    // jsQR 解码
    const qrResult = jsQR(
      new Uint8ClampedArray(raw.data),
      raw.width,
      raw.height,
    );

    if (!qrResult) {
      console.log('[二维码] 图片解码失败，可能无真实活动');
      return null;
    }

    // QR 内容格式：{enc}-{timestamp}
    const qrData: string = qrResult.data;
    console.log('[二维码] 解码成功:', qrData.substring(0, 40));

    const enc = qrData.split('-')[0];
    if (!enc || enc === 'null') {
      console.log('[二维码] enc 为空（无有效签到活动）');
      return null;
    }

    return enc;
  } catch (err) {
    console.log('[二维码] 解码异常:', err);
    return null;
  }
};
