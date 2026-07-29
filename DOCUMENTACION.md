# Mom's Assist Finance — cómo está hecho y dónde está cada cosa

Este archivo tiene dos partes:

1. **Qué contestar** cuando alguien te pregunta cómo está hecho el programa.
2. **Dónde viven los archivos** y qué hacer si querés editar algo vos.

---

## 1. Qué contestar cuando te preguntan "¿cómo está hecho?"

### Respuesta corta (para cualquiera)

> Es una aplicación web. Se abre desde el navegador del celular o de la compu, no
> se instala nada. La parte visual está hecha en React, los datos se guardan en
> Supabase (una base de datos en la nube) y está publicada en Vercel. Cuando subís
> un resumen de tarjeta en PDF, en foto o en Excel, lo lee y clasifica la
> inteligencia artificial de Claude.

### Respuesta media (si te preguntan un poco más)

- **Frontend (lo que se ve):** React 19, con `react-router-dom` para las
  pantallas, `recharts` para los gráficos y `lucide-react` para los iconitos.
  Los estilos están escritos a mano en el código (no usa Tailwind ni Bootstrap),
  con una paleta centralizada en un solo archivo.
- **Backend / base de datos:** Supabase. Ahí están el login (usuarios y
  contraseñas), y todas las tablas: movimientos, cuentas, extractos, categorías,
  reglas, hijos, alias, etc.
- **Funciones de servidor:** unas cuantas funciones sueltas ("serverless") que
  corren en Vercel, en la carpeta `api/`. Son las que hablan con la IA, las que
  manejan la suscripción de Mercado Pago y las que mandan mails.
- **Inteligencia artificial:** la API de Claude (modelo `claude-sonnet-4-6`) para
  leer resúmenes en PDF, en foto y para clasificar filas de Excel.
- **Pagos:** Mercado Pago, con suscripción mensual (plan Premium).
- **Mails:** Resend (avisos de alta de usuario, reportes de bug, auditoría).
- **Hosting:** Vercel. Cada vez que se aprueba un cambio en la rama `master`,
  Vercel lo despliega solo, sin que nadie tenga que hacer nada.
- **Es una PWA:** se puede "agregar a la pantalla de inicio" del celular y se
  comporta como una app.

### Respuesta técnica (si el que pregunta es programador)

```
React 19 (Create React App) + React Router 7
  ↓
Supabase (Postgres + Auth + Row Level Security)
  ↓
Vercel Serverless Functions (carpeta /api, Node.js)
  ↓
Claude API (claude-sonnet-4-6) · Mercado Pago (suscripciones) · Resend (mails)
```

Detalles que suelen preguntar:

- No hay servidor propio ni Docker: es un SPA estático + funciones serverless.
- El navegador habla con Supabase directamente usando la clave pública (anon key)
  y las políticas de seguridad de Supabase (RLS) son las que limitan qué ve cada
  usuario. La clave privada (`service role`) sólo se usa del lado del servidor,
  dentro de `api/`.
- Toda llamada a `api/` valida el token del usuario contra Supabase antes de
  hacer nada, y tiene límite de pedidos por usuario (`api/_lib/rateLimit.js`).
- Hay dos tareas programadas (crons de Vercel, declaradas en `vercel.json`):
  reclasificación diaria a las 3 AM y auditoría semanal los sábados a la 1 AM.
- Sin tests automatizados más allá del test de ejemplo de Create React App.

---

## 2. ¿Dónde están los archivos?

### Lo primero: el código no está en tu computadora

El programa vive **en GitHub**, en el repositorio:

```
https://github.com/florgp96-art/ma-finance
```

Cuando me pedís un cambio, yo lo hago en una copia en la nube, lo subo a GitHub
y Vercel lo publica. En ningún momento pasa por tu compu. Por eso **no lo
encontrás en Visual Studio Code**: nunca estuvo ahí.

Tenés tres formas de mirar o editar el código:

#### Opción A — Ver y editar desde el navegador (la más fácil, no instala nada)

1. Entrá a https://github.com/florgp96-art/ma-finance
2. Hacé click en el archivo que quieras ver.
3. Para editarlo, el iconito del lápiz arriba a la derecha.
4. Abajo, "Commit changes" y elegí **"Create a new branch"** (no `master`
   directo), así el cambio no sale publicado sin revisar.

Truco: dentro del repo en GitHub, apretá la tecla **`.`** (el punto). Se abre un
Visual Studio Code completo dentro del navegador, con todos los archivos.

#### Opción B — Bajarlo a tu computadora y abrirlo en Visual Studio Code

En una terminal:

```bash
git clone https://github.com/florgp96-art/ma-finance.git
cd ma-finance
code .          # abre la carpeta en Visual Studio Code
```

Si querés además **correrlo** en tu compu:

```bash
npm install     # instala las librerías (tarda unos minutos)
npm start       # abre http://localhost:3000
```

Para que funcione localmente necesitás un archivo `.env.local` en la raíz del
proyecto con las claves de Supabase (`REACT_APP_SUPABASE_URL` y
`REACT_APP_SUPABASE_ANON_KEY`). Ese archivo **no está en GitHub a propósito**
(está en `.gitignore`), porque son claves. Los valores los saca del panel de
Supabase o del panel de Vercel, en "Environment Variables".

#### Opción C — Seguir pidiéndomelo a mí

Es lo que venís haciendo y es lo más seguro: yo edito, verifico que compile, lo
subo y Vercel lo despliega. No necesitás tener nada instalado.

---

### Mapa de archivos (qué es cada cosa)

```
ma-finance/
├── src/                         ← TODO lo que se ve en pantalla
│   ├── App.js                   Las rutas: /login, /register, /onboarding, /dashboard
│   ├── theme.js                 ⭐ Colores y tipografía. Si querés cambiar un color, es acá
│   ├── index.js / index.css     Arranque de la app y estilos globales
│   ├── pages/
│   │   ├── Dashboard.js         ⭐ La pantalla principal — el archivo más grande de todos
│   │   ├── Login.js             Pantalla de ingreso
│   │   ├── Register.js          Alta de usuario nuevo
│   │   ├── Onboarding.js        Primeros pasos del usuario nuevo
│   │   └── ResetPassword.js     Cambio de contraseña
│   ├── components/
│   │   ├── AccountDetail.js     ⭐ Detalle de una cuenta: movimientos, importar extractos
│   │   ├── ConfigPanel.js       Configuración: categorías, reglas, alias, plan
│   │   ├── HijoDetail.js        Detalle por hijo
│   │   └── CashView.js          Vista de efectivo
│   ├── hooks/
│   │   ├── useAuth.js           Sesión del usuario (quién está logueado)
│   │   └── useBreakpoint.js     Detecta si es celular o compu
│   └── lib/
│       ├── supabase.js          Conexión a la base de datos
│       ├── pdfReader.js         Extrae el texto de un PDF antes de mandarlo a la IA
│       └── repartoRules.js      Reglas de reparto de gastos
│
├── api/                         ← Funciones de servidor (corren en Vercel)
│   ├── analyze.js               Analiza el texto de un resumen (PDF ya leído)
│   ├── analyzePdf.js            Analiza un PDF mandándolo directo a la IA
│   ├── analyzeImage.js          Analiza una foto de un resumen
│   ├── classifyRows.js          Clasifica filas de un Excel
│   ├── cron-reclasificar.js     Tarea automática diaria (3 AM)
│   ├── cron-auditoria.js        Tarea automática semanal (sábados 1 AM)
│   ├── mp-create-subscription.js / mp-cancel-subscription.js / mp-webhook.js
│   │                            Suscripción Premium con Mercado Pago
│   ├── notify-signup.js         Mail cuando se registra alguien
│   ├── reportBug.js             Mail cuando un usuario reporta un problema
│   ├── logImport.js             Registro de importaciones
│   └── _lib/
│       ├── analyzePrompt.js     ⭐ Las instrucciones que se le dan a la IA
│       ├── plan.js              Si el usuario es Premium y cuánta IA usó
│       ├── rateLimit.js         Límite de pedidos por usuario
│       └── secretsMatch.js      Verificación de firmas/secretos
│
├── public/
│   ├── index.html               El HTML base
│   ├── manifest.json            Nombre e iconos de la app instalable (PWA)
│   ├── icon.png / logo.png / favicon.ico
│   └── robots.txt
│
├── vercel.json                  Rutas, headers de seguridad y los dos crons
├── package.json                 Librerías que usa el proyecto
├── CLAUDE.md                    Instrucciones para mí (cómo trabajar en este repo)
├── README.md                    Texto genérico que viene con Create React App
├── AUDITORIA.md                 Notas de una auditoría del código
├── LIMPIEZA_AUDIT.md            Notas de limpieza del código
└── DOCUMENTACION.md             Este archivo
```

Los ⭐ son los archivos que se tocan casi siempre.

### Las tablas de la base de datos (en Supabase)

`transactions` (movimientos), `statements` (extractos cargados), `accounts`
(cuentas y tarjetas), `user_rules` (reglas de clasificación), `user_profiles`,
`categories`, `subcategories`, `children` (hijos), `user_settings`,
`user_aliases` (alias de comercios), `user_category_icons`, `reparto_rules`,
`exchange_rates` (cotizaciones), `ai_usage` (consumo de IA por usuario),
`import_logs`.

Se ven y se editan entrando a https://supabase.com con tu cuenta → el proyecto
de ma-finance → "Table Editor".

### Claves y configuración (variables de entorno)

Están cargadas en Vercel (Settings → Environment Variables), no en el código.
Los nombres son:

| Nombre | Para qué es |
| --- | --- |
| `REACT_APP_SUPABASE_URL` | Dirección de la base de datos |
| `REACT_APP_SUPABASE_ANON_KEY` | Clave pública de Supabase (la usa el navegador) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada de Supabase (sólo servidor) |
| `SUPABASE_WEBHOOK_SECRET` | Verifica avisos que manda Supabase |
| `CLAUDE_API_KEY` | Acceso a la IA de Claude |
| `MERCADOPAGO_ACCESS_TOKEN` | Cobros de Mercado Pago |
| `MERCADOPAGO_PRICE_ARS` | Precio del plan Premium |
| `MERCADOPAGO_WEBHOOK_SECRET` | Verifica avisos de Mercado Pago |
| `RESEND_API_KEY` | Envío de mails |
| `NOTIFY_EMAIL` | A qué mail llegan los avisos |
| `CRON_SECRET` | Protege las tareas automáticas |

**Nunca** pongas estos valores dentro de un archivo del proyecto: van siempre en
el panel de Vercel (y en `.env.local` si trabajás en tu compu, que no se sube).

---

## 3. Cómo llega un cambio a la app publicada

```
cambio en el código
   → rama nueva en GitHub
   → pull request hacia master
   → merge a master
   → Vercel compila y despliega solo (1-2 minutos)
   → ya está en la app
```

La rama `master` es la que está publicada. Todo lo que entra ahí sale al aire.
Por eso los cambios no se hacen directamente sobre `master` sino en una rama
aparte, y recién cuando compila bien se mergean.
