// API de expensas — monolito modular (ADR-001).
//
//   src/modulos/padron        consorcios, unidades y propietarios
//   src/modulos/liquidacion   expensas, conceptos y código de pago
//   src/modulos/cobranzas     corridas de conciliación y cobranzas del banco
//   src/http                  rutas, identidad (la pone el gateway) y errores con Problem Details
//
// Cada módulo es el único que lee y escribe sus tablas; los demás le piden lo que necesitan por su index.js.
// Seguridad (ADR-006): la API no publica su puerto; solo se llega a ella por el gateway.
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API de expensas escuchando en el puerto ${port}`));
