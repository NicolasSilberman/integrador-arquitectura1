// Reglas puras del dominio de liquidaciones (no saben nada de HTTP ni de la base).

// Value Object Dinero: monto en centavos enteros + moneda. Nunca se usan decimales para plata.
export const dinero = (centavos) => ({ centavos, moneda: 'ARS' });

// Dígito verificador de Luhn: el banco rechaza un código mal tipeado antes de que llegue a nosotros.
function digitoLuhn(digitos) {
  let suma = 0;
  let duplicar = true;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = Number(digitos[i]);
    if (duplicar) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    duplicar = !duplicar;
  }
  return (10 - (suma % 10)) % 10;
}

// El código de pago se deriva de la expensa (UNA expensa, UN código): pedirlo dos veces da el mismo.
// Es lo que hace idempotente la operación y lo que impide dos códigos "vivos" para la misma deuda.
export function codigoDePago(expensaId) {
  const base = String(expensaId).padStart(10, '0');
  return base + digitoLuhn(base);
}
