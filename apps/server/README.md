# Backend quản lý deadline Webtoon

Backend Node.js + Express cung cấp lớp API cho giao diện QC. Project không seed dữ liệu mẫu. Khi cấu hình Supabase, `supabaseRepository.js` đọc dữ liệu qua Supabase REST; nếu chưa cấu hình, các collection trả về rỗng.

## Chạy server

```bash
cd apps/server
npm install
npm run dev
```

Mặc định server chạy tại `http://localhost:5000`.

## API đọc dữ liệu

- `GET /api/health`
- `GET /api/dashboard/summary`
- `GET /api/tasks`
- `GET /api/freelancers`
- `GET /api/deadlines`
- `GET /api/company-deadlines`
- `GET /api/qrcodes`
- `GET /api/errors`
- `PATCH /api/profile`

## Biến môi trường

- `PORT`
- `GUIDE_URL`
- `RESOURCE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE_TASKS` (mặc định `SeriesList`)
- `SUPABASE_TABLE_FREELANCERS` (mặc định `Freelancer`)
- `SUPABASE_TABLE_DEADLINES` (mặc định `SeriesList`)
- `SUPABASE_TABLE_COMPANY_DEADLINES` (mặc định `Companies`)
- `SUPABASE_TABLE_QR` (mặc định `Freelancer`)
- `SUPABASE_TABLE_ERRORS` (mặc định `Error`)
