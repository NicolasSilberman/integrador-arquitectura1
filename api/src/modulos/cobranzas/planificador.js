// Conciliación automática diaria (ADR-004). Corre dentro de la API: no hay worker, cola ni cron externo.
//
// Pensada para un sistema SIN GUARDIA: falle cuando falle el banco, o aunque la API haya estado apagada,
// el sistema se pone al día solo. Cada minuto revisa si quedan días sin conciliar con éxito. Si quedan,
// y ya pasó la hora configurada, los concilia del más viejo al más nuevo. Si un día falla, no lo saltea:
// espera unos minutos y lo reintenta. Reintentar no duplica nada (ADR-007).
//
// Configuración (variables de entorno):
//   CONCILIACION_HORA            hora de Argentina desde la que corre, HH:MM (por defecto 07:00)
//   CONCILIACION_REINTENTO_MIN   minutos de espera antes de reintentar un día que falló (por defecto 30)
//   CONCILIACION_MAX_DIAS        cuántos días hacia atrás se pone al día como máximo (por defecto 7)
import { conciliar } from './conciliacion.js';
import { primeraFechaConciliada, fechasConciliadasEntre, minutosDesdeUltimoIntento } from './index.js';

const ZONA = 'America/Argentina/Buenos_Aires';

function leerHora(texto) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`CONCILIACION_HORA inválida: "${texto}". Usá el formato HH:MM, por ejemplo 07:00.`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

const config = {
  minutoDelDia: leerHora(process.env.CONCILIACION_HORA ?? '07:00'),
  reintentoMin: Number(process.env.CONCILIACION_REINTENTO_MIN ?? 30),
  maxDias: Number(process.env.CONCILIACION_MAX_DIAS ?? 7),
};

// Fecha (AAAA-MM-DD) y minuto del día de un instante, en la hora de Argentina
function enArgentina(instante) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante).map((p) => [p.type, p.value]));
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, minutoDelDia: Number(partes.hour) * 60 + Number(partes.minute) };
}

const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Días sin una corrida OK, del más viejo al más nuevo, hasta ayer.
// Se mira como máximo CONCILIACION_MAX_DIAS hacia atrás, y nunca antes de la primera fecha que el sistema
// concilió: si nunca concilió nada, solo ayer (no se recorre un pasado que el sistema no administraba).
export async function diasPendientes(hoy) {
  const ayer = sumarDias(hoy, -1);
  const limite = sumarDias(ayer, -(config.maxDias - 1));
  const primera = await primeraFechaConciliada();
  const desde = [limite, primera ?? ayer].sort().at(-1);
  if (desde > ayer) return [];
  const conciliadas = new Set(await fechasConciliadasEntre(desde, ayer));
  const dias = [];
  for (let d = desde; d <= ayer; d = sumarDias(d, 1)) if (!conciliadas.has(d)) dias.push(d);
  return dias;
}

// Un ciclo del planificador. Recibe el instante para poder probarlo sin esperar al reloj real.
// Devuelve qué hizo con cada día: OK, ERROR, EN_CURSO (había otra corrida) o ESPERANDO (falló hace poco).
export async function ejecutarCiclo(instante = new Date()) {
  const ahora = enArgentina(instante);
  if (ahora.minutoDelDia < config.minutoDelDia) return [];        // todavía no es la hora
  const resultado = [];
  for (const dia of await diasPendientes(ahora.fecha)) {
    const minutos = await minutosDesdeUltimoIntento(dia);         // medido con el reloj de la base
    if (minutos !== null && minutos < config.reintentoMin) { resultado.push({ dia, resultado: 'ESPERANDO' }); break; }
    try {
      const corrida = await conciliar({ fecha: dia, origen: 'AUTOMATICA' });
      console.log(`[conciliación automática] ${dia}: corrida ${corrida.id} OK (${corrida.imputadas} imputadas, ${corrida.observadas} observadas)`);
      resultado.push({ dia, resultado: 'OK' });
    } catch (err) {
      if (err.status === 409) {
        console.log(`[conciliación automática] ${dia}: hay otra conciliación en curso, se reintenta en el próximo ciclo`);
        resultado.push({ dia, resultado: 'EN_CURSO' });
      } else {
        console.error(`[conciliación automática] ${dia}: ${err.detail ?? err.message} Se reintenta en ${config.reintentoMin} minutos.`);
        resultado.push({ dia, resultado: 'ERROR' });
      }
      break;   // si un día no se pudo conciliar, los siguientes esperan: se respeta el orden
    }
  }
  return resultado;
}

// Arranca el planificador: un ciclo al iniciar y después uno por minuto (sin superponerse).
export function iniciarPlanificador(cadaMs = 60_000) {
  let ocupado = false;
  const ciclo = async () => {
    if (ocupado) return;
    ocupado = true;
    try { await ejecutarCiclo(); } catch (err) { console.error('[conciliación automática] error inesperado:', err.message); }
    finally { ocupado = false; }
  };
  const hh = String(Math.floor(config.minutoDelDia / 60)).padStart(2, '0');
  const mm = String(config.minutoDelDia % 60).padStart(2, '0');
  console.log(`Conciliación automática activa: cada día desde las ${hh}:${mm} (hora de Argentina), reintento cada ${config.reintentoMin} min`);
  ciclo();
  const temporizador = setInterval(ciclo, cadaMs);
  temporizador.unref();
  return temporizador;
}
