# Auditoría completa — octubre de 2026

Fecha: 10 de octubre de 2026. Alcance: base de datos de Supabase (Mom's Assist Finances), las 12 funciones de `api/`, todo `src/`, dependencias, build, configuración de Vercel y una recorrida de la app a 390 px.

Cómo se verificó: las fallas de permisos se probaron en la base real **dentro de una transacción que se deshizo al final** (no quedó nada cambiado), con la sesión de un usuario logueado. El resto, leyendo el código, corriendo los tests y el build, y con capturas de la app.

Leyenda: 🔴 crítico · 🟠 alto · 🟡 medio · 🔵 bajo. ✅ arreglado en este PR · 🗄️ arreglado en la migración `supabase/migrations/20261010000000_auditoria_seguridad.sql` · ⏳ pendiente.

---

## Resumen

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | Cualquier usuario puede hacerse Premium desde el navegador | 🔴 | 🗄️ |
| 2 | No se pueden crear, renombrar ni borrar categorías propias | 🟠 | 🗄️ |
| 3 | Cualquier usuario puede cambiar las cotizaciones de todos | 🟠 | 🗄️ |
| 4 | Un pago abandonado en Mercado Pago impide volver a suscribirse | 🟠 | ✅ |
| 5 | Después de las 21 h la app toma la fecha de mañana | 🟠 | ✅ |
| 6 | Cambios de preferencias (incluido el reparto entre socios) que se perdían | 🟠 | ✅ |
| 7 | Fotos y PDF de más de ~3 MB fallan con "Load failed" | 🟠 | ⏳ |
| 8 | Funciones de la base ejecutables sin iniciar sesión | 🟡 | 🗄️ |
| 9 | El aviso de registro mandaba el hash de la contraseña | 🟡 | 🗄️ |
| 10 | Monedas desconocidas ("EURc") sumadas como pesos | 🟡 | ✅ lo nuevo · ⏳ 10 movimientos viejos |
| 11 | El plan gratis puede usar la IA sin límite por Excel, y 10 lecturas a la vez | 🟡 | ⏳ decisión |
| 12 | Las notas de formato que aprende el lector se comparten sin revisión | 🟡 | ⏳ |
| 13 | La app pesa 623 kB comprimida y se carga entera al abrir | 🟡 | ⏳ |
| 14 | `xlsx` 0.18.5 tiene fallas conocidas al abrir Excel ajenos | 🟡 | ⏳ |
| 15 | No hay CI: Vercel despliega sin correr los tests | 🟡 | ⏳ |
| 16 | Contraseñas: mínimo 6 caracteres y sin control de filtradas | 🟡 | ⏳ (panel) |
| 17 | Detalles menores (lista abajo) | 🔵 | varios |

---

## 🔴 1. Cualquier usuario puede hacerse Premium

**Qué pasa.** La tabla `user_profiles` tiene una política que deja a cada usuario editar su propia fila, y eso incluye las columnas `plan`, `is_legacy` y `premium_hasta`. Con la sesión de cualquier cuenta gratis alcanza una línea en la consola del navegador:

```js
supabase.from('user_profiles').update({ plan: 'premium' }).eq('id', miId)
```

**Comprobado:** el `update` modificó la fila (en una transacción que se deshizo).

**Qué abre.** Cuentas ilimitadas: el trigger `enforce_account_limit` lee ese mismo `plan`. Y lecturas con IA ilimitadas: `api/_lib/plan.js` también lo lee. Eso es plata de Anthropic que paga la app, sin cobrar la suscripción.

**Arreglo (🗄️).** Se le sacan a los usuarios los permisos de escribir `user_profiles`, salvo crear su perfil vacío, que es lo único que hace la app (`Onboarding.js`: `upsert({ id })`). El plan lo escriben solo las funciones de Mercado Pago, con la service role. Probado:
- el `update` del plan da *permission denied*;
- el alta del perfil sigue andando;
- un alta con `plan: 'premium'` queda bloqueada.

## 🟠 2. No se pueden crear, renombrar ni borrar categorías propias

**Qué pasa.** `categories` solo tiene política de lectura. Hay cinco acciones de la app que fallan siempre:
- crear una categoría en Configuración: *new row violates row-level security policy*;
- renombrarla;
- cambiarle el tipo;
- borrarla;
- crear la categoría "Mascotas" del onboarding, que falla sin avisar.

Las 5 categorías propias que existen son de antes de que cambiara la política.

**Arreglo (🗄️).** Políticas para crear, editar y borrar solo las categorías propias que no son del sistema. Probado:
- crear, renombrar y borrar funcionan;
- las del sistema no se pueden tocar;
- no se puede crear una categoría marcada como del sistema.

## 🟠 3. Cualquier usuario puede cambiar las cotizaciones de todos

**Qué pasa.** `exchange_rates` es compartida. Sus políticas de alta y edición eran `true`: cualquier usuario podía editar las 121 cotizaciones, de cualquier mes y tipo. Eso cambia las conversiones a pesos de todos los usuarios.

**Arreglo (🗄️).** Lo único que guarda la app es el euro del mes en curso (`fetchDolarRates`), así que eso es lo único que queda permitido:
- tipo `euro`;
- mes actual, con un día de margen por las zonas horarias;
- valor entre 100 y 100.000.

Probado: el euro del mes se guarda, y el resto queda bloqueado.

## 🟠 4. Un pago abandonado impide volver a suscribirse

**Qué pasa.** Al tocar "Suscribirme" se crea la suscripción en Mercado Pago en estado `pending`. Si la persona cierra el checkout sin pagar, `mp_status` queda en `pending`, y el siguiente intento devolvía **409, "Ya tenés una suscripción activa o pendiente"**. Queda trabada sin poder pagar.

**Arreglo (✅ `api/mp-create-subscription.js`).** Si hay una suscripción `pending`, se consulta a Mercado Pago:
- si sigue pendiente, se manda a la persona al mismo checkout (no se crea una segunda);
- si ya está autorizada, 409;
- si venció o se canceló, se crea una nueva.

## 🟠 5. Después de las 21 h, "hoy" era mañana

**Qué pasa.** En 9 lugares el día o el mes actual salía de `new Date().toISOString()`, que da la fecha en UTC: en Argentina, de 21 a 24 h ya es el día siguiente.
- "Cargar movimiento" proponía la fecha de mañana. Un gasto cargado a las 22 del 31 quedaba en el mes siguiente.
- El mes de "A pagar", de las cotizaciones y de los vencimientos marcados como pagados se corría un mes en la última noche del mes.
- El saldo de una cuenta aceptaba una fecha de mañana.

**Arreglo (✅).** `hoyLocal()` y `mesLocal()` en `src/lib/formato.js`, usados en el Dashboard y en SaldoCuenta. Tiene tests.

## 🟠 6. Preferencias que se perdían

**Qué pasa.** `persistPref` (metas, ahorro, **reparto entre socios**, incluido "de quién es el laburo") esperaba 0,8 s antes de guardar. Si en ese lapso se cerraba la app o se cambiaba de pestaña en el celular, el cambio no se guardaba. Y si Supabase devolvía error, no se avisaba.

**Arreglo (✅).**
- Lo pendiente se manda al ocultar la página (`visibilitychange` / `pagehide`) y al salir del Dashboard.
- Si falla, aparece un aviso.
- Usa la sesión guardada en vez de ir a la red, para que alcance a salir.

## 🟠 7. Fotos y PDF grandes fallan con "Load failed" (⏳)

**Qué pasa.**
- Vercel corta cualquier pedido de más de **4,5 MB**, y la app manda el archivo en base64 (+33 %). Una foto o un PDF de más de ~3,3 MB nunca llega.
- La pantalla de importar dice "Máx. 10MB", y `analyzePdf` acepta hasta 9,5 MB, pero esos pedidos los corta Vercel antes de llegar.
- Las fotos del celular no se achican antes de mandarse.
- En la base hay **6 importaciones fallidas con "Load failed"**.

**Propuesta.**
1. Achicar las fotos en el celular antes de mandarlas: canvas, lado mayor de 2000 px, JPEG al 85 %. Una foto de 4 MB queda en ~400 kB.
2. Si un PDF pasa los 3 MB y no se puede leer como texto, avisar con un mensaje claro en vez de "Load failed".
3. Corregir el "Máx. 10MB".

## 🟡 8. Funciones de la base ejecutables sin iniciar sesión

**Qué pasa.** `consume_rate_limit`, `enforce_account_limit`, `notify_new_signup` y `rls_auto_enable` son `SECURITY DEFINER` y se podían llamar desde `/rest/v1/rpc/...` sin login.
- La que importa es `consume_rate_limit`: dejaba agotarle el límite de uso a otro usuario o llenar la tabla `rate_limits`.
- Las otras tres son de triggers.

**Arreglo (🗄️).** Se les quita el permiso a `anon` y `authenticated`. Los endpoints usan la service role, que lo conserva. Verificado en un Postgres local: los triggers se siguen disparando sin ese permiso. También se les fija el `search_path` (advisor de Supabase).

## 🟡 9. El aviso de registro mandaba el hash de la contraseña

**Qué pasa.** El trigger `notify_new_signup` mandaba `row_to_json(new)` de `auth.users` a `/api/notify-signup`. Eso incluye `encrypted_password` y los tokens de confirmación. El endpoint solo usa el mail, el nombre y la fecha. Además:
- el secreto del header estaba escrito en el código de la función;
- si el aviso fallaba, podía trabar el registro.

**Arreglo (🗄️).**
- Manda solo id, mail, nombre y fecha.
- El secreto pasa al **Vault** de Supabase: se copia de la función actual al correr la migración, así no queda en el repo.
- Si el aviso falla, se anota en el log y el registro sigue.

**Recomendado después:** cambiar ese secreto en el Vault y en `SUPABASE_WEBHOOK_SECRET` de Vercel, porque estuvo escrito en el código de la función.

## 🟡 10. Monedas desconocidas sumadas como pesos

**Qué pasa.** Hay **10 movimientos de valengp03 en "EURc"** (Revolut). La app solo conoce ARS, USD y EUR, y cualquier otra moneda la sumaba como pesos: € 50 contaban como $ 50.

**Arreglo (✅).** `normalizarMoneda()` lleva lo que lee la IA a ARS, USD o EUR. Por ejemplo, EURc → EUR y USDT → USD.

**Pendiente (⏳).** Corregir los 10 movimientos que ya están (`update transactions set moneda = 'EUR' where moneda = 'EURc'`). Después, agregar una restricción en la base para que no vuelva a entrar una moneda rara.

## 🟡 11. Costos de IA en el plan gratis (⏳ decisión)

- `api/classifyRows.js`, la clasificación con IA al importar Excel, **no mira el plan**. Una cuenta gratis puede clasificar 500 filas por pedido, 20 pedidos por minuto, sin límite mensual.
  - Si "Excel sin límite" incluye la IA, es una decisión de negocio. Si no, conviene limitarlo o clasificar solo con las reglas.
- El cupo gratis ("1 resumen con IA por mes") se anota **al terminar** la lectura. Diez lecturas lanzadas a la vez pasan las diez. Se arregla reservando el cupo antes de llamar a la IA.
- ✅ `analyzeImage` descontaba el cupo aunque no hubiera podido leer la imagen. Ahora no, igual que los otros dos endpoints.

## 🟡 12. Notas de formato compartidas sin revisión (⏳)

Cuando una segunda lectura cierra con el total, el lector guarda una "nota de formato" en `formatos_lectura`. Esa nota se usa en las lecturas de **todos** los usuarios. Alguien que suba un PDF armado a propósito podría dejar instrucciones para la IA de los demás.

**Mitigación actual:**
- hasta 300 caracteres, sin números, mails ni links;
- el prompt pide ignorar todo lo que no sea formato;
- te llega un mail con cada nota nueva.

**Recomendado:** que una nota nueva quede "pendiente" hasta que la apruebes desde ese mail.

## 🟡 13. La app pesa 623 kB comprimida (⏳)

Todo va en un solo archivo de 2,2 MB (623 kB con gzip): pdf.js, xlsx y recharts se descargan aunque solo se entre a ver el resumen, y también en la pantalla de login. En el celular con datos se nota.

**Propuesta:** cargar pdf.js y xlsx recién cuando se importa o se exporta (`import()` dinámico), y separar Login/Registro del Dashboard. Se estima que la carga inicial baja ~40 %.

## 🟡 14. `xlsx` 0.18.5 (⏳)

Es la última versión de SheetJS en npm, que ya no se mantiene. Tiene *prototype pollution* y ReDoS al abrir un Excel armado a propósito. Ahora que la idea es que clientes de una contadora suban sus archivos, conviene pasar a 0.20.3 desde el CDN oficial de SheetJS.

pdf.js 3.11 tiene una falla conocida (CVE-2024-4367) que **está mitigada**: se abre con `isEvalSupported: false`.

El resto del `npm audit` (117 avisos) es de las herramientas de build de Create React App y no llega al navegador del usuario. Create React App está abandonado: a mediano plazo conviene migrar a Vite.

## 🟡 15. No hay CI (⏳)

No existe `.github/workflows`. Vercel despliega `master` sin correr los tests, y como los PR se mergean al toque, nada frena un cambio que rompa algo.

**Propuesta:** un GitHub Action que corra `npm test` y el build en cada PR. Corre gratis.

## 🟡 16. Contraseñas (⏳, se cambia en el panel)

- La protección contra contraseñas filtradas (HaveIBeenPwned) está desactivada: Supabase → Authentication → Policies/Passwords.
- El registro acepta contraseñas de 6 caracteres; lo recomendado es 8.

---

## 🔵 17. Detalles menores

- ✅ `api/reportBug.js`: el campo "página" iba sin escapar al HTML del mail.
- ⏳ Tabla `transactions_backup_division3` (1.460 filas): es un backup viejo sin uso. Se puede borrar.
- ⏳ Una categoría "Devoluciones" sin dueño (`user_id` vacío, no es del sistema). La política la deja ver a todos, aunque la app no la muestra.
- ⏳ Datos para revisar con la herramienta de repetidos:
  - **8 resúmenes repetidos** (mismo cierre en la misma tarjeta): florgp96 4, bettyswarovski 3, valengp03 1;
  - **41 grupos de movimientos idénticos**: misma cuenta, fecha, monto y detalle;
  - un movimiento con monto negativo (02/06/2026).
- ⏳ Sin restricciones en `transactions.moneda`, `tipo` y `monto > 0`. Agregarlas después de limpiar lo de arriba.
- ⏳ Políticas duplicadas: `users_own_*` y "usuarios ven sus datos" hacen lo mismo. Además, `auth.uid()` se evalúa por fila. No afecta hoy (7.500 movimientos), pero sí a escala (advisor de performance). La migración suma 5 índices para las consultas de siempre.
- ⏳ **No hay forma de borrar una cuenta.** Las referencias a `auth.users` no borran en cascada, y no existe "Eliminar mi cuenta". Para la Ley 25.326 conviene tenerlo.
- ⏳ `vercel.json`: falta una Content-Security-Policy, y `X-XSS-Protection` ya no hace nada en los navegadores actuales.
- ⏳ `react-router-dom` 7.17 tiene un aviso de *open redirect*. Acá no se puede aprovechar, porque no se navega a direcciones que escriba el usuario, pero actualizar a 7.18 no cuesta nada.
- ⏳ Una dirección inexistente (`/cualquier-cosa`) muestra la pantalla en blanco: falta una ruta comodín.
- ⏳ `ConfigPanel`: la palabra clave de una regla va sin escapar dentro de un filtro `.or()`. Una coma en la palabra rompe el conteo de pendientes.
- ⏳ `cron-reclasificar` no pagina: cada noche revisa como máximo 1.000 movimientos sin identificar. Además, una regla muy corta (ej. "MP") puede clasificar de más.
- ⏳ Accesibilidad: 46 campos con `outline: none` y ningún estilo de foco. Con teclado no se ve dónde estás.
- ⏳ Mantenimiento: `Dashboard.js` tiene 6.100 líneas y 115 `useState`, y `AccountDetail.js` 5.100. Hay ayudantes repetidos: `hoyLocal` en 5 archivos, `fetchAllPages` en 3.
- Un usuario de los 12 no tiene perfil. No traba nada: se lo toma como plan gratis.

---

## Lo que se revisó y está bien

- **Los datos de cada usuario quedan aislados.** Todas las tablas con datos personales tienen RLS por `user_id`. No hay movimientos ni resúmenes de un usuario colgados de una cuenta de otro, ni movimientos huérfanos.
- **Endpoints.** Los 12 validan el token, salvo los crons y webhooks, que usan secreto comparado en tiempo constante. El límite de uso es compartido entre instancias. El webhook de Mercado Pago no le cree al aviso: vuelve a consultar el estado real.
- **Sin inyección de HTML.** No hay `dangerouslySetInnerHTML` ni `eval`, y los mails escapan lo que manda el usuario (salvo el caso de `reportBug`, ya arreglado).
- **Sin secretos en el repo.** `.env` está ignorado.
- **Consultas largas paginadas.** Las de movimientos pasan las 1.000 filas sin perder datos (`fetchAllTxPages`).
- **pdf.js** se abre con `isEvalSupported: false`.
- **Celular.** A 390 px no hay desbordes horizontales en el inicio, "Cargar movimiento", el detalle de una tarjeta ni Configuración. Lo de iOS no se pudo probar acá (no hay WebKit).
- **Tests y build.** 458 tests pasan (incluido `revisarLecturaApi`, que necesita `npm install` para el SDK de Anthropic) y el build no tiene warnings.
