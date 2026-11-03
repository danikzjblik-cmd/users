const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

class Database {
  constructor() {
    this.data = {
      users: [],
      keys: [],
      sessions: [],
      logs: []
    };
    this.init();
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(raw);
      } catch (e) {
        console.error('[DB] Error reading database, recreating backup:', e.message);
        this.save();
      }
    } else {
      // Seed default admin and demo keys
      this.seedDefaults();
      this.save();
    }
  }

  save() {
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
  }

  seedDefaults() {
    // Generate initial sample keys
    const demoKeys = [
      { key: 'NOVA-DEMO-30D-K8J2-98A1', days: 30, note: 'Default 30 Days Key' },
      { key: 'NOVA-VIP-LIFE-X992-ZZ01', days: 3650, note: 'Lifetime Key' },
      { key: 'NOVA-TEST-7DAY-77A2-11B3', days: 7, note: 'Test 7 Days Key' }
    ];

    for (const k of demoKeys) {
      this.data.keys.push({
        key: k.key,
        days: k.days,
        isUsed: false,
        usedBy: null,
        usedAt: null,
        createdAt: new Date().toISOString(),
        note: k.note
      });
    }

    console.log('[DB] Seeded initial demo license keys.');
  }

  hashPassword(password, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
  }

  createUser(username, password, licenseKey, hwid) {
    username = username.trim().toLowerCase();
    const existing = this.data.users.find(u => u.username.toLowerCase() === username);
    if (existing) {
      throw new Error('Пользователь с таким именем уже существует!');
    }

    // Verify key
    const keyObj = this.data.keys.find(k => k.key.trim().toUpperCase() === licenseKey.trim().toUpperCase());
    if (!keyObj) {
      throw new Error('Неверный лицензионный ключ!');
    }
    if (keyObj.isUsed) {
      throw new Error('Данный ключ уже активирован другим пользователем!');
    }

    const { hash, salt } = this.hashPassword(password);
    const now = Date.now();
    const expiresAt = now + keyObj.days * 24 * 60 * 60 * 1000;

    const user = {
      id: crypto.randomUUID(),
      username: username,
      passwordHash: hash,
      salt: salt,
      hwid: hwid || null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      activeKey: keyObj.key,
      role: 'user',
      banned: false
    };

    // Mark key as used
    keyObj.isUsed = true;
    keyObj.usedBy = username;
    keyObj.usedAt = new Date(now).toISOString();

    this.data.users.push(user);
    this.logAction('REGISTER', username, hwid, `Registered with key ${keyObj.key} (${keyObj.days} days)`);
    this.save();

    return user;
  }

  login(username, password, hwid) {
    username = username.trim().toLowerCase();
    const user = this.data.users.find(u => u.username.toLowerCase() === username);
    if (!user) {
      throw new Error('Пользователь не найден!');
    }

    if (user.banned) {
      throw new Error('Ваш аккаунт заблокирован администрацией!');
    }

    const { hash } = this.hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      throw new Error('Неверный пароль!');
    }

    // HWID check
    if (!user.hwid && hwid) {
      // First bind
      user.hwid = hwid;
      this.save();
    } else if (user.hwid && hwid && user.hwid !== hwid) {
      this.logAction('HWID_MISMATCH', username, hwid, `Expected ${user.hwid}, got ${hwid}`);
      throw new Error('Ошибка привязки HWID! Аккаунт привязан к другому ПК. Обратитесь к администратору для сброса.');
    }

    // Subscription check
    const now = Date.now();
    const expiresAt = new Date(user.expiresAt).getTime();
    const isExpired = expiresAt <= now;
    const daysLeft = isExpired ? 0 : Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    this.data.sessions.push({
      token,
      userId: user.id,
      username: user.username,
      hwid: hwid || user.hwid,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    this.logAction('LOGIN_SUCCESS', username, hwid, `Logged in successfully. Days left: ${daysLeft}`);
    this.save();

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        expiresAt: user.expiresAt,
        daysLeft,
        isExpired,
        hwid: user.hwid,
        role: user.role
      }
    };
  }

  getSession(token) {
    if (!token) return null;
    const session = this.data.sessions.find(s => s.token === token);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return null;
    }

    const user = this.data.users.find(u => u.id === session.userId);
    if (!user || user.banned) return null;

    const now = Date.now();
    const expiresAt = new Date(user.expiresAt).getTime();
    const daysLeft = expiresAt <= now ? 0 : Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    return {
      session,
      user: {
        id: user.id,
        username: user.username,
        expiresAt: user.expiresAt,
        daysLeft,
        isExpired: expiresAt <= now,
        hwid: user.hwid,
        role: user.role
      }
    };
  }

  redeemKey(username, licenseKey, hwid) {
    username = username.trim().toLowerCase();
    const user = this.data.users.find(u => u.username.toLowerCase() === username);
    if (!user) throw new Error('Пользователь не найден!');

    const keyObj = this.data.keys.find(k => k.key.trim().toUpperCase() === licenseKey.trim().toUpperCase());
    if (!keyObj) throw new Error('Неверный лицензионный ключ!');
    if (keyObj.isUsed) throw new Error('Данный ключ уже активирован!');

    const now = Date.now();
    const currentExpiry = new Date(user.expiresAt).getTime();
    const baseTime = currentExpiry > now ? currentExpiry : now;
    const newExpiresAt = baseTime + keyObj.days * 24 * 60 * 60 * 1000;

    user.expiresAt = new Date(newExpiresAt).toISOString();
    keyObj.isUsed = true;
    keyObj.usedBy = username;
    keyObj.usedAt = new Date(now).toISOString();

    if (hwid && !user.hwid) {
      user.hwid = hwid;
    }

    this.logAction('REDEEM_KEY', username, hwid, `Activated key ${keyObj.key} (+${keyObj.days} days)`);
    this.save();

    const daysLeft = Math.ceil((newExpiresAt - now) / (1000 * 60 * 60 * 24));
    return { success: true, daysLeft, expiresAt: user.expiresAt };
  }

  generateKey(days = 30, note = 'Generated by admin') {
    const chunk1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const chunk2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const chunk3 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const key = `NOVA-${days >= 3650 ? 'LIFE' : days + 'D'}-${chunk1}-${chunk2}${chunk3}`;

    const keyObj = {
      key,
      days,
      isUsed: false,
      usedBy: null,
      usedAt: null,
      createdAt: new Date().toISOString(),
      note
    };

    this.data.keys.push(keyObj);
    this.save();
    return keyObj;
  }

  resetHwid(username) {
    username = username.trim().toLowerCase();
    const user = this.data.users.find(u => u.username.toLowerCase() === username);
    if (!user) throw new Error('Пользователь не найден!');

    const oldHwid = user.hwid;
    user.hwid = null;
    this.logAction('RESET_HWID', username, oldHwid, 'HWID has been cleared by admin');
    this.save();
    return true;
  }

  logAction(action, username, hwid, details) {
    this.data.logs.push({
      id: crypto.randomUUID(),
      action,
      username,
      hwid,
      details,
      timestamp: new Date().toISOString()
    });
    // Keep logs bounded
    if (this.data.logs.length > 1000) {
      this.data.logs.shift();
    }
  }
}

module.exports = new Database();
