# AUDITORIA.md — MA Finance · Fase 0 (read-only)
Fecha: 2026-06-23

---

## 1. Inventario de páginas / rutas

| Ruta | Componente principal | CSS / estilos |
|------|----------------------|---------------|
| `/login` | `src/pages/Login.js` | Inline styles (objeto `styles` local) |
| `/register` | `src/pages/Register.js` | Inline styles (objeto `styles` local) |
| `/onboarding` | `src/pages/Onboarding.js` | Inline styles locales |
| `/dashboard` | `src/pages/Dashboard.js` (3 411 líneas) | Inline styles, objeto `styles` al final del archivo |
| `/dashboard` → detalle de cuenta | `src/components/AccountDetail.js` (1 437 líneas) | Inline styles |
| `/dashboard` → detalle de hijo | `src/components/HijoDetail.js` | Inline styles |

### Sub-componentes y bibliotecas usados en AccountDetail
- `BubbleChart` (propio, canvas-less con simulación de física)
- `recharts`: `BarChart`, `PieChart`, `Pie`, `Cell`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`
- `lucide-react` (importada pero verificar qué íconos se usan)

### No hay página de configuración propia
La configuración (tipo de cambio, alias, categorías, hijos, íconos, contraseña) vive como **modales dentro de `Dashboard.js`**. No existe una ruta `/configuracion`.

---

## 2. Desvíos del design system

Design system definido: fondo `#E4E7F3` · primario `#6B7BB8` · sidebar 240 px blanco · logo 220 px · fuente Montserrat.

### Login.js
| Elemento | Valor actual | Valor correcto |
|----------|-------------|----------------|
| Fondo (`container`) | `#F0EDEC` | `#E4E7F3` |
| Botón "Ingresar" | `#5C4F5C` | `#6B7BB8` |
| Logo height | `90px` | sin restricción definida (220 px ancho) |
| Link "¿Olvidaste tu contraseña?" | `#5C4F5C` | `#6B7BB8` |
| Link "Registrate" | `#5C4F5C` | `#6B7BB8` |

### Register.js
| Elemento | Valor actual | Valor correcto |
|----------|-------------|----------------|
| Fondo (`container`) | `#F7F5F6` | `#E4E7F3` |
| Primario (const `PURPLE`) | `#7C5CBF` | `#6B7BB8` |
| Botón "Crear cuenta" | `#7C5CBF` | `#6B7BB8` |
| H1 hardcodeado | `"Moms Assist Finance"` | debe usar constante `APP_NAME` |
| Link "Iniciá sesión" | `#7C5CBF` | `#6B7BB8` |

### App.js (estado de carga)
| Elemento | Valor actual | Valor correcto |
|----------|-------------|----------------|
| `fontFamily` | `'Arial, sans-serif'` | `'"Montserrat", sans-serif'` |
| Fondo | ninguno (blanco por defecto) | `#E4E7F3` |

### Dashboard.js y AccountDetail.js
| Elemento | Valor actual | Valor correcto |
|----------|-------------|----------------|
| Botones activos / primarios | `#5C4F5C` (dark plum) | `#6B7BB8` (azul-violeta del design system) |
| Botones "Seleccionar todo / Ninguna" | `#7c5cbf` | `#6B7BB8` |
| Selección activa de tabs | `#5C4F5C` | `#6B7BB8` |
| Algunos bordes de highlight | `#5C4F5C` | `#6B7BB8` |

### manifest.json (PWA)
| Campo | Valor actual | Valor correcto |
|-------|-------------|----------------|
| `name` | `"Create React App Sample"` | nombre de la app |
| `short_name` | `"React App"` | nombre corto de la app |
| `theme_color` | `"#000000"` | `"#6B7BB8"` |
| `background_color` | `"#ffffff"` | `"#E4E7F3"` |
| Ícono 512 px | ausente | requerido para PWA instalable |

---

## 3. Bug — "Total por mes" (ejes en blanco)

### Ubicación
`src/components/AccountDetail.js` líneas 481–484 y 1019–1031.

### Causa raíz
El gráfico "Total por mes" de cuentas de egresos usa la columna `total_resumen` de la tabla `statements`:

```js
// AccountDetail.js : 481
const barData = statements.map(s => ({
  mes: s.periodo || s.fecha_hasta?.slice(0, 7),
  total: Number(s.total_resumen) || 0   // ← lee total_resumen
}))
```

El problema está en cómo se insertan los statements en `Dashboard.js`:

```js
// Dashboard.js : 1347-1350 — extractos de banco (tipo_documento === 'banco')
await supabase.from('statements').insert({
  ...
  total_resumen: null,   // ← siempre null para extractos bancarios
  estado: 'completo'
})

// Dashboard.js : 1363-1366 — extractos de adicionales
await supabase.from('statements').insert({
  ...
  total_resumen: null,   // ← también null
  estado: 'completo'
})

// Dashboard.js : 1447-1452 — solo tarjetas de crédito guardan el total
await supabase.from('statements').insert({
  ...
  total_resumen: statementData.total_pesos,  // ← único caso con valor
  estado: 'completo'
})
```

**Resultado**: para extractos bancarios, `total_resumen` es siempre `null`. `Number(null) || 0` = `0`. `barData` tiene filas pero todas con `total: 0`. Las barras se renderizan con altura 0, mostrando solo los ejes y el área vacía.

### Fix sugerido (Fase 6.3)
Al insertar statements de tipo banco, calcular el total como suma de las transacciones seleccionadas y guardarlo en `total_resumen`. O bien calcular `barData` directamente desde `transactions` (por mes), sin depender de `total_resumen`.

---

## 4. Bug — "Amelia con ?" (hijo sin ícono)

### Ubicación
`src/components/AccountDetail.js` líneas 588–591.

### Causa raíz
El mapa de íconos de hijos (`childExtraConfig`) se construye **solo** a partir de los hijos que tienen transacciones **en el período seleccionado actualmente**:

```js
// AccountDetail.js : 588
const childExtraConfig = Object.fromEntries(
  childTotals.map((c, i) => [c.name, { icon: '👧', color: CHILDREN_PALETTE[i % CHILDREN_PALETTE.length] }])
)
// childTotals = hijos con monto > 0 en el período filtrado por selectedMeses

// AccountDetail.js : 591
const resolveIcon = (name) =>
  (customIcons?.[name]) ||       // ícono custom del usuario
  CATEGORY_CONFIG[name]?.icon || // categoría conocida
  childExtraConfig[name]?.icon || // hijo CON transacciones en el período
  '❓'                            // fallback
```

Si "Amelia" (u otro hijo) existe en la tabla `children` pero **no tiene transacciones en el mes seleccionado**, no aparece en `childTotals`, por lo que `childExtraConfig["Amelia"]` es `undefined`, y `resolveIcon("Amelia")` devuelve `'❓'`.

Esto se replica en `mergedExtraConfig` (línea 594), que es lo que el `BubbleChart` usa para mostrar íconos en la leyenda y en el tooltip.

### Fix sugerido (Fase 5)
Ampliar `resolveIcon` para que también busque en el array `children` cargado desde la DB:
```js
const resolveIcon = (name) =>
  customIcons?.[name] ||
  CATEGORY_CONFIG[name]?.icon ||
  childExtraConfig[name]?.icon ||
  (children.find(c => c.nombre === name) ? '👧' : '❓')
```

---

## 5. Bug — "EQUIV. TOTALES" muestra USD cuando está en modo ARS

### Ubicación
`src/components/AccountDetail.js` líneas 984–997.

### Causa raíz
Cuando el toggle está en ARS (`equivEnUSD === false`) y no hay ingresos (`!hayIngresos`), el bloque renderiza un equivalente en USD debajo del total en ARS:

```js
// AccountDetail.js : 984-997
</> : <>  {/* rama ARS */}
  <p>Egresos</p>
  <p>$ {formatMonto(egresosEquivARS)}</p>
  {hayIngresos && ingresosEquivARS > 0 && <>
    {/* balance en ARS */}
  </>}
  {!hayIngresos && <>{divider}
    <p style={styles.summaryLabel}>Final equiv. en USD</p>         {/* ← BUG */}
    <p>U$S {formatMonto(egresosEquivUSD)}</p>                      {/* ← BUG */}
  </>}
</>
```

**Resultado**: al seleccionar ARS, el panel igual muestra "Final equiv. en USD" al fondo. El usuario ve el total en ARS Y su equivalente en USD aunque haya elegido explícitamente no ver USD. Es redundante.

### Fix sugerido (Fase 4.2)
Eliminar el bloque `{!hayIngresos && ...}` cuando `equivEnUSD === false`. El equivalente secundario solo debe aparecer si hay una `moneda_comparacion` configurada distinta de la moneda base.

---

## 6. Observación adicional — "Seleccionar todo / Ninguna" (visual)

### Ubicación
`src/pages/Dashboard.js` líneas 2684–2689.

### Problema
Los botones se renderizan como links subrayados con color `#7c5cbf` (no del design system). El layout usa `justify-content: space-between` entre el texto explicativo (que puede ser largo) y los botones, lo que en viewports acotados aprieta los botones contra el texto sin separación visual clara.

```js
// Dashboard.js : 2684
<div style={{ fontSize: '12px', color: '#8e8e93', marginBottom: '8px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  <span>Las tachadas ya podrían estar cargadas...</span>
  <div style={{ display: 'flex', gap: '8px' }}>
    <button style={{ ... color: '#7c5cbf', textDecoration: 'underline' }}>Seleccionar todo</button>
    <button style={{ ... color: '#7c5cbf', textDecoration: 'underline' }}>Ninguna</button>
  </div>
</div>
```

### Fix sugerido (Fase 3 / UX)
Cambiar color a `#6B7BB8`, separar el texto en su propia línea, y alinear los botones a la derecha con `flex-end` o dentro de su propio row.

---

## 7. Estado del build — error previo `esVistaIngresos`

El error mencionado en las instrucciones (`esVistaIngresos` en AccountDetail) **ya no existe** en el código actual. La variable está correctamente definida en la línea 479 y usada en múltiples puntos sin error de linting aparente. El build debería pasar limpio. Verificar con `npm run build` antes de comenzar la Fase 1.

---

## Resumen ejecutivo

| # | Categoría | Severidad | Estado |
|---|-----------|-----------|--------|
| 2a | Design system: Login fondo/botón | Media | Pendiente Fase 6 |
| 2b | Design system: Register primario `#7C5CBF` | Media | Pendiente Fase 6 |
| 2c | Design system: App.js loading state | Baja | Pendiente Fase 6 |
| 2d | Design system: `#5C4F5C` en toda la app | Media | Pendiente Fase 6 |
| 2e | manifest.json genérico | Baja | Pendiente Fase 7 |
| 3 | Bug "Total por mes" vacío (banco) | Alta | Pendiente Fase 6.3 |
| 4 | Bug "Amelia con ?" | Alta | Pendiente Fase 5 |
| 5 | Bug EQUIV. TOTALES muestra USD en modo ARS | Media | Pendiente Fase 4.2 |
| 6 | Visual "Seleccionar todo / Ninguna" | Baja | Pendiente Fase 3/UX |
