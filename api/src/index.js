import { crearApp } from './app.js';
import { config } from './config.js';
import { marcarInterrumpidas } from './modulos/cobranzas/index.js';
import { iniciarPlanificador } from './scheduler.js';

const interrumpidas = await marcarInterrumpidas().catch((err) => {
  // La base puede tardar en estar lista: docker-compose espera su healthcheck, pero no es un error fatal.
  console.error('No se pudo revisar corridas interrumpidas:', err.message);
  return 0;
});
if (interrumpidas) console.warn(`Se marcaron ${interrumpidas} conciliación(es) interrumpida(s) por un reinicio.`);

crearApp().listen(config.port, () => {
  console.log(`API de expensas escuchando en el puerto ${config.port} (DB en ${config.db.host}, banco en ${config.banco.url})`);
});

if (config.conciliacion.automatica) {
  iniciarPlanificador();
  console.log(`Conciliación automática activa: desde las ${config.conciliacion.hora} (${config.zonaHoraria}), reintento cada ${config.conciliacion.reintentoMin} min.`);
}
