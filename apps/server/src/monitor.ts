import fs from 'fs';
import jsdom from 'jsdom';
import { blue, red } from 'kolorist';
import path from 'path';
import prompts from 'prompts';
import WebSocket from 'ws';
import { getPPTActiveInfo, getSignType, preSign, preSign2, speculateType } from './functions/activity';
import CQ from './functions/cq';
import { GeneralSign, GeneralSign_2 } from './functions/general';
import { LocationSign, LocationSign_2 } from './functions/location';
import { getObjectIdFromcxPan, PhotoSign, PhotoSign_2 } from './functions/photo';
import { handlePracticeMessage, isPracticeMessage } from './functions/practice';
import { QRCodeSign } from './functions/qrcode';
import { QrCodeScan } from './functions/tencent.qrcode';
import { getIMParams, getLocalUsers, userLogin } from './functions/user';
import { getJsonObject, getStoredUser, storeUser } from './utils/file';
import { delay } from './utils/helper';
import { parseSignMessage } from './utils/imMessage';
import { sendEmail } from './utils/mailer';
import { fetchAndDecodeQrEnc } from './utils/qrDecode';
import { PromptsOptions, addressPrompts, monitorPromptsQuestions } from './configs/prompts';
const JSDOM = new jsdom.JSDOM('', { url: 'https://im.chaoxing.com/webim/me' });
(globalThis.window as any) = JSDOM.window;
(globalThis.WebSocket as any) = WebSocket;
Object.defineProperty(globalThis, 'navigator', {
  value: JSDOM.window.navigator,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'location', {
  value: JSDOM.window.location,
  configurable: true,
  writable: true,
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webIM = require('./utils/websdk3.1.4.js').default;
const MonitorLogPath = path.resolve(__dirname, '../../../logs/monitor.log');
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

const formatLogValue = (value: unknown): string => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    return String(value);
  }
};

const appendMonitorLog = (...args: unknown[]) => {
  try {
    fs.mkdirSync(path.dirname(MonitorLogPath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${args.map(formatLogValue).join(' ')}${require('os').EOL}`;
    fs.appendFileSync(MonitorLogPath, line, 'utf8');
  } catch (error) {
    originalConsoleError('[监听日志] 写入失败', error);
  }
};

console.log = (...args: unknown[]) => {
  originalConsoleLog(...args);
  appendMonitorLog(...args);
};

console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  appendMonitorLog(...args);
};

const ImMessageTimeKeys = [
  'time',
  'timestamp',
  'sendTime',
  'msgTime',
  'serverTime',
  'createTime',
  'createdAt',
  'msgTimestamp',
];

const parseImTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (value > 1_000_000_000_000) return value;
    if (value > 1_000_000_000) return value * 1000;
    return null;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;

    const numeric = Number(text);
    if (Number.isFinite(numeric)) return parseImTimestamp(numeric);

    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const getImMessageTimestamp = (message: any): number | null => {
  for (const source of [message, message?.ext]) {
    if (!source || typeof source !== 'object') continue;

    for (const key of ImMessageTimeKeys) {
      const timestamp = parseImTimestamp(source[key]);
      if (timestamp !== null) return timestamp;
    }
  }

  return null;
};

const shouldSkipByImTimeBaseline = (
  message: any,
  imTimeBaseline: number,
): { skip: boolean; timestamp: number | null; reason: string; } => {
  const timestamp = getImMessageTimestamp(message);
  if (timestamp === null) {
    return { skip: true, timestamp, reason: '无可解析 IM 时间戳' };
  }

  if (timestamp < imTimeBaseline) {
    return { skip: true, timestamp, reason: '早于启动 IM 时间基线' };
  }

  return { skip: false, timestamp, reason: '' };
};

const WebIMConfig = {
  xmppURL: 'https://im-api-vip6-v2.easecdn.com/ws',
  apiURL: 'https://a1-vip6.easecdn.com',
  appkey: 'cx-dev#cxstudy',
  Host: 'easemob.com',
  https: true,
  isHttpDNS: false,
  isMultiLoginSessions: true,
  isAutoLogin: true,
  isWindowSDK: false,
  isSandBox: false,
  isDebug: false,
  autoReconnectNumMax: 20,
  autoReconnectInterval: 5,
  isWebRTC: false,
  heartBeatWait: 30000,
  delivery: false,
};

const conn = new webIM.connection({
  isMultiLoginSessions: WebIMConfig.isMultiLoginSessions,
  https: WebIMConfig.https,
  url: WebIMConfig.xmppURL,
  apiUrl: WebIMConfig.apiURL,
  isAutoLogin: WebIMConfig.isAutoLogin,
  heartBeatWait: WebIMConfig.heartBeatWait,
  autoReconnectNumMax: WebIMConfig.autoReconnectNumMax,
  autoReconnectInterval: WebIMConfig.autoReconnectInterval,
  appKey: WebIMConfig.appkey,
  isHttpDNS: WebIMConfig.isHttpDNS,
});

async function configure(phone: string) {
  const config = getStoredUser(phone);
  let local = false;
  console.log(blue('自动签到支持 [普通/手势/拍照/签到码/位置]'));
  if (config?.monitor) {
    local = (
      await prompts(
        {
          type: 'confirm',
          name: 'local',
          message: '是否用本地缓存的签到信息?',
          initial: true,
        },
        PromptsOptions
      )
    ).local;
  }
  // 若不使用本地，则配置并写入本地
  if (!local) {
    const presetAddress = await addressPrompts();
    const response = await prompts(monitorPromptsQuestions, PromptsOptions);
    const monitor: any = {};
    const mailing: any = {};
    const cqserver: any = {};
    monitor.delay = response.delay;
    monitor.lon = response.lon;
    monitor.lat = response.lat;
    monitor.presetAddress = presetAddress;
    monitor.qrAutoFetch = response.qrAutoFetch || false;
    mailing.enabled = response.mail;
    mailing.host = response.host;
    mailing.ssl = response.ssl;
    mailing.port = response.port;
    mailing.user = response.user;
    mailing.pass = response.pass;
    mailing.to = response.to;
    cqserver.cq_enabled = response.cq_enabled;
    cqserver.ws_url = response.ws_url;
    cqserver.target_type = response.target_type;
    cqserver.target_id = response.target_id;
    config!.monitor = monitor;
    config!.mailing = mailing;
    config!.cqserver = cqserver;

    const data = getJsonObject('configs/storage.json');
    for (let i = 0; i < data.users.length; i++) {
      if (data.users[i].phone === phone) {
        data.users[i].monitor = monitor;
        data.users[i].mailing = mailing;
        data.users[i].cqserver = cqserver;
        break;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    fs.writeFile(path.join(__dirname, './configs/storage.json'), JSON.stringify(data), 'utf8', () => { });
  }

  return JSON.parse(JSON.stringify({ mailing: config!.mailing, monitor: config!.monitor, cqserver: config!.cqserver }));
}

// 自动获取二维码并签到，优先使用 presetAddress 中保存的位置
const autoQrSign = async (
  activeId: string,
  realname: string,
  params: any,
  config: any,
): Promise<string | null> => {
  const enc = await fetchAndDecodeQrEnc(activeId, params);
  if (!enc) return null;

  const loc = config.presetAddress?.[0] || {};
  return await QRCodeSign({
    ...params,
    activeId,
    enc,
    name: realname,
    lat: String(loc.lat || 34.817038),
    lon: String(loc.lon || 113.516288),
    address: loc.address || '',
    altitude: config.altitude || '100',
  });
};

async function Sign(realname: string, params: UserCookieType & { tuid: string; }, config: any, activity: Activity) {
  let result = null;
  // 群聊签到，无课程
  if (!activity.courseId) {
    const page = await preSign2({ ...activity, ...params, chatId: activity.chatId as string });
    const activityType = speculateType(page);
    switch (activityType) {
      case 'general': {
        result = await GeneralSign_2({ activeId: activity.activeId, ...params });
        break;
      }
      case 'photo': {
        const objectId = await getObjectIdFromcxPan(params);
        if (objectId === null) return null;
        result = await PhotoSign_2({ objectId, activeId: activity.activeId, ...params });
        break;
      }
      case 'location': {
        result = await LocationSign_2({
          name: realname,
          presetAddress: config.presetAddress,
          activeId: activity.activeId,
          ...params,
        });
        break;
      }
      case 'qr': {
        if (config.qrAutoFetch) {
          result = await autoQrSign(activity.activeId, realname, params, config) || '[二维码]自动获取失败，请手动发送二维码照片';
        } else {
          result = '[二维码]请发送二维码照片';
          console.log(red('二维码签到，需人工干预！'));
        }
        break;
      }
    }
    return result;
  }

  // 课程签到
  await preSign({ ...activity, ...params });
  switch (activity.otherId) {
    case 2: {
      // 二维码签到
      if (config.qrAutoFetch) {
        result = await autoQrSign(activity.activeId, realname, params, config) || '[二维码]自动获取失败，请手动发送二维码照片';
      } else {
        result = '[二维码]请发送二维码照片';
        console.log(red('二维码签到，需人工干预！'));
      }
      break;
    }
    case 4: {
      // 位置签到
      result = await LocationSign({
        name: realname,
        presetAddress: config.presetAddress,
        activeId: activity.activeId,
        ...params,
      });
      break;
    }
    case 3: {
      // 手势签到
      result = await GeneralSign({ name: realname, activeId: activity.activeId, ...params });
      break;
    }
    case 5: {
      // 签到码签到
      result = await GeneralSign({ name: realname, activeId: activity.activeId, ...params });
      break;
    }
    case 0: {
      if (activity.ifphoto === 0) {
        result = await GeneralSign({ name: realname, activeId: activity.activeId, ...params });
        break;
      } else {
        const objectId = await getObjectIdFromcxPan(params);
        if (objectId === null) return null;
        result = await PhotoSign({ name: realname, activeId: activity.activeId, objectId, ...params });
        break;
      }
    }
  }
  return result;
}

async function handleMsg(this: CQ, data: string) {
  // 处理图片，是否二维码，发送一些其他反馈
  if (CQ.hasImage(data) && this.getCache('params') !== undefined) {
    console.log('[图片]尝试二维码识别');
    const img_url = data.match(/https:\/\/[\S]+[^\]]/g)![0];
    const params = this.getCache('params');
    const qr_str = (await QrCodeScan(img_url, 'url')).CodeResults?.[0].Url;

    if (typeof qr_str === 'undefined') this.send('是否已配置腾讯云OCR？图像是否包含清晰二维码？', this.getTargetID());
    else {
      params.enc = qr_str.match(/(?<=&enc=)[\dA-Z]+/)?.[0];
      const result = await QRCodeSign(params);
      this.send(`${result} - ${params.name}`, this.getTargetID());
      // 签到成功则清理缓存
      result === '[二维码]签到成功' ? this.clearCache() : this.send(result, this.getTargetID());
    }
  }
}

process.on('SIGINT', () => {
  process.exit(0);
});

// 开始运行
(async () => {
  let params: any = {};
  let config: any = {};
  // 若凭证由命令参数传来，直接解析赋值；否则，直接用户名密码登录获取凭证
  if (process.argv[2] === '--auth') {
    const auth_config = JSON.parse(Buffer.from(process.argv[4], 'base64').toString('utf8'));
    params.phone = auth_config.credentials.phone;
    params.uf = auth_config.credentials.uf;
    params._d = auth_config.credentials._d;
    params.vc3 = auth_config.credentials.vc3;
    params._uid = auth_config.credentials.uid;
    params.lv = auth_config.credentials.lv;
    params.fid = auth_config.credentials.fid;
    config.monitor = { ...auth_config.config.monitor };
    config.mailing = { ...auth_config.config.mailing };
    config.cqserver = { ...auth_config.config.cqserver };
  } else {
    // 打印本地用户列表，并返回用户数量
    const userItem = (
      await prompts(
        { type: 'select', name: 'userItem', message: '选择用户', choices: getLocalUsers(), initial: 0 },
        PromptsOptions
      )
    ).userItem;
    // 手动登录
    if (userItem === -1) {
      const phone = (await prompts({ type: 'text', name: 'phone', message: '手机号' }, PromptsOptions)).phone;
      const password = (await prompts({ type: 'password', name: 'password', message: '密码' }, PromptsOptions)).password;
      // 登录获取各参数
      params = await userLogin(phone, password);
      if (params === 'AuthFailed') process.exit(0);
      storeUser(phone, { phone, params }); // 储存到本地
      params.phone = phone;
    } else {
      // 使用本地储存的参数
      const user = getJsonObject('configs/storage.json').users[userItem];
      params = user.params;
      params.phone = user.phone;
    }
    // 手动配置签到信息
    config = await configure(params.phone);
  }

  // 获取IM参数
  const IM_Params = await getIMParams(params as UserCookieType);
  if (IM_Params === 'AuthFailed') {
    if (process.send) process.send('authfail');
    process.exit(0);
  }
  params.tuid = IM_Params.myTuid;
  params.name = IM_Params.myName;
  const imTimeBaseline = IM_Params.imServerTime ?? Date.now();
  if (IM_Params.imServerTime === null) {
    console.log('[监听中] 未取得 IM 服务端 Date 响应头，临时使用本机时间作为消息基线');
  }

  let cq: CQ;
  // 建立连接，添加监听事件并绑定处理函数
  if (config.cqserver?.cq_enabled) {
    cq = new CQ(config.cqserver.ws_url, config.cqserver.target_type, config.cqserver.target_id);
    cq.connect();
    cq.onMessage(handleMsg);
  }

  const imOpenOptions = {
    apiUrl: WebIMConfig.apiURL,
    user: IM_Params.myTuid,
    accessToken: IM_Params.myToken,
    appKey: WebIMConfig.appkey,
  };
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let hasReportedSuccess = false;

  const scheduleImReconnect = (reason: string) => {
    if (reconnectTimer) {
      console.log(`[监听重连] 已有重连任务，忽略：${reason}`);
      return;
    }

    reconnectAttempt += 1;
    const waitSeconds = Math.min(60, 5 * Math.pow(2, Math.min(reconnectAttempt - 1, 4)));
    console.log(`[监听重连] ${reason}，将在 ${waitSeconds} 秒后重新连接 IM`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openImConnection(`第 ${reconnectAttempt} 次重连`);
    }, waitSeconds * 1000);
  };

  const openImConnection = (reason: string) => {
    try {
      console.log(`[监听重连] 打开 IM 连接：${reason}`);
      conn.open(imOpenOptions);
    } catch (error) {
      console.log(`[监听重连] 打开 IM 连接失败：${formatLogValue(error)}`);
      scheduleImReconnect('打开 IM 连接失败');
    }
  };

  conn.listen({
    onOpened: () => {
      reconnectAttempt = 0;
      console.log('[监听中] IM 连接已建立');
      if (!hasReportedSuccess && process.send) process.send('success');
      hasReportedSuccess = true;
    },
    onClosed: () => {
      console.log('[监听断开] IM 连接关闭');
      scheduleImReconnect('IM 连接关闭');
    },
    onTextMessage: async (message: any) => {
      // Normalize IM sign messages before branching between group and course flows.
      const signMessage = parseSignMessage(message);
      if (signMessage) {
        const gate = shouldSkipByImTimeBaseline(message, imTimeBaseline);
        if (gate.skip) {
          const time = gate.timestamp === null ? 'unknown' : new Date(gate.timestamp).toLocaleString();
          console.log(`[签到] 跳过非启动后消息：${gate.reason}，time=${time} activeId=${signMessage.activeId}`);
          return;
        }

        let signType = signMessage.label || (signMessage.source === 'course' ? 'course sign' : 'group sign');
        let otherId = 0;
        let ifphoto = 0;

        if (signMessage.source === 'course') {
          if (!signMessage.courseId || !signMessage.classId) {
            console.log(`[IM] Course sign ${signMessage.activeId} missing courseId/classId, skipped`);
            return;
          }

          const PPTActiveInfo = await getPPTActiveInfo({ activeId: signMessage.activeId, ...(params as UserCookieType) });
          otherId = PPTActiveInfo.otherId;
          ifphoto = PPTActiveInfo.ifphoto;
          signType = getSignType(PPTActiveInfo);
        }

        // 签到 & 推送消息
        // 签到检测通知推送
        if (config.cqserver?.cq_enabled) {
          cq.send(`${IM_Params.myName}，检测到${signType}，将在${config.monitor.delay}秒后处理`, config.cqserver.target_id);
          cq.setCache('params', { ...params, activeId: signMessage.activeId });
        }

        await delay(config.monitor.delay);
        const result = await Sign(IM_Params.myName, params, config.monitor, {
          classId: signMessage.classId || '',
          courseId: signMessage.courseId || '',
          activeId: signMessage.activeId,
          otherId,
          ifphoto,
          chatId: signMessage.chatId,
        });
        // 邮件推送签到结果
        if (config.mailing?.enabled) {
          sendEmail({
            aid: signMessage.activeId,
            uid: params._uid,
            realname: IM_Params.myName,
            status: result,
            mailing: config.mailing,
          });
        }
        // CQ 推送签到结果
        if (config.cqserver?.cq_enabled) {
          cq.send(`${result} - ${IM_Params.myName}`, config.cqserver.target_id);
        }

      } else if (isPracticeMessage(message)) {
        const gate = shouldSkipByImTimeBaseline(message, imTimeBaseline);
        if (gate.skip) {
          const time = gate.timestamp === null ? 'unknown' : new Date(gate.timestamp).toLocaleString();
          console.log(`[随堂练习] 跳过非启动后消息：${gate.reason}，time=${time}`);
          return;
        }

        void handlePracticeMessage(message, params as BasicCookie).catch((error) => {
          console.log(`[随堂练习] 处理失败：${error}`);
        });
      }
    },
    onError: (msg: any) => {
      console.log(red('[发生异常]'), msg);
      const errorType = msg && typeof msg === 'object' ? msg.type : undefined;
      scheduleImReconnect(String(errorType) === '16' ? 'IM 连接断开(type=16)' : 'IM 异常');
    },
  });

  openImConnection('首次启动');
  console.log(blue(`[监听中] ${config.cqserver.cq_enabled ? 'CQ服务器已连接' : ''} ${config.mailing?.enabled ? '邮件推送已开启' : ''}...`));
  console.log(blue(`[监听中] 只处理不早于 IM 时间基线 ${new Date(imTimeBaseline).toLocaleString()} 的签到/随堂练习消息...`));
})();
