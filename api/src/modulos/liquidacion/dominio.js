// Reglas de dominio del módulo LIQUIDACIÓN que no dependen de la base.

// Dinero: centavos enteros + moneda (value object). Nunca números con decimales.
export const dinero = (centavos) => ({ centavos, moneda: 'ARS' });

// Código de pago (ADR-007): el id de la expensa con 10 dígitos + un dígito verificador (algoritmo de Luhn).
// Siempre es el mismo para la misma expensa, y un error de tipeo en un dígito se detecta.
export function codigoDePago(expensaId) {
  const base = String(expensaId).padStart(10, '0');
  let suma = 0;
  [...base].reverse().forEach((d, i) => {
    let n = Number(d);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    suma += n;
  });
  return base + ((10 - (suma % 10)) % 10);
}

// El camino inverso: de un código de pago al id de la expensa. Devuelve null si el código no es válido
// (largo incorrecto, caracteres que no son dígitos o dígito verificador que no coincide).
export function expensaIdDesdeCodigo(codigo) {
  if (!/^\d{11}$/.test(String(codigo ?? ''))) return null;
  const id = Number(codigo.slice(0, 10));
  if (id <= 0 || codigoDePago(id) !== codigo) return null;
  return id;
}
