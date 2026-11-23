// Server-sent events: GET /api/events keeps a connection open and pushes {type, ticketId, projectId}
// whenever something the user can see changes. The browser reconnects automatically.
import { Router } from 'express';
import { subscribe, visibleTo } from '../services/events.js';
import { orgCan } from '../policies/permissions.js';

const r = Router();
let open = 0;
const MAX = 500;

r.get('/', (req, res) => {
  if (open >= MAX) return res.status(503).json({ error: { code: 'BUSY', message: 'Too many live connections' } });
  open++;
  const auth = req.auth;
  // events carry ids only and clients re-fetch through the permission-checked APIs, so every internal user
  // may hear that a ticket changed (lists then show only the tickets of their projects)
  const canViewAllTickets = orgCan(auth, 'ticket.viewAll') || !auth.isCustomer;
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const unsub = subscribe((evt) => {
    if (!visibleTo(auth, evt, { canViewAllTickets })) return;
    const out = { type: evt.type, ticketId: evt.ticketId, projectId: evt.projectId, self: evt.actorId === auth.userId, title: evt.userIds ? evt.title : undefined };
    res.write(`data: ${JSON.stringify(out)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); unsub(); open--; });
});

export default r;
