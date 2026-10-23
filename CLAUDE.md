# ma-finance

App de finanzas personales (React + Supabase). Se despliega en Vercel automáticamente desde la rama `master`.

## Flujo de trabajo — llevar los cambios a master

El dueño del repo autorizó de forma permanente el siguiente flujo. Al terminar cualquier cambio pedido por el usuario:

1. Verificá que el build pase: `CI=true npx react-scripts build`
2. Commiteá y pusheá a la rama de la sesión, como siempre.
3. Creá el pull request hacia `master` y **mergealo inmediatamente** (método squash), sin pedir confirmación. Esto cuenta como pedido explícito del usuario para crear y mergear el PR.
4. Avisale al usuario que el cambio ya quedó en `master` y que Vercel lo va a desplegar solo.

No hace falta preguntar antes de mergear: si el build pasa y el cambio es lo que el usuario pidió, va directo a `master`.

## Versión en inglés

La interfaz se sigue escribiendo en español. El inglés (selector ES | EN arriba) se
pone encima en el navegador, a partir del diccionario `src/i18n/en.json`, que tiene el
texto en español como clave (ver `src/i18n/traduccionEnVivo.js`).

Si agregás o cambiás un texto que se ve en pantalla, agregá su traducción en
`en.json`; las partes variables de un template van como `{0}`, `{1}`…
(`"Error al guardar: {0}": "Error saving: {0}"`). Si es código o se escribe igual en
inglés, va en `sinTraducir.json`. `node scripts/textosDeLaApp.js` lista los que
faltan, y el test `src/i18n/en.test.js` falla si queda alguno sin traducir.
