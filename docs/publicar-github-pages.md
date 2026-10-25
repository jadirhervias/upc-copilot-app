# Publicar Mi Presupuesto en GitHub Pages

Repositorio: [jadirhervias/upc-copilot-app](https://github.com/jadirhervias/upc-copilot-app).

La aplicación es estática: HTML, CSS y JavaScript. No necesita compilación, servidor de aplicaciones ni instalación de paquetes. La publicación se configura desde la rama `main` y la carpeta raíz, donde está `index.html`.

## Paso a paso

1. Inicia sesión en GitHub con una cuenta administradora del repositorio y abre [el repositorio](https://github.com/jadirhervias/upc-copilot-app).
2. En **Code**, confirma que la rama `main` contiene `index.html`, `styles.css`, `app.js` y `budget.mjs` en la raíz. No elijas la carpeta `docs` como origen: contiene esta guía, no la aplicación.
3. Abre **Settings**. Si la pestaña está oculta, búscala en el menú de pestañas adicionales.
4. En la barra lateral, dentro de **Code and automation**, abre **Pages**.
5. En **Build and deployment → Source**, selecciona **Deploy from a branch**.
6. En **Branch**, selecciona **main** y **/(root)**.
7. Pulsa **Save**.
8. Abre **Actions** y espera a que la ejecución de **pages build and deployment** termine correctamente. Si hay un error, abre esa ejecución y revisa sus mensajes.
9. Vuelve a **Settings → Pages** y abre **Visit site** cuando aparezca. La dirección esperada, sin dominio personalizado, es [https://jadirhervias.github.io/upc-copilot-app/](https://jadirhervias.github.io/upc-copilot-app/).
10. Comprueba la aplicación desde una ventana privada, sin iniciar sesión en GitHub. Configura un presupuesto y registra un movimiento de prueba. Verifica también el enlace desde un celular o una ventana estrecha.

El enlace esperado solo estará operativo después de activar Pages y completar el despliegue. Guardar los archivos en el repositorio no activa por sí solo esta configuración.

## Qué comprobar antes de entregar

- El repositorio se puede abrir sin iniciar sesión.
- La página carga estilos, selectores y formularios, y no muestra errores de JavaScript.
- Con presupuesto de S/ 2,000 y movimientos por S/ 100, S/ 50, S/ 80 y S/ 20, el total utilizado es S/ 250 y el saldo es S/ 1,750.
- Las alertas distinguen límites de gasto de metas de ahorro e inversión.
- Editar y eliminar actualiza los totales; recargar conserva los datos del navegador.
- Los enlaces del repositorio, la aplicación y el video de máximo un minuto son accesibles para el docente.

## Datos locales y cambios posteriores

Cada navegador guarda su información en `localStorage`. Los datos que registraste en `localhost:8000` no se transfieren automáticamente a la dirección de GitHub Pages. La publicación tampoco sincroniza los presupuestos entre dispositivos.

Al subir nuevos cambios a `main`, GitHub Pages vuelve a publicar la aplicación. Revisa **Actions** y recarga cuando termine. No se necesita mantener el servidor local encendido para usar la versión publicada.

## Si algo falla

- **Error 404:** confirma `main`, `/(root)` y la existencia de `index.html`; revisa si el despliegue ya terminó.
- **Se ve una versión anterior:** espera al despliegue y fuerza una recarga con `Cmd + Shift + R` en macOS o `Ctrl + Shift + R` en Windows/Linux.
- **La página aparece sin estilos o sin interacción:** revisa la consola del navegador y que las rutas sean relativas, como `./styles.css`, `./app.js` y `./budget.mjs`.
- **No aparece Settings o Pages:** comprueba que la cuenta tiene permisos de administración o mantenimiento y que Pages está permitido en el repositorio.
- **No aparecen tus gastos anteriores:** asegúrate de usar el mismo navegador, perfil y dirección; `localhost` y GitHub Pages tienen almacenes separados.

## Referencia oficial

[Configurar un origen de publicación para GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
