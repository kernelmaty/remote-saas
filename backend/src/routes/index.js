import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import * as clients from '../controllers/clients.controller.js';
import * as tickets from '../controllers/tickets.controller.js';
import * as sessions from '../controllers/sessions.controller.js';
import * as devices from '../controllers/devices.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true });

// Auth
router.post('/auth/register', auth.register);
router.post('/auth/login', loginLimiter, auth.login);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/logout', auth.logout);

// Todo lo demás requiere JWT
router.use(requireAuth);

// Clientes
router.get('/clients', clients.list);
router.post('/clients', clients.create);
router.get('/clients/:id', clients.getOne);
router.patch('/clients/:id', clients.update);
router.delete('/clients/:id', requireRole('admin'), clients.remove);
router.get('/clients/:id/devices', devices.listByClient);

// Dispositivos
router.post('/devices/register', devices.register);
router.delete('/devices/:id', requireRole('admin'), devices.revoke);

// Tickets
router.get('/tickets', tickets.list);
router.post('/tickets', tickets.create);
router.get('/tickets/:id', tickets.getOne);
router.patch('/tickets/:id', tickets.update);
router.post('/tickets/:id/comments', tickets.comment);

// Sesiones (historial)
router.get('/sessions', sessions.list);
router.get('/sessions/:id', sessions.getOne);

// Dashboard
router.get('/dashboard/summary', dashboard.summary);
router.get('/dashboard/activity', dashboard.activity);

export default router;
