import fs from 'fs';
import { JSDOM } from 'jsdom';
import os from 'os';
import path from 'path';
import { getChatCourseAttachment } from '../utils/imMessage';
import { safeWritePageSnapshot } from '../utils/pageSnapshot';
import { cookieSerialize, request } from '../utils/request';

const PracticeLogPath = path.resolve(__dirname, '../../../../logs/practice-options.log');
const handledPracticeKeys = new Set<string>();

const PracticeKeywords = [
  '随堂练习',
  '课堂练习',
  '练习',
  '测验',
  '问卷',
  '投票',
  '答题',
  '题目',
  'quiz',
  'practice',
  'exercise',
  'question',
  'questionnaire',
  'vote',
  'answer',
  'work',
];

const OptionArrayKeys = [
  'options',
  'optionList',
  'optionlist',
  'answerList',
  'answerlist',
  'answers',
  'choices',
  'items',
  'list',
];

const OptionValueKeys = [
  'option',
  'optionText',
  'optionContent',
  'content',
  'text',
  'title',
  'name',
  'value',
  'label',
];

type PracticeAttachment = {
  aid?: string;
  url?: string;
  title?: string;
  name?: string;
  type?: string;
  content?: string;
  description?: string;
  courseInfo?: {
    classid?: string;
    courseid?: string;
  };
};

type PracticePageData = {
  activeId: string;
  courseId: string;
  classId: string;
  quizList: any[];
};

type PreparedPracticeAnswer = {
  quizList: any[];
  selectedOptions: string[];
};

const normalizeText = (value: unknown): string => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const decodeHtml = (value: string): string => {
  const dom = new JSDOM(`<textarea>${value}</textarea>`);
  return dom.window.document.querySelector('textarea')?.value || value;
};

const uniqueOptions = (options: string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const option of options.map(option => normalizeText(decodeHtml(option)))) {
    if (!option) continue;
    if (option.length > 300) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }

  return result;
};

const tryParseJson = (value: string): unknown | null => {
  const text = value.trim();
  if (!text || !/^[{\[]/.test(text)) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isOptionLike = (value: string): boolean => (
  /^[A-H][.、．\s]/i.test(value)
  || /^[（(]?[A-H][）)]/.test(value)
  || value.length <= 120
);

const extractOptionsFromText = (text: string): string[] => {
  const options: string[] = [];
  const plain = normalizeText(text);
  const lineMatches = text.match(/(?:^|[\r\n])\s*([A-H][.、．\s][^\r\n]+)/g) || [];

  for (const match of lineMatches) {
    options.push(match.trim());
  }

  const compactMatches = plain.match(/[A-H][.、．]\s*[^A-H]{1,120}(?=\s+[A-H][.、．]|\s*$)/g) || [];
  for (const match of compactMatches) {
    options.push(match.trim());
  }

  return uniqueOptions(options);
};

const valueToOption = (value: unknown): string | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const option = normalizeText(value);
    return option && isOptionLike(option) ? option : null;
  }

  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  for (const key of OptionValueKeys) {
    if (record[key] !== undefined) {
      const option = normalizeText(record[key]);
      if (option && isOptionLike(option)) return option;
    }
  }

  return null;
};

const extractOptionsFromObject = (value: unknown, depth = 0): string[] => {
  if (depth > 6 || value === null || value === undefined) return [];

  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    if (parsed) return extractOptionsFromObject(parsed, depth + 1);
    return extractOptionsFromText(value);
  }

  if (Array.isArray(value)) {
    const directOptions = value
      .map(item => valueToOption(item))
      .filter((item): item is string => Boolean(item));

    if (directOptions.length >= 2) {
      return uniqueOptions(directOptions);
    }

    return uniqueOptions(value.flatMap(item => extractOptionsFromObject(item, depth + 1)));
  }

  if (typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  for (const key of OptionArrayKeys) {
    const optionValue = record[key];
    if (Array.isArray(optionValue)) {
      const options = optionValue
        .map(item => valueToOption(item))
        .filter((item): item is string => Boolean(item));
      if (options.length >= 2) return uniqueOptions(options);
    }
  }

  return uniqueOptions(Object.values(record).flatMap(item => extractOptionsFromObject(item, depth + 1)));
};

const extractOptionsFromInlineQuizList = (html: string): string[] => {
  const options: string[] = [];
  const assignmentPattern = /this\.quizList\s*=\s*(\[[\s\S]*?\]);/g;

  for (const match of html.matchAll(assignmentPattern)) {
    const quizList = tryParseJson(match[1]);
    if (!Array.isArray(quizList)) continue;
    options.push(...extractOptionsFromObject(quizList));
  }

  return uniqueOptions(options);
};

const extractInlineStringVar = (html: string, name: string): string => {
  const match = html.match(new RegExp(`var\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1] || '';
};

const getUrlParam = (url: string | undefined, name: string): string => {
  if (!url) return '';

  try {
    return new URL(normalizeUrl(url)).searchParams.get(name) || '';
  } catch {
    return '';
  }
};

const extractInlineQuizList = (html: string): any[] => {
  const match = html.match(/this\.quizList\s*=\s*(\[[\s\S]*?\]);/);
  const quizList = match ? tryParseJson(match[1]) : null;
  return Array.isArray(quizList) ? quizList : [];
};

const extractPracticePageData = (html: string, attachment: PracticeAttachment): PracticePageData | null => {
  const quizList = extractInlineQuizList(html);
  if (!quizList.length) return null;

  const activeId = extractInlineStringVar(html, 'activeId')
    || String(attachment.aid || '')
    || getUrlParam(attachment.url, 'activeId')
    || getUrlParam(attachment.url, 'activePrimaryId');
  const courseId = extractInlineStringVar(html, 'courseId')
    || attachment.courseInfo?.courseid
    || getUrlParam(attachment.url, 'courseId');
  const classId = extractInlineStringVar(html, 'classId')
    || attachment.courseInfo?.classid
    || getUrlParam(attachment.url, 'classId');

  if (!activeId || !courseId || !classId) return null;

  return { activeId, courseId, classId, quizList };
};

const extractOptionsFromHtml = (html: string): string[] => {
  const inlineQuizOptions = extractOptionsFromInlineQuizList(html);
  if (inlineQuizOptions.length >= 2) return inlineQuizOptions;

  const dom = new JSDOM(html);
  const document = dom.window.document;
  const options: string[] = [];
  const selector = [
    'label',
    'li',
    '[class*="option" i]',
    '[class*="answer" i]',
    '[class*="choice" i]',
    '[class*="select" i]',
    '[data-option]',
  ].join(',');

  document.querySelectorAll(selector).forEach(element => {
    const text = normalizeText(element.textContent || '');
    if (text && isOptionLike(text)) options.push(text);
  });

  const htmlTextOptions = extractOptionsFromText(document.body?.textContent || html);
  const scriptOptions = Array.from(document.querySelectorAll('script'))
    .flatMap(script => extractOptionsFromText(script.textContent || ''));

  const jsonLikeMatches = html.match(/"(?:option|optionText|optionContent|answer|content|title)"\s*:\s*"([^"]{1,300})"/g) || [];
  for (const match of jsonLikeMatches) {
    const option = match.replace(/^.*:\s*"/, '').replace(/"$/, '');
    options.push(option);
  }

  return uniqueOptions([...options, ...htmlTextOptions, ...scriptOptions]);
};

const getAttachment = (message: any): PracticeAttachment | null => {
  return getChatCourseAttachment(message) as PracticeAttachment | null;
};

const attachmentText = (attachment: PracticeAttachment, message: any): string => {
  return [
    attachment.url,
    attachment.title,
    attachment.name,
    attachment.type,
    attachment.content,
    attachment.description,
    message?.data,
    message?.msg,
  ].filter(Boolean).join(' ');
};

export const isPracticeMessage = (message: any): boolean => {
  const attachment = getAttachment(message);
  if (!attachment) return false;

  const text = attachmentText(attachment, message).toLowerCase();
  if (text.includes('sign')) return false;

  return PracticeKeywords.some(keyword => text.includes(keyword.toLowerCase()));
};

const normalizeUrl = (url: string): string => {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://mobilelearn.chaoxing.com${url}`;
  return url;
};

const fetchPracticePage = async (url: string, cookies: BasicCookie, redirectLimit = 2): Promise<string> => {
  const result = await request(normalizeUrl(url), {
    headers: {
      Cookie: cookieSerialize(cookies),
      'User-Agent': 'Mozilla/5.0',
    },
  });

  if (
    redirectLimit > 0
    && result.statusCode
    && result.statusCode >= 300
    && result.statusCode < 400
    && result.headers.location
  ) {
    return fetchPracticePage(result.headers.location, cookies, redirectLimit - 1);
  }

  return String(result.data || '');
};

const writeChoiceLog = (option: string) => {
  fs.mkdirSync(path.dirname(PracticeLogPath), { recursive: true });
  fs.appendFileSync(PracticeLogPath, `${option.replace(/[\r\n]+/g, ' ')}${os.EOL}`, 'utf8');
};

const getQuestionOptions = (question: any): any[] => {
  if (Array.isArray(question?.answer)) return question.answer;
  if (typeof question?.options === 'string') {
    const parsed = tryParseJson(question.options);
    if (Array.isArray(parsed)) return parsed;
  }
  if (Array.isArray(question?.options)) return question.options;
  return [];
};

const chooseRandomItems = <T>(items: T[], count: number): T[] => {
  const pool = [...items];
  const result: T[] = [];

  while (pool.length && result.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }

  return result;
};

const preparePracticeAnswer = (quizList: any[]): PreparedPracticeAnswer | null => {
  const payload = JSON.parse(JSON.stringify(quizList));
  const selectedOptions: string[] = [];

  for (const question of payload) {
    const type = Number(question?.type);
    if (![0, 1, 3, 16].includes(type)) continue;

    const options = getQuestionOptions(question)
      .map(option => String(option?.name || '').trim())
      .filter(Boolean);
    if (!options.length) continue;

    if (!question.personAnswer || typeof question.personAnswer !== 'object') {
      question.personAnswer = {};
    }

    if (type === 1) {
      const min = Number(question.answerLimitMap?.min || 1);
      const max = Number(question.answerLimitMap?.max || options.length);
      const count = Math.max(1, Math.min(options.length, Math.max(min, Math.min(max, min))));
      const selected = chooseRandomItems(options, count).sort();
      const allLetterOptions = selected.every(option => /^[A-Za-z]$/.test(option));
      question.personAnswer.myoption = allLetterOptions ? selected.join('') : selected.join(',');
      selectedOptions.push(question.personAnswer.myoption);
    } else {
      const selected = options[Math.floor(Math.random() * options.length)];
      question.personAnswer.myoption = selected;
      selectedOptions.push(selected);
    }
  }

  return selectedOptions.length ? { quizList: payload, selectedOptions } : null;
};

const submitPracticeAnswer = async (
  pageData: PracticePageData,
  preparedAnswer: PreparedPracticeAnswer,
  cookies: BasicCookie,
): Promise<boolean> => {
  const submitUrl = normalizeUrl(`/v2/apis/studentQuestion/doQuestionAnswering?activeId=${encodeURIComponent(pageData.activeId)}&courseId=${encodeURIComponent(pageData.courseId)}&classId=${encodeURIComponent(pageData.classId)}&DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=activeId`);
  const submitResult = await request(submitUrl, {
    method: 'POST',
    headers: {
      Cookie: cookieSerialize(cookies),
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Referer: normalizeUrl(`/pptTestPaper/preAddQuestion2quiz?classId=${encodeURIComponent(pageData.classId)}&activePrimaryId=${encodeURIComponent(pageData.activeId)}&chatId=null&appType=15&isclasschat=1`),
    },
  }, JSON.stringify(preparedAnswer.quizList));

  let submitData: any = {};
  try {
    submitData = JSON.parse(String(submitResult.data || '{}'));
  } catch {
    submitData = {};
  }

  if (submitData.result !== 1) {
    console.log(`[随堂练习] 提交失败：${submitData.errorMsg || submitResult.data || submitResult.statusCode}`);
    return false;
  }

  const receiptParams = new URLSearchParams({
    classId: pageData.classId,
    activePrimaryId: pageData.activeId,
    uid: String((cookies as any)._uid || ''),
    chatId: 'null',
    appType: '15',
    openChatView: 'false',
  });
  await request(normalizeUrl(`/pptTestPaperStu/answerReceipt?${receiptParams.toString()}`), {
    headers: {
      Cookie: cookieSerialize(cookies),
      'User-Agent': 'Mozilla/5.0',
    },
  });

  return true;
};

export const handlePracticeMessage = async (message: any, params: BasicCookie) => {
  const attachment = getAttachment(message);
  if (!attachment) return;

  const key = String(attachment.aid || attachment.url || JSON.stringify(attachment).slice(0, 120));
  if (handledPracticeKeys.has(key)) return;
  handledPracticeKeys.add(key);

  let options = extractOptionsFromObject(message);
  let pageHtml = '';
  let pageData: PracticePageData | null = null;

  safeWritePageSnapshot({
    kind: 'practice',
    activeId: attachment.aid,
    url: attachment.url,
    metadata: {
      source: 'im-message',
      attachment,
      messageKeys: Object.keys(message || {}),
      extractedOptions: options.slice(0, 20),
    },
  });

  if (attachment.url) {
    try {
      pageHtml = await fetchPracticePage(attachment.url, params);
      const pageOptions = extractOptionsFromHtml(pageHtml);
      if (pageOptions.length >= 2) options = pageOptions;
      pageData = extractPracticePageData(pageHtml, attachment);
      safeWritePageSnapshot({
        kind: 'practice',
        activeId: attachment.aid,
        url: attachment.url,
        html: pageHtml,
        metadata: {
          source: 'practice-page',
          attachment,
          extractedOptions: options.slice(0, 20),
          optionCount: options.length,
        },
      });
      
      // 保存页面源码供后续分析真实提交 API 使用
      try {
        const pageLogPath = path.resolve(__dirname, '../../../../logs/last_practice_page.html');
        fs.mkdirSync(path.dirname(pageLogPath), { recursive: true });
        fs.writeFileSync(pageLogPath, pageHtml, 'utf8');
        console.log(`[随堂练习] 页面源码已保存到 ${pageLogPath}，以便分析提交接口`);
      } catch (err) {
        console.log(`[随堂练习] 保存页面源码失败：${err}`);
      }
    } catch (error) {
      console.log(`[随堂练习] 读取页面失败：${error}`);
    }
  }

  if (options.length < 2) {
    console.log('[随堂练习] 已检测到练习消息，但没有解析到可随机记录的选项。');
    return;
  }

  if (!pageData) {
    const selected = options[Math.floor(Math.random() * options.length)];
    writeChoiceLog(selected);
    console.log(`[随堂练习] 已随机记录 1 个选项到 ${PracticeLogPath}`);
    console.log('[随堂练习] 未解析到可提交的页面题目结构，已跳过自动提交。');
    return;
  }

  const preparedAnswer = preparePracticeAnswer(pageData.quizList);
  if (!preparedAnswer) {
    const selected = options[Math.floor(Math.random() * options.length)];
    writeChoiceLog(selected);
    console.log(`[随堂练习] 已随机记录 1 个选项到 ${PracticeLogPath}`);
    console.log('[随堂练习] 未找到可自动提交的客观题答案结构，已跳过自动提交。');
    return;
  }

  writeChoiceLog(preparedAnswer.selectedOptions.join(', '));
  console.log(`[随堂练习] 已随机记录实际提交选项到 ${PracticeLogPath}`);

  const submitted = await submitPracticeAnswer(pageData, preparedAnswer, params);
  if (submitted) {
    console.log(`[随堂练习] 已自动提交选项：${preparedAnswer.selectedOptions.join(', ')}`);
  }
};
