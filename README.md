# RemoteDesk SaaS

Plataforma de acceso remoto multi-empresa para soporte técnico a PyMEs.
**Stack:** Flutter · Node.js/Express · PostgreSQL · WebRTC · Socket.IO · Coturn · Docker.

## Documentación

Toda la arquitectura (diagramas, DB, APIs, wireframes, roadmap, despliegue y seguridad)
está en **`docs/01-ARQUITECTURA.md`**. El esquema SQL completo con RLS multi-tenant
está en **`backend/sql/schema.sql`**.

## Levantar el MVP

```bash
cp backend/.env.example backend/.env   # editar secretos
docker compose up -d --build
curl http://localhost:4000/health      # {"ok":true}
```

El schema se aplica automáticamente al crear el contenedor de PostgreSQL.

### Probar la API

```bash
# Registrar empresa + admin
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"companyName":"Soporte SRL","fullName":"Matias","email":"admin@soporte.com","password":"clave-segura-123"}'

# Login → accessToken
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@soporte.com","password":"clave-segura-123"}'
```

### Frontend Flutter

```bash
cd frontend
flutter pub get
flutter run -d windows   # o macos / linux / chrome
```

## Estado del código inicial (Fase 0 completa)

| Módulo | Estado |
|---|---|
| Auth (JWT + refresh rotativo + rate limit) | ✅ Funcional |
| CRUD clientes / tickets / dispositivos | ✅ Funcional |
| Historial de sesiones + auditoría | ✅ Funcional |
| Signaling WebRTC (Socket.IO) + TURN efímero | ✅ Funcional |
| Dashboard (KPIs + actividad 30 días) | ✅ Funcional |
| Flutter: login, dashboard, tickets, viewer WebRTC | ✅ Esqueleto funcional |
| Inyección nativa de mouse/teclado en host | ⚠️ Punto de integración (Fase 1, requiere FFI por SO) |
| Transferencia de archivos por DataChannel | ⚠️ Canal creado, protocolo de chunks en Fase 2 |
