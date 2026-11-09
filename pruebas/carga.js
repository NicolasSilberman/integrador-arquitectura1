// Prueba de carga (escenario E8 · performance): 50 propietarios consultan su expensa en el pico de vencimiento.
// Es una fitness function: si no se cumple un umbral, k6 termina con error.
//
// Recorre el camino completo de un pedido real: gateway (valida el token y los permisos) → API → base.
// Cómo correrla: ver la prueba 20 de docs/verificacion.md.
import http from 'k6/http';
import { check, sleep } from 'k6';

const GATEWAY = __ENV.GATEWAY ?? 'http://gateway:8000';   // por la red interna del compose
const TOKEN = __ENV.TOKEN;                                  // token de acceso de paula (dura 5 minutos)
if (!TOKEN) throw new Error('Falta el token: pasalo con -e TOKEN=...');

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // rampa hasta 50 usuarios simultáneos (supuesto S1)
    { duration: '1m', target: 50 },    // pico sostenido
    { duration: '15s', target: 0 },    // bajada
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // el 95 % de las respuestas en menos de 1 s
    http_req_failed: ['rate<0.01'],    // menos del 1 % de errores
  },
};

const encabezados = { headers: { Authorization: `Bearer ${TOKEN}` } };

// Cada usuario hace lo que hace un propietario: ver la lista de sus expensas y abrir una.
export default function () {
  const lista = http.get(`${GATEWAY}/v1/expensas`, encabezados);
  check(lista, { 'lista: 200': (r) => r.status === 200 });

  const id = Math.random() < 0.5 ? 1 : 51;   // las dos expensas de paula
  const detalle = http.get(`${GATEWAY}/v1/expensas/${id}`, encabezados);
  check(detalle, { 'detalle: 200': (r) => r.status === 200 });

  sleep(1);   // el tiempo que tarda una persona en leer la pantalla
}
