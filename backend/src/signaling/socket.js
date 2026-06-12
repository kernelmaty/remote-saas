import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { pool } from '../config/db.js';

/**
 * Servidor de señalización WebRTC.
 * Namespaces lógicos por rol:
 *  - Técnicos: auth con JWT (handshake.auth.token)
 *  - Dispositivos host: auth con deviceId + deviceToken
 * Rooms: `company:<id>` (presencia) y `session:<id>` (señalización).
 */
export function attachSignaling(httpServer, corsOrigin) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin } });

  io.use(async (socket, next) => {
    try {
      const { token, deviceId, deviceToken } = socket.handshake.auth || {};
      if (token) {
        const p = jwt.verify(token, process.env.JWT_SECRET);
        socket.data = { kind: 'tech', userId: p.sub, companyId: p.cid };
        return next();
      }
      if (deviceId && deviceToken) {
        const { rows: [dev] } = await pool.query(
          'SELECT * FROM devices WHERE id = $1 AND is_active', [deviceId]);
        if (!dev || !(await bcrypt.compare(deviceToken, dev.device_token_hash))) {
          return next(new Error('device auth failed'));
        }
        socket.data = { kind: 'device', deviceId: dev.id, companyId: dev.company_id };
        return next();
      }
      next(new Error('auth requerido'));
    } catch (e) { next(new Error('auth inválido')); }
  });

  io.on('connection', async (socket) => {
    const { kind, companyId } = socket.data;
    socket.join(`company:${companyId}`);

    if (kind === 'device') {
      const { deviceId } = socket.data;
      socket.join(`device:${deviceId}`);
      await pool.query(
        'UPDATE devices SET is_online = true, last_seen_at = now() WHERE id = $1', [deviceId]);
      io.to(`company:${companyId}`).emit('device:online', { deviceId });

      socket.on('disconnect', async () => {
        await pool.query(
          'UPDATE devices SET is_online = false, last_seen_at = now() WHERE id = $1', [deviceId]);
        io.to(`company:${companyId}`).emit('device:offline', { deviceId });
      });
    }

    // ---- Técnico solicita sesión ----
    socket.on('session:request', async ({ deviceId, ticketId }, ack) => {
      if (kind !== 'tech') return;
      const { rows: [dev] } = await pool.query(
        'SELECT * FROM devices WHERE id = $1 AND company_id = $2 AND is_active',
        [deviceId, companyId]);
      if (!dev) return ack?.({ error: 'Dispositivo inexistente' });

      const { rows: [session] } = await pool.query(
        `INSERT INTO sessions (company_id, device_id, technician_id, ticket_id, status, tech_ip)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id`,
        [companyId, deviceId, socket.data.userId, ticketId ?? null,
         socket.handshake.address]);

      socket.join(`session:${session.id}`);
      io.to(`device:${deviceId}`).emit('session:incoming', {
        sessionId: session.id, technicianId: socket.data.userId });
      ack?.({ sessionId: session.id });
    });

    // ---- Dispositivo acepta / rechaza ----
    socket.on('session:accept', async ({ sessionId }) => {
      if (kind !== 'device') return;
      await pool.query(
        `UPDATE sessions SET status = 'active', started_at = now()
         WHERE id = $1 AND device_id = $2`, [sessionId, socket.data.deviceId]);
      socket.join(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit('session:accepted', {
        sessionId, iceServers: buildIceServers() });
      socket.emit('session:ice-config', { iceServers: buildIceServers() });
      logEvent(sessionId, 'connected');
    });

    socket.on('session:reject', async ({ sessionId }) => {
      await pool.query(
        `UPDATE sessions SET status = 'rejected' WHERE id = $1 AND device_id = $2`,
        [sessionId, socket.data.deviceId]);
      socket.to(`session:${sessionId}`).emit('session:rejected', { sessionId });
    });

    // ---- Relay de señalización WebRTC (SDP / ICE) ----
    for (const ev of ['webrtc:offer', 'webrtc:answer', 'webrtc:ice']) {
      socket.on(ev, ({ sessionId, payload }) => {
        if (socket.rooms.has(`session:${sessionId}`)) {
          socket.to(`session:${sessionId}`).emit(ev, { sessionId, payload });
        }
      });
    }

    // ---- Chat persistente ----
    socket.on('chat:message', async ({ sessionId, text }) => {
      const body = String(text || '').slice(0, 2000).trim();
      if (!body) return;
      await pool.query(
        `INSERT INTO chat_messages (company_id, session_id, sender_user_id, sender_device_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, sessionId ?? null,
         kind === 'tech' ? socket.data.userId : null,
         kind === 'device' ? socket.data.deviceId : null, body]);
      const room = sessionId ? `session:${sessionId}` : `company:${companyId}`;
      socket.to(room).emit('chat:message', { sessionId, text: body, from: kind });
    });

    // ---- Fin de sesión ----
    socket.on('session:end', async ({ sessionId }) => {
      if (!socket.rooms.has(`session:${sessionId}`)) return;
      await pool.query(
        `UPDATE sessions SET status = 'ended', ended_at = now()
         WHERE id = $1 AND status = 'active'`, [sessionId]);
      io.to(`session:${sessionId}`).emit('session:ended', { sessionId });
      io.socketsLeave(`session:${sessionId}`);
      logEvent(sessionId, 'ended');
    });
  });

  return io;
}

function logEvent(sessionId, type, payload = null) {
  pool.query(
    'INSERT INTO session_events (session_id, event_type, payload) VALUES ($1, $2, $3)',
    [sessionId, type, payload]).catch(console.error);
}

/** Credenciales TURN efímeras (coturn use-auth-secret), TTL 1 hora. */
function buildIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_HOST && process.env.TURN_SECRET) {
    const ttl = 3600;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:remotedesk`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET)
      .update(username).digest('base64');
    servers.push({
      urls: [`turn:${process.env.TURN_HOST}:3478?transport=udp`,
             `turn:${process.env.TURN_HOST}:3478?transport=tcp`],
      username, credential,
    });
  }
  return servers;
}
