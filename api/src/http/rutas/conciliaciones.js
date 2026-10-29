import { Router } from 'express';
import { requiereRol } from '../auth.js';
import { Problema } from '../problemas.js';
import { ahoraEnZona, esFechaIso, sumarDias } from '../../fechas.js';
import * as cobranzas from '../../modulos/cobranzas/index.js';
import { idDeRuta } from './comunes.js';

export const rutasConciliaciones = Router();
rutasConciliaciones.use(requiereRol('administrador'));

// POST /v1/conciliaciones  { "fecha": "2026-10-27" }  (opcional; por defecto, ayer)
// Dispara la descarga y conciliación de un día de cobranzas. No es idempotente como pedido (cada POST deja una
// corrida registrada), pero SÍ lo es en sus efectos: repetirla no vuelve a imputar nada (ADR-004).
rutasConciliaciones.post('/', async (req, res) => {
  const hoy = ahoraEnZona().fecha;
  const fecha = req.body?.fecha ?? sumarDias(hoy, -1);
  if (!esFechaIso(fecha)) {
    throw new Problema(400, 'parametro-invalido', 'Parámetro inválido', 'La fecha debe tener formato AAAA-MM-DD y existir en el calendario.');
  }
  if (fecha > hoy) {
    throw new Problema(422, 'fecha-futura', 'Fecha futura', 'No se puede conciliar un día que todavía no ocurrió.');
  }
  const corrida = await cobranzas.conciliar({ fecha, origen: 'MANUAL', solicitadaPor: req.usuario.username });
  res.status(201).location(`/v1/conciliaciones/${corrida.id}`).json(corrida);
});

// GET /v1/conciliaciones  -> las últimas corridas (es lo primero que mira quien arregla "lo que falló de noche")
rutasConciliaciones.get('/', async (req, res) => {
  res.json(await cobranzas.listarCorridas());
});

// GET /v1/conciliaciones/{id}  -> la corrida con las cobranzas que procesó
rutasConciliaciones.get('/:id', async (req, res) => {
  const id = idDeRuta(req.params.id);
  const corrida = await cobranzas.obtenerCorrida(id);
  if (!corrida) throw new Problema(404, 'conciliacion-no-encontrada', 'Conciliación no encontrada', `No existe una conciliación con id ${id}.`);
  res.json({ ...corrida, cobranzas: await cobranzas.listarCobranzas({ conciliacionId: id }) });
});
