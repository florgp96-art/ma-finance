# LIMPIEZA_AUDIT.md — user_rules + user_category_icons
Fecha: 2026-06-23

---

## Estado de situación (análisis de código)

### Por qué no pude correr las queries SQL directamente
El archivo `.env` no tiene `SUPABASE_SERVICE_ROLE_KEY` (está en las env vars de Vercel, no committeada). Las queries de auditoría del prompt necesitan JOINs que requieren permisos de admin. Las queries SQL están abajo listas para que las corras vos en **Supabase Dashboard → SQL Editor**.

---

## A.0 — Inventario de columnas en uso (código fuente)

### Tabla `user_rules`

**Columnas escritas actualmente por el código:**

| Columna | Tipo | Escrita en | Leída en |
|---------|------|-----------|----------|
| `user_id` | uuid FK | AccountDetail:407, Dashboard:1216, Dashboard:1284 | — |
| `texto_original` | text | AccountDetail:409, Dashboard:1218, Dashboard:1285 | api/analyze.js:50 |
| `nombre_asignado` | text | AccountDetail:410, Dashboard:1219 | — |
| `categoria` | **text** | AccountDetail:**411**, Dashboard:**1220** | **api/analyze.js:50** ← ⚠️ |
| `subcategoria` | **text** | AccountDetail:**412**, Dashboard:**1221** | **api/analyze.js:50** ← ⚠️ |
| `category_id` | uuid FK | AccountDetail:413, Dashboard:1222, Dashboard:1290 | — |
| `subcategory_id` | uuid FK | AccountDetail:414, Dashboard:1223, Dashboard:1291 | — |
| `veces_confirmado` | int | AccountDetail:415, Dashboard:1224 | — |
| `updated_at` | timestamp | AccountDetail:416, Dashboard:1225 | — |

**⚠️ CRÍTICO**: `api/analyze.js` (línea 50) lee **exclusivamente las columnas de texto** para construir el contexto que le manda a Claude:
```js
const rulesText = userRules
  .map(r => `- "${r.texto_original}" → categoría: "${r.categoria}", subcategoría: "${r.subcategoria || ''}"`)
  .join('\n')
```
Si se dropean las columnas de texto antes de actualizar la API, Claude dejará de recibir las reglas del usuario → clasificación automática rota.

**Comportamiento por flujo de escritura:**
- Flujo "identificar" (AccountDetail + Dashboard modal): escribe texto Y FK simultáneamente → debería ser consistente para reglas recientes
- Flujo "contexto detectado" (Dashboard:1284): escribe `category_id: null, subcategory_id: null` sin escribir texto de categoría (correcto, son flags de sistema, no reglas de categoría)

---

### Tabla `user_category_icons`

| Columna | Tipo | Escrita en | Leída en |
|---------|------|-----------|----------|
| `user_id` | uuid FK | Dashboard:330 | Dashboard:322 |
| `categoria` | **text** | Dashboard:330, 333 | Dashboard:**322** |
| `icono` | text | Dashboard:330 | Dashboard:322 |

**No existe columna `category_id` todavía.** Toda la tabla opera sobre texto.

Código relevante en `Dashboard.js`:
```js
// Lectura (línea 322)
const { data } = await supabase.from('user_category_icons')
  .select('categoria, icono').eq('user_id', user.id)
if (data) setCustomIcons(Object.fromEntries(data.map(r => [r.categoria, r.icono])))

// Escritura (línea 330) — el onConflict usa texto como clave única
await supabase.from('user_category_icons')
  .upsert({ user_id: user.id, categoria, icono }, { onConflict: 'user_id,categoria' })

// Borrado (línea 333)
await supabase.from('user_category_icons')
  .delete().eq('user_id', user.id).eq('categoria', categoria)
```

---

## A.1 — Query: user_rules — FK vs texto

Corré esto en **Supabase → SQL Editor** y pegá el resultado abajo:

```sql
-- A.1: Filas donde FK y texto NO coinciden (o FK falta con texto presente)
SELECT
  ur.id,
  ur.user_id,
  ur.texto_original,
  ur.category_id,
  c.nombre  AS categoria_segun_fk,
  ur.categoria AS categoria_texto,
  ur.subcategory_id,
  sc.nombre AS subcategoria_segun_fk,
  ur.subcategoria AS subcategoria_texto
FROM user_rules ur
LEFT JOIN categories    c  ON c.id  = ur.category_id
LEFT JOIN subcategories sc ON sc.id = ur.subcategory_id
WHERE
     (ur.category_id IS NULL AND NULLIF(TRIM(ur.categoria), '') IS NOT NULL)
  OR (ur.subcategory_id IS NULL AND NULLIF(TRIM(ur.subcategoria), '') IS NOT NULL)
  OR (c.nombre  IS DISTINCT FROM ur.categoria    AND ur.categoria    IS NOT NULL)
  OR (sc.nombre IS DISTINCT FROM ur.subcategoria AND ur.subcategoria IS NOT NULL)
ORDER BY ur.user_id, ur.updated_at DESC;
```

**Resultado A.1:** _(id,user_id,texto_original,category_id,categoria_segun_fk,categoria_texto,subcategory_id,subcategoria_segun_fk,subcategoria_texto
fe2237b9-08aa-47fe-9a3c-948852e7a2a0,66029aec-97f5-40df-8779-54d9e6957fb2,contexto_auto_propio,null,null,Personal,null,null,null
aebe2637-e73e-47c3-b430-182db29db0bc,66029aec-97f5-40df-8779-54d9e6957fb2,contexto_mascota,null,null,Personal,null,null,null
019dc42e-1f8d-4d12-a216-b80498e59305,66029aec-97f5-40df-8779-54d9e6957fb2,contexto_hijo,null,null,Personal,null,null,null)_

---

## A.2 — Query: user_rules — texto huérfano (sin categoría real)

```sql
-- A.2: Reglas con texto de categoría que NO matchea ninguna categoría real
SELECT
  ur.id,
  ur.user_id,
  ur.texto_original,
  ur.categoria,
  ur.subcategoria
FROM user_rules ur
WHERE NULLIF(TRIM(ur.categoria), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.nombre = ur.categoria
      AND (c.user_id = ur.user_id OR c.es_sistema = true)
  )
ORDER BY ur.user_id;
```

**Resultado A.2:** _(id,user_id,texto_original,categoria,subcategoria
151d9a3b-cb83-42a6-8a62-c30eba484c96,66029aec-97f5-40df-8779-54d9e6957fb2,TRANSFERENCIA A TERCEROS SWAROVSKI JULIA BEAT 27128219965 VARIOS BANCO DE GALICIA Y B,Devoluciones,Otros
04431bb4-5394-4695-8984-301d7cf81dc6,66029aec-97f5-40df-8779-54d9e6957fb2,TRANSFERENCIA A TERCEROS Silvio Matko Papini 23390766149 VARIOS MERCADO LIBRE SRL,Devoluciones,Otros)_

---

## A.3 — Query: user_category_icons — texto vs categoría real

```sql
-- A.3: Íconos con su match (o falta de match) a una categoría real
SELECT
  uci.id,
  uci.user_id,
  uci.categoria AS categoria_texto,
  uci.icono,
  c.id AS category_id_match,
  c.nombre AS categoria_real
FROM user_category_icons uci
LEFT JOIN categories c
  ON c.nombre = uci.categoria
 AND (c.user_id = uci.user_id OR c.es_sistema = true)
ORDER BY (c.id IS NULL) DESC, uci.user_id;
```

**Resultado A.3:** _(id,user_id,categoria_texto,icono,category_id_match,categoria_real
2675d11e-47fb-4ff5-8e23-372d6c4aedfe,66029aec-97f5-40df-8779-54d9e6957fb2,Devoluciones,💰,null,null
76b995a4-1a1d-47be-9408-e6c97d19e033,66029aec-97f5-40df-8779-54d9e6957fb2,Amelia,👧🏼,null,null
7b502a74-0847-491b-8f57-a2615275d8f9,66029aec-97f5-40df-8779-54d9e6957fb2,Vitto,👦🏼,null,null
8224eac6-95cc-4af2-8245-8ec04696f553,66029aec-97f5-40df-8779-54d9e6957fb2,Deportes,🏋️‍,e1595529-166c-40ab-90be-c59dc670ae46,Deportes
b048bcd2-b835-48a6-b8f2-f7f206b972d7,66029aec-97f5-40df-8779-54d9e6957fb2,Crianza,🤰,7b1e8825-709c-4931-a606-85079c6b1e8b,Crianza
07d2e683-e747-451b-bcc6-394bf794be9f,66029aec-97f5-40df-8779-54d9e6957fb2,Comida,🍽️,3d77483d-17f6-4f73-8e3d-058cb157fb9e,Comida)_

---

## A.4 — Query: conteos generales

```sql
-- Cuántas reglas hay en total
SELECT COUNT(*) AS total_rules FROM user_rules;

-- Cuántas tienen FK de categoría
SELECT COUNT(*) AS rules_con_fk FROM user_rules WHERE category_id IS NOT NULL;

-- Cuántas tienen texto de categoría
SELECT COUNT(*) AS rules_con_texto FROM user_rules WHERE NULLIF(TRIM(categoria), '') IS NOT NULL;

-- Cuántas tienen AMBOS
SELECT COUNT(*) AS rules_con_ambos FROM user_rules 
WHERE category_id IS NOT NULL AND NULLIF(TRIM(categoria), '') IS NOT NULL;

-- Cuántos íconos hay
SELECT COUNT(*) AS total_icons FROM user_category_icons;
```

**Resultado A.4:** _(total_icons
6)_

---

## Estado del análisis

| Punto | Estado |
|-------|--------|
| A.0 — Inventario de código | ✅ Completo |
| A.1 — FK vs texto en user_rules | ✅ 3 filas conflictivas |
| A.2 — Texto huérfano en user_rules | ✅ 2 filas huérfanas |
| A.3 — user_category_icons sin match | ✅ 3 de 6 son huérfanas |
| A.4 — Conteos generales | ⚠️ Solo se recibió total_icons=6 |

---

## Análisis de resultados

### A.1 — user_rules: 3 conflictos (todos son context flags)

| texto_original | category_id | categoria_texto | Diagnóstico |
|----------------|-------------|-----------------|-------------|
| `contexto_auto_propio` | null | "Personal" | Flag de sistema con texto stale |
| `contexto_mascota` | null | "Personal" | Flag de sistema con texto stale |
| `contexto_hijo` | null | "Personal" | Flag de sistema con texto stale |

**Diagnóstico**: Son flags de sistema que registran que el usuario ya confirmó un contexto detectado. El `category_id: null` es intencional. El `categoria: "Personal"` es incorrecto y stale — quedó de una versión anterior del código. No son reglas de clasificación.

**Acción propuesta**: `UPDATE user_rules SET categoria = NULL, subcategoria = NULL WHERE texto_original LIKE 'contexto_%'` — no toca el `category_id`.

---

### A.2 — user_rules: 2 filas con categoría "Devoluciones" (no existe)

| texto_original | categoria | subcategoria |
|----------------|-----------|--------------|
| `TRANSFERENCIA A TERCEROS SWAROVSKI JULIA BEAT...` | Devoluciones | Otros |
| `TRANSFERENCIA A TERCEROS Silvio Matko Papini...` | Devoluciones | Otros |

**Diagnóstico**: La categoría "Devoluciones" no existe en `categories`. Ambas son transferencias a terceros que clasificaste como "Devoluciones" (probablemente una categoría que eliminaste). Sin categoría real → `category_id` es null.

**⚠️ Decisión 2 — necesito tu elección**:
- A) Mapear a `Ingresos / Reintegros`
- B) Mapear a `Personal / Varios`
- C) **Borrarlas** (son solo 2, fácil de recrear)

---

### A.3 — user_category_icons: 3 de 6 filas huérfanas

| categoria_texto | icono | Tipo | category_id_match |
|----------------|-------|------|-------------------|
| `Devoluciones` | 💰 | Categoría inexistente | null ⚠️ |
| `Amelia` | 👧🏼 | **Hijo** (no es categoría) | null ⚠️ |
| `Vitto` | 👦🏼 | **Hijo** (no es categoría) | null ⚠️ |
| `Deportes` | 🏋️ | Categoría OK | ✅ e1595529... |
| `Crianza` | 🤰 | Categoría OK | ✅ 7b1e8825... |
| `Comida` | 🍽️ | Categoría OK | ✅ 3d77483d... |

**Diagnóstico**: `Amelia` y `Vitto` son hijos, no categorías. El código los guarda en `user_category_icons` usando el nombre como clave — funciona porque `customIcons` es un mapa `{ nombre: icono }` sin distinguir tipo. Pero si migramos a FK de `categories`, esta tabla ya no puede guardar íconos de hijos.

**⚠️ Decisión 3 — propuesta de diseño**: Mover íconos de hijos a la tabla `children` como columna `icono`:
```sql
ALTER TABLE children ADD COLUMN IF NOT EXISTS icono text;
UPDATE children SET icono = '👧🏼' WHERE nombre = 'Amelia';
UPDATE children SET icono = '👦🏼' WHERE nombre = 'Vitto';
-- Luego DELETE de user_category_icons esas dos filas
```
Esto también resuelve el bug de "Amelia con ?" de forma permanente (el ícono deja de depender del período seleccionado).

---

## ⚠️ Las 3 decisiones que necesito antes de la Fase B

### Decisión 1 — context flags (user_rules)
Limpiar el texto stale de los 3 flags de contexto con `UPDATE ... WHERE texto_original LIKE 'contexto_%'`.
→ **¿OK?** (es benigno y reversible)

### Decisión 2 — reglas "Devoluciones" huérfanas (user_rules)
¿Qué hago con las 2 reglas de Swarovski y Silvio Matko Papini?
→ **A / B / C** (ver opciones arriba)

### Decisión 3 — íconos de hijos
¿Aprobás agregar columna `icono` a `children` y migrar Amelia + Vitto?
→ **Sí / No**

Con las 3 respuestas ejecuto todo en orden: Fase B → C → D → E.
