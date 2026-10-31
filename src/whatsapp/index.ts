import 'dotenv/config';
import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import { Telegraf } from 'telegraf';
import { tgQueue } from '../utils/tgQueue.js';
import QRCode from 'qrcode';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendReportMessage } from '../reporting.js';

const root = process.cwd();
const groupId = Number(process.env.TG_GROUP_ID);
const token = process.env.TG_TOKEN;
if (!token || !Number.isSafeInteger(groupId) || groupId >= 0) throw new Error('TG_TOKEN and negative TG_GROUP_ID required');
const accountId = process.env.WA_ACCOUNT_ID || path.basename(root);
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const authDir = path.join(dataDir, 'whatsapp', accountId);
const mappingFile = path.join(dataDir, 'whatsapp-topics.json');
const bot = new Telegraf(token);
const chromePath = process.env.CHROME_PATH
  || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    .find(existsSync);
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authDir }),
  puppeteer: {
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

type Topic = { topicId: number; chatId: string; name: string };
type TelegramMediaMessage = {
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string; file_name?: string; mime_type?: string };
  video_note?: { file_id: string };
  animation?: { file_id: string; file_name?: string; mime_type?: string };
  audio?: { file_id: string; file_name?: string; mime_type?: string };
  voice?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  sticker?: { file_id: string; is_animated?: boolean; is_video?: boolean; file_name?: string };
  caption?: string;
};
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
let topics: Topic[] = [];
try { if (existsSync(mappingFile)) topics = JSON.parse(readFileSync(mappingFile, 'utf8')) as Topic[]; } catch { topics = []; }
function save(): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${mappingFile}.tmp`, JSON.stringify(topics, null, 2));
  renameSync(`${mappingFile}.tmp`, mappingFile);
}
function topic(chatId: string): Topic | undefined { return topics.find(x => x.chatId === chatId); }
async function ensureTopic(chatId: string, name: string): Promise<Topic> {
  const old = topic(chatId);
  if (old) return old;
  const created = await bot.telegram.createForumTopic(groupId, `WhatsApp · ${name}`.slice(0, 128));
  const item = { topicId: created.message_thread_id, chatId, name };
  topics.push(item); save();
  return item;
}
function senderName(msg: Message & { _data?: Record<string, unknown> }): string {
  return String(msg._data?.notifyName || msg._data?.pushname || msg.author || msg.from);
}
function mediaFilename(mime: string, fallback: string): string {
  const ext = mime.split('/')[1]?.split(';')[0] || 'bin';
  return `${fallback}.${ext}`;
}
async function sendWhatsAppMedia(target: Awaited<ReturnType<Client['getChatById']>>, media: MessageMedia, caption?: string): Promise<void> {
  await target.sendMessage(media, caption ? { caption } : undefined);
}
async function telegramMediaFromWhatsApp(msg: Message): Promise<{ media: { source: Buffer; filename: string }; mime: string }> {
  const media = await msg.downloadMedia();
  if (!media?.data) throw new Error('WhatsApp media download returned empty data');
  const buffer = Buffer.from(media.data, 'base64');
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error(`Media exceeds ${MAX_MEDIA_BYTES / 1024 / 1024} MB limit`);
  return { media: { source: buffer, filename: media.filename || mediaFilename(media.mimetype, 'whatsapp-media') }, mime: media.mimetype };
}
async function telegramFile(fileId: string): Promise<Buffer> {
  const url = await bot.telegram.getFileLink(fileId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Telegram media download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error(`Media exceeds ${MAX_MEDIA_BYTES / 1024 / 1024} MB limit`);
  return buffer;
}
async function whatsappMediaFromTelegram(fileId: string, mime: string, filename: string): Promise<MessageMedia> {
  return new MessageMedia(mime || 'application/octet-stream', (await telegramFile(fileId)).toString('base64'), filename);
}

client.on('qr', qr => {
  console.log(`[WhatsApp:${accountId}] QR code received`);
  void QRCode.toBuffer(qr).then(image => bot.telegram.sendPhoto(
    groupId,
    { source: image, filename: 'whatsapp-qr.png' },
    { caption: `WhatsApp ${accountId}: quét QR để đăng nhập.` },
  )).catch(error => console.error(`[WhatsApp:${accountId}] QR delivery failed:`, error));
});
client.on('authenticated', () => console.log(`[WhatsApp:${accountId}] authenticated`));
client.on('ready', () => console.log(`[WhatsApp:${accountId}] listener started`));
client.on('auth_failure', error => console.error(`[WhatsApp:${accountId}] auth failure: ${error}`));
client.on('disconnected', reason => console.error(`[WhatsApp:${accountId}] disconnected: ${reason}`));
client.on('message', async msg => {
  if (msg.fromMe) return;
  try {
    const chat = await msg.getChat();
    const item = await ensureTopic(chat.id._serialized, chat.isGroup ? chat.name : senderName(msg as Message & { _data?: Record<string, unknown> }));
    const sender = senderName(msg as Message & { _data?: Record<string, unknown> });
    const text = msg.body.trim();
    if (text) appendReportMessage(dataDir, { instance: accountId, platform: 'whatsapp', groupId: chat.id._serialized, sender, text, timestamp: new Date((msg as Message & { timestamp?: number }).timestamp ? Number((msg as Message & { timestamp?: number }).timestamp) * 1000 : Date.now()).toISOString() });
    const prefix = `${sender}: `;
    const options = { message_thread_id: item.topicId };
    if (msg.hasMedia) {
      const downloaded = await telegramMediaFromWhatsApp(msg);
      const input = { ...downloaded.media, filename: downloaded.media.filename };
      const caption = `${prefix}${msg.body.trim()}`.trim().slice(0, 1024);
      await tgQueue<unknown>(() => downloaded.mime.startsWith('image/')
        ? bot.telegram.sendPhoto(groupId, input, { caption, ...options })
        : downloaded.mime.startsWith('video/')
          ? bot.telegram.sendVideo(groupId, input, { caption, ...options })
          : downloaded.mime.startsWith('audio/')
            ? bot.telegram.sendAudio(groupId, input, { caption, ...options })
            : bot.telegram.sendDocument(groupId, input, { caption, ...options }));
    } else {
      if (text) await tgQueue(() => bot.telegram.sendMessage(groupId, `${prefix}${text}`, options));
    }
  } catch (error) { console.error(`[WhatsApp:${accountId}] receive failed:`, error); }
});

bot.on('message', async ctx => {
  if (ctx.chat.id !== groupId || ctx.from?.is_bot) return;
  const message = ctx.message as typeof ctx.message & TelegramMediaMessage;
  const threadId = 'message_thread_id' in message ? message.message_thread_id : undefined;
  const item = topics.find(x => x.topicId === threadId);
  if (!item) return;
  try {
    const target = await client.getChatById(item.chatId);
    if ('text' in message && message.text) await target.sendMessage(message.text);
    else {
      const media = message.photo?.at(-1)
        ? await whatsappMediaFromTelegram(message.photo.at(-1)!.file_id, 'image/jpeg', 'telegram-photo.jpg')
        : message.video
          ? await whatsappMediaFromTelegram(message.video.file_id, message.video.mime_type || 'video/mp4', message.video.file_name || 'telegram-video.mp4')
          : message.audio
            ? await whatsappMediaFromTelegram(message.audio.file_id, message.audio.mime_type || 'audio/mpeg', message.audio.file_name || 'telegram-audio.mp3')
            : message.voice
              ? await whatsappMediaFromTelegram(message.voice.file_id, message.voice.mime_type || 'audio/ogg', 'telegram-voice.ogg')
              : message.document
                ? await whatsappMediaFromTelegram(message.document.file_id, message.document.mime_type || 'application/octet-stream', message.document.file_name || 'telegram-document')
                : message.sticker && !message.sticker.is_animated && !message.sticker.is_video
                  ? await whatsappMediaFromTelegram(message.sticker.file_id, 'image/webp', message.sticker.file_name || 'telegram-sticker.webp')
                  : undefined;
      if (!media) return;
      await sendWhatsAppMedia(target, media, message.caption);
    }
  } catch (error) {
    await ctx.reply(`WhatsApp send failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

async function stop(reason: string): Promise<void> {
  try { await client.destroy(); } catch { /* already stopped */ }
  bot.stop(reason);
}
process.once('SIGINT', () => { void stop('SIGINT'); });
process.once('SIGTERM', () => { void stop('SIGTERM'); });
await bot.launch({ dropPendingUpdates: true });
console.log('[WhatsApp] Telegram polling connected');
await client.initialize();
console.log(`[WhatsApp:${accountId}] bridge ready`);

// Self-check: mapping remains one-to-one after serialization.
if (topics.some((x, i) => topics.findIndex(y => y.chatId === x.chatId) !== i)) throw new Error('Duplicate WhatsApp topic mapping');
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
const keepAlive = setInterval(() => undefined, 60_000);
process.once('exit', () => clearInterval(keepAlive));

export {}; 
