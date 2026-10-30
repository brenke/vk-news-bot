/**
 * Приводит событие Bots LongPoll к простому виду.
 */
export function normalizeMessageEvent(update, { groupId } = {}) {
  if (update?.type !== 'message_new') return null;

  const object = update.object ?? {};
  const message = object.message ?? object;
  if (!message || typeof message !== 'object') return null;

  const peerId = Number(message.peer_id ?? 0);
  const fromId = Number(message.from_id ?? 0);
  if (!peerId) return null;

  const isChat = peerId >= 2_000_000_000;
  const fromCommunity = groupId ? fromId === -Number(groupId) : fromId < 0;
  const action = message.action ?? null;

  return {
    messageId: Number(message.id ?? message.conversation_message_id ?? 0),
    peerId,
    fromId,
    text: typeof message.text === 'string' ? message.text : '',
    date: Number(message.date ?? 0) * 1_000 || Date.now(),
    isChat,
    chatId: isChat ? peerId - 2_000_000_000 : null,
    isOutgoing: Boolean(message.out) || fromCommunity || fromId < 0,
    isService: Boolean(action),
    actionType: action?.type ?? null,
    actionMemberId: Number(action?.member_id ?? 0),
    hasReply: Boolean(message.reply_message),
  };
}
