# Mi Presupuesto

Aplicación web estática para planificar y registrar el presupuesto mensual en soles peruanos (PEN). Se ejecuta desde la raíz del proyecto con `python3 -m http.server 8000`; luego abre `http://localhost:8000`. No requiere instalación de dependencias.

## Repositorio y publicación

- Repositorio público: [jadirhervias/upc-copilot-app](https://github.com/jadirhervias/upc-copilot-app).
- Dirección prevista en GitHub Pages: [Mi Presupuesto](https://jadirhervias.github.io/upc-copilot-app/). Requiere activar Pages desde `main` y `/(root)` y esperar el despliegue.
- [Guía paso a paso para publicar y verificar la aplicación](docs/publicar-github-pages.md).

Los datos guardados en `localhost` no se transfieren a GitHub Pages: cada dirección y navegador conserva su propio almacenamiento local.

## Problemática

Llevar un presupuesto mensual en herramientas separadas puede dificultar ver cuánto se asignó a cada categoría, qué movimientos ya se registraron y cuánto queda disponible. Además, un cambio de presupuesto no debe reescribir el contexto de meses que ya tienen historial.

## Contexto

La aplicación organiza el presupuesto por mes y conserva la configuración y los movimientos en el almacenamiento local del navegador. La fecha inicial corresponde al mes actual del dispositivo. No se envían datos a un servicio remoto.

## Usuario objetivo

Personas que desean planificar un monto mensual, registrar gastos y aportes, y consultar su historial mensual desde un navegador.

## Objetivo

Ofrecer una interfaz sencilla en español para definir presupuestos mensuales, asignar montos a categorías y revisar los gastos, aportes y saldos sin perder el historial al cambiar de mes.

## Solución y funcionalidades implementadas

- Interfaz adaptable en español y montos en soles peruanos.
- Navegación mensual mediante botones de mes anterior/siguiente, selectores de mes y año e indicador para volver al mes actual.
- Presupuesto predeterminado editable y excepciones por mes. Cambiar de mes solo consulta datos; no crea ni modifica presupuestos.
- Si un mes tiene una configuración propia, esta se conserva al cambiar el presupuesto predeterminado.
- Al aplicar el predeterminado en un mes sin movimientos, se quita la excepción de presupuesto y el historial existente no se elimina.
- En un mes con movimientos, el monto del mes queda conservado como excepción para no alterar asignaciones históricas; cambios posteriores al predeterminado no modifican esa copia.
- Distribución: Gastos esenciales 50 %, Inversión 25 %, Ahorro y reserva 15 % y Gastos personales 10 %. Las asignaciones se calculan en céntimos y suman exactamente el presupuesto.
- Registro de movimientos con descripción, monto positivo de hasta dos decimales, fecha válida del mes seleccionado, tipo y categoría. Se pueden editar y eliminar movimientos; el historial se ordena del más reciente al más antiguo.
- Resumen por mes con gastos, aportes, total utilizado y saldo disponible, incluidas cifras negativas si el total supera el presupuesto.
- Indicadores por categoría para gastos y metas de ahorro e inversión, con porcentajes y excesos concretos. Las barras se limitan visualmente al 100 % y los estados se determinan a partir de importes exactos.
- Persistencia por mes en `localStorage`. Al registrar el primer movimiento de un mes que usa el predeterminado, se conserva una copia del monto para ese mes.
- Protección ante cambios desde otra pestaña: antes de guardar se comparan los datos actuales con la versión cargada. Si cambiaron, la aplicación informa el conflicto, no sobrescribe los datos compartidos y mantiene abierto el formulario con sus valores.

## Decisiones del usuario

- Simplificar Inversión eliminando las subdivisiones que tenía en una versión anterior.
- Usar términos claros en español en toda la interfaz.
- Mejorar la navegación mensual con controles accesibles, selectores de mes/año e inicio en el mes actual.
- Incorporar un presupuesto predeterminado y excepciones mensuales, sin elegir automáticamente un mes anterior como predeterminado.
- Mantener las asignaciones históricas de meses que ya tienen movimientos.

## Aporte de GitHub Copilot

GitHub Copilot asistió en la implementación y mantenimiento de la aplicación a partir de las decisiones y requisitos indicados por el usuario. La solución es una aplicación estática sin dependencias de terceros; los importes se calculan en céntimos enteros y los datos se guardan en el navegador.

El trabajo se realizó por etapas: planificación, presupuesto mensual, mejora de la navegación, registro y edición de movimientos, indicadores visuales y corrección de errores. Se revisaron sus propuestas y se ajustaron las subdivisiones, el vocabulario, el presupuesto predeterminado y la conservación del historial. Las pruebas incluyen los límites del 80 % y 100 %, saldos negativos menores de un sol y conflictos entre sesiones que comparten almacenamiento.

## Fuera del alcance

Rentabilidad, valor de mercado, simulaciones y recomendaciones de productos financieros no forman parte del objetivo de esta aplicación.

## Pruebas

Ejecuta `node --test` desde la raíz para correr las pruebas automatizadas. Incluyen asignaciones y sumas en céntimos, validaciones de movimientos, indicadores, preservación de presupuestos históricos y detección de conflictos entre dos sesiones que comparten almacenamiento.
