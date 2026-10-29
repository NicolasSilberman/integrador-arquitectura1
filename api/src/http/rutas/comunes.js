import { Problema } from '../problemas.js';
import { esAdministrador } from '../auth.js';

export function idDeRuta(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Problema(400, 'parametro-invalido', 'Parámetro inválido', `El id "${valor}" no es un entero positivo.`);
  }
  return id;
}

// Autorización por PROPIEDAD, además de por rol: un propietario solo accede a lo de sus unidades.
export function verificarAcceso(usuario, unidad) {
  if (esAdministrador(usuario)) return;
  if (unidad.propietarioUsuario !== usuario.username) {
    throw new Problema(403, 'sin-permiso', 'Sin permiso', 'Esta expensa corresponde a una unidad de otro propietario.');
  }
}

export function presentarExpensa(e, unidad) {
  return {
    id: e.id,
    periodo: e.periodo,
    vencimiento: e.vencimiento,
    estado: e.estado,
    total: e.total,
    codigoPago: e.codigoPago,
    unidad: { id: unidad.id, codigo: unidad.codigo, consorcio: unidad.consorcio },
  };
}
