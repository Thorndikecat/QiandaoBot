export type SignMessageSource = 'group' | 'course';

export interface ChatCourseAttachment {
  aid?: string | number;
  atypeName?: string;
  pcUrl?: string;
  title?: string;
  url?: string;
  courseInfo?: {
    classid?: string | number;
    classId?: string | number;
    courseid?: string | number;
    courseId?: string | number;
    coursename?: string;
  };
  [key: string]: unknown;
}

export interface ParsedSignMessage {
  source: SignMessageSource;
  activeId: string;
  chatId?: string;
  classId?: string;
  courseId?: string;
  label?: string;
  attachment: ChatCourseAttachment;
}

const idToString = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value);
};

const firstId = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const id = idToString(value);
    if (id) return id;
  }

  return undefined;
};

const parseAttachmentObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  return typeof value === 'object' ? value as Record<string, unknown> : null;
};

export const getChatCourseAttachment = (message: any): ChatCourseAttachment | null => {
  const attachment = parseAttachmentObject(message?.ext?.attachment);
  const directAttachment = parseAttachmentObject(message?.ext?.att_chat_course);

  if (attachment?.att_chat_course && typeof attachment.att_chat_course === 'object') {
    return attachment.att_chat_course as ChatCourseAttachment;
  }

  if (directAttachment) return directAttachment as ChatCourseAttachment;

  if (attachment?.url || attachment?.aid) {
    return attachment as ChatCourseAttachment;
  }

  return null;
};

const getUrlParam = (url: string | undefined, key: string): string | undefined => {
  if (!url) return undefined;

  try {
    const parsed = new URL(url, 'https://mobilelearn.chaoxing.com');
    const value = parsed.searchParams.get(key);
    return value && value !== 'null' ? value : undefined;
  } catch (error) {
    return undefined;
  }
};

const hasSignUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  return /\/(?:newsign|sign)\/preSign/i.test(url);
};

export const parseSignMessage = (message: any): ParsedSignMessage | null => {
  const attachment = getChatCourseAttachment(message);
  if (!attachment || !hasSignUrl(attachment.url)) return null;

  const courseInfo = attachment.courseInfo || {};
  const courseId = firstId(courseInfo.courseid, courseInfo.courseId, getUrlParam(attachment.url, 'courseId'));
  const classId = firstId(courseInfo.classid, courseInfo.classId, getUrlParam(attachment.url, 'classId'));
  const activeId = firstId(
    attachment.aid,
    getUrlParam(attachment.url, 'activeId'),
    getUrlParam(attachment.url, 'activePrimaryId'),
  );

  if (!activeId) return null;

  const isCourseSign = Boolean(
    attachment.pcUrl
    || attachment.url?.includes('/newsign/preSign')
    || courseId
    || classId,
  );

  return {
    source: isCourseSign ? 'course' : 'group',
    activeId,
    chatId: idToString(getUrlParam(attachment.url, 'chatId') ?? message?.to),
    classId,
    courseId,
    label: idToString(attachment.atypeName ?? attachment.title ?? message?.data),
    attachment,
  };
};
