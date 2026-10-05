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
| `MAIL_PROVIDER=gmail` | Gửi qua Gmail API bằng HTTPS, không cần tên miền hoặc SMTP |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | OAuth client và refresh token cấp quyền Gmail gửi; xem hướng dẫn bên dưới |
| `GMAIL_SENDER_EMAIL` | Gmail đã cấp quyền, ví dụ `gmail-cua-ban@gmail.com` |
| `GMAIL_SENDER_NAME=WZ System` | Tên người gửi hiển thị |
| `APP_PUBLIC_URL` | URL frontend cho link task trong mail, ví dụ `https://qc-manager.pages.dev/` |
| `GUIDE_URL`, `RESOURCE_URL` | Nếu đang dùng các link toàn cục này |

Không đưa mật khẩu database hoặc các khóa vào Git/Cloudflare. Lấy danh sách biến và mặc định từ `apps/server/.env.example`; không sao chép `PORT=5000` và đường dẫn file Windows một cách máy móc. Trợ lý AI đã tách khỏi source phát hành, không cần biến `GEMINI_*`.

Trong Railway Settings > Networking, dùng domain public hiện có hoặc tạo domain. Kiểm tra `https://<domain-backend>/api/health` trả HTTP 200. Healthcheck chỉ xác nhận API sống; sau deploy cần đăng nhập và đọc dữ liệu để xác nhận database hoạt động.

Backend hiện lưu phiên đăng nhập trong bộ nhớ. Dùng một replica; redeploy sẽ yêu cầu đăng nhập lại. Không tự chạy thêm migration hoặc tạo database mới trong quá trình build này.

### Nhắc freelancer nộp task qua mail

Trước khi bật tính năng, chạy `docs/migrations/20261003_task_reminders.sql` rồi `docs/migrations/20261003_gmail_reminders.sql` trên database hiện tại. Nếu migration đầu đã chạy thì chỉ chạy migration Gmail mới. Migration đầu thêm cột `taskRemindersEnabled` (mặc định `false`), bảng lịch sử và hàm nhận quyền xử lý nguyên tử; migration Gmail thêm dịch vụ gửi và quy tắc phục hồi an toàn. Lịch sử cũ vẫn mang dịch vụ Resend. Với Supabase REST, migration cấp quyền cho `service_role` và yêu cầu PostgREST tải lại schema; không cấp quyền truy cập lịch sử mail cho trình duyệt. Với PostgreSQL dùng tài khoản backend khác chủ migration, cấp `SELECT, INSERT, UPDATE` trên bảng `TaskReminderDeliveries` và `EXECUTE` trên hàm `task_reminder_store(text, jsonb)` cho đúng role backend; role này cần chính sách RLS tương ứng hoặc quyền bypass RLS.

Cấu hình Gmail theo phần dưới và `APP_PUBLIC_URL` trên Railway. URL frontend không chứa thông tin đăng nhập, query hoặc hash. Sau khi deploy, vào **Cấu hình chung → Nhắc freelancer nộp task qua mail** để bật. Backend cần hoạt động liên tục; tắt chế độ ngủ/serverless của service nếu đang sử dụng để bộ kiểm tra mỗi 60 giây chạy đều. Thiếu biến hoặc migration thì không cho bật; kiểm tra cấu hình không xác nhận OAuth còn hiệu lực, hãy gửi thử trên môi trường thử trước.

Mỗi task chưa nộp được nhắc ở mốc trước 24 giờ, 6 giờ, 3 giờ và một lần quá hạn. Hạn tính 23:59:59.999 theo giờ Việt Nam. Mail gửi riêng tới email hồ sơ freelancer, kể cả ban đêm. Task đã trễ từ trước cũng nhận một mail khi bật; các mốc đã bỏ lỡ không được gửi dồn. Task Submitted/Checking/Fixing/Done không nhận nhắc nộp lần đầu.

Trước khi bật trên dữ liệu thật, kiểm tra trên môi trường thử với hồ sơ dùng hộp thư của đội triển khai. Xác nhận nhận được mail, nút mở đúng task sau đăng nhập và lịch sử không trùng khi khởi động lại. Không thay email freelancer thật để thử nghiệm. “Gmail đã tiếp nhận” chỉ là nhà cung cấp nhận yêu cầu, không xác nhận mail đã vào hộp thư. Gmail không hỗ trợ khóa idempotency: mất kết nối trong lúc gửi, HTTP 5xx, phản hồi thiếu mã mail hoặc backend gián đoạn lúc đang xử lý sẽ chuyển ngay sang “Cần kiểm tra” (sau khi lease hết hạn nếu backend bị gián đoạn). Đối chiếu thư **Đã gửi** trong Gmail theo người nhận, tiêu đề và thời gian trước khi xử lý thủ công. Không có nút tự gửi lại kết quả chưa rõ. Lỗi trước bước gửi (làm mới token) và lỗi giới hạn rõ ràng 429/403 rate limit thử lại tối đa 3 lần sau 1/5/15 phút, tôn trọng Retry-After và hủy khi task đã nộp/đổi mốc. Đổi dịch vụ hoặc địa chỉ gửi khi mail đang chờ cũng dừng để kiểm tra. Tắt công tắc để dừng gửi mới; mail đã được tiếp nhận không thể thu hồi bằng công tắc.

Kiểm thử logic: `node --test apps/server/tests/*.test.mjs apps/client/tests/*.test.mjs`. Kiểm thử database tích hợp yêu cầu `TEST_REMINDER_DATABASE_URL` trỏ tới database **tạm** trên `127.0.0.1`, tên bắt đầu bằng `qc_reminder_test`; test tạo bảng fixture và xóa lịch sử trong database thử này. Không đặt biến đó bằng connection string production.

### Gmail API không cần tên miền

Gửi từ Gmail hiện có, ví dụ `WZ System <gmail-cua-ban@gmail.com>`, qua HTTPS. Không dùng SMTP nên không cần Railway Pro. Tài khoản nhận mail của freelancer vẫn lấy từ database và có thể thuộc bất kỳ dịch vụ email nào. Gmail API có giới hạn gửi của tài khoản; khi bị giới hạn, xem lịch sử thay vì giả định mail đã được giao.

1. Mở [Google Cloud Console](https://console.cloud.google.com/), chọn/tạo project và bật **Gmail API** trong API Library.
2. Trong **Google Auth Platform**, cấu hình Branding/Audience, chọn External cho Gmail cá nhân. Nếu đang Testing, thêm Gmail gửi vào Test users. Trong Data Access, thêm quyền `https://www.googleapis.com/auth/gmail.send` cùng `openid` và `email` (hai quyền sau dùng kiểm tra đúng tài khoản lúc cấp quyền, không đọc hộp thư).
3. Tạo OAuth Client loại **Desktop app**, tải JSON về máy. Lưu ngoài repo; đây không phải JSON Service Account của Sheets/Drive.
4. Từ gốc repo, chạy lệnh bên dưới rồi mở đường dẫn terminal đưa ra, đăng nhập đúng Gmail và cấp đủ quyền. Công cụ dùng callback `127.0.0.1` với port tạm, state và PKCE; chỉ chạy trên máy bạn, không cần cấu hình callback trên Railway.

```powershell
npm run gmail:authorize -- --credentials "C:\duong-dan\client_secret.json" --email "gmail-cua-ban@gmail.com"
```

Công cụ tạo `.gmail-oauth.env` trong thư mục hiện tại, không in secret ra terminal và không ghi đè file đã tồn tại. File này đã bị loại khỏi Git. Để cấp quyền lại, dùng `--output ".gmail-oauth-new.env"`; file JSON gốc cần được lưu ngoài repository. Sao chép từng **giá trị** trong file vào Railway Variables (bỏ dấu ngoặc kép bao ngoài):

```dotenv
MAIL_PROVIDER=gmail
GMAIL_CLIENT_ID=<OAuth client ID>
GMAIL_CLIENT_SECRET=<OAuth client secret>
GMAIL_REFRESH_TOKEN=<refresh token công cụ tạo>
GMAIL_SENDER_EMAIL=gmail-cua-ban@gmail.com
GMAIL_SENDER_NAME=WZ System
APP_PUBLIC_URL=https://qc-manager.pages.dev/
```

`APP_PUBLIC_URL` thêm riêng, công cụ không tạo biến này. Local: chép các biến vào `apps/server/.env`. Không đưa secret vào `VITE_*`, Git, ảnh chụp màn hình hoặc chat. Redeploy backend sau khi đổi biến. Access token được làm mới tự động và dùng lại trong bộ nhớ; refresh token bị thu hồi/hết hiệu lực cần chạy lại công cụ và cập nhật Railway. Ứng dụng OAuth External ở **Testing** cấp refresh token hết hạn sau 7 ngày; trước khi chạy lâu dài, chuyển Audience sang **In production** và cấp quyền lại, đáp ứng yêu cầu xác minh Google nếu áp dụng. Không coi refresh token là quyền gửi vĩnh viễn.

Nếu tiếp tục dùng Resend, đặt rõ `MAIL_PROVIDER=resend`, `RESEND_API_KEY` và `RESEND_FROM` thuộc domain đã xác minh. Mặc định mới là Gmail; biến Resend cũ không tự chọn dịch vụ. Resend vẫn dùng khóa idempotency/cửa sổ 24 giờ; mail cũ không tự chuyển sang Gmail khi đổi cấu hình.

Tài liệu: [gửi bằng Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending), [OAuth Desktop và loopback](https://developers.google.com/identity/protocols/oauth2/native-app), [vòng đời refresh token](https://developers.google.com/identity/protocols/oauth2#expiration), [Railway và SMTP](https://docs.railway.com/networking/outbound-networking).

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

## Web Push: thông báo trên thiết bị

Kênh Web Push không qua Gmail và không phụ thuộc công tắc nhắc mail. Sau khi cấu hình, lời mời bật thông báo xuất hiện sau đăng nhập; người dùng bấm **Cho phép** rồi xác nhận hộp thoại của trình duyệt. Từ chối lời mời không hỏi lại tự động; bật lại trong menu chuông. Nếu Chặn ở hộp thoại trình duyệt, phải thay đổi quyền trong cài đặt trang web.

1. Chạy `docs/migrations/20261005_web_push.sql`, rồi `docs/migrations/20261005_web_push_bell_notifications.sql` trong SQL Editor của database đang dùng. Nếu đã chạy migration đầu, chỉ cần chạy migration thứ hai. Các migration không phụ thuộc hai migration mail, không sửa bảng mail hoặc dữ liệu task; migration thứ hai giữ đăng ký và lịch sử gửi hiện có.
2. Trong `apps/server`, chạy `npm run push:keys`. Lưu cặp khóa sinh ra vào Railway Variables: `WEB_PUSH_VAPID_PUBLIC_KEY` và `WEB_PUSH_VAPID_PRIVATE_KEY`. Đây là cặp khóa lâu dài; không sinh lại mỗi lần deploy và không đưa private key vào frontend/Git.
3. Đặt `WEB_PUSH_VAPID_SUBJECT=mailto:<email-liên-hệ-thật>`, `WEB_PUSH_ENABLED=true`, `APP_PUBLIC_URL=https://<domain-frontend>/`. Khóa VAPID không cần đăng ký Firebase hay chứng chỉ APNs. Chỉ frontend HTTPS (hoặc localhost khi phát triển) dùng được thông báo.
4. Deploy backend với dependency `web-push`, rồi frontend với manifest/service worker mới. Nếu frontend chạy trên Cloudflare, giữ `_headers` để service worker không bị cache lâu.
5. Đăng nhập trên thiết bị, chọn **Cho phép**. Mở chuông → **Gửi thử**, kiểm tra trung tâm thông báo. Bấm thông báo deadline mở đúng task; thông báo lỗi mở Quản lý lỗi. Thử **Không cho phép**, tải lại và kiểm tra không hỏi lại; thử đăng xuất để xác nhận ngừng nhận trên thiết bị.
6. iPhone/iPad từ iOS/iPadOS 16.4: Safari → Chia sẻ → Thêm vào Màn hình chính → mở biểu tượng WZ System → bật thông báo. Android dùng trình duyệt hỗ trợ Web Push như Chrome. Kiểm tra cả cài đặt thông báo của trình duyệt/hệ điều hành và chế độ Không làm phiền.

Worker chạy trên backend liên tục, quét mỗi phút và áp dụng cùng bốn cửa sổ nhắc như mail (24h/6h/3h/quá hạn), không gửi bù tất cả mốc đã bỏ lỡ khi máy chủ ngừng chạy. Mỗi tài khoản có thể bật nhiều thiết bị; mỗi thiết bị nhận một lượt cho từng task/hạn/mốc. Task nộp, đổi người nhận hoặc đổi hạn được kiểm tra lại trước khi gửi. Nếu thay khóa VAPID, người dùng cần mở lại web để client tạo đăng ký mới.

Worker còn gửi các thông báo hiện có trong chuông theo quy tắc chung tại `apps/shared/bellNotifications.mjs`: Freelancer có lỗi cần sửa (Fixing/feedback), lỗi chưa tick Fix/Check, đã có raw, hạn trong hôm nay và deadline được giao. Admin/QC hiện không có mục thông báo trong chuông nên không phát sinh push nghiệp vụ cho hai role này. Thiết bị theo role đang chọn lần gần nhất trên web; đổi role cập nhật đăng ký mà không xin quyền lại. Đăng ký cũ chưa lưu role dùng role mặc định của account đến khi người dùng mở lại web.

Mỗi thông báo trong chuông được gửi một lần cho từng thiết bị/role/phiên bản nội dung, kể cả sau khi backend khởi động lại. Sửa feedback/nội dung hoặc thông báo biến mất rồi xuất hiện lại giữa các lượt quét sẽ tạo phiên bản mới; chỉ đổi `updatedAt` không gửi lại. Khi bật lần đầu, những mục đang có trong chuông cũng được gửi. Trạng thái đã đọc trong giao diện không phải điều kiện nhận push. Các nhắc 24h/6h/3h/quá hạn là lượt riêng nên có thể cùng xuất hiện với thông báo trong chuông.

Để cập nhật hệ thống đã bật Web Push: chạy migration thứ hai, deploy lại backend Railway và frontend Cloudflare, rồi mở lại web trên thiết bị. Giữ nguyên khóa VAPID và các biến môi trường đã cấu hình; không cần thêm biến mới.

Cho phép nhận là quyền của từng trình duyệt/origin, không thể tự bật ở mọi thiết bị. Push service tiếp nhận không bảo đảm người dùng đã nhìn thấy banner; cách hiện, âm thanh và thời gian nhận phụ thuộc thiết bị, kết nối và quyền hệ điều hành.

Nguồn: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [MDN yêu cầu quyền](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static), [WebKit Web Push trên iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [web-push](https://github.com/web-push-libs/web-push).

## Tài liệu nền tảng

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway healthchecks và PORT](https://docs.railway.com/deployments/healthchecks)
- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages Node version](https://developers.cloudflare.com/pages/configuration/build-image/)
- [Cloudflare Pages SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
