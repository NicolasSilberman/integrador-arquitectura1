// Conciliación automática diaria (ADR-009). Vive dentro de la API: no hay cola, worker ni cron externo que operar.
//
// Diseñado para un sistema SIN GUARDIA: no importa a qué hora falle el banco o se caiga el servidor,
// el sistema se "pone al día" solo. Cada minuto revisa: ¿hay días de cobranza sin conciliar con éxito?
// Si los hay y ya pasó la hora configurada, los concilia (del más viejo al más nuevo) y reintenta cada
// N minutos hasta lograrlo. Como la conciliación es idempotente, reintentar nunca duplica nada.
import { config } from './config.js';
import { ahoraEnZona, sumarDias } from './fechas.js';
import * as cobranzas from './modulos/cobranzas/index.js';

// Qué días faltan conciliar: desde el siguiente al último conciliado hasta ayer (máximo N días hacia atrás).
// Si nunca se concilió nada, solo ayer (no se recorre un pasado que el sistema no administraba).
export async function diasPendientes(ahora) {
  const ayer = sumarDias(ahora.fecha, -1);
  const ultima = await cobranzas.ultimaFechaConciliada();
  const limite = sumarDias(ayer, -(config.conciliacion.maxDiasAtrasados - 1));
  let desde = ultima ? sumarDias(ultima, 1) : ayer;
  if (desde < limite) desde = limite;
  const dias = [];
  for (let d = desde; d <= ayer; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

// Un ciclo del planificador. Recibe "ahora" para poder probarlo sin esperar al reloj real.
export async function ejecutarCiclo(instante = new Date()) {
  const ahora = ahoraEnZona(instante);
  if (ahora.hora < config.conciliacion.hora) return { ejecutadas: [] };
  const ejecutadas = [];
  for (const dia of await diasPendientes(ahora)) {
    const minutos = await cobranzas.minutosDesdeUltimoIntento(dia);
    if (minutos !== null && minutos < config.conciliacion.reintentoMin) break;     // falló hace poco: esperar para reintentar
    try {
      await cobranzas.conciliar({ fecha: dia, origen: 'AUTOMATICA' });
      ejecutadas.push({ dia, resultado: 'OK' });
    } catch (err) {
      console.error(`[conciliación automática] ${dia}: ${err.detail ?? err.message}`);
      ejecutadas.push({ dia, resultado: 'ERROR' });
      break;     // si un día falla no se saltea: se conserva el orden y se reintenta más tarde
    }
  }
  return { ejecutadas };
}

export function iniciarPlanificador(cadaMs = 60_000) {
  const temporizador = setInterval(() => ejecutarCiclo().catch((err) => console.error('[planificador]', err)), cadaMs);
  temporizador.unref();
  return temporizador;
}
