import { config } from '../config.js';
import { bindTammi, sendTammi, tammiBot, tammiHealth, tammiTopic, unbindTammi } from './bridge.js';

export function setupTammiTelegram(): void {
  if (!tammiBot) return;
  tammiBot.catch((err, ctx) => console.error(`[Tammi Telegram] Update ${ctx.update.update_id} failed:`, err));
  tammiBot.telegram.setMyCommands([
    { command: 'tammi', description: 'Trạng thái, ID group hoặc liên kết topic' },
  ]).catch(err => console.warn('[Tammi] Could not set commands:', err));

  tammiBot.command('tammi', async ctx => {
    const [, action, id, kind] = ctx.message.text.trim().split(/\s+/);
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (member.status !== 'creator' && member.status !== 'administrator') return;
    if (action === 'id') {
      await ctx.reply(`Telegram group ID: ${ctx.chat.id}`);
      return;
    }
    if (action === 'status') {
      const health = await tammiHealth();
      await ctx.reply(health
        ? `Tammi bridge: ${health.loggedIn ? 'đã đăng nhập' : 'chưa đăng nhập'}\nKết nối: ${String(health.connectionState ?? 'không rõ')}\nGroup: ${config.tammi.telegramGroupId}`
        : 'Tammi bridge chưa chạy. Dùng hermes-tammi-plugin status trên máy chủ để kiểm tra.');
      return;
    }
    if (ctx.chat.id !== config.tammi.telegramGroupId) {
      await ctx.reply('Group này chưa được cấu hình cho Tammi. Dùng /tammi id rồi đặt TAMMI_TG_GROUP_ID trong .env.');
      return;
    }
    const topicId = ctx.message.message_thread_id;
    if (!topicId) return;
    if (action === 'bind' && id) {
      bindTammi(topicId, id, kind || 'peer');
      await ctx.reply(`Đã liên kết topic với Tammi ${id}.`);
    } else if (action === 'unbind') {
      await ctx.reply(unbindTammi(topicId) ? 'Đã hủy liên kết Tammi.' : 'Topic chưa liên kết Tammi.');
    } else {
      const mapping = tammiTopic(topicId);
      await ctx.reply(mapping ? `Tammi: ${mapping.conversationId} (${mapping.conversationType})` : 'Dùng /tammi bind <conversationId> [conversationType] trong topic, hoặc /tammi unbind.');
    }
  });

  tammiBot.on('message', async ctx => {
    const topicId = 'message_thread_id' in ctx.message ? ctx.message.message_thread_id : undefined;
    if (!topicId || ctx.chat.id !== config.tammi.telegramGroupId || !tammiTopic(topicId) || ctx.from?.is_bot) return;
    const text = 'text' in ctx.message ? ctx.message.text : 'caption' in ctx.message ? ctx.message.caption : undefined;
    if (!text || text.startsWith('/')) return;
    try { await sendTammi(topicId, text); }
    catch (err) { await ctx.reply(`⚠️ Gửi Tammi thất bại: ${err instanceof Error ? err.message : String(err)}`); }
  });
}
