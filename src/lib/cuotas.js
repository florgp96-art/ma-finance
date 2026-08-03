// Único lugar que sabe reconstruir "compras en cuotas" a partir de las filas
// sueltas de cada cuota. Antes esta lógica estaba duplicada en Dashboard.js
// (widget "Cuotas pendientes") y en CashView.js (card "Cuotas comprometidas a
// futuro"), y las dos copias se desincronizaron: el fix de la clave de
// agrupación se aplicó en una sola, así que las dos vistas mostraban totales
// distintos para lo mismo (una infla la deuda futura respecto de la otra).

// El banco pega el sufijo de cuota al nombre de cada fila ("Compra 3/12"), que
// cambia en cada cuota de la MISMA compra real — sin sacarlo, cada cuota ya
// facturada se cuenta como una compra aparte.
export const stripCuotaSuffix = (n) => (n || '')
  // Algunos resúmenes lo escriben en palabras y en medio del nombre, no como
  // "N/M" al final: "AYNOTDEAD RECOLETA (cuota 1 de 3) 1/3". Sin sacar esa parte
  // quedaba en el nombre mostrado, y además hacía que la misma compra leída de
  // otro resumen (que sí usa "N/M") no se reconociera como la misma.
  .replace(/\(?\s*cuotas?\s+\d+\s+de\s+\d+\s*\)?/gi, ' ')
  .replace(/\s+\d+\/\d+\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim()

// Además del "N/M" final, se saca un posible prefijo de titular adicional tipo
// "BETTY — " / "FEDERICO — ": la misma compra real a veces se lee con ese
// prefijo y a veces sin él según el resumen, y si no se normaliza queda como
// dos compras distintas.
export const normalizarNombreCompra = (n) => stripCuotaSuffix(n)
  .replace(/^.+?\s+[—-]\s+/, '')
  .toLowerCase()

// Alquiler/expensas puede quedar cargado con cuotas_total/cuota_numero (ej.
// para trackear los meses de un contrato), pero no es una compra financiada con
// fecha de fin real: es un gasto fijo recurrente que no corresponde proyectar
// (y que ni siquiera está garantizado que se pague todos los meses).
//
// Se reconoce por el NOMBRE de la subcategoría y no por un id, porque cada
// usuario tiene sus propias categorías: las que vienen por defecto se llaman así,
// pero alguien puede renombrarlas o armar las suyas. Por eso no se exige que la
// categoría padre sea "Casa" — con que la subcategoría diga alquiler o expensas
// alcanza, aunque el usuario la haya puesto bajo "Vivienda" o "Fijos". Es más
// tolerante que atarlo a un nombre exacto de categoría, que dejaba de aplicar en
// silencio en cuanto el cliente no usaba las categorías por defecto.
const SUBCATS_GASTO_FIJO = ['alquiler', 'expensas']
export const esAlquilerOExpensas = (t) => {
  const sub = (t.subcategories?.nombre || '').trim().toLowerCase()
  return SUBCATS_GASTO_FIJO.includes(sub)
}

// Las compras se agrupan por CUENTA + CANTIDAD DE CUOTAS + MONTO DE LA CUOTA,
// no por nombre.
//
// El nombre no sirve como identificador: el mismo plan de cuotas viene escrito
// distinto en cada resumen. Casos reales vistos en producción:
//   "Perfume Mama CUOTA 3/9"                  vs  "CUOTA 3/9"
//   "AYNOTDEAD RECOLETA (cuota 1 de 3) 1/3"   vs  "AYNOTDEAD RECOLETA 2/3"
// Agrupando por nombre, cada variante era una "compra" aparte que proyectaba sus
// propias cuotas restantes — así el widget listaba como pendientes cuotas que ya
// estaban cargadas (con el monto exacto), y la deuda futura salía inflada.
//
// El monto de la cuota sí es invariante en un plan de cuotas fijas, que es cómo
// se financia en la práctica. La única diferencia admitida son CENTAVOS de
// redondeo: cuando el total no es divisible, el banco ajusta la última cuota
// ($221.000 en 3 → 73.666,67 / 73.666,67 / 73.666,66). Si dos filas difieren en
// más que eso, son compras distintas y no hay que unirlas.
//
// Antes la tolerancia era del 2%, y a esa distancia entran compras que no tienen
// nada que ver: MUNECOS $57.800 y Norte Sport $58.333,34 (0,9%), ROPA $41.837 y
// UTN $42.587,68 (1,76%). Cada fusión de esas hacía que la compra nueva pareciera
// completa y el widget dejara de avisar sus cuotas.
//
// Contrapartida asumida: dos compras DISTINTAS en la misma tarjeta, con la misma
// cantidad de cuotas, arrancadas el mismo mes y con el mismo monto por cuota, se
// cuentan como una. Es mucho menos frecuente que la inconsistencia de nombres.
const TOLERANCIA_MONTO_PESOS = 1

// PASO 1 — juntar las partes de una misma cuota. Un gasto dividido entre hijos
// (regla de tipo "split") queda como varias filas reales de la MISMA cuota, y si
// el reparto no es mitad y mitad esas partes tienen montos distintos: agrupar
// por monto las separaría en compras diferentes. Las partes comparten cuenta,
// cantidad de cuotas, número de cuota, fecha y nombre, así que se suman por esa
// combinación antes de comparar montos.
function unificarPartesDeCuota(filas) {
  const porCuota = new Map()
  filas.forEach(t => {
    const k = [
      t.account_id,
      t.cuotas_total,
      t.cuota_numero,
      (t.fecha || '').slice(0, 10),
      normalizarNombreCompra(t.nombre || t.detalle || ''),
    ].join('|')
    const acumulado = porCuota.get(k)
    if (acumulado) acumulado.monto = Number(acumulado.monto) + Number(t.monto)
    else porCuota.set(k, { ...t, monto: Number(t.monto) })
  })
  return [...porCuota.values()]
}

// Nombres que no identifican nada: son lo que queda cuando el resumen no trae
// comercio y solo dice que es una cuota. Usarlos para unir es peor que no tener
// nombre — "CUOTA" está contenido en "KIT CUOTA", en "TOALLITAS CUOTA" y en
// cualquier otra, así que pegaría todas las compras de la tarjeta entre sí.
const NOMBRES_SIN_INFO = new Set([
  'cuota', 'cuotas', 'compra', 'compras', 'pago', 'pagos', 'consumo', 'consumos',
])
const nombreIdentifica = (n) => {
  const x = normalizarNombreCompra(n || '')
  // Dos letras no alcanzan para afirmar nada por contención, y un nombre que es
  // solo números es un código de operación, no un comercio.
  return x.length >= 3 && !NOMBRES_SIN_INFO.has(x) && !/^\d+$/.test(x)
}

// ¿Los nombres apuntan a la misma compra? Se acepta que uno contenga al otro,
// porque un resumen puede escribirlo más corto que el otro ("KINDERLAND" vs
// "KINDERLAND JUGUETES", "FEBO" vs "MERPAGO*FBZAPATFEBO" no, pero "AYRES" sí).
// Si de un lado no quedó nada para comparar, no se afirma nada.
function nombresDeLaMismaCompra(a, b) {
  if (!nombreIdentifica(a) || !nombreIdentifica(b)) return false
  const x = normalizarNombreCompra(a)
  const y = normalizarNombreCompra(b)
  return x === y || x.includes(y) || y.includes(x)
}

// Mes en que caería la CUOTA 1 de la compra a la que pertenece esta fila:
// fecha de la fila menos (nº de cuota − 1) meses. Es el único dato que no
// depende de cómo el banco escribió el nombre ni de cuánto salió cada cuota, y
// dos filas de la misma compra tienen que coincidir en él.
function mesAncla(t) {
  if (!t.fecha) return null
  const d = new Date(t.fecha + 'T12:00:00')
  if (isNaN(d.getTime())) return null
  return d.getFullYear() * 12 + d.getMonth() - ((t.cuota_numero || 1) - 1)
}

// Cuánto puede diferir el mes ancla de dos filas de la misma compra. No es 0
// porque hay datos viejos donde la fecha de la cuota la puso el resumen que la
// facturó y no la compra: ahí el ancla se corre un mes o dos según el día de
// cierre. Con la unión transitiva alcanza de sobra — en una compra cargada de
// golpe con todas las cuotas en la misma fecha, cada cuota queda a un mes de la
// anterior y la cadena las une igual.
const TOLERANCIA_MESES_ANCLA = 2

// Dos compras distintas de la misma tarjeta y la misma cantidad de cuotas se
// fusionaban aunque estuvieran separadas por más de un año, porque coincidían en
// el monto o en el nombre. Casos reales:
//   MUNECOS $57.800 (ene-2025)   vs  Norte Sport Palo Hockey $58.333,34 (jul-2026)
//   COTO (feb-2025)              vs  COTO (feb-2026), mismo nombre
// El efecto era el peor posible: la compra nueva quedaba "completa" porque las
// cuotas de la vieja llenaban los números que faltaban, y el widget dejaba de
// avisar cuotas que sí se vienen. Exigir que el mes ancla coincida las separa.
//
// `margen` en meses: 0 pide que arranquen exactamente el mismo mes.
function anclasCompatibles(a, b, margen) {
  const ma = mesAncla(a), mb = mesAncla(b)
  // Sin fecha no se puede afirmar que sean de compras distintas: no bloquea la
  // unión, que sigue decidiéndose por monto o nombre.
  if (ma === null || mb === null) return true
  return Math.abs(ma - mb) <= margen
}

const montosDeLaMismaCuota = (a, b) => {
  const x = Math.abs(Number(a) || 0)
  const y = Math.abs(Number(b) || 0)
  if (x === 0 || y === 0) return false
  return Math.abs(x - y) <= TOLERANCIA_MONTO_PESOS
}

// PASO 2 — agrupar las cuotas en compras. Dentro de cada cuenta + cantidad de
// cuotas, dos filas son de la misma compra si pasa UNA de estas dos:
//
//   a) MISMO MONTO (salvo centavos de redondeo) y arrancaron a dos meses o menos
//      una de la otra. El margen de dos meses es para los datos viejos, donde la
//      fecha de la cuota la puso el resumen que la facturó y no la compra.
//
//   b) MISMO NOMBRE (o uno contiene al otro) y arrancaron EXACTAMENTE el mismo
//      mes. Acá el margen tiene que ser cero: hay cuatro compras distintas
//      llamadas "ROPA" en la misma tarjeta, todas en 3 cuotas, dos de ellas a un
//      mes de distancia (jul-2025 $53.000 y ago-2025 $120.984,01). Con margen las
//      unía y quedaba una sola compra con el monto de otra.
//
// Hacen falta las dos vías, porque en los datos reales fallan las dos por
// separado:
//   - Solo por monto: "SILLON 1/3" ($74.500) y "SILLON 2/3" ($80.088) son la
//     misma compra, pero le descontaron algo en la primera cuota.
//   - Solo por nombre: "matko" / "stanley" / "regalo stanley" son la misma
//     compra escrita de tres formas que no se parecen en nada.
//
// Contrapartida asumida: dos compras distintas, mismo mes, mismo monto exacto y
// misma cantidad de cuotas se cuentan como una. Ese error deja la deuda futura de
// menos; partir una compra la inventaba de más, que es el problema que se reportó.
function agruparPorCompra(filas) {
  const buckets = new Map()
  filas.forEach(t => {
    const k = `${t.account_id}|${t.cuotas_total}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(t)
  })

  const grupos = []
  buckets.forEach(filasBucket => {
    // Union-find sobre las filas del bucket: se van fusionando de a pares y al
    // final cada raíz es una compra. Hace falta la transitividad — si A junta
    // con B por monto y B con C por nombre, las tres son la misma compra.
    const padre = filasBucket.map((_, i) => i)
    const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i] } return i }
    const unir = (i, j) => { const ri = raiz(i), rj = raiz(j); if (ri !== rj) padre[rj] = ri }

    for (let i = 0; i < filasBucket.length; i++) {
      for (let j = i + 1; j < filasBucket.length; j++) {
        const a = filasBucket[i], b = filasBucket[j]
        const porMonto = montosDeLaMismaCuota(a.monto, b.monto) &&
          anclasCompatibles(a, b, TOLERANCIA_MESES_ANCLA)
        const porNombre = nombresDeLaMismaCompra(a.nombre || a.detalle, b.nombre || b.detalle) &&
          anclasCompatibles(a, b, 0)
        if (porMonto || porNombre) unir(i, j)
      }
    }

    const porRaiz = new Map()
    filasBucket.forEach((t, i) => {
      const r = raiz(i)
      if (!porRaiz.has(r)) porRaiz.set(r, [])
      porRaiz.get(r).push(t)
    })
    porRaiz.forEach(g => grupos.push(g))
  })
  return grupos
}

// Reconstruye las compras en cuotas con saldo pendiente. De cada compra
// devuelve la cuota conocida más reciente (la de número más alto) y cuántas
// cuotas faltan después de esa.
export function comprasEnCuotasPendientes(transactions) {
  const conCuotas = (transactions || []).filter(t =>
    t.tipo === 'gasto' && (t.cuotas_total || 1) > 1 && (t.cuota_numero || 0) > 0 && t.fecha &&
    !esAlquilerOExpensas(t)
  )
  if (conCuotas.length === 0) return []

  return agruparPorCompra(unificarPartesDeCuota(conCuotas)).map(grupo => {
    const maxCuota = grupo.reduce((m, t) => Math.max(m, t.cuota_numero || 0), 0)
    // De la cuota más alta puede haber más de una fila si quedaron dos cargas de
    // la misma cuota con nombres distintos — se toma una, no se suman (sumarlas
    // duplicaría el monto de esa cuota).
    const tx = grupo.find(t => (t.cuota_numero || 0) === maxCuota)
    return { tx, restantes: (tx.cuotas_total || 1) - maxCuota }
  }).filter(c => c.restantes > 0)
}

const mesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export const esCuota = (t) => (t.cuotas_total || 1) > 1

// ¿Esta cuota la factura un ciclo que va (desde, hasta]?
//
// SE COMPARA SOLO POR MES, en los dos extremos. El día que lleva una cuota es el de la
// compra original arrastrado mes a mes por addMeses: es una etiqueta de mes, no una
// fecha real de nada. Preguntarle a una cuota fechada el 28 de agosto si cae antes o
// después de un cierre del 20 de agosto no significa nada — la cuota de agosto la
// factura el resumen de agosto igual, cierre el 9, el 20 o el 28. Una compra de julio
// en tres cuotas se paga en julio, agosto y septiembre, y ningún día de cierre corre
// una de esas cuotas al mes siguiente.
//
// Es el mismo criterio con el que reconciliarSueltas (AccountDetail.js) liga cada cuota
// al resumen cuyo cierre cae en su mismo mes, y de ahí sale la convención de toda la
// app: el mes de una cuota es el mes de CIERRE del resumen que la factura.
//
// `hasta` en null = el ciclo todavía abierto; el tope lo pone quien llama (el mes en
// curso, porque de ahí en adelante ya son cuotas futuras y viven en el widget).
export function cuotaEnCiclo(t, desdeISO, hastaISO) {
  const mes = (t.fecha || '').slice(0, 7)
  if (!mes) return false
  if (desdeISO && mes <= desdeISO.slice(0, 7)) return false
  return !hastaISO || mes <= hastaISO.slice(0, 7)
}

// Suma meses a una fecha YYYY-MM-DD recortando el día al último del mes destino:
// el 31/01 más un mes da 28/02, no 03/03 (con setMonth, JS desborda al mes
// siguiente y esa cuota se salteaba febrero). El string se arma a mano y no con
// toISOString(), que pasa por UTC y corre un día en zonas de offset positivo.
//
// Cada cuota se calcula SIEMPRE desde la fecha de la compra, nunca desde la
// cuota anterior: así una compra del 31/01 vuelve al 31 en marzo en vez de
// quedar arrastrando el 28 para siempre.
export const addMeses = (fechaISO, n) => {
  if (!fechaISO) return fechaISO
  const [y, m, d] = fechaISO.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return fechaISO
  if (!n) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const destino = new Date(y, (m - 1) + n, 1)
  const ultimoDia = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate()
  destino.setDate(Math.min(d, ultimoDia))
  return `${destino.getFullYear()}-${String(destino.getMonth() + 1).padStart(2, '0')}-${String(destino.getDate()).padStart(2, '0')}`
}

// Las cuotas de una compra financiada que TODAVÍA NO EXISTEN como movimiento,
// listas para crearse. Devuelve, por cada una, la fila que sirve de molde (para
// copiar cuenta, categoría, subcategoría, hijo y moneda) más la fecha y el
// número que le corresponden.
//
// El único criterio de la app para "qué cuotas se vienen" tiene que ser ESTO:
// se crean los movimientos y después todas las vistas leen movimientos. Antes el
// widget mostraba una proyección calculada al vuelo que no existía en ninguna
// parte, así que el total del widget y el de los movimientos nunca cerraban.
//
// No se generan cuotas que caerían en un mes YA PASADO: si la última cuota
// conocida de una compra es vieja, las siguientes ya se facturaron y lo que falta
// es cargar ese resumen — inventarlas ahora metería gastos en meses cerrados.
//
// El corte acá es por MES y no por día (a diferencia de cuotasFuturasCargadas,
// que corta en la fecha de hoy): una cuota del 7 cuando estamos a fin de mes ya
// pasó y no va en un panel de "pendientes", pero el gasto existió igual y el
// movimiento tiene que estar cargado.
export function cuotasParaCrear(transactions, hoy = new Date()) {
  const mesActual = mesDe(hoy)
  const yaCargadas = (transactions || []).filter(t =>
    t.tipo === 'gasto' && (t.cuotas_total || 1) > 1 && (t.cuota_numero || 0) > 0 && t.fecha)

  // Una cuota ya existe si en la misma cuenta hay una fila del mismo plan, con el
  // mismo número, monto parecido y fecha cercana. La ventana de fechas es amplia
  // porque los datos viejos tienen la fecha del resumen que facturó la cuota y no
  // la derivada de la compra: sin eso se crearía una segunda copia de algo que sí
  // está cargado.
  const existe = (accountId, cuotasTotal, cuotaNum, monto, fechaISO) =>
    yaCargadas.some(t =>
      t.account_id === accountId &&
      (t.cuotas_total || 1) === cuotasTotal &&
      (t.cuota_numero || 0) === cuotaNum &&
      montosDeLaMismaCuota(t.monto, monto) &&
      Math.abs(new Date(t.fecha + 'T12:00:00') - new Date(fechaISO + 'T12:00:00')) <= 45 * 86400000
    )

  const aCrear = []
  comprasEnCuotasPendientes(transactions).forEach(({ tx, restantes }) => {
    for (let i = 1; i <= restantes; i++) {
      const fecha = addMeses(tx.fecha, i)
      if (fecha.slice(0, 7) < mesActual) continue
      const cuotaNum = (tx.cuota_numero || 1) + i
      if (existe(tx.account_id, tx.cuotas_total || 1, cuotaNum, tx.monto, fecha)) continue
      aCrear.push({ molde: tx, fecha, cuotaNum, cuotasTotal: tx.cuotas_total || 1, monto: tx.monto })
    }
  })
  return aCrear
}

// ¿Este resumen todavía debe algo EN LA MONEDA de la cuota? Un resumen puede estar
// pagado en pesos y seguir debiendo dólares (caso real: Visa con $ 0 y U$S 3,03
// pendientes). Mirando solo "¿el resumen debe algo?" las cuotas en pesos de esa
// tarjeta seguían figurando como pendientes por culpa de tres dólares.
// EUR no tiene bucket propio, igual que en calcularEstadoStatement: va con los pesos.
const resumenDebeEnMoneda = (saldo, moneda) => {
  if (!saldo) return false
  return moneda === 'USD' ? Math.round(saldo.usd * 100) > 0 : Math.round(saldo.ars) > 0
}

// Las cuotas que TODAVÍA SE DEBEN, ya cargadas como movimiento. Esto es lo que
// muestran las vistas de cuotas: se lee la base, no se calcula nada.
//
// Cuenta una cuota si pasa alguna de estas dos:
//
//   a) La facturó un resumen que TODAVÍA SE DEBE (los que muestra "A pagar"). Vale
//      aunque su fecha ya haya pasado: si el resumen no está pagado, esa cuota es
//      plata que hay que poner. Y al revés: si ese resumen YA SE PAGÓ, la cuota deja
//      de ser pendiente en el acto, sin importar qué día lleve encima. Antes acá se
//      caía a la regla de fecha, así que una cuota de agosto facturada en un resumen
//      de agosto ya pagado seguía apareciendo como pendiente hasta que llegara su día.
//   b) Ningún resumen cargado la facturó, y cae en un MES POSTERIOR al actual.
//
// El corte es por MES y no por día a propósito. Una cuota es una unidad mensual: el
// día que lleva es el de la compra original arrastrado mes a mes (ver addMeses), no
// una fecha de facturación ni de vencimiento. Comparándolo contra hoy, las cuotas del
// mes en curso se iban del widget de a una por día según qué día habías comprado —
// dos cuotas del mismo mes tratadas distinto por un número que no significa nada.
// Las del mes actual ya son deuda de este ciclo: se ven en "A pagar", no acá.
//
// `saldoPorResumen` es el Map id → { ars, usd } de lo que todavía se debe de cada
// resumen, calculado con calcularStatementsPendientes — la misma función que usan
// "A pagar" y el widget de Vencimientos, así que las cuatro vistas no pueden
// discrepar sobre qué se debe.
//
// La lista es de PENDIENTES y no de pagados a propósito. Con el criterio inverso
// ("mostrar todo lo que no esté marcado como pagado") aparecía el historial completo:
// los resúmenes viejos no tienen los pagos cargados, así que ninguno figura como
// pagado y el widget listaba cuotas de enero, febrero y marzo. Partiendo de los
// pendientes, lo viejo no puede colarse: si no está en ese Map, ya se saldó.
export function cuotasFuturasCargadas(transactions, hoy = new Date(), saldoPorResumen = null) {
  const mesActual = mesDe(hoy)
  return (transactions || []).filter(t => {
    if (t.tipo !== 'gasto' || (t.cuotas_total || 1) <= 1 || (t.cuota_numero || 0) <= 0) return false
    if (!t.fecha || esAlquilerOExpensas(t)) return false
    // Si un resumen cargado la facturó, decide el resumen y no se mira la fecha.
    if (t.statement_id && saldoPorResumen) {
      return resumenDebeEnMoneda(saldoPorResumen.get(t.statement_id), t.moneda)
    }
    return t.fecha.slice(0, 7) > mesActual
  })
}

// Proyecta una por una las cuotas que faltan, con el mes en que caería cada
// una. Se saltean las que caerían en un mes YA PASADO: si la última cuota
// conocida de una compra es vieja, las siguientes probablemente ya se
// facturaron y solo falta cargar ese resumen — contarlas como deuda futura
// abultaría el total.
//
// Las dos vistas de cuotas (la card "Cuotas comprometidas a futuro" y el widget
// "Cuotas pendientes") tienen que partir de ESTA proyección: cuando la card
// sumaba todas las restantes y el widget salteaba las de meses pasados, los dos
// números no cerraban entre sí y parecía que uno de los dos estaba mal.
export function proyectarCuotasFuturas(transactions, hoy = new Date()) {
  const mesActual = mesDe(hoy)
  const proyectadas = []
  comprasEnCuotasPendientes(transactions).forEach(({ tx, restantes }) => {
    const base = new Date(tx.fecha + 'T12:00:00')
    for (let i = 1; i <= restantes; i++) {
      const mes = mesDe(new Date(base.getFullYear(), base.getMonth() + i, 1))
      if (mes < mesActual) continue
      proyectadas.push({ tx, mes, cuotaNum: (tx.cuota_numero || 1) + i })
    }
  })
  return proyectadas
}
