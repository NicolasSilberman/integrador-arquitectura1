import { Router } from 'express';
import { esAdministrador, requiereRol } from '../auth.js';
import { Problema } from '../problemas.js';
import * as padron from '../../modulos/padron/index.js';
import * as liquidaciones from '../../modulos/liquidaciones/index.js';
import * as cobranzas from '../../modulos/cobranzas/index.js';
import { idDeRuta, presentarExpensa, verificarAcceso } from './comunes.js';

export const rutasExpensas = Router();

// Las rutas COMPONEN módulos (padrón + liquidaciones + cobranzas); los módulos no se llaman entre sí en círculo.

// GET /v1/expensas?periodo=2026-10&estado=EMITIDA
rutasExpensas.get('/', requiereRol('propietario', 'administrador'), async (req, res) => {
  const { periodo, estado } = req.query;
  if (periodo !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    throw new Problema(400, 'parametro-invalido', 'Parámetro inválido', 'El período debe tener formato AAAA-MM (ej. 2026-10).');
  }
  if (estado !== undefined && !['EMITIDA', 'PAGADA'].includes(estado)) {
    throw new Problema(400, 'parametro-invalido', 'Parámetro inválido', 'El estado debe ser EMITIDA o PAGADA.');
  }
  // El administrador ve todo; el propietario, solo las expensas de SUS unidades.
  let unidadIds = null;
  if (!esAdministrador(req.usuario)) {
    unidadIds = (await padron.unidadesDePropietario(req.usuario.username)).map((u) => u.id);
  }
  const expensas = await liquidaciones.listar({ unidadIds, periodo, estado });
  const unidades = await padron.unidadesPorIds([...new Set(expensas.map((e) => e.unidadId))]);
  res.json(expensas.map((e) => presentarExpensa(e, unidades.get(e.unidadId))));
});

// GET /v1/expensas/{id}
rutasExpensas.get('/:id', requiereRol('propietario', 'administrador'), async (req, res) => {
  const expensa = await liquidaciones.obtener(idDeRuta(req.params.id));
  const unidad = await padron.unidad(expensa.unidadId);
  verificarAcceso(req.usuario, unidad);
  const [conceptos, pago] = await Promise.all([
    liquidaciones.conceptos(expensa.id),
    expensa.estado === 'PAGADA' ? cobranzas.pagoImputado(expensa.id) : null,
  ]);
  res.json({
    ...presentarExpensa(expensa, unidad),
    conceptos,
    pago: pago && { fechaPago: pago.fechaPago, bancoRef: pago.bancoRef, monto: pago.monto },
  });
});

// PUT /v1/expensas/{id}/codigo-pago  -> el propietario pide el código para pagar en el banco.
// PUT porque la URI es conocida (cada expensa tiene UN código) y repetirlo da el mismo resultado:
// 201 la primera vez, 200 las siguientes. Si la expensa ya está pagada: 409.
rutasExpensas.put('/:id/codigo-pago', requiereRol('propietario'), async (req, res) => {
  const expensa = await liquidaciones.obtener(idDeRuta(req.params.id));
  verificarAcceso(req.usuario, await padron.unidad(expensa.unidadId));
  const { codigoPago, creado } = await liquidaciones.asegurarCodigoDePago(expensa.id);
  if (creado) res.status(201).location(`/v1/expensas/${expensa.id}/codigo-pago`);
  res.json({ expensaId: expensa.id, codigoPago, importe: expensa.total, vencimiento: expensa.vencimiento });
});

// GET /v1/expensas/{id}/codigo-pago
rutasExpensas.get('/:id/codigo-pago', requiereRol('propietario'), async (req, res) => {
  const expensa = await liquidaciones.obtener(idDeRuta(req.params.id));
  verificarAcceso(req.usuario, await padron.unidad(expensa.unidadId));
  if (!expensa.codigoPago) {
    throw new Problema(404, 'codigo-no-generado', 'Código de pago no generado', `La expensa ${expensa.id} todavía no tiene código de pago.`);
  }
  res.json({ expensaId: expensa.id, codigoPago: expensa.codigoPago, importe: expensa.total, vencimiento: expensa.vencimiento });
});
