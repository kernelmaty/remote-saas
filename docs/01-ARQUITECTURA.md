# RemoteDesk SaaS — Arquitectura Completa
Plataforma de acceso remoto multi-empresa orientada a soporte técnico para PyMEs.

---

## 1. Visión general de la arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTES (Flutter)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ App Técnico  │  │ App Cliente  │  │ Dashboard Admin (Web) │  │
│  │ (Desktop)    │  │ (Desktop)    │  │ (Flutter Web)         │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘  │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │   WebRTC P2P    │                     │
          │◄───────────────►│                     │ HTTPS (REST)
          │                 │                     │
┌─────────▼─────────────────▼─────────────────────▼───────────────┐
│                      CAPA DE SERVIDOR                            │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ API REST        │  │ Signaling Server │  │ Coturn         │  │
│  │ Node + Express  │  │ Socket.IO (WSS)  │  │ (STUN/TURN)    │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────────────┘  │
│           │                    │                                 │
│  ┌────────▼────────────────────▼─────────┐                       │
│  │           PostgreSQL 16                │                       │
│  │  (multi-tenant: company_id en filas)   │                       │
│  └────────────────────────────────────────┘                      │
│                    Todo en contenedores Docker                   │
└──────────────────────────────────────────────────────────────────┘
```

### Componentes

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| API REST | Node.js + Express | Auth, CRUD (clientes, tickets, sesiones), dashboard |
| Signaling | Socket.IO sobre WSS | Intercambio de SDP/ICE, presencia de dispositivos, chat |
| Media | WebRTC (P2P) | Pantalla, control remoto (DataChannel), transferencia de archivos (DataChannel) |
| STUN/TURN | Coturn | NAT traversal; TURN como relay cuando P2P falla (~15-20% de casos) |
| DB | PostgreSQL | Datos multi-tenant, historial, auditoría |
| Infra | Docker Compose (MVP) → Kubernetes (escala) | Despliegue reproducible |

### Decisiones clave

1. **Pantalla y control por WebRTC**: el video viaja P2P (latencia mínima, sin costo de ancho de banda del servidor). El control de mouse/teclado y la transferencia de archivos van por **DataChannels** (cifrados con DTLS, orden garantizado configurable).
2. **El servidor nunca ve el contenido de la sesión**: solo orquesta señalización. Esto reduce superficie de ataque y costos.
3. **Multi-tenancy por columna `company_id`** con Row Level Security (RLS) de PostgreSQL: una sola base, aislamiento a nivel de fila, simple de operar en MVP y escalable.
4. **Chat**: por Socket.IO (persiste en DB) fuera de sesión, y por DataChannel dentro de una sesión activa (menor latencia, sin pasar por servidor).
5. **Flutter en todas las superficies**: desktop (Windows/macOS/Linux) para técnico y cliente, web para el dashboard admin. Un solo codebase con `flutter_webrtc`.

### Flujo de una sesión remota

```
Técnico                Signaling (Socket.IO)              Cliente
  │ 1. request_session ────────►│                            │
  │                             │ 2. incoming_session ──────►│ (acepta)
  │                             │◄── 3. session_accepted ────│
  │ 4. SDP offer ──────────────►│──────────────────────────► │
  │ ◄────────────────────────── │◄────────── 5. SDP answer   │
  │ 6. ICE candidates ◄────────►│◄──────────► (bidireccional)│
  │                             │                            │
  │ ◄══════ 7. WebRTC P2P: video + datachannels ══════════►  │
  │                             │ 8. session_ended (log a DB)│
```

---

## 2. Estructura de carpetas

```
remote-saas/
├── docker-compose.yml
├── docs/                          # esta documentación
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   ├── sql/schema.sql             # esquema completo + seeds
│   └── src/
│       ├── index.js               # bootstrap: Express + Socket.IO
│       ├── config/db.js           # pool de PostgreSQL
│       ├── middleware/auth.js     # JWT + scoping por company_id
│       ├── routes/                # definición de endpoints
│       │   ├── auth.routes.js
│       │   ├── clients.routes.js
│       │   ├── tickets.routes.js
│       │   ├── sessions.routes.js
│       │   ├── devices.routes.js
│       │   └── dashboard.routes.js
│       ├── controllers/           # lógica de cada recurso
│       └── signaling/socket.js    # servidor de señalización WebRTC
└── frontend/                      # Flutter (técnico + cliente + admin web)
    ├── pubspec.yaml
    └── lib/
        ├── main.dart
        ├── core/
        │   ├── api_client.dart    # HTTP + manejo de JWT
        │   └── signaling_service.dart
        └── features/
            ├── auth/login_screen.dart
            ├── dashboard/dashboard_screen.dart
            ├── remote/remote_session_screen.dart  # WebRTC viewer + control
            └── tickets/tickets_screen.dart
```

---

## 3. Sistema de autenticación

- **Registro de empresa** → crea `company` + primer usuario `admin`.
- **Login** → email + password (bcrypt, cost 12) → devuelve **access token JWT (15 min)** + **refresh token (7 días, rotativo, almacenado hasheado en DB)**.
- JWT payload: `{ sub: user_id, cid: company_id, role }`. Todo middleware filtra por `cid` — el frontend nunca envía `company_id`.
- **Dispositivos no atendidos** (acceso desatendido tipo TeamViewer Host): se registran con un `device_token` de larga duración + clave de acceso propia, revocable desde el dashboard.
- Roles: `admin` (gestiona empresa, usuarios, facturación), `technician` (sesiones, tickets), `client_user` (recibe soporte).
- 2FA TOTP (fase 2) para admins.

---

## 4. APIs REST (resumen)

Base: `/api/v1` — Auth: header `Authorization: Bearer <jwt>`

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/auth/register` | Registra empresa + admin |
| POST | `/auth/login` | Login, devuelve tokens |
| POST | `/auth/refresh` | Rota refresh token |
| POST | `/auth/logout` | Revoca refresh token |
| GET/POST | `/clients` | Listar / crear clientes (empresas atendidas) |
| GET/PATCH/DELETE | `/clients/:id` | Detalle / editar / baja |
| GET/POST | `/clients/:id/devices` | Dispositivos del cliente |
| POST | `/devices/register` | Alta de dispositivo desatendido (token) |
| GET/POST | `/tickets` | Listar (filtros: estado, prioridad, cliente) / crear |
| GET/PATCH | `/tickets/:id` | Detalle / cambiar estado, asignar |
| POST | `/tickets/:id/comments` | Comentar ticket |
| GET | `/sessions` | Historial de conexiones (filtros + paginación) |
| GET | `/sessions/:id` | Detalle: duración, técnico, dispositivo, eventos |
| GET | `/dashboard/summary` | KPIs: sesiones hoy, tickets abiertos, técnicos activos |
| GET | `/dashboard/activity` | Serie temporal de sesiones (últimos 30 días) |
| GET/POST | `/users` | Gestión de usuarios de la empresa (admin) |

Las sesiones **se crean vía Socket.IO** (tiempo real) y la API solo las consulta; el signaling persiste inicio/fin/eventos en `sessions`.

### Eventos Socket.IO (signaling)

| Evento | Dirección | Payload |
|---|---|---|
| `device:online` / `device:offline` | server→tech | presencia |
| `session:request` | tech→server→device | `{deviceId, ticketId?}` |
| `session:accept` / `session:reject` | device→server→tech | `{sessionId}` |
| `webrtc:offer` / `webrtc:answer` | bidireccional | SDP |
| `webrtc:ice` | bidireccional | ICE candidate |
| `chat:message` | bidireccional | `{sessionId?, text}` (persiste) |
| `session:end` | cualquiera | cierra y loguea duración |

---

## 5. Wireframes (texto)

```
LOGIN                              DASHBOARD ADMIN
┌──────────────────────┐  ┌─────────────────────────────────────────┐
│      RemoteDesk      │  │ ☰ RemoteDesk   [empresa ▾]  [🔔] [user] │
│  ┌────────────────┐  │  ├──────────┬──────────────────────────────┤
│  │ email          │  │  │ Inicio   │ KPI: 12 sesiones hoy │ 5 ⚠   │
│  ├────────────────┤  │  │ Clientes │ ┌─ Gráfico sesiones 30d ───┐ │
│  │ contraseña     │  │  │ Tickets  │ └──────────────────────────┘ │
│  └────────────────┘  │  │ Sesiones │ Últimas conexiones           │
│  [ Iniciar sesión ]  │  │ Equipos  │ ▸ PC-Contaduría  14:03  8min │
│  ¿Olvidaste tu pass? │  │ Usuarios │ ▸ Caja-01        13:40 22min │
└──────────────────────┘  └──────────┴──────────────────────────────┘

LISTA DE EQUIPOS (técnico)         SESIÓN REMOTA
┌─────────────────────────┐  ┌─────────────────────────────────────┐
│ 🔍 buscar equipo...     │  │ ⏺ Grabando │ 00:08:13 │ Caja-01     │
│ ● PC-Contaduría  online │  │ ┌─────────────────────────────────┐ │
│   [Conectar] [Archivos] │  │ │                                 │ │
│ ● Caja-01        online │  │ │      PANTALLA REMOTA (video)    │ │
│ ○ Depósito      offline │  │ │                                 │ │
│ ● Recepción      online │  │ └─────────────────────────────────┘ │
└─────────────────────────┘  │ [🖱 control] [📁 archivos] [💬 chat]│
                             │ [📋 portapapeles] [⏹ finalizar]     │
TICKETS                      └─────────────────────────────────────┘
┌────────────────────────────────────┐  CHAT (panel lateral)
│ [+ Nuevo] [Abiertos ▾] [Prioridad▾]│  ┌──────────────────┐
│ #341 Impresora no responde   🔴 ALTA│  │ Cliente: no anda │
│      Cliente: Farmacia López       │  │ Téc: ya entro 👍 │
│ #340 Excel se cierra         🟡 MED │  │ [escribir...   ] │
└────────────────────────────────────┘  └──────────────────┘
```

---

## 6. Roadmap por fases

**Fase 0 — Fundaciones (semanas 1-2)**
Docker Compose, schema PostgreSQL, auth JWT completa, CRUD de clientes/usuarios. ✅ *Incluido en el código inicial.*

**Fase 1 — MVP de sesión remota (semanas 3-6)** ← objetivo: demo operativa
- Signaling Socket.IO + Coturn desplegado.
- Flutter desktop: ver pantalla remota (screen capture con `flutter_webrtc` / getDisplayMedia).
- Control de mouse/teclado vía DataChannel (lado host: inyección con paquete nativo, p.ej. FFI a `robotjs`-like o `keybinder`).
- Historial de sesiones persistido.

**Fase 2 — Soporte completo (semanas 7-10)**
Chat integrado (persistente + en sesión), transferencia de archivos por DataChannel (chunks de 16KB con backpressure), sistema de tickets con comentarios y estados, acceso desatendido con device token.

**Fase 3 — SaaS productivo (semanas 11-14)**
Dashboard con métricas, gestión de roles, planes y límites por empresa (seats, dispositivos), facturación (Mercado Pago para LATAM / Stripe), 2FA, RLS activado en PostgreSQL.

**Fase 4 — Escala (semanas 15+)**
Kubernetes + autoscaling del signaling (Socket.IO con adapter Redis), múltiples TURN regionales, grabación de sesiones (opt-in, SFU como mediasoup si se necesita server-side recording), apps móviles (soporte desde el celular).

---

## 7. Estrategia de despliegue

**MVP (1 VPS, p.ej. Hetzner/DigitalOcean 4GB):**
```
docker compose up -d   # postgres + api + coturn + caddy (TLS automático)
```
- Caddy o Nginx como reverse proxy con TLS (Let's Encrypt). WSS obligatorio para signaling.
- Coturn en el mismo host con puertos UDP 3478 + rango 49152-65535 abiertos.
- Backups: `pg_dump` diario a S3/Backblaze + retención 30 días.

**Producción:**
- CI/CD: GitHub Actions → build de imágenes → registry → deploy.
- Migrar a managed PostgreSQL (RDS/Neon) cuando haya tracción.
- Signaling escalado horizontal con `socket.io-redis-adapter`.
- TURN: medir % de sesiones relay; si supera ~20%, agregar nodos TURN por región (el relay es el único costo de ancho de banda real).

---

## 8. Recomendaciones de seguridad

1. **Transporte**: TLS 1.3 en API y WSS; WebRTC ya cifra media con SRTP y datos con DTLS de extremo a extremo.
2. **Consentimiento**: toda sesión atendida requiere aceptación explícita del cliente; el acceso desatendido requiere clave propia del dispositivo + queda auditado.
3. **Multi-tenant**: RLS en PostgreSQL (`current_setting('app.company_id')`) como segunda barrera además del middleware; tests que verifiquen aislamiento entre tenants.
4. **Tokens**: access corto (15 min), refresh rotativo con detección de reuso (si un refresh viejo se reusa → revocar familia completa).
5. **Passwords**: bcrypt cost 12, rate limit en `/auth/login` (p.ej. 5 intentos/15 min por IP+email), bloqueo progresivo.
6. **TURN**: credenciales efímeras (`use-auth-secret` con TTL), nunca estáticas, para que no usen tu relay como proxy gratuito.
7. **Auditoría**: tabla `session_events` inmutable (quién, cuándo, desde qué IP, qué dispositivo, archivos transferidos con nombre y tamaño).
8. **Inyección de input remoto (lado host)**: validar que los eventos vienen del DataChannel de la sesión activa, con kill-switch local (el cliente siempre puede cortar con un click/tecla).
9. **Secrets**: `.env` fuera del repo, rotación de JWT secret soportada (kid en header), escaneo de dependencias (`npm audit`, Dependabot).
10. **Hardening**: Helmet, CORS restrictivo, validación de payloads con `zod`, límites de tamaño de body, contenedores non-root.
