import { withCron } from '../context.js';
import { json } from '../http.js';
import { generateAll, sendDueReminders } from '../chores.js';

// Daily (vercel.json crons): top up recurring chores a few weeks ahead, then send due-soon reminders.
// Both are safe to re-run: unique (chore_id, due_at) and last_reminded_at.
export const GET = withCron(async () => {
  const generated = await generateAll();
  const reminders = await sendDueReminders();
  return json({ ...generated, ...reminders });
});
