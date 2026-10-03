# Deploy Supabase + Railway + Cloudflare Pages

Luồng truy cập: trình duyệt tải frontend từ Cloudflare Pages, frontend gọi API HTTPS của Railway, backend kết nối database/Storage của Supabase và Google Sheets/Drive khi có cấu hình. Không cần tự cài Docker trên các nền tảng này.

Địa chỉ của dự án:

- Frontend: `https://qc-manager.pages.dev/`
- API: `https://qc-azure-production.up.railway.app/api`
- Backend healthcheck: `https://qc-azure-production.up.railway.app/api/health`

## 1. Backend Railway

Chọn repository và nhánh cần deploy cho service backend. Cấu hình theo bảng:

| Cấu hình | Giá trị |
| --- | --- |
| Root Directory | `/` (gốc repository, không phải `apps/server`) |
| Railway Variable | `RAILWAY_DOCKERFILE_PATH=Dockerfile.railway` |
| Custom Build Command | Để trống; Railway build từ Dockerfile |
| Custom Start Command | Để trống; Dockerfile chạy `node server.js` |
| Healthcheck Path | `/api/health` |
| Healthcheck Timeout | `180` giây |
| Số replica | `1` |

`Dockerfile.railway` chỉ đóng gói backend, dùng Node khóa bằng digest, `npm ci --omit=dev` và user không phải root. Server và Docker healthcheck đều dùng `PORT` do Railway cấp (mặc định local là 5000). Không đặt cứng cổng nếu không cần; public networking phải trỏ đúng cổng service đang nghe.

Nếu đã có `RAILWAY_DOCKERFILE_PATH` cũ, sửa thành đường dẫn trên. Nếu đã cấu hình Railway config file riêng, kiểm tra nó không ghi đè Dockerfile/start command/healthcheck; bộ cấu hình này không thêm `railway.json` mới. Không dùng Dockerfile gốc cho Railway: stage cuối của file đó là frontend Nginx dành cho Docker local.

Trong Railway Variables, đặt giá trị thật cho các biến sau; file `apps/server/.env` trên máy không tự được deploy:

| Biến | Khi nào cần |
| --- | --- |
| `NODE_ENV=production` | Dockerfile đã đặt sẵn |
| `DATABASE_URL` | Connection string PostgreSQL hiện tại lấy từ Supabase Connect |
| `DATABASE_SSL_REJECT_UNAUTHORIZED=true` | Giữ xác minh TLS cho Supabase |
| `SUPABASE_URL` | URL project nếu dùng Supabase REST hoặc Storage |
| `SUPABASE_SERVICE_ROLE_KEY` hoặc `SUPABASE_SECRET_KEY` | Khóa backend tương ứng, chỉ đặt một loại; cần cùng URL khi dùng REST/Storage |
| `SUPABASE_*_BUCKET`, `SUPABASE_TABLE_*` | Sao chép tên đã cấu hình nếu khác mặc định trong `.env.example` |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Nội dung file Service Account mã hóa base64 nếu dùng Sheets/Drive |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Để trống trên Railway; không dùng đường dẫn Windows |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Để trống nếu dùng base64; có thể dùng JSON trực tiếp thay base64 |
| `RESEND_API_KEY`, `RESEND_FROM` | Khi cần gửi OTP quên mật khẩu |
| `GUIDE_URL`, `RESOURCE_URL` | Nếu đang dùng các link toàn cục này |

Không đưa mật khẩu database hoặc các khóa vào Git/Cloudflare. Lấy danh sách biến và mặc định từ `apps/server/.env.example`; không sao chép `PORT=5000` và đường dẫn file Windows một cách máy móc. Trợ lý AI đã tách khỏi source phát hành, không cần biến `GEMINI_*`.

Trong Railway Settings > Networking, dùng domain public hiện có hoặc tạo domain. Kiểm tra `https://<domain-backend>/api/health` trả HTTP 200. Healthcheck chỉ xác nhận API sống; sau deploy cần đăng nhập và đọc dữ liệu để xác nhận database hoạt động.

Backend hiện lưu phiên đăng nhập trong bộ nhớ. Dùng một replica; redeploy sẽ yêu cầu đăng nhập lại. Không tự chạy thêm migration hoặc tạo database mới trong quá trình build này.

## 2. Database Supabase

Giữ project/database hiện tại và lấy connection string từ Supabase Dashboard > Connect. Backend ưu tiên `DATABASE_URL` khi có; nếu để trống, cần cấu hình `SUPABASE_URL` và khóa backend để dùng REST.

Nếu môi trường kết nối chỉ có IPv4, chọn Shared Session Pooler (port 5432) từ Connect. Sao chép đúng host, username và database Supabase cấp; không tự suy ra host. Mật khẩu có ký tự đặc biệt cần URL-encode trong connection string.

Giữ TLS verification bật. Nếu Railway báo lỗi chứng chỉ, xử lý CA phù hợp với Supabase thay vì sao chép thiết lập bỏ xác minh từ mạng local. Storage cho avatar/QR/screenshot cần cấu hình URL project và khóa backend ngay cả khi database dùng kết nối PostgreSQL trực tiếp.

### Chứng chỉ CA Supabase cho Docker backend

`apps/server/certs/supabase-ca.crt` là chứng chỉ CA công khai tải từ Supabase Database > Settings > SSL Configuration > Download Certificate, không phải private key hay thông tin đăng nhập. `Dockerfile.railway` và target `server` của Docker local đã đóng gói CA này và đặt `NODE_EXTRA_CA_CERTS=/app/apps/server/certs/supabase-ca.crt` trước khi Node khởi động. Không cần upload file riêng lên Railway hoặc cấu hình đường dẫn Windows.

- Commit/push chứng chỉ và Dockerfile đã sửa, rồi build/deploy lại backend.
- Giữ `DATABASE_SSL_REJECT_UNAUTHORIZED=true` trong Railway Variables. Xóa `NODE_TLS_REJECT_UNAUTHORIZED=0` nếu từng thêm.
- Nếu Railway có `NODE_EXTRA_CA_CERTS` cũ, xóa biến ghi đè đó hoặc đặt đúng đường dẫn Linux trên.
- Không để các tham số `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `ssl` hoặc `uselibpqcompat` trong `DATABASE_URL` ghi đè cấu hình xác minh TLS của backend. Giữ nguyên host/port/username/password/database và các tham số không liên quan TLS; không đưa URL có mật khẩu vào log hoặc chat.
- Sau deploy, thử đăng nhập và đọc dữ liệu. `/api/health` không thực hiện truy vấn database.
- CA này có hạn tới 2031-04-26; khi Supabase thay CA, tải chứng chỉ mới từ Dashboard, cập nhật file và build lại image. Không lấy CA từ nguồn không tin cậy.

Khi chạy Node trực tiếp trên PowerShell (không dùng Docker), từ gốc repository đặt `$env:NODE_EXTRA_CA_CERTS = (Resolve-Path 'apps/server/certs/supabase-ca.crt').Path` trước khi chạy `npm run dev`. Node chỉ đọc biến này khi tiến trình khởi động, nên dotenv không thể bật nó sau đó.

## 3. Frontend Cloudflare Pages

Hướng dẫn này dùng Pages (frontend tĩnh React/Vite). Không deploy Dockerfile hoặc Compose lên Pages.

| Cấu hình | Giá trị |
| --- | --- |
| Root Directory | `apps/client` |
| Build Command | `npm run build:cloudflare` |
| Build Output Directory | `dist` |
| Node.js | `24.16.0`, từ `apps/client/.node-version` |
| `VITE_API_URL` | `https://qc-azure-production.up.railway.app/api` |

Đặt `VITE_API_URL` trong Settings > Variables cho cả Production và Preview nếu dùng preview deployments. Nếu đã có `NODE_VERSION` cũ, đặt lại `24.16.0` vì biến môi trường có thể ghi đè file version. Pages tự cài dependencies trước build; lockfile được giữ trong repository.

Lệnh `build:cloudflare` kiểm tra URL trước khi gọi Vite. Thiếu URL, URL mẫu, HTTP, localhost, URL có thông tin đăng nhập hoặc `/api` tương đối đều bị từ chối. `.env.production` đã dùng URL Railway thật thay cho Render cũ, nhưng biến Cloudflare có ưu tiên cao hơn: sửa hoặc xóa biến Cloudflare nếu còn URL cũ. `VITE_*` là giá trị công khai, được nhúng vào JavaScript của trình duyệt: chỉ đặt URL API ở frontend.

Sau khi đổi `VITE_API_URL`, phải build/deploy lại frontend. Không dùng `/api` cho Pages khi chưa có reverse proxy: `/api` tương đối chỉ được cấu hình tự động cho Docker local có Nginx. Backend hiện đã hỗ trợ CORS cho các request và header ứng dụng dùng.

Gắn domain frontend trong Pages > Custom domains. Pages có fallback SPA mặc định khi không có `404.html`; không cần redirect tất cả URL bằng một rule mới. File `_headers` đặt cache ngắn cho HTML và cache dài cho assets có hash để tránh trình duyệt giữ frontend cũ.

## 4. Kiểm tra sau deploy

1. Backend `/api/health` trả 200; đăng nhập rồi đọc deadline/lương bằng account hiện có.
2. Mở domain frontend; trong Network, request phải đến domain Railway và đường dẫn `/api/...`, không phải Render hoặc localhost.
3. Kiểm tra avatar/QR/screenshot nếu dùng Storage, và đồng bộ Sheets/Drive nếu đã cấu hình Google. Các thao tác ghi/sync chỉ thử trên dữ liệu phù hợp.
4. Nút trợ lý AI không xuất hiện; POST `/api/assistant/chat` trả 404.

Docker local vẫn chạy bằng `npm run docker:up` tại `http://localhost:8080`. Chuẩn bị source không tự push hoặc deploy lên các tài khoản cloud.

## Tài liệu nền tảng

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway healthchecks và PORT](https://docs.railway.com/deployments/healthchecks)
- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages Node version](https://developers.cloudflare.com/pages/configuration/build-image/)
- [Cloudflare Pages SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
