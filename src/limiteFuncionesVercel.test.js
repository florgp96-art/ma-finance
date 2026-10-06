// El plan Hobby de Vercel admite como máximo 12 funciones por despliegue: con una
// más, el despliegue entero falla y producción se queda en la versión anterior sin
// que nada lo avise en la app. Cada archivo .js suelto en api/ es una función (los
// de api/_lib no cuentan). Si este test falla, sumá el endpoint nuevo a uno que ya
// exista, como la revisión de lectura que entra por /api/analyze?revision=1.
const fs = require('fs')
const path = require('path')

test('api/ no pasa de 12 funciones', () => {
  const funciones = fs.readdirSync(path.join(__dirname, '..', 'api')).filter(f => f.endsWith('.js'))
  expect(funciones.length).toBeLessThanOrEqual(12)
})
