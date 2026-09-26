import express from 'express';
import cors from 'cors';
import { isSupabaseConfigured, selectRows } from './supabaseRepository.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const emptyCollections = {
  tasks: [],
  freelancers: [],
  deadlines: [],
  companyDeadlines: [],
  qrcodes: [],
  errors: []
};

async function getCollection(collection) {
  if (!isSupabaseConfigured()) return emptyCollections[collection];
  const rows = await selectRows(collection);
  if (collection === 'qrcodes') {
    return rows.filter((row) => row.imageQR || row.imageQr || row.qrUrl || row.url);
  }
  return rows;
}

async function sendCollection(collection, res) {
  try {
    res.json({ success: true, data: await getCollection(collection) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Webtoon Deadline Management API',
    dataSource: isSupabaseConfigured() ? 'supabase' : 'empty'
  });
});

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const tasks = await getCollection('tasks');
    const completed = tasks.filter((item) => /hoàn thành|completed|done/i.test(item.status || item.statusRaw || '')).length;
    const assigned = tasks.filter((item) => item.fId || item.fIld || item.freelancerId || item.assignedToId || item.assignedTo).length;
    const review = tasks.filter((item) => /qc|review|duyệt|kiểm/i.test(item.status || item.statusRaw || '')).length;

    res.json({
      success: true,
      data: {
        guideUrl: process.env.GUIDE_URL || '',
        resourceUrl: process.env.RESOURCE_URL || '',
        waitingTasks: tasks.length - assigned,
        assignedTasks: assigned,
        reviewTasks: review,
        completedTasks: completed
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.get('/api/tasks', (req, res) => sendCollection('tasks', res));
app.get('/api/freelancers', (req, res) => sendCollection('freelancers', res));
app.get('/api/deadlines', (req, res) => sendCollection('deadlines', res));
app.get('/api/company-deadlines', (req, res) => sendCollection('companyDeadlines', res));
app.get('/api/qrcodes', (req, res) => sendCollection('qrcodes', res));
app.get('/api/errors', (req, res) => sendCollection('errors', res));

app.patch('/api/profile', (req, res) => {
  res.status(501).json({ success: false, message: 'Profile persistence chưa được cấu hình với Supabase.' });
});

app.post('/api/auth/login', (req, res) => {
  res.status(501).json({ success: false, message: 'Authentication sẽ được xử lý qua Supabase Auth.' });
});

app.listen(PORT, () => {
  console.log(`Webtoon Deadline Management API listening on port ${PORT}`);
});
