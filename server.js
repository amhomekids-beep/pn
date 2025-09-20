const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

// VAPID keys (tạo trước và thêm vào env variables)
webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// API: lấy danh sách học sinh
app.get('/users', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users');
  res.json(rows);
});

// API: học sinh làm bài hôm nay
app.post('/complete', async (req, res) => {
  const { userId, score } = req.body;
  const today = new Date().toISOString().split('T')[0];
  await db.query('UPDATE users SET lastCompletedDate=?, score=? WHERE id=?', [today, score || 0, userId]);
  res.json({ status: 'ok' });
});

// API: đăng ký push notification
app.post('/subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  const { endpoint, keys } = subscription;
  await db.query(
    'INSERT INTO subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)',
    [userId, endpoint, keys.p256dh, keys.auth]
  );
  res.json({ status: 'subscribed' });
});

// Cron job 18h: gửi thông báo học sinh chưa làm bài
cron.schedule('0 18 * * *', async () => {
  const today = new Date().toISOString().split('T')[0];
  const [users] = await db.query('SELECT * FROM users WHERE lastCompletedDate<>? OR lastCompletedDate IS NULL', [today]);
  for (let user of users) {
    const [subs] = await db.query('SELECT * FROM subscriptions WHERE user_id=?', [user.id]);
    for (let s of subs) {
      const pushSubscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth }
      };
      webpush.sendNotification(pushSubscription, JSON.stringify({ title: '⚠️ Bạn chưa làm bài hôm nay!', body: 'Hãy làm bài tập ngay nhé!' })).catch(console.error);
    }
  }
  console.log('Cron job gửi notification xong');
});

app.listen(3000, () => console.log('Server chạy cổng 3000'));
