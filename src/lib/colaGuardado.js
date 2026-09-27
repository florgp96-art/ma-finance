// Cola de escrituras a Supabase. Existe porque la versión anterior de la
// liquidación esperaba para escribir y, al cerrar la vista, la escritura
// pendiente nunca salía. Reglas:
//
// - ahora(): acciones estructurales (agregar, borrar, cerrar). Sale ya.
// - programar(): tipeo. Throttle con trailing: la primera tecla agenda la
//   escritura a `espera` ms y las siguientes solo reemplazan qué se escribe, sin
//   correr el plazo (un debounce la podía postergar para siempre).
// - vaciar(): manda ya todo lo agendado. Se llama al ocultar la página, en
//   pagehide, al desmontar y antes de cambiar o cerrar el mes.
//
// Todo lo de una misma clave (una fila) sale en orden: el update de un día
// recién agregado espera al insert, y dos updates seguidos no se pisan al volver.
// Si una escritura falla se reintenta una vez; si vuelve a fallar se informa.
// Las de tipeo quedan guardadas para reintentar(), porque el dato sigue en
// pantalla; las estructurales las deshace quien las pidió.
const dormir = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const llamar = async (fn) => {
  try {
    return (await fn()) || {}
  } catch (e) {
    return { error: e || new Error('Error desconocido') }
  }
}

// Una llamada a Supabase con un reintento. Devuelve { data, error } del último intento.
export const conReintento = async (fn, esperaReintento = 1000) => {
  const primero = await llamar(fn)
  if (!primero.error) return primero
  if (esperaReintento > 0) await dormir(esperaReintento)
  return llamar(fn)
}

export const crearColaDeGuardado = ({ espera = 500, esperaReintento = 1000, onEstado } = {}) => {
  const programadas = new Map() // clave → { timer, escribir }
  const cadenas = new Map() // clave → promesa de la última escritura de esa clave
  const fallidas = new Map() // clave → escribir (tipeo que no se pudo guardar)
  let enCurso = 0
  let guardoAlgo = false
  let ultimoError = null

  const avisar = () => onEstado?.({
    pendientes: enCurso + programadas.size,
    fallidas: fallidas.size,
    error: ultimoError,
    guardoAlgo,
  })

  const ejecutar = (clave, escribir) => {
    enCurso++
    avisar()
    // Sin otra escritura de esa clave en curso, sale en este mismo tick (importa
    // en pagehide: después puede no haber más ticks).
    const previa = cadenas.get(clave)
    const arrancar = () => conReintento(escribir, esperaReintento)
    const esta = (previa ? previa.then(arrancar) : arrancar()).then(({ error }) => {
      enCurso--
      if (cadenas.get(clave) === esta) cadenas.delete(clave)
      if (error) ultimoError = error
      else {
        guardoAlgo = true
        if (fallidas.size === 0) ultimoError = null
      }
      avisar()
      return error || null
    })
    cadenas.set(clave, esta)
    return esta
  }

  const ahora = (clave, escribir) => ejecutar(clave, escribir)

  const disparar = (clave) => {
    const pendiente = programadas.get(clave)
    if (!pendiente) return cadenas.get(clave) || Promise.resolve(null)
    clearTimeout(pendiente.timer)
    programadas.delete(clave)
    fallidas.delete(clave)
    return ejecutar(clave, pendiente.escribir).then(error => {
      if (error) fallidas.set(clave, pendiente.escribir)
      else if (fallidas.size === 0) ultimoError = null
      avisar()
      return error
    })
  }

  const programar = (clave, escribir) => {
    const pendiente = programadas.get(clave)
    if (pendiente) {
      pendiente.escribir = escribir
      return
    }
    programadas.set(clave, { escribir, timer: setTimeout(() => disparar(clave), espera) })
    avisar()
  }

  const vaciar = () => Promise.all([...programadas.keys()].map(disparar).concat([...cadenas.values()]))
    .then(() => fallidas.size === 0)

  // Se olvida de lo agendado o fallido de una clave (ej. la fila se borró).
  const descartar = (clave) => {
    const pendiente = programadas.get(clave)
    if (pendiente) clearTimeout(pendiente.timer)
    programadas.delete(clave)
    fallidas.delete(clave)
    avisar()
  }

  const reintentar = () => {
    const lista = [...fallidas.entries()]
    fallidas.clear()
    ultimoError = null
    avisar()
    return Promise.all(lista.map(([clave, escribir]) => ejecutar(clave, escribir).then(error => {
      if (error) fallidas.set(clave, escribir)
      avisar()
      return error
    })))
  }

  return { ahora, programar, vaciar, descartar, reintentar }
}
