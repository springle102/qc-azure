# Hệ thống quản lý deadline Webtoon

Giao diện QC cho việc theo dõi freelancer, deadline, mã QR, lương và giá theo độ khó.

## Kiến trúc

- Frontend: React 19 + Vite
- Backend: Node.js + Express
- Database: PostgreSQL local hoặc Supabase PostgreSQL

## Giao diện QC

Sidebar hiện gồm:

- Dashboard
- Quản lý freelancer (hồ sơ freelancer và cấp/chỉnh account)
- Đăng ký deadline (khả năng nhận chapter theo tuần/tháng của freelancer)
- Quản lý Deadline
- Giá tiền
- Cấu hình chung (deadline mặc định theo giờ và thêm/sửa/xóa mảng)
- Lương
- Hồ sơ cá nhân

Các bảng giao diện bám theo schema trong `docs/database diagram.png` và schema mẫu:

- `Freelancer`: `fIld`, `name`, `email`, `field`, `note`, `salary`, `imageQR`
- `DeadlineRegistrations`: `fIld`, `name`, số chapter nhận theo tuần/tháng, độ ổn định và note
- `SeriesList`: thông tin deadline, chapter dạng văn bản, status tiến độ, thời gian làm và `% hoàn thành`
- `DifficultyLevels`: danh sách độ khó, màu nền và màu chữ tùy chỉnh theo từng mảng
- `DifficultyPricing`: giá theo mảng và độ khó do người dùng tự định nghĩa cho từng mảng
- `Fields`: danh sách mảng dùng chung cho account, freelancer, deadline, giá tiền và link Guide/Tài nguyên theo từng mảng
- `GeneralSettings`: cấu hình deadline mặc định theo giờ và kết nối Google Sheet
- `Accounts`: username, mật khẩu hash, role, mảng và `freelancerId`; account role Freelancer hoặc QC tự sinh đúng một hồ sơ thành viên mới, không tạo hồ sơ rời

Deadline công ty và bảng `Companies` đã được loại bỏ khỏi giao diện, API và database.

File PostgreSQL mẫu để tạo schema và dữ liệu test: `docs/sample-database.sql`. Nếu database đã tồn tại từ trước, chạy các migration trong `docs/migrations/` trong SQL Editor để thêm đăng ký deadline, cột màu chữ, mapping folder Drive, sao chép raw từ Drive và bảng Quản lý lỗi. Sheet lỗi gốc cần có các cột `Title`, `Chapter`, `Error Type`, `Error`, `Note`, `Editor`, `Fix/Check`; Service Account cần quyền Editor trên từng Sheet. `Error Type` gồm: `TR`, `File`, `Censor`, `Exposure`, `Logo/Credit`, `Text`, `SFX`, `Image`, `Bubble`, `Aesthetics`, `RD`.

## Cấu hình dữ liệu

Tạo file `apps/server/.env`:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/Qc-WZ
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_ERROR_SCREENSHOT_BUCKET=error-screenshots
SUPABASE_TABLE_TASKS=SeriesList
SUPABASE_TABLE_FREELANCERS=Freelancer
SUPABASE_TABLE_QC=QC
SUPABASE_TABLE_ACCOUNTS=Accounts
SUPABASE_TABLE_DEADLINES=SeriesList
SUPABASE_TABLE_DIFFICULTY_PRICING=DifficultyPricing
GUIDE_URL=
RESOURCE_URL=
GOOGLE_SERVICE_ACCOUNT_FILE=
```

Tài khoản Admin mẫu trong `docs/sample-database.sql`: username `admin`, password `admin123`.
Khi cấp account role `Freelancer` hoặc `QC`, Admin chọn mảng từ danh sách cấu hình; QC có thể chọn nhiều mảng. Freelancer chỉ được chỉnh status `Doing`/`Submitted`, còn QC/Admin được chỉnh các status còn lại. Khi task chuyển sang `Doing`, hệ thống bắt đầu lưu thời gian làm; khi rời `Doing`, thời gian được chốt vào `workDurationSeconds`.

Đồng bộ Google Sheet riêng tư: tạo Google Service Account, bật Google Sheets API, chia sẻ file cho email `client_email` của Service Account với quyền Editor, rồi đặt file key JSON ngoài Git qua `GOOGLE_SERVICE_ACCOUNT_FILE`. Sau đó Admin nhập link Sheet trong tab Cấu hình chung, khai báo mỗi tab tương ứng một mảng (Japan/Latin/QC) và chọn Đồng bộ ngay hoặc bật tự động đồng bộ. Đồng bộ deadline là hai chiều theo khóa `seriesId` + `chapterNumber`: tạo/sửa/xóa ở Sheet hoặc web sẽ được phản ánh sang bên còn lại. Để tự gắn URL bộ truyện, bật thêm Google Drive API và chia sẻ Drive tổng (hoặc folder tổng) cho cùng email Service Account với quyền Viewer. Khi đồng bộ, hệ thống tìm folder có tên chính xác bằng `seriesId` và điền link folder vào `urlSeries` nếu dòng chưa có URL.

Để tự sao chép raw, chạy migration `docs/migrations/20261001_google_drive_raw_transfer.sql`, bật Google Drive API và cấp Service Account quyền Editor trên các folder gốc. Trong Cấu hình chung, với mỗi mảng (ví dụ Japan), nhập folder gốc công ty (JP_công_ty) và folder gốc freelancer (JP), rồi bật **Tự động sao chép file mới**. Mỗi phút backend đối chiếu các folder bộ truyện trùng tên, tìm folder `2.RAW` ở hai bên và sao chép file mới vào `2.RAW` freelancer; file gốc vẫn được giữ ở công ty. Nếu `2.RAW` đích đã có file cùng tên thì bỏ qua; folder truyện hoặc `2.RAW` thiếu ở bên freelancer cũng được bỏ qua và thống kê.

## Chạy project

### Frontend

```bash
cd apps/client
npm install
npm run dev
```

### Backend

```bash
cd apps/server
npm install
npm run dev
```

Frontend mặc định gọi API tại `http://localhost:5000/api`. Có thể đổi bằng `VITE_API_URL`.
