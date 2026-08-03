# ma-finance — estado y trabajo pendiente

> Documento de traspaso. Escrito al cerrar la sesión del 1 de agosto de 2026,
> actualizado el 3 de agosto.
> Para arrancar una sesión nueva: leé este archivo y seguí desde la sección 2.

---

## Contexto del proyecto

App de finanzas personales, **React (CRA) + Supabase**, desplegada en **Vercel**
automáticamente desde `master`. Serverless functions en `/api`. La app tiene un mes de
vida; los datos van hasta febrero 2026 porque se importó historial.

**Flujo de trabajo autorizado de forma permanente** (está en `CLAUDE.md`): al terminar
cualquier cambio, verificar el build con `CI=true npx react-scripts build`, commitear y
pushear a la rama de la sesión, crear el PR a `master` y **mergearlo inmediatamente con
squash sin pedir confirmación**, y avisar que ya quedó en `master`.

**No hay credenciales de Supabase en la sesión de Claude** (viven en las env vars de
Vercel). Todo trabajo sobre la base se entrega como SQL para que el dueño lo corra,
**pegado como texto en el chat, nunca como archivo para descargar**.

---

## 1. Dos migraciones de base sin correr

### a) Fechas del próximo ciclo de la tarjeta — **subió de prioridad el 3 de agosto**

```sql
alter table statements add column if not exists proximo_cierre date;
alter table statements add column if not exists proximo_vencimiento date;
```

Muchos resúmenes traen, además de su propio cierre y vencimiento, las fechas del ciclo
siguiente ("Próximo cierre 13-Ago-26 / Próximo vencimiento 21-Ago-26"). El prompt de la
IA ya las lee y el guardado vive en `handleGuardar` de `src/pages/Dashboard.js`. Sin las
columnas el insert se reintenta sin ellas y no falla nada.

Ya no es solo "se pierde un dato opcional": desde el corte de ciclo (#285) esta fecha es
**lo único con lo que la app puede saber que un ciclo cerró**. Sin ella no parte el ciclo
ni suma nada a "Te falta pagar" — se limita a avisar con una estimación. Ver
`cicloAbiertoDe` en `src/components/AccountDetail.js`.

**Los ciclos de tarjeta NO son mensuales, y por eso no se pueden estimar.** Fechas reales
de los resúmenes de julio de 2026:

| Tarjeta | Cierre anterior | Cierre actual | Próximo cierre | Próximo vencimiento |
| --- | --- | --- | --- | --- |
| Visa Galicia | 18-Jun | 16-Jul | 13-Ago | 21-Ago |
| Mastercard Galicia | 11-Jun | 08-Jul | **27-Ago** | 04-Sep |
| Mercado Pago | — | ~21-Jul | 18-Ago | 24-Ago |

La Mastercard va 27 días de un ciclo y **50 del siguiente**. Estimar "un mes" le erra por
19 días: la app habría dado ese ciclo por cerrado el 8 de agosto y mostrado un resumen que
no existe. De ahí la regla: **con fecha estimada se avisa, nunca se afirma que cerró.**

Para chequear si ya está corrida:

```sql
select column_name from information_schema.columns
where table_name = 'statements' and column_name like 'proximo_%';
```

Y para ver cuántos resúmenes tienen efectivamente el dato (solo lo van a tener los
importados después de la migración):

```sql
select count(*) total, count(proximo_cierre) con_proximo_cierre from statements;
```

### b) Rate limit compartido — **esta es la que más conviene**

```sql
create table if not exists rate_limits (
  key      text primary key,
  count    integer     not null default 0,
  reset_at timestamptz not null
);

alter table rate_limits enable row level security;
-- Sin políticas a propósito: solo la clave de servicio la toca, nunca el cliente.

create or replace function consume_rate_limit(p_key text, p_limit integer, p_window_ms integer)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  insert into rate_limits (key, count, reset_at)
  values (p_key, 1, now() + (p_window_ms || ' milliseconds')::interval)
  on conflict (key) do update
    set count    = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at < now()
                        then now() + (p_window_ms || ' milliseconds')::interval
                        else rate_limits.reset_at end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
```

`api/_lib/rateLimit.js` ya la llama. Hasta que exista, cae a un contador en memoria por
instancia de Vercel, o sea que **el límite de las llamadas a Claude no limita nada** y
cada request que se cuela cuesta plata.

Conviene además limpiar filas viejas de vez en cuando:

```sql
delete from rate_limits where reset_at < now() - interval '1 day';
```

---

## 2. Tareas de código, en orden de valor

### a) Revisar las cuatro pantallas vacías que ve un cliente nuevo

De siete bugs encontrados en la última auditoría, casi todos eran casos borde que nadie
prueba. Faltan estos cuatro estados vacíos, que un cliente nuevo ve el primer día:

- una cuenta recién creada sin movimientos
- un mes sin datos
- una categoría sin gastos
- un hijo sin nada asignado

Buscar ceros sin sentido, `NaN`, guiones raros y widgets vacíos sin explicación. Ejemplo
del tipo de cosa que sale: la etiqueta del selector de meses decía literalmente
"0 meses" al destildar todos los meses.

### b) Fase 3 — asistente de IA financiero con tool-calling

La feature grande que falta. Nunca se empezó. La idea es un asistente que pueda consultar
los movimientos del usuario con herramientas (tool-calling) y responder preguntas sobre
sus finanzas. Ya existen `api/analyze.js`, `api/analyzePdf.js` y `api/analyzeImage.js`
como referencia de cómo se llama a Claude, y `api/_lib/plan.js` para chequear si el
usuario tiene plan Premium.

### c) Fetch duplicado de transacciones

Al abrir la app se piden **las mismas transacciones de todas las cuentas dos veces**:

- `fetchGlobalWidgetsData` en `src/pages/Dashboard.js` — alimenta los widgets del
  costado, escucha `[accounts]`
- `fetchAllData` en `src/components/AccountDetail.js` — alimenta la tabla, escucha
  `refreshKey`

Es lo que hace que la carga se sienta lenta.

**Cuidado**: `accountTransactions` en Dashboard tiene dos escritores — ese fetch global y
el `onTransactionsLoaded` que le pasa el `AccountDetail` montado. Al unificar hay que no
romper los widgets del costado, que dependen de ver **todas** las cuentas.

### d) Refactor de los 111 colores a `src/theme.js`

Hay 111 colores hex distintos repartidos a mano, **47 usados una sola vez**, con grupos
casi idénticos entre sí: `#f0f0f0` / `#f3f3f3` / `#f5f5f5`, y cuatro malvas a un punto de
diferencia.

`src/theme.js` ya tiene `paleta(dark)` y `leerDarkMode()`, y `src/pages/Onboarding.js` ya
sale entero de ahí — es el modelo a seguir. Faltan `Dashboard.js`, `AccountDetail.js`,
`ConfigPanel.js`, `HijoDetail.js` y `CashView.js`. Sin riesgo funcional, solo volumen.

### e) Confirmar el mail de aviso de altas de cuenta

Con un signup nuevo de verdad, verificar de punta a punta que llega el mail a
`NOTIFY_EMAIL`. Nunca se comprobó.

---

## 3. Cosas del dueño, no de código

- **Probar la cancelación de la suscripción.** El pago real ya se probó y funcionó. Falta
  cancelar y verificar: que quede `plan='premium'` con `premium_hasta` = la fecha del
  próximo pago cacheada en `mp_next_payment_date`, que siga siendo Premium hasta esa
  fecha, y que después caiga a `free` perdiendo PDFs e IA pero **conservando las
  cuentas**. Ver `api/mp-cancel-subscription.js`.

- **Nombre de fantasía en Mercado Pago**, para que el checkout no muestre el nombre
  personal del dueño. Es una configuración de la cuenta de MP, no de la app: lo único que
  manda el código es el concepto (`reason` en `api/mp-create-subscription.js`).

---

## 4. Lo que hay que saber antes de tocar código

**El patrón que ya rompió seis veces: la misma regla escrita en dos lugares, una
actualizada y la otra no.** Casos vividos: matcheo de alias en Excel vs PDF, proyección de
cuotas en CashView vs Dashboard, detección de duplicados, corrección de fechas de cuotas,
`esAlquilerOExpensas`, y el limitador de rate limit copiado en tres endpoints de Mercado
Pago. **Cuando dos pantallas no cierren un número, la primera hipótesis es esta.** Al
arreglar, extraer a un módulo compartido, no parchear la copia.

**`src/lib/cuotas.js` es la única fuente de verdad de las cuotas.** Reconstruye compras a
partir de las filas sueltas con union-find: dos filas son de la misma compra si arrancan a
dos meses o menos y coincide el monto (±$1, solo centavos de redondeo), **o** si arrancan
exactamente el mismo mes y coincide el nombre. Exporta `cuotasParaCrear` (las que faltan
crear), `cuotasFuturasCargadas` (las que todavía se deben) y `addMeses`.

**Una cuota es una unidad MENSUAL, y todos los cortes van por mes.** El día que lleva una
cuota es el de la compra original arrastrado mes a mes por `addMeses`: es una etiqueta de
mes, no una fecha real de nada. **Nunca compares el día de una cuota contra nada** — ni
contra hoy, ni contra el cierre de la tarjeta. Una compra de julio en tres cuotas se paga
en julio, agosto y septiembre, y que la tarjeta cierre el 9 o el 20 no corre ninguna de
esas cuotas al mes siguiente: la cuota de agosto la factura el resumen de agosto.

La regla vive en **`cuotaEnCiclo` (`src/lib/cuotas.js`)** y la usan los dos lugares que
ubican una cuota en un ciclo: `perteneceCicloActual` y `perteneceAlCierre`
(reconciliarSueltas). Si necesitás la regla en un tercer lado, llamá a esa función; no la
vuelvas a escribir. De ahí sale la convención de toda la app: **el mes de una cuota es el
mes de CIERRE del resumen que la factura.**

El mes en curso es deuda de este ciclo y se ve en "A pagar"; el widget de cuotas arranca
en el mes siguiente. Sin huecos ni solapamiento.

**Y si un resumen cargado facturó la cuota, decide ese resumen, no la fecha.** Pendiente
si el resumen debe, no pendiente si ya se pagó. El saldo se mira **por moneda**: un
resumen puede estar pagado en pesos y seguir debiendo dólares, y con eso marcaba como
impagas todas las cuotas en pesos de la tarjeta.

**Fechas de cuotas:** la cuota N se fecha **derivando de la compra**,
`compra + (N−1) meses`, nunca de la fecha del resumen — si no, cargar resúmenes viejos
para armar historial genera duplicados. El día se recorta al último del mes destino
(31/01 + 1 mes = 28/02) y cada cuota se calcula desde la compra, no desde la cuota
anterior, así marzo vuelve al 31.

**Nunca usar `toISOString()` para fechas.** Pasa por UTC y corre un día o un mes. Armar el
string a mano con los getters locales. Ya se arregló cuatro veces en distintos archivos.

**Cuotas futuras son un dato nuevo en la app:** hay movimientos con fecha posterior a hoy.
Cualquier vista que filtre "por mes" sin mirar el día va a contar como pasado algo que no
ocurrió. Ya pasó en el Resumen mensual de `CashView.js`.

**El desfasaje de un mes:** la app fecha la cuota 1 el día de la compra, y el banco la
cobra al mes siguiente. Es una decisión tomada, no un bug — pero explica por qué el mes de
la app va un mes adelantado respecto de los cuadraditos "Cuotas a vencer" del resumen.

**Paginación de Supabase:** tope de 1000 filas. Toda query grande tiene que paginar **y**
ordenar por una columna que desempate por completo (`.order('fecha').order('id')`), o
entre páginas se duplican y se pierden filas.

**Modelo de reparto:** un gasto dividido guarda la metadata en la columna JSON `reparto`
de la propia fila (no en filas separadas), y `child_id` es la asignación 100% a un hijo.
Son dos mecanismos distintos. Las reglas viven en `reparto_rules` y se aplican en cada
punto de ingesta con `aplicarReglasReparto` de `src/lib/repartoRules.js`.

**Un gasto asignado a un hijo no cuenta en el total de su categoría** — es a propósito,
para no contarlo dos veces. Los hijos cuentan con lo suyo, la categoría con lo que no es
de nadie.

**Al crear una tabla nueva en Supabase, crearle las políticas de RLS.** `reparto_rules`
estuvo un mes con RLS activado y cero políticas: la función existía en la app pero la base
denegaba todo, en silencio. Verificar con:

```sql
select c.relname as tabla_bloqueada
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  );
```

`ai_usage`, `import_logs` y `transactions_backup_division3` aparecen ahí y **está bien
así**: las escribe el servidor con la clave de servicio, que saltea RLS. Si el cliente
pudiera tocar `ai_usage`, borraría su contador y tendría IA gratis infinita.

**La auditoría semanal** (`api/cron-auditoria.js`) manda un mail los lunes con datos
imposibles: duplicados, cuotas que suben sin justificación, "cuota 5 de 3", USD/EUR sin
tipo de cambio, repartos que suman más que el gasto, gastos sueltos con fecha futura y la
misma cuota cargada dos veces. **No detecta bugs de código, solo síntomas en los datos.**

---

## 5. Qué se hizo

Para no volver a proponer algo que ya está hecho.

### 3 de agosto de 2026 (#284, #285)

**El corte de ciclo, que no existía.** El "Resumen abierto" iba del último cierre conocido
hasta HOY, sin techo, y lo único que lo cerraba era importar el PDF siguiente: si no
llegaba, el ciclo tragaba compras para siempre y mezclaba lo ya facturado con lo que no.
Como un resumen abierto está excluido de "Te falta pagar" por diseño, la pantalla llegó a
mostrar $ 0 con millones vencidos. Ahora el ciclo tiene techo (`cicloAbiertoDe`), y si ya
cerró sin PDF la tarjeta se parte en dos tramos, con los pagos posteriores achicando el
cerrado. Suma a "Te falta pagar" solo si el cierre lo informó el banco.

**Las cuotas pasaron a cortarse por mes** en los dos lados, y un resumen ya pagado da de
baja sus cuotas en el acto (ver sección 4). Antes el mes en curso no desaparecía del
widget: se derretía día a día según qué día habías comprado.

**Primeros tests reales del proyecto**: `src/lib/cuotas.test.js` y
`src/components/AccountDetail.test.js`. Se sacó `src/App.test.js`, el de ejemplo de CRA,
que fallaba siempre y dejaba la suite en rojo.

### 1 de agosto de 2026 (26 PRs, #257 a #282)

**Cuotas — el hilo largo.** Una sola fuente de verdad: los movimientos. Las cuotas futuras
se crean solas al importar un resumen, y el widget y la card de Caja leen la base en vez de
proyectar. Agrupar por "mismo mes de arranque". Tolerancia de monto de 2% a centavos.
Detección de duplicados que iba a duplicar las 15 cuotas generadas.

**Resúmenes y pagos.** Selector "El resumen / Carga parcial" al importar. El resumen
abierto ya no cuenta cuotas futuras ni las ya facturadas. Sobrepago falso (saldo a favor
del banco) y reintegros contados como pagos. Euros convertidos donde se sumaban como pesos.

**Interfaz.** Filtro por columna tipo Excel, con moneda. Editar cuotas y fechas desde la
fila. Corte a 10 movimientos en todas las pantallas. El año en fechas de otros años. Modo
oscuro en el onboarding, que no lo tenía. 42 grises que no se adaptaban al tema.

**Infraestructura.** Rate limit compartido entre instancias y seis chequeos nuevos en la
auditoría semanal.

**En la base:** 9 planes de cuotas cerrados, 15 cuotas agregadas, 255 divisiones sacadas,
7 OSDE unificados, 6 duplicados borrados, 2 fichas de resumen falsas, y las reglas de
reparto desbloqueadas después de un mes muertas.
