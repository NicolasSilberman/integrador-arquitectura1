// API de expensas — monolito modular (ADR-001).
//
//   src/modulos/padron        consorcios, unidades y propietarios
//   src/modulos/liquidacion   expensas, conceptos y código de pago
//   src/modulos/cobranzas     corridas de conciliación, cobranzas del banco y conciliación automática
//   src/http                  rutas, identidad (la pone el gateway) y errores con Problem Details
//
// Cada módulo es el único que lee y escribe sus tablas; los demás le piden lo que necesitan por su index.js.
// Seguridad (ADR-006): la API no publica su puerto; solo se llega a ella por el gateway.
import { app } from './app.js';
import * as cobranzas from './modulos/cobranzas/index.js';

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API de expensas escuchando en el puerto ${port}`));

// Conciliación automática diaria (ADR-004). Se puede apagar con CONCILIACION_AUTOMATICA=false.
try {
  const interrumpidas = await cobranzas.marcarInterrumpidas();
  if (interrumpidas > 0) console.log(`${interrumpidas} conciliación(es) interrumpida(s) por un reinicio quedaron en ERROR y se van a reintentar`);
} catch (err) {
  console.error('No se pudieron revisar las conciliaciones interrumpidas:', err.message);
}
if (process.env.CONCILIACION_AUTOMATICA !== 'false') cobranzas.iniciarPlanificador();
else console.log('Conciliación automática desactivada (CONCILIACION_AUTOMATICA=false)');
