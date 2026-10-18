// Smoke test del wire S2-17: cookie + playerId en respuesta.
const http = require('node:http');

function post(headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      method: 'POST',
      host: 'localhost',
      port: 3001,
      path: '/api/rooms',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('--- 1ª peticion (sin cookie, debe crearla) ---');
  const r1 = await post({}, { mode: 'lobby', name: 'test' });
  console.log('status:', r1.status);
  console.log('Set-Cookie:', r1.headers['set-cookie']);
  console.log('body:', r1.body);

  // Extraer el playerId para reusarlo
  const body1 = JSON.parse(r1.body);
  const playerId = body1.playerId;

  console.log('\n--- 2ª peticion (con cookie reusada, debe devolver MISMO playerId) ---');
  const r2 = await post({ Cookie: `guinote_pid=${playerId}` }, { mode: 'lobby', name: 'test2' });
  console.log('status:', r2.status);
  console.log('body:', r2.body);
  const body2 = JSON.parse(r2.body);
  console.log('playerIds iguales?', body1.playerId === body2.playerId);

  console.log('\n--- 3ª peticion (con cookie inventada, debe crear player nuevo) ---');
  const r3 = await post({ Cookie: 'guinote_pid=fake-uuid-xxx' }, { mode: 'lobby', name: 'test3' });
  console.log('status:', r3.status);
  console.log('body:', r3.body);
  const body3 = JSON.parse(r3.body);
  console.log('playerIds 1ª vs 3ª distintos?', body1.playerId !== body3.playerId);
})();