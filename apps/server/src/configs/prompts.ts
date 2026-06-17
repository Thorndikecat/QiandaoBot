import { red } from 'kolorist';
import prompts from 'prompts';

type AddressPromptItem = {
  lon: string;
  lat: string;
  address: string;
};

type SelectAddressResult = {
  presetAddress: AddressPromptItem[];
  selectedAddress: AddressPromptItem;
};

const AddressInputPattern = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\/\s*(.+?)\s*$/u;

export const PromptsOptions = {
  onCancel: () => {
    console.log(red('✖') + ' 操作取消');
    process.exit(0);
  },
};

export const formatAddressItem = (address: AddressPromptItem) => `${address.lon},${address.lat}/${address.address}`;

export const normalizePresetAddress = (presetAddress: AddressPromptItem[] = []): AddressPromptItem[] => {
  const result: AddressPromptItem[] = [];
  const seen = new Set<string>();

  for (const item of presetAddress) {
    const address = {
      lon: String(item?.lon || '').trim(),
      lat: String(item?.lat || '').trim(),
      address: String(item?.address || '').trim(),
    };
    if (!address.lon || !address.lat || !address.address) continue;

    const key = formatAddressItem(address);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(address);
  }

  return result;
};

const promptAddressInput = async (message: string, initial?: string): Promise<AddressPromptItem> => {
  let { lon_lat_address } = await prompts({
    type: 'text',
    name: 'lon_lat_address',
    message,
    initial,
    validate: value => AddressInputPattern.test(String(value)) || 'Use: longitude,latitude/address',
  }, PromptsOptions);

  lon_lat_address = String(lon_lat_address).match(AddressInputPattern);
  if (!lon_lat_address) {
    throw new Error('Invalid location format. Use: longitude,latitude/address');
  }

  return {
    lon: lon_lat_address[1],
    lat: lon_lat_address[2],
    address: lon_lat_address[3],
  };
};

// 最多保存10个长期位置；每次监听启动时再选择本次使用哪一个。
export const addressPrompts = async (initialPresetAddress: AddressPromptItem[] = []) => {
  const presetAddress = normalizePresetAddress(initialPresetAddress);
  for (let i = presetAddress.length; i < 10; i++) {
    const address = await promptAddressInput(
      `位置参数预设#${i + 1}（经纬度/地址）`,
      i === 0 ? '116.356720,40.000961/北京语言大学主楼南' : undefined
    );
    console.log(`#${i + 1}  经度: ${address.lon}  纬度: ${address.lat}  地址: ${address.address}`);
    presetAddress.push(address);

    // 到10个就不再询问继续
    if (i < 9) {
      const { next } = await prompts({
        type: () => i === 9 ? null : 'confirm',
        name: 'next',
        message: '是否继续添加',
        initial: true,
      }, PromptsOptions);
      if (!next) break;
    }
  }
  return normalizePresetAddress(presetAddress);
};

export const selectPresetAddress = async (savedPresetAddress: AddressPromptItem[] = []): Promise<SelectAddressResult> => {
  let presetAddress = normalizePresetAddress(savedPresetAddress);
  if (presetAddress.length === 0) {
    presetAddress = await addressPrompts();
  }

  const { presetItem } = await prompts({
    type: 'select',
    name: 'presetItem',
    message: '选择本次使用的位置预设',
    choices: [
      ...presetAddress.map((address, index) => ({
        title: formatAddressItem(address),
        value: index,
      })),
      { title: '添加新位置', value: -1 },
    ],
    initial: 0,
  }, PromptsOptions);

  if (presetItem !== -1) {
    return {
      presetAddress,
      selectedAddress: presetAddress[presetItem],
    };
  }

  const addedAddress = await promptAddressInput(
    '新增位置预设（经纬度/地址）',
    '116.356760,40.001872/北京语言大学主楼北'
  );
  presetAddress = normalizePresetAddress([...presetAddress, addedAddress]);
  const selectedAddress = presetAddress.find(address => formatAddressItem(address) === formatAddressItem(addedAddress))
    || addedAddress;

  console.log(`已保存新位置：${formatAddressItem(selectedAddress)}`);
  return {
    presetAddress,
    selectedAddress,
  };
};

/**
 * 监听模式问题数组
 */
export const monitorPromptsQuestions: Array<prompts.PromptObject> = [
  {
    type: 'number',
    name: 'delay',
    message: '签到延时（单位：秒）',
    initial: 0,
  },
  {
    type: 'confirm',
    name: 'mail',
    message: '是否启用邮件通知?',
    initial: false,
  },
  {
    type: (prev) => (prev ? 'text' : null),
    name: 'host',
    message: 'SMTP服务器',
    initial: 'smtp.qq.com',
  },
  {
    type: (prev) => (prev ? 'confirm' : null),
    name: 'ssl',
    message: '是否启用SSL',
    initial: true,
  },
  {
    type: (prev) => (prev ? 'number' : null),
    name: 'port',
    message: '端口号',
    initial: 465,
  },
  {
    type: (prev) => (prev ? 'text' : null),
    name: 'user',
    message: '邮件账号',
    initial: 'xxxxxxxxx@qq.com',
  },
  {
    type: (prev) => (prev ? 'text' : null),
    name: 'pass',
    message: '授权码(密码)',
  },
  {
    type: (prev) => (prev ? 'text' : null),
    name: 'to',
    message: '接收邮箱',
  },
  {
    type: 'confirm',
    name: 'qrAutoFetch',
    message: '是否启用自动获取二维码？（实验性功能，未经真实签到验证，建议手动扫码）',
    initial: false,
  },
  {
    type: 'confirm',
    name: 'cq_enabled',
    message: '是否连接到go-cqhttp服务?',
    initial: false,
  },
  {
    type: (prev) => (prev ? 'text' : null),
    name: 'ws_url',
    message: 'Websocket 地址',
    initial: 'ws://127.0.0.1:8080',
  },
  {
    type: (prev) => (prev ? 'select' : null),
    name: 'target_type',
    message: '选择消息的推送目标',
    choices: [
      { title: '群组', value: 'group' },
      { title: '私聊', value: 'private' }
    ],
  },
  {
    type: (prev) => (prev ? 'number' : null),
    name: 'target_id',
    message: '接收号码',
    initial: 10001,
  },
];

