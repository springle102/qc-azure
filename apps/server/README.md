# Backend quản lý deadline Webtoon

Backend Node.js + Express cung cấp lớp API cho giao diện QC. Backend ưu tiên đọc trực tiếp PostgreSQL qua `DATABASE_URL`; nếu không có, nó fallback sang Supabase REST. Nếu chưa cấu hình nguồn dữ liệu, các collection trả về rỗng.

## Chạy server

Triển khai backend Railway bằng `Dockerfile.railway` ở gốc repository, với Root Directory `/` và biến `RAILWAY_DOCKERFILE_PATH=Dockerfile.railway`. Không dùng Dockerfile frontend mặc định. Các biến database/Google/Storage đặt trong Railway Variables; healthcheck dùng `/api/health`. Xem [hướng dẫn triển khai](../../docs/deployment.md) cho các bước đầy đủ.

### Bonus cộng dồn theo các chap đã tick Thanh toán

Giữ cấu hình hiện có trong `BonusSettings.bonusPolicy`; việc chuyển sang cộng dồn không đổi schema hoặc yêu cầu migration mới.

Khi đóng gói backend, giữ file `apps/server/bonus.mjs` trong cùng service với `apps/server/server.js`. Frontend có bản module tương ứng trong `apps/client/src/utils/bonus.mjs`; điều này giúp Railway chạy được khi mỗi service dùng một Root Directory riêng.

- Tab Giá tiền có hai công tắc độc lập: thưởng KPI một lần và thưởng từng chap **sau** mốc. Bật cả hai thì cộng dồn.
- `GET /api/salaries` mặc định trả tổng lương tất cả task đã tick Thanh toán, kể cả thiếu Ngày nộp. Ngày nộp không còn là điều kiện để được tính trong bảng tổng; hệ thống không tự sửa ngày trong database.
- Bonus đếm mọi chap đã tick Thanh toán, không lọc status, riêng từng freelancer và từng mảng; không chia tháng, không đặt lại mốc mỗi tháng. Lương cơ bản vẫn dựa trên số tiền của task đã duyệt Thanh toán. QC vẫn chỉ nhận lương task Done, theo giá QC và tiền chuyển QC hiện có.
- Xếp theo Ngày nộp, rồi ID truyện/chapter khi trùng thời điểm. Chap thiếu/ngày không hợp lệ được xếp sau các chap có ngày, rồi theo ID truyện/chapter. Cả N chap đầu tiên phải có `completionPercent >= 100`; không lọc bỏ chap chưa đạt rồi đếm bù. Sau mốc, chap đạt từ 100% được thưởng. KPI cộng một lần trên tổng các chap; thưởng sau mốc bắt đầu từ N+1.
- Cấu hình là chính sách hiện hành của từng mảng, không có tháng hiệu lực. Tab Lương không lọc tháng; chi tiết Bonus chỉ hiển thị một nhóm cho mỗi mảng.
- Để tương thích caller cũ, API vẫn hỗ trợ `?month=YYYY-MM` như bộ lọc dữ liệu theo `submittedAt` ở múi giờ `Asia/Ho_Chi_Minh`; khi dùng bộ lọc này, chỉ các task thuộc tháng được chọn được đưa vào bảng tính. Đây không phải chế độ của tab Lương hiện tại. `missingDateChapters` chỉ còn báo task không gán được vào bộ lọc tháng cũ; trên bảng tổng, mảng này rỗng.
- Với dữ liệu cấu hình cũ, giữ `taskThreshold` (tối thiểu 1) và `bonusPerTask` làm mốc/số tiền của thưởng sau mốc; KPI mặc định tắt. Quy tắc mới kiểm tra từ 100% và chỉ tính task đã tick Thanh toán.
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
- `POST /api/auth/forgot-password/request-otp` (nhập username để gửi OTP tới email của account)
- `POST /api/auth/forgot-password/verify-otp` (xác nhận OTP)
- `POST /api/auth/forgot-password/reset` (đặt mật khẩu mới)
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

### Account có hai role

Mặc định mỗi account có một role. Role thứ hai chỉ được cấp bằng SQL trong bảng `Accounts`; giao diện vẫn chỉ cấp hoặc đổi một role. Hệ thống luôn dùng role có quyền cao nhất theo thứ tự `Admin > QC > Freelancer`.

```sql
UPDATE public."Accounts"
SET "roles" = ARRAY['Admin', 'Freelancer']::text[]
WHERE "username" = 'username_can_cap_quyen'
RETURNING "id", "username", "roles", "role";
```

Chạy migration `docs/migrations/20260929_add_account_roles.sql` trước. Trigger sẽ tự đồng bộ cột `role` cũ thành `Admin` trong ví dụ trên. Chỉ người có role hiệu lực `Admin` mới có thể quản lý account.
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
- `DATABASE_SSL_REJECT_UNAUTHORIZED` (mặc định `true`; chỉ đặt `false` trong `.env` local nếu mạng thay chứng chỉ TLS Supabase. Kết nối vẫn mã hóa nhưng không xác minh danh tính chứng chỉ; production nên dùng CA Supabase để xác minh.)
- `NODE_EXTRA_CA_CERTS` (Docker backend đã đặt tới `certs/supabase-ca.crt`, CA Supabase công khai được đóng gói cùng image. Nếu chạy Node trực tiếp, đặt biến này trong shell trước khi khởi động Node; chỉ đặt trong `.env` không có hiệu lực.)
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
- `MAIL_PROVIDER=gmail` (mặc định): dùng Gmail API qua HTTPS, không cần tên miền hoặc SMTP.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL`, `GMAIL_SENDER_NAME` (OAuth Gmail gửi; tên mặc định WZ System). Lấy token bằng `npm run gmail:authorize` từ gốc repo theo [hướng dẫn](../../docs/deployment.md#gmail-api-không-cần-tên-miền). Không dùng mật khẩu Gmail hay Service Account Sheets/Drive.
- `APP_PUBLIC_URL`: URL frontend để mở task sau đăng nhập.
- Nếu vẫn dùng Resend: đặt rõ `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RESEND_FROM` thuộc domain đã xác minh.

Luồng quên mật khẩu gửi OTP 6 số tới email đang lưu trong `Accounts`, dùng chung Gmail API với mail nhắc deadline. OTP có hiệu lực 10 phút, tối đa 5 lần nhập; sau khi đặt mật khẩu mới, các phiên đăng nhập cũ của account sẽ bị thu hồi. Cần cấu hình Gmail OAuth trên backend/Railway trước khi dùng tính năng này. Mail nhắc hạn cần hai migration trong `docs/migrations/20261003_*reminders.sql`; lượt gửi Gmail bị gián đoạn hoặc chưa rõ kết quả được dừng ở “Cần kiểm tra” để tránh trùng.

Mỗi dòng trong bảng `Fields` có thêm `guideUrl` và `resourceUrl`. Dashboard trả các link theo mảng; Freelancer chỉ nhận link của mảng được gán trong account.

## Fix/Check trong Quản lý lỗi

- **Đồng bộ từ Sheet** chỉ nhập các dòng đang hiển thị và có dữ liệu trong các cột lỗi, kể cả dòng thiếu Title/Chapter/Error hoặc chỉ có ghi chú/ảnh. Bỏ qua dòng bị ẩn thủ công hoặc bởi bộ lọc, dòng trống và dòng trống có checkbox Fix/Check chưa tick; checkbox đã tick vẫn được nhập nếu dòng đang hiển thị. Dòng nguồn đã ẩn, xóa hoặc trống sẽ được loại khỏi bảng lỗi trên web khi đồng bộ lại. Đồng bộ cập nhật theo dòng nguồn, không tạo bản sao khi Error bị xóa.
- Tick/bỏ tick trên web cập nhật đúng một ô checkbox có sẵn trong Sheet, sau đó mới lưu database. Request chỉ có `updateCells` với `fields: userEnteredValue`; không thêm hàng/cột, tạo checkbox hay ghi nội dung lỗi, ảnh, ghi chú và định dạng.
- Khi tab Quản lý lỗi đang hiển thị, giao diện gọi `GET /api/errors/fix-check` mỗi 15 giây sau khi lần đọc trước hoàn tất để lấy tick/bỏ tick từ Sheet. Luồng này không xuất ảnh, không ghi Sheet và chỉ cập nhật Fix/Check trong database, theo quyền của người đăng nhập.
- Cần Service Account có quyền Editor, cột Fix/Check duy nhất và ô có data validation loại checkbox. Hỗ trợ checkbox mặc định và giá trị checked/unchecked tùy chỉnh.
- Trước khi ghi, kiểm tra workbook/tab (`?gid=` hoặc `#gid=`), số dòng, Title/Chapter/Error/Editor và ô checkbox. Nếu hàng bị đổi, di chuyển, trùng, ẩn, hoặc ô bị gộp/chứa công thức, hệ thống báo lỗi. Admin/QC cần bấm **Đồng bộ từ Sheet** để cập nhật liên kết; dữ liệu cũ chưa lưu `gid` cũng cần đồng bộ một lần.
- Lỗi tạo riêng trên web chưa có dòng nguồn chỉ lưu trạng thái trên web, không tự thêm nội dung vào Sheet. Các lần nhập Sheet, đọc checkbox và sửa lỗi được xếp hàng trong cùng tiến trình backend để tránh ghi đè từ bản đọc cũ.
- Kiểm thử: `node --test apps/server/tests/errorFixCheck.test.mjs` từ thư mục gốc.

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
