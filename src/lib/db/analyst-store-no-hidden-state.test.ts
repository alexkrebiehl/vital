import { describe, expect, it } from 'vitest';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';
import {
  findConversation,
  insertConversation,
  insertMessage,
  listConversations,
  listMessages,
  listRecentMessages,
  renameConversationRow,
  deleteConversationRow,
} from '@/lib/db/analyst-store';

// A removed source's conversations are deleted, never hidden: no read may consult
// the lifecycle table, so there is no state in which a conversation is "removed
// but still stored".
describe('conversation reads carry no hidden-until-purge filter', () => {
  it('none of the read or write statements mention the lifecycle table', async () => {
    const db = new FakeAnalystDb();
    const c = await insertConversation(db, 'A');
    await insertMessage(db, c.id, { role: 'user', content: 'q' }, 200);
    await listConversations(db, 10);
    await findConversation(db, c.id);
    await listMessages(db, c.id);
    await listRecentMessages(db, c.id, 5);
    await renameConversationRow(db, c.id, 'B');
    await deleteConversationRow(db, c.id);
    expect(db.calls.map(call => call.text).filter(text => /data_sources_seen|removed_at/.test(text))).toEqual([]);
  });
});
