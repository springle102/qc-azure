# Backend quản lý deadline Webtoon

Backend Node.js + Express cung cấp lớp API cho giao diện QC. Backend ưu tiên đọc trực tiếp PostgreSQL qua `DATABASE_URL`; nếu không có, nó fallback sang Supabase REST. Nếu chưa cấu hình nguồn dữ liệu, các collection trả về rỗng.

## Chạy server

### Bonus theo tháng

Trước khi triển khai phiên bản bonus mới, chạy `docs/migrations/20260929_monthly_bonus_policy.sql` trong Supabase SQL Editor. Migration chỉ thêm cột JSONB `BonusSettings.bonusPolicy`; không liên quan Supabase Storage. Nếu dùng tên bảng tùy chỉnh, đổi tên bảng trong migration tương ứng.

Khi đóng gói backend, giữ thư mục `apps/shared` cạnh `apps/server`: API và frontend dùng chung `apps/shared/bonus.mjs` để tính bonus và xem thử nhất quán.

- Tab Giá tiền có hai công tắc độc lập: thưởng KPI một lần và thưởng từng chap **sau** mốc. Bật cả hai thì cộng dồn.
- `GET /api/salaries?month=YYYY-MM` mặc định tháng hiện tại, chia kỳ theo `submittedAt` ở múi giờ `Asia/Ho_Chi_Minh`. Task thiếu Ngày nộp không được tự gán tháng; API trả `missingDateChapters` để hiển thị cảnh báo.
- Lương cơ bản chỉ gồm task đã duyệt Thanh toán trong kỳ. Bonus chỉ đếm các task đó có trạng thái Submitted/Done, riêng từng freelancer và mảng. QC vẫn chỉ nhận lương task Done.
- Xếp theo Ngày nộp, rồi ID truyện/chapter khi trùng thời điểm. Cả N chap đầu tiên phải có `completionPercent === 100`; không lọc bỏ chap chưa đạt rồi đếm bù. Sau mốc, chỉ chap đúng 100% được thưởng. KPI cộng một lần; thưởng sau mốc bắt đầu từ N+1.
- Cấu hình lưu phiên bản theo tháng hiệu lực (chỉ tháng hiện tại/tương lai). Lưu cùng tháng thay thế phiên bản tháng đó; tháng trước dùng phiên bản trước. QC price cũng nằm trong phiên bản. Đây là lịch sử chính sách, không phải bảng lương đã chốt: chỉnh task vẫn tính lại lương.
- Với dữ liệu cấu hình cũ, giữ `taskThreshold` (tối thiểu 1) và `bonusPerTask` làm mốc/số tiền của thưởng sau mốc; KPI mặc định tắt. Những giá trị cũ được chụp lại thành phiên bản nền khi lưu lần đầu. Quy tắc mới kiểm tra 100% và chia kỳ theo tháng cũng áp dụng khi xem dữ liệu cũ; ứng dụng trước đây chưa lưu bảng lương chốt hoặc lịch sử chính sách cũ.
- Kiểm thử: `node --test apps/server/tests/monthlyBonus.test.mjs` từ thư mục gốc dự án.

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
- `GET /api/deadline-registrations`
- `POST /api/deadline-registrations` (Admin/QC quản lý mọi freelancer; Freelancer chỉ đăng ký cho chính mình)
- `PATCH /api/deadline-registrations/:id`
- `DELETE /api/deadline-registrations/:id`
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
- `POST /api/google-sheet/sync` (Admin; đối soát hai chiều Google Sheet và `SeriesList`)
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
- `SUPABASE_SERVICE_ROLE_KEY` hoặc `SUPABASE_SECRET_KEY` (chỉ cần khai báo một; giữ key ở backend/Railway, không đưa vào client)
- `SUPABASE_ERROR_SCREENSHOT_BUCKET` (mặc định `error-screenshots`; bucket public được tạo tự động để trình duyệt tải ảnh trực tiếp qua CDN)
- `SUPABASE_AVATAR_BUCKET` (mặc định `avatars`; bucket public được tạo tự động để lưu ảnh đại diện)
- `SUPABASE_QR_BUCKET` (mặc định `qr-codes`; bucket public được tạo tự động để lưu mã QR freelancer)
- `SUPABASE_TABLE_TASKS` (mặc định `SeriesList`)
- `SUPABASE_TABLE_FREELANCERS` (mặc định `Freelancer`)
- `SUPABASE_TABLE_QC` (mặc định `QC`)
- `SUPABASE_TABLE_ACCOUNTS` (mặc định `Accounts`)
- `SUPABASE_TABLE_DEADLINE_REGISTRATIONS` (mặc định `DeadlineRegistrations`)
- `SUPABASE_TABLE_DEADLINES` (mặc định `SeriesList`)
- `SUPABASE_TABLE_DIFFICULTY_LEVELS` (mặc định `DifficultyLevels`)
- `SUPABASE_TABLE_DIFFICULTY_PRICING` (mặc định `DifficultyPricing`)
- `SUPABASE_TABLE_BONUS_SETTINGS` (mặc định `BonusSettings`)
- `SUPABASE_TABLE_FIELDS` (mặc định `Fields`)
- `SUPABASE_TABLE_GENERAL_SETTINGS` (mặc định `GeneralSettings`)
- `GOOGLE_SERVICE_ACCOUNT_JSON` hoặc `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` hoặc `GOOGLE_SERVICE_ACCOUNT_FILE` (thông tin Google Service Account; không commit secret)

Mỗi dòng trong bảng `Fields` có thêm `guideUrl` và `resourceUrl`. Dashboard trả các link theo mảng; Freelancer chỉ nhận link của mảng được gán trong account.

## Screenshot trên Supabase Storage

Khi đã khai báo `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`, screenshot mới sẽ được upload vào bucket `SUPABASE_ERROR_SCREENSHOT_BUCKET` và bảng `Errors` chỉ lưu URL ảnh. Nếu bucket chưa tồn tại, server tự tạo bucket public `error-screenshots` để trình duyệt tải ảnh trực tiếp qua CDN. Admin có thể bấm `Chuyển ảnh lên Storage` một lần trong màn hình Quản lý lỗi để migrate các ảnh Base64 cũ.

Ảnh đại diện được upload vào bucket `SUPABASE_AVATAR_BUCKET` và bảng `Accounts` chỉ lưu public URL. Bucket `avatars` sẽ được tạo tự động nếu chưa tồn tại.

Mã QR freelancer được upload vào bucket `SUPABASE_QR_BUCKET` và cột `Freelancer.imageQR` chỉ lưu public URL. Bucket `qr-codes` sẽ được tạo tự động nếu chưa tồn tại.

## Đồng bộ Google Sheet riêng tư

1. Trong Google Cloud, bật Google Sheets API, tạo Service Account và tạo key JSON.
2. Chia sẻ file Google Sheet cho email `client_email` trong file JSON với quyền Editor để hệ thống có thể ghi ngược dữ liệu.
3. Đặt đường dẫn file JSON vào `GOOGLE_SERVICE_ACCOUNT_FILE` trong `apps/server/.env` (hoặc dùng biến JSON/base64), rồi khởi động lại server.
4. Vào Cấu hình chung, nhập link Google Sheet, khai báo tab cho từng mảng (ví dụ `Japan` → tab `Japan`, `Latin` → tab `Latin`, `QC` → tab `QC`), lưu kết nối và bấm Đồng bộ ngay.

Dòng đầu tiên của mỗi tab là header. Tên mảng của tab được dùng làm `type` của deadline nên không bắt buộc phải có cột `type`. `chapterNumber` là chuỗi tối đa 100 ký tự, nên có thể dùng các giá trị như `1A`, `01`, `Prologue` hoặc `Side Story`. Khóa đồng bộ là `seriesId` + `chapterNumber`. Đồng bộ hai chiều: dòng mới/sửa/xóa trên Sheet được phản ánh về web; tạo/sửa/xóa trên web được ghi lại vào Sheet. Nếu đồng thời sửa cùng một dòng, lần ghi cuối sẽ được giữ lại. Web kiểm tra Sheet khi tải dữ liệu và tối đa mỗi 5 phút khi bật tự động đồng bộ.
