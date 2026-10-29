import { Router } from 'express';
import { requiereRol } from '../auth.js';
import { Problema } from '../problemas.js';
import * as cobranzas from '../../modulos/cobranzas/index.js';

export const rutasCobranzas = Router();
rutasCobranzas.use(requiereRol('administrador'));

// GET /v1/cobranzas?estado=OBSERVADA  -> lo que el administrador tiene que resolver a mano
rutasCobranzas.get('/', async (req, res) => {
  const { estado } = req.query;
  if (estado !== undefined && !['IMPUTADA', 'OBSERVADA'].includes(estado)) {
    throw new Problema(400, 'parametro-invalido', 'Parámetro inválido', 'El estado debe ser IMPUTADA u OBSERVADA.');
  }
  res.json(await cobranzas.listarCobranzas({ estado }));
});
