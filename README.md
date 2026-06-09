# Media Trivia

Sistema de trivia en tiempo real para eventos en vivo. El organizador crea cuestionarios con múltiples preguntas, los encola y los lanza automáticamente. El público responde desde su móvil, acumula puntos y compite en un ranking proyectado en pantalla grande.

---

## Pantallas

| Pantalla | URL | Descripción |
|---|---|---|
| Votante | `/` | Login con nombre + 3 últimos dígitos del DNI, opciones de respuesta, feedback de resultado y ranking |
| Display | `/display` | Pantalla grande para proyector: pregunta, barras en tiempo real, overlay de ranking |
| Admin | `/admin?pwd=...` | Panel de control: cuestionarios, cola, control activo, ranking |

---

## Funcionalidades

- **Cuestionarios**: creá preguntas con opciones múltiples, marcá la respuesta correcta, configurá temporizador y visibilidad de resultados
- **Cola de reproducción**: encolá cuestionarios para que se lancen uno tras otro automáticamente (8 segundos entre preguntas)
- **Ranking en tiempo real**: los que aciertan suman puntos, el ranking se actualiza en vivo en el display y en los celulares
- **Pantalla final**: al terminar la cola, el display muestra el ranking final en grande y cada celular muestra su posición
- **Reset de emergencia**: botón en admin para forzar vuelta a pantalla de espera en cualquier momento
- **QR automático**: en la pantalla de espera y durante votaciones, el display muestra el QR con la IP local

---

## Instalación

```bash
npm install
cp .env.example .env
# Editá .env con tus valores
node server.js
```

---

## Variables de entorno

```env
PORT=3006
VENUE_NAME=Mi Evento
PRIMARY_COLOR=#6C63FF
ADMIN_PASSWORD=tu_contraseña
```

---

## Deploy en Railway

1. Subí el repo a GitHub
2. Creá un proyecto en [Railway](https://railway.app)
3. Conectá el repo
4. Configurá las variables de entorno en Railway
5. Deploy automático

---

## Stack

- **Backend**: Node.js + Express 5 + Socket.IO 4
- **Frontend**: HTML/CSS/JS vanilla (sin frameworks)
- **QR**: paquete `qrcode` (sin servicios externos)
- **Estado**: en memoria (sin base de datos)
