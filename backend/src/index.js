import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import routes from './routes/index.js';
import { attachSignaling } from './signaling/socket.js';
import { pool } from './config/db.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use('/api/v1', routes);

// Manejo central de errores
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

const server = http.createServer(app);
attachSignaling(server, process.env.CORS_ORIGIN?.split(',') ?? true);

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`RemoteDesk API + signaling en :${port}`));
