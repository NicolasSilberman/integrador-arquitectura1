// Backend For Frontend (BFF) para la app mobile.
// No tiene base de datos ni lógica de negocio: le pide los datos a la API y los adapta
// a lo que necesita ESTE cliente (menos campos, nombres pensados para la pantalla).
import http from 'node:http';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const PORT = Number(process.env.PORT ?? 3001);

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/mobile/cursos') {
    try {
      const resp = await fetch(`${API_URL}/cursos`);   // service discovery: "api" se resuelve por DNS de Docker
      const cursos = await resp.json();
      return send(res, 200, {
        total: cursos.length,
        items: cursos.map((c) => ({ id: c.id, titulo: c.nombre, cupo: c.cupo })),
      });
    } catch (err) {
      console.error(err.message);
      return send(res, 502, { type: 'about:blank', title: 'API no disponible', status: 502,
        detail: `El BFF no pudo comunicarse con ${API_URL}.` }, 'application/problem+json');
    }
  }
  send(res, 404, { type: 'about:blank', title: 'No encontrado', status: 404 }, 'application/problem+json');
});

server.listen(PORT, () => console.log(`BFF mobile escuchando en ${PORT}, API en ${API_URL}`));
