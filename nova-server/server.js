const http = require('http');
const db = require('./database');
const Security = require('./security');

const PORT = process.env.PORT || 3030;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-HWID, X-Signature, X-Timestamp'
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-HWID, X-Signature, X-Timestamp'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // Health / Status endpoint
    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'Nova Auth & Protection Server',
        version: '1.21.11-v2',
        serverTime: new Date().toISOString()
      });
    }

    // REGISTRATION WITH KEY AND HWID BINDING
    if (req.method === 'POST' && pathname === '/api/register') {
      const body = await parseJsonBody(req);
      const { username, password, licenseKey, hwid } = body;

      if (!username || !password || !licenseKey) {
        return sendJson(res, 400, {
          success: false,
          error: 'Пожалуйста, заполните логин, пароль и лицензионный ключ!'
        });
      }

      if (username.length < 3) {
        return sendJson(res, 400, {
          success: false,
          error: 'Имя пользователя должно содержать минимум 3 символа!'
        });
      }

      if (password.length < 4) {
        return sendJson(res, 400, {
          success: false,
          error: 'Пароль должен содержать минимум 4 символа!'
        });
      }

      try {
        const user = db.createUser(username, password, licenseKey, hwid);
        const loginData = db.login(username, password, hwid);

        return sendJson(res, 200, {
          success: true,
          message: 'Аккаунт успешно создан и активирован!',
          token: loginData.token,
          user: loginData.user
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // LOGIN
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await parseJsonBody(req);
      const { username, password, hwid } = body;

      if (!username || !password) {
        return sendJson(res, 400, {
          success: false,
          error: 'Введите логин и пароль!'
        });
      }

      try {
        const loginData = db.login(username, password, hwid);
        return sendJson(res, 200, {
          success: true,
          message: 'Успешный вход!',
          token: loginData.token,
          user: loginData.user
        });
      } catch (err) {
        return sendJson(res, 403, { success: false, error: err.message });
      }
    }

    // CURRENT USER INFO
    if (req.method === 'GET' && pathname === '/api/me') {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
      const sessionData = db.getSession(token);

      if (!sessionData) {
        return sendJson(res, 401, { success: false, error: 'Сессия недействительна или истекла!' });
      }

      return sendJson(res, 200, {
        success: true,
        user: sessionData.user
      });
    }

    // EXTEND / REDEEM KEY
    if (req.method === 'POST' && pathname === '/api/redeem') {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
      const sessionData = db.getSession(token);

      if (!sessionData) {
        return sendJson(res, 401, { success: false, error: 'Требуется авторизация!' });
      }

      const body = await parseJsonBody(req);
      const { licenseKey, hwid } = body;

      try {
        const resData = db.redeemKey(sessionData.user.username, licenseKey, hwid);
        return sendJson(res, 200, {
          success: true,
          message: 'Ключ успешно продлил подписку!',
          ...resData
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // INJECTION CHECK & TOKEN
    if (req.method === 'POST' && pathname === '/api/inject') {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
      const sessionData = db.getSession(token);

      if (!sessionData) {
        return sendJson(res, 401, { success: false, error: 'Ошибка авторизации сессии.' });
      }

      if (sessionData.user.isExpired) {
        return sendJson(res, 403, {
          success: false,
          error: 'Ваша подписка истекла! Пожалуйста, продлите ключ.'
        });
      }

      // Check client HWID match
      const reqHwid = req.headers['x-hwid'];
      if (sessionData.user.hwid && reqHwid && sessionData.user.hwid !== reqHwid) {
        return sendJson(res, 403, {
          success: false,
          error: 'Несовпадение контрольной суммы HWID!'
        });
      }

      const securePayload = Security.signResponse({
        authorized: true,
        user: sessionData.user.username,
        features: ['Combat', 'Movement', 'Player', 'Render', 'Cosmetics'],
        token: token,
        timestamp: Date.now()
      });

      return sendJson(res, 200, {
        success: true,
        message: 'Модули верифицированы. Инжект разрешен!',
        payload: securePayload
      });
    }

    // HEARTBEAT INTEGRITY CHECK
    if (req.method === 'POST' && pathname === '/api/heartbeat') {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
      const sessionData = db.getSession(token);

      if (!sessionData || sessionData.user.isExpired) {
        return sendJson(res, 403, { success: false, active: false });
      }

      return sendJson(res, 200, { success: true, active: true });
    }

    // ADMIN: GENERATE KEYS
    if (req.method === 'POST' && pathname === '/api/admin/generate') {
      const body = await parseJsonBody(req);
      const days = parseInt(body.days, 10) || 30;
      const count = parseInt(body.count, 10) || 1;
      const note = body.note || 'Admin API Generated';

      const generated = [];
      for (let i = 0; i < count; i++) {
        generated.push(db.generateKey(days, note));
      }

      return sendJson(res, 200, {
        success: true,
        count: generated.length,
        keys: generated
      });
    }

    // ADMIN: LIST KEYS
    if (req.method === 'GET' && pathname === '/api/admin/keys') {
      return sendJson(res, 200, {
        success: true,
        keys: db.data.keys
      });
    }

    // ADMIN: RESET HWID
    if (req.method === 'POST' && pathname === '/api/admin/reset-hwid') {
      const body = await parseJsonBody(req);
      const { username } = body;
      try {
        db.resetHwid(username);
        return sendJson(res, 200, {
          success: true,
          message: `HWID для пользователя "${username}" успешно сброшен!`
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    }

    // Fallback 404
    return sendJson(res, 404, { success: false, error: 'Endpoint not found' });
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    return sendJson(res, 500, { success: false, error: 'Internal Server Error: ' + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`   NOVA CLIENT - AUTH & LICENSE SERVER ONLINE   `);
  console.log(`   Listening on: http://localhost:${PORT}      `);
  console.log(`===============================================`);
});
