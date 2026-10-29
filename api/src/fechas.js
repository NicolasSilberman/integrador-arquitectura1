import { config } from './config.js';

// Fecha y hora "de pared" en la zona del consorcio, sin depender de la zona del servidor.
export function ahoraEnZona(fecha = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.zonaHoraria, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(fecha).map((p) => [p.type, p.value]),
  );
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

export function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// "2026-10-28" y además que exista en el calendario (no "2026-02-31").
export function esFechaIso(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  return new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
}
