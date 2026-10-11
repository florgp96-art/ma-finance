# Auditoría completa — octubre de 2026

Fecha: 10 de octubre de 2026. Alcance: base de datos de Supabase (Mom's Assist Finances), las 12 funciones de `api/`, todo `src/`, dependencias, build, configuración de Vercel y una recorrida de la app a 390 px.

Cómo se verificó: las fallas de permisos se probaron en la base real **dentro de una transacción que se deshizo al final** (no quedó nada cambiado), con la sesión de un usuario logueado. El resto, leyendo el código, corriendo los tests y el build, y con capturas de la app.

Leyenda: 🔴 crítico · 🟠 alto · 🟡 medio · 🔵 bajo. ✅ arreglado en código · 🗄️ arreglado en la base con la migración `supabase/migrations/20261010000000_auditoria_seguridad.sql`, **ya aplicada el 11/10** · ⏳ pendiente.

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
| 7 | Fotos y PDF de más de ~3 MB fallan con "Load failed" | 🟠 | ✅ |
| 8 | Funciones de la base ejecutables sin iniciar sesión | 🟡 | 🗄️ |
| 9 | El aviso de registro mandaba el hash de la contraseña | 🟡 | 🗄️ |
| 10 | Monedas desconocidas ("EURc") sumadas como pesos | 🟡 | ✅ (y los 10 viejos pasados a EUR) |
| 11 | El plan gratis puede usar la IA sin límite por Excel, y 10 lecturas a la vez | 🟡 | ✅ |
| 12 | Las notas de formato que aprende el lector se comparten sin revisión | 🟡 | ⏳ |
| 13 | La app pesa 623 kB comprimida y se carga entera al abrir | 🟡 | ✅ |
| 14 | `xlsx` 0.18.5 tiene fallas conocidas al abrir Excel ajenos | 🟡 | ⏳ |
| 15 | No hay CI: Vercel despliega sin correr los tests | 🟡 | ✅ |
| 16 | Contraseñas: mínimo 6 caracteres y sin control de filtradas | 🟡 | ✅ mínimo 8 · filtradas: solo plan Pro |
| 17 | El mail de auditoría de los viernes repetía todo y revisaba solo 1.000 movimientos | 🟡 | ✅ |
| 18 | Detalles menores (lista abajo) | 🔵 | varios |

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

## 🟠 7. Fotos y PDF grandes fallan con "Load failed" (✅)

**Qué pasa.**
- Vercel corta cualquier pedido de más de **4,5 MB**, y la app manda el archivo en base64 (+33 %). Una foto o un PDF de más de ~3,3 MB nunca llega.
- La pantalla de importar dice "Máx. 10MB", y `analyzePdf` acepta hasta 9,5 MB, pero esos pedidos los corta Vercel antes de llegar.
- Las fotos del celular no se achican antes de mandarse.
- En la base hay **6 importaciones fallidas con "Load failed"**.

**Hecho.**
- Las fotos se achican en el celular antes de mandarse (`src/lib/imagen.js`) al tamaño con el que la IA las lee de todos modos: 1568 px de lado y ~1,15 megapíxeles. No se pierde calidad de lectura. En la prueba, una foto de 10,8 MB se mandó en 0,47 MB.
- Un PDF que no se lee como texto y pesa más de 3 MB muestra un aviso que explica qué pasa y qué hacer, y no se intenta mandar.
- La pantalla dice "PDF, PNG o JPG", sin el "Máx. 10MB" que no era cierto.

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

**Hecho.** Los 10 movimientos que ya estaban se pasaron a EUR el 11/10. Queda pendiente agregar una restricción en la base para que no vuelva a entrar una moneda rara.

## 🟡 11. Costos de IA en el plan gratis (✅)

- `api/classifyRows.js`, la clasificación con IA al importar Excel, **no mira el plan**. Una cuenta gratis puede clasificar 500 filas por pedido, 20 pedidos por minuto, sin límite mensual.
  - ✅ Ahora el plan gratis tiene un tope de 15 clasificaciones con IA por día. Pasado el tope, el Excel se importa igual y las filas sin regla quedan para identificar, con un aviso que lo explica. Premium no cambia.
- ✅ El cupo gratis ("1 resumen con IA por mes") se anotaba **al terminar** la lectura, y diez lecturas lanzadas a la vez pasaban las diez.
  - Ahora una lectura gratis reserva su lugar antes de llamar a la IA (`reservarLecturaGratis`, atómico), y una segunda en paralelo recibe "Ya hay una lectura en curso".
  - Si la lectura falla, la reserva se suelta *antes* de responder, para que el reintento automático de la app no choque con ella.
  - Tiene tests (`lecturaGratisApi.test.js`).
- ✅ `analyzeImage` descontaba el cupo aunque no hubiera podido leer la imagen. Ahora no, igual que los otros dos endpoints.

## 🟡 12. Notas de formato compartidas sin revisión (⏳)

Cuando una segunda lectura cierra con el total, el lector guarda una "nota de formato" en `formatos_lectura`. Esa nota se usa en las lecturas de **todos** los usuarios. Alguien que suba un PDF armado a propósito podría dejar instrucciones para la IA de los demás.

**Mitigación actual:**
- hasta 300 caracteres, sin números, mails ni links;
- el prompt pide ignorar todo lo que no sea formato;
- te llega un mail con cada nota nueva.

**Recomendado:** que una nota nueva quede "pendiente" hasta que la apruebes desde ese mail.

## 🟡 13. La app pesa 623 kB comprimida (✅)

Todo va en un solo archivo de 2,2 MB (623 kB con gzip): pdf.js, xlsx y recharts se descargan aunque solo se entre a ver el resumen, y también en la pantalla de login. En el celular con datos se nota.

**Hecho.**
- Cada pantalla, pdf.js, xlsx y el reporte para la contadora se descargan cuando hacen falta. La carga inicial bajó de **623 kB a 134 kB**. En el login se baja eso más 3 kB.
- El worker de pdf.js sale de la propia app y no de cdnjs. Antes, si el CDN no respondía, el PDF se mandaba entero a la IA.
- Si alguien tenía la app abierta durante un despliegue y pide un archivo que ya no existe (`src/lib/cargaDiferida.js`):
  - se reintenta una vez;
  - si se estaba abriendo una pantalla, la app se recarga sola (una vez);
  - si estaba importando, aparece "La app se actualizó. Recargá la página".
- Probado en el navegador: PDF, Excel, reporte, login y registro.

## 🟡 14. `xlsx` 0.18.5 (⏳)

Es la última versión de SheetJS en npm, que ya no se mantiene. Tiene *prototype pollution* y ReDoS al abrir un Excel armado a propósito.

**Sigue pendiente.** La versión corregida (0.20.3) solo se publica en el CDN de SheetJS (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), y desde donde se hizo la auditoría no se pudo descargar para probar el build. Se hace con:

```
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Después hay que correr los tests. Mientras tanto el riesgo es bajo: cada usuario abre solo sus propios Excel, y desde esta auditoría xlsx se carga recién al importar o exportar.

✅ `react-router-dom` pasó a 7.18.4, que corrige su aviso de *open redirect*.

pdf.js 3.11 tiene una falla conocida (CVE-2024-4367) que **está mitigada**: se abre con `isEvalSupported: false`.

El resto del `npm audit` (117 avisos) es de las herramientas de build de Create React App y no llega al navegador del usuario. Create React App está abandonado: a mediano plazo conviene migrar a Vite.

## 🟡 15. No hay CI (✅)

No existe `.github/workflows`. Vercel despliega `master` sin correr los tests, y como los PR se mergean al toque, nada frena un cambio que rompa algo.

**Hecho:** `.github/workflows/ci.yml` ("Tests y build") corre los tests y el build en cada PR y en cada push a `master`. En GitHub, cada PR muestra si pasó.

## 🟡 16. Contraseñas (⏳, se cambia en el panel)

- La protección contra contraseñas filtradas (HaveIBeenPwned, en Authentication → Attack Protection) **solo existe en el plan Pro de Supabase**. El proyecto está en el plan gratis y no se puede activar (probado el 11/10). Si algún día se pasa a Pro, conviene prenderla.
- ⏳ Poner el mínimo de 8 caracteres también en Supabase: Authentication → Sign In / Providers → Email → Minimum password length.
- ✅ Las contraseñas nuevas piden 8 caracteres (registro, olvidé mi contraseña y cambio de contraseña). Las que ya existen siguen andando.

---

## 🟡 17. El mail de auditoría de los viernes (✅)

**Qué pasaba.**
- `api/cron-auditoria.js` mandaba todos los viernes la lista entera de hallazgos, aunque fueran los mismos de la semana anterior.
- Además leía los movimientos sin paginar: revisaba solo los primeros 1.000 de los ~7.500.

**Arreglo.**
- Lee todos los movimientos.
- Anota lo que ya avisó en `auditoria_hallazgos` (migración `20261011000000_auditoria_hallazgos.sql`, ya aplicada).
- El mail lleva solo los hallazgos nuevos, más cuántos siguen abiertos y cuántos se resolvieron. Si no hay nada nuevo, no llega mail.
- Lo que se resuelve sale de la memoria: si vuelve a pasar, se avisa de nuevo.
- La primera corrida manda un único aviso corto ("desde ahora, solo lo nuevo").
- Los textos del mail se escapan.

## 🔵 18. Detalles menores

- ✅ `api/reportBug.js`: el campo "página" iba sin escapar al HTML del mail.
- ✅ Tabla `transactions_backup_division3` (1.460 filas, un backup viejo sin uso): borrada el 11/10, con tu confirmación.
- Una categoría "Devoluciones" sin dueño (`user_id` vacío, no es del sistema). **No se borró:** la usan 9 movimientos, 6 subcategorías y 3 reglas. Funciona como categoría compartida. Lo prolijo sería marcarla como del sistema.
- ⏳ Datos para revisar con la herramienta de repetidos:
  - **8 resúmenes repetidos** (mismo cierre en la misma tarjeta): florgp96 4, bettyswarovski 3, valengp03 1;
  - **41 grupos de movimientos idénticos**: misma cuenta, fecha, monto y detalle;
  - un movimiento con monto negativo (02/06/2026).
- ⏳ Sin restricciones en `transactions.moneda`, `tipo` y `monto > 0`. Agregarlas después de limpiar lo de arriba.
- ⏳ Políticas duplicadas: `users_own_*` y "usuarios ven sus datos" hacen lo mismo. Además, `auth.uid()` se evalúa por fila. No afecta hoy (7.500 movimientos), pero sí a escala (advisor de performance). La migración suma 5 índices para las consultas de siempre.
- ⏳ **No hay forma de borrar una cuenta.** Las referencias a `auth.users` no borran en cascada, y no existe "Eliminar mi cuenta". Para la Ley 25.326 conviene tenerlo.
- ✅ `vercel.json`: `X-XSS-Protection: 0` (el valor recomendado hoy) y `Permissions-Policy` para micrófono, ubicación, pagos y USB.
- ⏳ Falta una Content-Security-Policy. Conviene hacerla con cuidado, en modo "solo reportar" primero, porque una mal armada deja la app en blanco.
- ⏳ `react-router-dom` 7.17 tiene un aviso de *open redirect*. Acá no se puede aprovechar, porque no se navega a direcciones que escriba el usuario, pero actualizar a 7.18 no cuesta nada.
- ✅ Una dirección inexistente (`/cualquier-cosa`) mostraba la pantalla en blanco: ahora lleva al inicio.
- ✅ `ConfigPanel`: la palabra clave de una regla con coma o paréntesis rompía el filtro `.or()`. Ahora va entre comillas, solo en ese caso.
- ✅ `cron-reclasificar`:
  - pagina (revisaba como máximo 1.000 movimientos sin identificar por noche);
  - ignora reglas de menos de 3 letras, que clasificaban de más;
  - ignora las preferencias guardadas en `user_rules`.
- ✅ Accesibilidad: con teclado no se veía dónde estaba el foco. Ahora botones, links, selects y casillas muestran un contorno al navegar con Tab (`:focus-visible`, no aparece al tocar).
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
