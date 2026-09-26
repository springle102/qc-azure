# Backend quản lý deadline Webtoon

Backend Node.js + Express cung cấp lớp API cho giao diện QC. Backend ưu tiên đọc trực tiếp PostgreSQL qua `DATABASE_URL`; nếu không có, nó fallback sang Supabase REST. Nếu chưa cấu hình nguồn dữ liệu, các collection trả về rỗng.

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
- `GET /api/qcs`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/accounts` (Admin)
- `POST /api/accounts` (Admin; role Freelancer/QC bắt buộc chọn ít nhất một `field` đang cấu hình và tự tạo hồ sơ thành viên)
- `PATCH /api/accounts/:id` (Admin)
- `GET /api/deadlines`
- `POST /api/deadlines`
- `PATCH /api/deadlines/:seriesId/:chapterNumber`
- `PATCH /api/deadlines/:seriesId/:chapterNumber/status` (Freelancer chỉ được chọn `doing` hoặc `submitted`; Admin/QC được chọn mọi status)
- `GET /api/fields`
- `POST /api/fields` (Admin)
- `PATCH /api/fields/:id` (Admin)
- `DELETE /api/fields/:id` (Admin)
- `GET /api/general-settings`
- `PATCH /api/general-settings` (Admin; cấu hình kết nối Google Sheet)
- `POST /api/google-sheet/sync` (Admin; đồng bộ Google Sheet vào `SeriesList`)
- `GET /api/difficulty-levels`
- `POST /api/difficulty-levels`
- `PATCH /api/difficulty-levels/:id`
- `DELETE /api/difficulty-levels/:id`
- `GET /api/difficulty-prices`
- `POST /api/difficulty-prices`
- `PATCH /api/difficulty-prices/:id`
- `DELETE /api/difficulty-prices/:id`
- `GET /api/bonus-settings`
- `PATCH /api/bonus-settings`
- `GET /api/salaries`
- `PATCH /api/profile`

## Biến môi trường

- `PORT`
- `DATABASE_URL` (PostgreSQL trực tiếp, được ưu tiên nếu có)
- `GUIDE_URL`
- `RESOURCE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE_TASKS` (mặc định `SeriesList`)
- `SUPABASE_TABLE_FREELANCERS` (mặc định `Freelancer`)
- `SUPABASE_TABLE_QC` (mặc định `QC`)
- `SUPABASE_TABLE_ACCOUNTS` (mặc định `Accounts`)
- `SUPABASE_TABLE_DEADLINES` (mặc định `SeriesList`)
- `SUPABASE_TABLE_DIFFICULTY_LEVELS` (mặc định `DifficultyLevels`)
- `SUPABASE_TABLE_DIFFICULTY_PRICING` (mặc định `DifficultyPricing`)
- `SUPABASE_TABLE_BONUS_SETTINGS` (mặc định `BonusSettings`)
- `SUPABASE_TABLE_FIELDS` (mặc định `Fields`)
- `SUPABASE_TABLE_GENERAL_SETTINGS` (mặc định `GeneralSettings`)
- `GOOGLE_SERVICE_ACCOUNT_JSON` hoặc `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` hoặc `GOOGLE_SERVICE_ACCOUNT_FILE` (thông tin Google Service Account; không commit secret)

Mỗi dòng trong bảng `Fields` có thêm `guideUrl` và `resourceUrl`. Dashboard trả các link theo mảng; Freelancer chỉ nhận link của mảng được gán trong account.

## Đồng bộ Google Sheet riêng tư

1. Trong Google Cloud, bật Google Sheets API, tạo Service Account và tạo key JSON.
2. Chia sẻ file Google Sheet cho email `client_email` trong file JSON với quyền Viewer.
3. Đặt đường dẫn file JSON vào `GOOGLE_SERVICE_ACCOUNT_FILE` trong `apps/server/.env` (hoặc dùng biến JSON/base64), rồi khởi động lại server.
4. Vào Cấu hình chung, nhập link Google Sheet, khai báo tab cho từng mảng (ví dụ `Japan` → tab `Japan`, `Latin` → tab `Latin`, `QC` → tab `QC`), lưu kết nối và bấm Đồng bộ ngay.

Dòng đầu tiên của mỗi tab là header. Tên mảng của tab được dùng làm `type` của deadline nên không bắt buộc phải có cột `type`. Khóa đồng bộ là `seriesId` + `chapterNumber`; bản ghi trùng khóa được cập nhật, bản ghi mới được thêm, còn bản ghi không còn trong Sheet không bị xóa tự động.
