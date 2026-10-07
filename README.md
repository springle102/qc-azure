# Hệ thống quản lý deadline Webtoon

Giao diện QC cho việc theo dõi freelancer, deadline, mã QR, lương và giá theo độ khó.

## Kiến trúc

- **Frontend (`apps/client`)**: React 19, đóng gói và chạy phát triển bằng Vite. `src/main.jsx` khởi chạy ứng dụng; `src/App.jsx` kết nối các màn hình trong `src/components/`. Các lời gọi HTTP tập trung trong `src/services/api.js`; tiện ích nằm trong `src/utils/`.
- **Backend (`apps/server`)**: Node.js + Express, khởi chạy từ `server.js` và cung cấp REST API cho client. Các thao tác dữ liệu được tách trong `supabaseRepository.js`; upload/xóa ảnh đại diện, mã QR và ảnh lỗi dùng `supabaseStorage.js`; quy tắc thưởng cộng dồn được đặt trong `bonus.mjs`.
- **Lưu trữ dữ liệu**: backend ưu tiên PostgreSQL khi có `DATABASE_URL`. Nếu không có, backend dùng Supabase REST khi đã cấu hình `SUPABASE_URL` và service role key; nếu chưa cấu hình nguồn dữ liệu, các collection trả về rỗng. Supabase Storage được dùng cho ảnh khi cấu hình Supabase tương ứng.
- **Tích hợp ngoài**: backend đồng bộ deadline hai chiều với Google Sheets và tra cứu folder Google Drive để gắn link bộ truyện khi có cấu hình Service Account. Client chỉ gọi API backend, không kết nối trực tiếp tới database hoặc Google API.
- **Logic dùng chung (`apps/shared`)**: chứa các module nghiệp vụ có bản tương ứng ở client và server; khi sửa logic chung, cần kiểm tra và giữ các bản liên quan đồng bộ.
- **Tài liệu và database (`docs`)**: chứa schema mẫu, migration SQL, dữ liệu khởi tạo và tài liệu nghiệp vụ. Thay đổi schema cần có migration phù hợp cùng cập nhật tài liệu liên quan.

Luồng chính: trình duyệt → React/Vite → REST API Express → PostgreSQL hoặc Supabase. Tích hợp Google Sheets/Drive và Supabase Storage do backend thực hiện.

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

Các bảng giao diện bám theo [sơ đồ database và use case](docs/diagrams/README.md), cùng snapshot schema trong `docs/diagrams/schema-metadata.json`:

- `Freelancer`: `fIld`, `name`, `email`, `field`, `note`, `salary`, `imageQR`
- `DeadlineRegistrations`: `fIld`, `name`, số chapter nhận theo tuần/tháng, độ ổn định và note
- `SeriesList`: thông tin deadline, chapter dạng văn bản, status tiến độ, thời gian làm và `% hoàn thành`
- `DifficultyLevels`: danh sách độ khó, màu nền và màu chữ tùy chỉnh theo từng mảng
- `DifficultyPricing`: giá theo mảng và độ khó do người dùng tự định nghĩa cho từng mảng
- `Fields`: danh sách mảng dùng chung cho account, freelancer, deadline, giá tiền và link Guide/Tài nguyên theo từng mảng
- `GeneralSettings`: cấu hình deadline mặc định theo giờ và kết nối Google Sheet
- `Accounts`: username, mật khẩu hash, role, mảng và `freelancerId`; account role Freelancer hoặc QC tái sử dụng hồ sơ chưa liên kết có cùng email, hoặc tạo một hồ sơ mới nếu chưa có

Deadline công ty và bảng `Companies` đã được loại bỏ khỏi giao diện, API và database.

Repository hiện có snapshot schema và các migration trong `docs/migrations/`, chưa có script khởi tạo đầy đủ cho database mới. Snapshot dùng để đối chiếu cấu trúc, không phải SQL khởi tạo; với database đã tồn tại, xem yêu cầu và thứ tự áp dụng trong từng migration cùng [hướng dẫn triển khai](docs/deployment.md). Sheet lỗi gốc cần có các cột `Title`, `Chapter`, `Error Type`, `Error`, `Note`, `Editor`, `Fix/Check`; Service Account cần quyền Editor trên từng Sheet. `Error Type` gồm: `TR`, `File`, `Censor`, `Exposure`, `Logo/Credit`, `Text`, `SFX`, `Image`, `Bubble`, `Aesthetics`, `RD`.

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

`DATABASE_URL` có thể trỏ tới PostgreSQL local hoặc connection string PostgreSQL của Supabase. Nếu dùng Supabase, lấy connection string ở mục **Connect** trong Supabase Dashboard; backend tự bật TLS và xác minh chứng chỉ cho host Supabase. Khi `DATABASE_URL` được cấu hình, backend dùng kết nối PostgreSQL này trước Supabase REST.

Khi cấp account role `Freelancer` hoặc `QC`, Admin chọn mảng từ danh sách cấu hình; QC có thể chọn nhiều mảng. Freelancer chỉ được chỉnh status `Doing`/`Submitted`, còn QC/Admin được chỉnh các status còn lại. Khi task chuyển sang `Doing`, hệ thống bắt đầu lưu thời gian làm; khi rời `Doing`, thời gian được chốt vào `workDurationSeconds`.

Đồng bộ Google Sheet riêng tư: tạo Google Service Account, bật Google Sheets API, chia sẻ file cho email `client_email` của Service Account với quyền Editor, rồi đặt file key JSON ngoài Git qua `GOOGLE_SERVICE_ACCOUNT_FILE`. Sau đó Admin nhập link Sheet trong tab Cấu hình chung, khai báo mỗi tab tương ứng một mảng (Japan/Latin/QC) và chọn Đồng bộ ngay hoặc bật tự động đồng bộ. Đồng bộ deadline là hai chiều theo khóa `seriesId` + `chapterNumber`: tạo/sửa/xóa ở Sheet hoặc web sẽ được phản ánh sang bên còn lại. Để tự gắn URL bộ truyện, bật thêm Google Drive API và chia sẻ Drive tổng (hoặc folder tổng) cho cùng email Service Account với quyền Viewer. Khi đồng bộ, hệ thống tìm folder có tên chính xác bằng `seriesId` và điền link folder vào `urlSeries` nếu dòng chưa có URL.

## Chạy project

Nhắc freelancer nộp task qua mail: chạy migration `docs/migrations/20261003_task_reminders.sql` rồi `docs/migrations/20261003_gmail_reminders.sql`, cấu hình Gmail API và `APP_PUBLIC_URL`, rồi bật trong **Cấu hình chung**. Dùng được Gmail thường, không cần tên miền hay SMTP. Tính năng mặc định tắt, nhắc trước 1 ngày/6 tiếng/3 tiếng và một lần khi quá hạn. Chạy `npm run gmail:authorize` để cấp quyền cục bộ; xem [cách cấu hình và kiểm thử](docs/deployment.md#gmail-api-không-cần-tên-miền).

Thông báo trực tiếp trên thiết bị qua Web Push: chạy `docs/migrations/20261005_web_push.sql` rồi `docs/migrations/20261005_web_push_bell_notifications.sql`, cấu hình các biến `WEB_PUSH_*` trên backend và deploy frontend/backend. Sau đăng nhập, người dùng chọn **Cho phép** trong lời mời để mở hộp thoại quyền chính thức của trình duyệt; chọn **Không cho phép** sẽ lưu lựa chọn và không hỏi lại tự động. Menu chuông có nút bật/tắt và gửi thử. Kênh này gửi cả 5 loại thông báo trong chuông của Freelancer, chống gửi lặp qua các lần khởi động backend; giữ bốn mốc nhắc deadline riêng và hoạt động độc lập với email. Admin/QC hiện không có loại thông báo trong chuông. Xem [cấu hình Web Push](docs/deployment.md#web-push-thông-báo-trên-thiết-bị).

### Deploy Supabase + Railway + Cloudflare Pages

Xem [hướng dẫn triển khai](docs/deployment.md) để cấu hình backend bằng `Dockerfile.railway`, frontend bằng `npm run build:cloudflare` và các biến môi trường. Docker Compose dùng cho local. Cloudflare phải có `VITE_API_URL` là URL HTTPS công khai của backend, kết thúc bằng `/api`; địa chỉ Render cũ đã được bỏ khỏi cấu hình production.

### Chạy bằng Docker

Cài và khởi động Docker Desktop (Linux containers), sau đó tạo `apps/server/.env` từ `.env.example` nếu chưa có. Từ thư mục gốc chạy:

```bash
npm run docker:up
```

Web mở tại `http://localhost:8080`; máy khác cùng mạng truy cập `http://<IP-máy-chạy-Docker>:8080` nếu firewall cho phép. Backend chỉ mở trong mạng container và được Nginx chuyển tiếp qua `/api`. Docker build luôn dùng `VITE_API_URL=/api`, nên không gọi nhầm `localhost` của máy người xem. Đây là chạy trên máy hiện tại; để truy cập Internet cần triển khai cùng cấu hình lên server và thiết lập domain/HTTPS.

```bash
npm run docker:status
npm run docker:logs
npm run docker:down
```

`docker:up` build hai image bằng `npm ci` theo lockfile, chạy nền và chờ healthcheck. Chạy lại lệnh này sau khi đổi mã nguồn. Bí mật trong `.env` không được đưa vào image. Script tự tìm Docker Desktop nếu chưa có trong PATH; khi `GOOGLE_SERVICE_ACCOUNT_FILE` đã cấu hình, script gắn đúng file từ máy vào container ở chế độ chỉ đọc bằng `compose.google.yaml`. Máy khác cần có `.env` và file Google riêng ở đường dẫn hợp lệ. JSON/base64 inline cũng được hỗ trợ qua `.env`; với `format: raw`, giữ giá trị không có dấu nháy bao ngoài.

Database vẫn dùng kết nối đang có trong `apps/server/.env`, không tạo database mới hoặc tự chạy migration. Nếu PostgreSQL chạy trên máy host, đổi hostname `localhost` thành `host.docker.internal`. Nếu dùng Supabase, giữ connection string hiện tại. Healthcheck `/api/health` kiểm tra tiến trình API, không kiểm tra kết nối database hay Google. Phiên đăng nhập hiện lưu trong bộ nhớ backend: khởi động lại container sẽ cần đăng nhập lại; cấu hình này dùng một backend.

Có thể đặt `WEB_PORT` để đổi cổng hoặc `WEB_BIND_ADDRESS=127.0.0.1` để chỉ cho phép truy cập trên máy hiện tại. Với server chỉ có Docker/Compose (không cần Node.js trên host):

```bash
docker compose up -d --build --wait
```

Nếu dùng file Google, đặt `GOOGLE_SERVICE_ACCOUNT_HOST_FILE` thành đường dẫn tuyệt đối trên host rồi chạy `docker compose -f compose.yaml -f compose.google.yaml up -d --build --wait`. Docker Compose cần phiên bản hỗ trợ `env_file.format: raw` (2.30 trở lên). File `Dockerfile` có hai target `server` và `client`; cả hai base image Node/Nginx khóa bằng SHA-256 digest. Khi phát hành lên nhiều máy, build một lần, đẩy image lên registry rồi chạy cùng image digest để giữ đúng cùng phiên bản. Cập nhật digest base image có chủ đích khi nâng phiên bản hoặc vá bảo mật.

### Chạy frontend và backend cùng lúc

Từ thư mục gốc, chạy một lệnh trong terminal:

```bash
npm run dev
```

Frontend mở tại `http://localhost:5173`, backend tại `http://localhost:5000`. Nhấn `Ctrl+C` để dừng cả hai tiến trình. Lệnh này dùng cấu hình phát triển local; cấu hình API dành cho build/deploy trong `.env.production` không được dùng bởi Vite dev server.

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

## Kiểm tra code

Sau khi cài dependencies cho cả hai ứng dụng, chạy từ thư mục gốc:

```bash
npm test
npm run lint
npm run build:client
```

`npm test` chạy test client và server; các test PostgreSQL cần biến `TEST_*_DATABASE_URL` trỏ tới database kiểm thử riêng và sẽ được bỏ qua khi chưa cấu hình. `npm run lint` dùng oxlint đã cài trong client để kiểm tra `apps/` và `scripts/`.
