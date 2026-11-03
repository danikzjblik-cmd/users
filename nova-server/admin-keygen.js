#!/usr/bin/env node
const db = require('./database');

const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : 'help';

function printHeader() {
  console.log('\x1b[35m' + `
  ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ 
  ████╗  ██║██╔═══██╗██║   ██║██╔══██╗
  ██╔██╗ ██║██║   ██║██║   ██║███████║
  ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║
  ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║
  ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝
  >>> KEY & LICENSE GENERATOR <<<
` + '\x1b[0m');
}

function showHelp() {
  printHeader();
  console.log('\x1b[36mИспользование команд:\x1b[0m');
  console.log('  node admin-keygen.js create <дни> [количество]   - Создать ключи на N дней (напр. node admin-keygen.js create 30 3)');
  console.log('  node admin-keygen.js lifetime [количество]       - Создать вечный ключ (Lifetime)');
  console.log('  node admin-keygen.js list                        - Показать все созданные ключи');
  console.log('  node admin-keygen.js users                       - Список пользователей, HWID и подписок');
  console.log('  node admin-keygen.js reset-hwid <username>       - Сбросить HWID игроку');
  console.log('  node admin-keygen.js ban <username>              - Заблокировать пользователя');
  console.log('');
}

switch (command) {
  case 'create': {
    printHeader();
    const days = parseInt(args[1], 10) || 30;
    const count = parseInt(args[2], 10) || 1;
    console.log(`\x1b[32m[+] Генерация ${count} ключ(ей) на ${days} дней...\x1b[0m\n`);
    for (let i = 0; i < count; i++) {
      const k = db.generateKey(days, `CLI Admin (${days}d)`);
      console.log(`  \x1b[33m🔑 КЛЮЧ [${i + 1}]:\x1b[0m \x1b[1m\x1b[37m${k.key}\x1b[0m (\x1b[35m${k.days} дней\x1b[0m)`);
    }
    console.log('\n\x1b[32m✔ Ключи сохранены в базе и готовы к отправке клиентам!\x1b[0m\n');
    break;
  }

  case 'lifetime': {
    printHeader();
    const count = parseInt(args[1], 10) || 1;
    console.log(`\x1b[32m[+] Генерация ${count} вечных ключей (Lifetime)...\x1b[0m\n`);
    for (let i = 0; i < count; i++) {
      const k = db.generateKey(3650, 'CLI Admin (Lifetime)');
      console.log(`  \x1b[33m👑 LIFETIME [${i + 1}]:\x1b[0m \x1b[1m\x1b[37m${k.key}\x1b[0m`);
    }
    console.log('\n\x1b[32m✔ Lifetime ключи созданы!\x1b[0m\n');
    break;
  }

  case 'list': {
    printHeader();
    console.log('\x1b[36m--- СПИСОК ВСЕХ ЛИЦЕНЗИОННЫХ КЛЮЧЕЙ ---\x1b[0m');
    const keys = db.data.keys;
    if (keys.length === 0) {
      console.log('Ключей пока нет. Создайте с помощью: node admin-keygen.js create 30');
    } else {
      console.table(
        keys.map(k => ({
          'Ключ': k.key,
          'Дней': k.days >= 3650 ? 'LIFETIME' : k.days,
          'Статус': k.isUsed ? '❌ Использован' : '✅ Свободен',
          'Пользователь': k.usedBy || '-',
          'Дата активации': k.usedAt ? new Date(k.usedAt).toLocaleString('ru-RU') : '-'
        }))
      );
    }
    break;
  }

  case 'users': {
    printHeader();
    console.log('\x1b[36m--- ЗАРЕГИСТРИРОВАННЫЕ ПОЛЬЗОВАТЕЛИ ---\x1b[0m');
    const users = db.data.users;
    if (users.length === 0) {
      console.log('Пользователей пока нет.');
    } else {
      const now = Date.now();
      console.table(
        users.map(u => {
          const exp = new Date(u.expiresAt).getTime();
          const daysLeft = exp <= now ? 0 : Math.ceil((exp - now) / 86400000);
          return {
            'Логин': u.username,
            'Дней подписки': daysLeft > 0 ? `${daysLeft} д.` : 'Истекла',
            'Привязанный HWID': u.hwid ? (u.hwid.slice(0, 16) + '...') : 'Не привязан',
            'Бан': u.banned ? '⛔ БАН' : 'ОК',
            'До': new Date(u.expiresAt).toLocaleDateString('ru-RU')
          };
        })
      );
    }
    break;
  }

  case 'reset-hwid': {
    printHeader();
    const targetUser = args[1];
    if (!targetUser) {
      console.log('\x1b[31mОшибка: Укажите логин игрока. Пример: node admin-keygen.js reset-hwid vasya\x1b[0m');
      process.exit(1);
    }
    try {
      db.resetHwid(targetUser);
      console.log(`\x1b[32m✔ HWID для игрока "${targetUser}" успешно сброшен! Теперь он может войти с нового ПК.\x1b[0m`);
    } catch (e) {
      console.log(`\x1b[31mОшибка: ${e.message}\x1b[0m`);
    }
    break;
  }

  case 'ban': {
    printHeader();
    const targetUser = args[1];
    const user = db.data.users.find(u => u.username.toLowerCase() === (targetUser || '').toLowerCase());
    if (!user) {
      console.log(`\x1b[31mПользователь "${targetUser}" не найден.\x1b[0m`);
    } else {
      user.banned = true;
      db.save();
      console.log(`\x1b[31m⛔ Пользователь "${user.username}" заблокирован!\x1b[0m`);
    }
    break;
  }

  default:
    showHelp();
    break;
}
