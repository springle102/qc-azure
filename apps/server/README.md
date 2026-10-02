# Backend quản lý deadline Webtoon

Backend Node.js + Express cung cấp lớp API cho giao diện QC. Backend ưu tiên đọc trực tiếp PostgreSQL qua `DATABASE_URL`; nếu không có, nó fallback sang Supabase REST. Nếu chưa cấu hình nguồn dữ liệu, các collection trả về rỗng.

## Chạy server

### Bonus theo tháng

Trước khi triển khai bonus mới, chạy `docs/migrations/20260929_monthly_bonus_policy.sql` trong Supabase SQL Editor. Migration chỉ thêm cột JSONB `BonusSettings.bonusPolicy`; không liên quan Supabase Storage. Nếu dùng tên bảng tùy chỉnh, đổi tên bảng trong migration tương ứng.

Khi đóng gói backend, giữ file `apps/server/bonus.mjs` trong cùng service với `apps/server/server.js`. Frontend có bản module tương ứng trong `apps/client/src/utils/bonus.mjs`; điều này giúp Railway chạy được khi mỗi service dùng một Root Directory riêng.

- Tab Giá tiền có hai công tắc độc lập: thưởng KPI một lần và thưởng từng chap **sau** mốc. Bật cả hai thì cộng dồn.
- `GET /api/salaries` mặc định trả tổng lương tất cả các tháng. API vẫn hỗ trợ `?month=YYYY-MM` khi cần xem một kỳ, chia kỳ theo `submittedAt` ở múi giờ `Asia/Ho_Chi_Minh`. Task thiếu Ngày nộp không được tự gán tháng; API trả `missingDateChapters` để hiển thị cảnh báo.
- Lương cơ bản chỉ gồm task đã duyệt Thanh toán trong kỳ. Bonus chỉ đếm các task đó có trạng thái Submitted/Done, riêng từng freelancer và mảng. QC vẫn chỉ nhận lương task Done.
- Xếp theo Ngày nộp, rồi ID truyện/chapter khi trùng thời điểm. Cả N chap đầu tiên phải có `completionPercent === 100`; không lọc bỏ chap chưa đạt rồi đếm bù. Sau mốc, chỉ chap đúng 100% được thưởng. KPI cộng một lần; thưởng sau mốc bắt đầu từ N+1.
- Cấu hình là chính sách hiện hành của từng mảng, không có tháng hiệu lực. Tab Lương không lọc tháng; bonus được tính riêng từng tháng và mảng trên các chap đã tick Thanh toán, rồi cộng vào tổng lương.
- Với dữ liệu cấu hình cũ, giữ `taskThreshold` (tối thiểu 1) và `bonusPerTask` làm mốc/số tiền của thưởng sau mốc; KPI mặc định tắt. Quy tắc mới kiểm tra 100% và chỉ tính task đã tick Thanh toán.
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
- `GET /api/google-drive/raw-transfer/status` (đăng nhập; xem lần quét raw gần nhất)
- `POST /api/google-drive/raw-transfer/sync` (Admin; quét và sao chép file raw ngay)
- `POST /api/google-drive/raw-transfer/oauth/start` (Admin; bắt đầu kết nối tài khoản Google)
- `GET /api/google-drive/raw-transfer/oauth/callback` (OAuth callback; lưu refresh token đã mã hóa)
- `DELETE /api/google-drive/raw-transfer/oauth` (Admin; xóa kết nối tài khoản Google)

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
- `GOOGLE_DRIVE_TRANSFER_CLIENT_ID`, `GOOGLE_DRIVE_TRANSFER_CLIENT_SECRET`, `GOOGLE_DRIVE_TRANSFER_REDIRECT_URI`, `GOOGLE_DRIVE_TRANSFER_TOKEN_KEY` (OAuth riêng cho tài khoản người dùng tạo bản sao raw; refresh token được mã hóa AES-256-GCM trước khi lưu trong database)
- `RESEND_API_KEY`, `RESEND_FROM` (cấu hình Resend API để gửi OTP quên mật khẩu; không commit secret; `RESEND_FROM` phải là địa chỉ thuộc domain đã xác minh trên Resend)

Luồng quên mật khẩu gửi OTP 6 số tới email đang lưu trong `Accounts`. OTP có hiệu lực 10 phút, tối đa 5 lần nhập; sau khi đặt mật khẩu mới, các phiên đăng nhập cũ của account sẽ bị thu hồi. Cần cấu hình `RESEND_API_KEY` và `RESEND_FROM` trên backend/Railway trước khi dùng tính năng này.

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

## Tự sao chép raw trên Google Drive

1. Chạy migration `docs/migrations/20261001_google_drive_raw_transfer.sql` để thêm cấu hình vào `GeneralSettings`.
2. Bật Google Drive API, tạo OAuth Client kiểu Web Application và khai báo redirect URI trùng với `GOOGLE_DRIVE_TRANSFER_REDIRECT_URI`, ví dụ `https://<backend-host>/api/google-drive/raw-transfer/oauth/callback`. Cấu hình 4 biến môi trường OAuth; `GOOGLE_DRIVE_TRANSFER_TOKEN_KEY` là 32 byte dạng hex, có thể tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Giữ khóa ổn định và bí mật; đổi khóa thì phải kết nối lại tài khoản.
3. Vào Cấu hình chung và bấm **Chọn tài khoản Google tạo bản sao**. Đăng nhập đúng tài khoản có quyền Viewer trên folder nguồn và Editor trên folder đích. Backend dùng OAuth của tài khoản này riêng cho sao chép raw; Service Account tiếp tục phục vụ các tích hợp khác.
4. Trong Cấu hình chung, mỗi mảng có công tắc **Áp dụng cho mảng này**, folder gốc công ty/freelancer và đường dẫn RAW tương đối bên trong folder truyện. Mặc định đường dẫn là `0-RAW` nguồn → `2.RAW` đích; có thể nhập nhiều tầng như `RAW/Original`. Backend ghép folder truyện theo tên giống nhau ngay dưới hai folder gốc, rồi đi theo đường dẫn đã cấu hình riêng cho mảng đó. Chỉ mảng được bật và cấu hình đủ mới được xử lý; mảng khác có thể để tắt/trống đến khi sẵn sàng. Công tắc tự động chung bật/tắt lịch quét mỗi phút. Lệnh **Sao chép ngay** chạy một lượt dù lịch tự động đang tắt.
5. Trước khi sao chép, backend so khớp tên file trong folder RAW đích; nếu tên đã tồn tại thì bỏ qua. Bản do hệ thống tạo còn được đánh dấu bằng `appProperties`, nên không tạo trùng giữa các lượt quét. Nếu folder bộ truyện hoặc một tầng trong đường dẫn RAW nguồn/đích không tồn tại, folder truyện đó được bỏ qua và tính vào số bỏ qua.

OAuth yêu cầu scope `drive` để đọc cấu trúc folder đã chọn và sao chép vào đó. Với tài khoản trong Google Workspace của công ty, nên cấu hình consent screen dạng Internal. Ứng dụng External đang ở trạng thái Testing có thể khiến refresh token hết hạn sau 7 ngày; scope Drive đầy đủ cũng có thể yêu cầu quy trình xác minh của Google trước khi dùng production.

Dòng đầu tiên của mỗi tab là header. Tên mảng của tab được dùng làm `type` của deadline nên không bắt buộc phải có cột `type`. `chapterNumber` là chuỗi tối đa 100 ký tự, nên có thể dùng các giá trị như `1A`, `01`, `Prologue` hoặc `Side Story`. Khóa đồng bộ là `seriesId` + `chapterNumber`. Đồng bộ hai chiều: dòng mới/sửa/xóa trên Sheet được phản ánh về web; tạo/sửa/xóa trên web được ghi lại vào Sheet. Nếu đồng thời sửa cùng một dòng, lần ghi cuối sẽ được giữ lại. Web kiểm tra Sheet khi tải dữ liệu và tối đa mỗi 5 phút khi bật tự động đồng bộ.
