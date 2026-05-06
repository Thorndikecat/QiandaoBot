# 超星学习通签到 IM 消息结构

> 通过 WebIM (Easemob/Huanxin SDK) 连接 `im-api-vip6-v2.easecdn.com/ws` 实时捕获。
> 监听 `onTextMessage` 事件，消息类型为 `groupchat`。

## 消息结构概览

```json
{
  "id": "消息唯一ID",
  "type": "groupchat",
  "from": "发送者 tuid",
  "to": "聊天室ID (群聊ID/课程聊天室ID)",
  "data": "消息文本（如 [签到]、二维码签到）",
  "ext": {
    "attachment": "JSON字符串 或 已解析对象",  // ⚠️ 来自他人的消息为字符串
    "fromPuid": "发送者 puid（课程签到为 null）"  // ⚠️ 课程vs群聊差异
  },
  "time": "时间戳"
}
```

## 核心差异：课程签到 vs 群聊签到

| 维度 | 群聊签到 | 课程签到 |
|------|---------|---------|
| `from` | 用户 tuid（创建者） | 系统 tuid（如 `86655542`） |
| `fromPuid` | 有值（如 `369740861`） | **null** |
| `to` (聊天室) | 群聊ID（如 `312619054465026`） | 课程聊天室ID（如 `308065766277123`） |
| `aid` 格式 | **8 位数字** | **13 位数字** |
| `att_chat_course.url` | `/sign/preSign?courseId=null&...` | `/newsign/preSign?courseId=xxx&classId=xxx&...` |
| 签到端点 | `POST /sign/stuSignajax` | `GET /pptSign/stuSignajax` |
| `courseInfo` | 无 | **有**（courseId, classId, coursename, teacherfactor） |
| `pcUrl` | 无 | **有**（`proxyPcSign`） |
| 预签流程 | `preStuSign`（一次） | `preSign` + `analysis` + `analysis2`（三次） |

## attachment 解析 Bug

**来自他人的消息**中 `ext.attachment` 是 **JSON 字符串**而非对象：

```json
// 他人消息 - ❌ 原代码取不到
"ext": { "attachment": "{\"att_chat_course\":{...}}" }

// 自己消息 - ✅ 原代码正常
"ext": { "attachment": { "att_chat_course": {...} } }
```

原代码 `message?.ext?.attachment?.att_chat_course` 对他人消息返回 `undefined`，导致签到检测**静默失效**。

## att_chat_course 字段

| 字段 | 群聊 | 课程 | 说明 |
|------|------|------|------|
| `aid` | 8位 | **13位** | 活动ID，签到API必传 |
| `atype` | 2 | 2 | 活动类型，当前观察均为2 |
| `atypeName` | 标题文本 | 标题文本 | 如"二维码签到""位置签到""手势签到" |
| `title` | 活动标题 | 活动标题 | |
| `type` | 1 | 1 | |
| `url` | `/sign/preSign?...` | `/newsign/preSign?...` | 签到页面URL |
| `courseInfo` | 不存在 | **存在** | 含 courseId/classId/coursename/imageUrl/teacherfactor |
| `pcUrl` | 不存在 | **存在** | 教师端PC签到页 |

## PPTActiveInfo（课程签到独有）

课程签到可通过 `getPPTActiveInfo?activeId={aid}` 获取丰富配置：

| 字段 | 含义 | 本次观察值 |
|------|------|----------|
| `status` | 1=进行中, 2=已结束 | 2 |
| `showVCode` | 需要验证码 | **0**（本次未开启） |
| `ifopenAddress` | 需要位置 | 1（但 lat/lon 为空） |
| `openCheckFaceFlag` | 需要人脸 | 0 |
| `openPreventCheatFlag` | 防作弊 | 0 |
| `locationText` | 预设位置描述 | "北京市-海淀区-..." |
| `locationRange` | 地理围栏 | "100米" |
| `lateMinute` | 迟到窗口 | 10分钟 |
| `signCode` | 签到码 | ""（空=无） |

## 样本文件

| 文件 | 类型 | 发送者 |
|------|------|--------|
| `01_group_qrcode_other.json` | 群聊-二维码签到 | 他人 |
| `02_group_gesture_other.json` | 群聊-手势签到 | 他人 |
| `03_group_location_other.json` | 群聊-位置签到 | 他人 |
| `04_course_location.json` | 课程-位置签到 | 系统(教师) |
| `05_course_pptActiveInfo.json` | 课程签到配置 | API返回 |

> 以上数据经脱敏处理（隐去姓名、Token、用户ID）。
