# Kế hoạch dọn dẹp code QC Webtoon

Ngày rà soát: 07/10/2026. Phạm vi: mã nguồn đang được Git quản lý, cấu hình build/deploy, tài liệu và test. Các mục 1–6 ghi lại kết quả trước khi dọn và kế hoạch ban đầu; mục 7 ghi nhận phần đã thực hiện.

## 1. Kết quả kiểm tra hiện tại

- Đã đọc hướng dẫn `AGENT.md`, các README, cấu trúc client/server/shared, các điểm gọi API, module dữ liệu và tích hợp, cấu hình Docker/Cloudflare và test liên quan.
- Working tree sạch trước khi rà soát.
- Test client và server: **155 test, 152 pass, 0 fail, 3 skip**. Ba test cần PostgreSQL riêng cho account lifecycle, task reminder và Web Push; chưa kiểm chứng tích hợp database.
- Lint chạy trong `apps/client`: **13 warning, không có error**, exit code 0. Quét thêm từ root bằng cùng oxlint phát hiện cảnh báo backend và script.
- Build frontend thành công: JS chính **593,06 kB** (gzip 173,19 kB), CSS **107,86 kB** (gzip 18,67 kB). Có cảnh báo chunk JS vượt 500 kB.
- Kích thước file tính theo dòng vật lý, gồm cả dòng trống: `server.js` khoảng **5.437**, `App.css` khoảng **6.080**, `DeadlineManagementView.jsx` khoảng **1.401**, `ErrorManagementView.jsx` khoảng **884**. Kích thước lớn là dấu hiệu cần tổ chức lại, không chứng minh toàn bộ nội dung là rác.

Lệnh thực tế đã chạy, dùng Node bundled vì Node/npm không có trong PATH:

```powershell
$taskNode = 'C:\Users\anhxu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
# Từ thư mục gốc:
& $taskNode --test 'apps/client/tests/*.test.mjs' 'apps/server/tests/*.test.mjs'
& $taskNode apps/client/node_modules/oxlint/bin/oxlint
# Từ apps/client:
& $taskNode node_modules/oxlint/bin/oxlint
& $taskNode node_modules/vite/bin/vite.js build
```

Chưa chạy giao diện bằng trình duyệt, Docker build, Cloudflare build riêng hoặc đồng bộ tới Google/Supabase thật. Build tạo lại thư mục `dist` bị Git ignore.

## 2. Danh sách phát hiện và hướng xử lý

| Ưu tiên | Vị trí hiện tại | Bằng chứng | Hành động đề xuất | Rủi ro |
| --- | --- | --- | --- | --- |
| P1 | `apps/server/server.js:1166–1171` | `try/catch` bên trong chỉ `throw error`; bên ngoài đã xử lý lỗi | Bỏ lớp bọc bên trong, giữ response và cách xử lý lỗi bên ngoài | Thấp |
| P1 | `apps/server/server.js:3283–3329` | `deleteDeadlinesFromGoogleSheet` không có nơi gọi trong source/test đã quét; oxlint cũng báo unused | Đưa vào danh sách xóa sau khi ghi nhận riêng sự không nhất quán của luồng xóa với README | Thấp đối với code đang chạy; cần xác định nghiệp vụ xóa |
| P1 | `apps/client/src/assets/hero.png`, `apps/client/public/icons.svg` | Không tìm thấy tham chiếu trong source/config đã quét; `icons.svg` còn sprite mạng xã hội của template | Xóa sau lượt xác minh cuối với HTML, CSS, manifest và chuỗi URL tạo động | Thấp |
| P1 | `apps/client/src/components/common/Icons.jsx` | 13 export không xuất hiện trong các module client còn lại | Bỏ icon không dùng; giữ icon có import và icon dùng trong map component | Thấp |
| P1 | `apps/client/README.md`, `README.md`, `AGENT.md` | README client còn phần hướng dẫn template Vite; tài liệu trỏ tới 3 file không tồn tại | Bỏ nội dung template, sửa liên kết và hướng dẫn setup dựa trên tài liệu hiện có | Thấp |
| P2 | `apps/client/src/App.css`, `src/index.css` | Phân tích PostCSS tìm 70 rule ở App.css và 26 rule ở index.css không thấy tên class đầy đủ trong JS/JSX; App.css có 29 selector cấp gốc xuất hiện nhiều lần | Rà từng nhóm, loại class tạo động khỏi danh sách, xóa CSS cũ đã xác nhận; hợp nhất override sau khi đối chiếu cascade | Trung bình |
| P2 | `apps/server/bonus.mjs`, `apps/shared/bonus.mjs`, `apps/client/src/utils/bonus.mjs` | Server và shared trùng logic sau khi bỏ comment/khoảng trắng; client lặp default, resolve và validate | Đặt logic chuẩn trong shared, dùng import/re-export hoặc bước sinh bản đóng gói có kiểm tra đồng bộ | Trung bình; liên quan lương và deploy |
| P2 | `ToastContainer.jsx:7`, `App.jsx:148` và các view có warning effect | Export helper chung với component; dependency effect và nhiều setState trong effect bị lint cảnh báo | Tách dispatcher toast; rà mục đích từng effect, giữ luồng auth, form và polling | Trung bình |
| P3 | `server.js`, `DeadlineManagementView.jsx`, `ErrorManagementView.jsx` | File gom route, nghiệp vụ, parser, component và state | Tách theo trách nhiệm từng bước, giữ API và hành vi | Cao hơn; phải chuyển test theo module |
| P3 | `App.jsx`, các view bảng | Import view đồng thời; `ColumnFilterButton` được viết riêng ở Account, Freelancer và Deadline | Lazy-load view lớn; chỉ gom phần filter thực sự cùng semantics | Trung bình |

13 icon ứng viên: `IconShield`, `IconDownload`, `IconChevronDown`, `IconSparkles`, `IconGrid`, `IconList`, `IconMessage`, `IconSmartphone`, `IconSend`, `IconFile`, `IconZap`, `IconArrowLeft`, `IconArrowRight`. Việc xóa export chủ yếu giảm mã cần bảo trì; chưa đo lợi ích bundle vì bundler có thể đã loại export không dùng.

CSS ứng viên rõ nhất: `.brand-badge`, `.brand-logo-icon`, `.role-switcher-box`, `.kanban-*`, `.dashboard-link-*` và các nhóm badge cũ trong `index.css`. **96 rule là danh sách sàng lọc, không phải 96 rule chắc chắn được phép xóa.** Ví dụ `ErrorManagementView.jsx:31` tạo `error-type-${slug}`, nên các selector `.error-type-file`, `.error-type-censor`… vẫn có thể đang dùng.

Các tài liệu đang được tham chiếu nhưng thiếu: `docs/use-case.md`, `docs/sample-database.sql`, `docs/database diagram.png`. Có `docs/diagrams/README.md`, file drawio và `schema-metadata.json`; cần trỏ tới đúng tài liệu hiện hành. Snapshot schema không thay thế tự động cho một script khởi tạo database đầy đủ.

## 3. Những phần không nên xóa máy móc

- `server.js:756`: destructuring `sourceSheetUrl`, `sourceUrl`, `sourceRow` nhằm loại thông tin nguồn khỏi response Freelancer. Đây là chủ ý về phạm vi dữ liệu, dù lint báo unused. Giữ phép loại trường; thể hiện chủ ý bằng helper hoặc cấu hình lint cục bộ có giải thích.
- `server.js:3884`: `localFileSignature` chưa được dùng trong parser ZIP. Có thể bỏ hằng dư để giữ hành vi, hoặc dùng nó để kiểm tra local header trong một thay đổi riêng có test file lỗi; không gộp thay đổi parser vào lượt dọn đơn giản.
- `AccountManagementView` đang được nhúng trong `FreelancerManagementView`, không phải màn hình chết.
- Tất cả method trong `services/api.js` có nơi gọi trong client đã quét. Chưa có cơ sở xóa endpoint chỉ vì không thấy mục riêng trên sidebar.
- `notification-sw.js`, manifest, favicon, icon push, certificate Supabase và các entrypoint/config được dùng ngoài import graph thông thường.
- Fallback dữ liệu cũ: `bonusPolicy.versions`, `field/fields`, QC legacy, alias `calculateMonthlyBonus`, tùy chọn lọc lương theo tháng và các định danh cũ. Một số đã có test chứng minh tương thích. Chỉ bỏ khi đã kiểm kê người gọi và dữ liệu.
- PostgreSQL và Supabase REST là hai chế độ được tài liệu và repository hỗ trợ; giữ cả hai.
- Giữ lockfile, migration, seed, repair SQL và diagram generator có mục đích rõ ràng. Không chạy repair hoặc xóa dữ liệu khi dọn source.
- `.local-only` là vùng tính năng được giữ cục bộ và Git ignore; không coi đó là dữ liệu được phép xóa. Dòng chặn `GEMINI_API_KEY` trong Compose có chủ ý tránh truyền credential cho tính năng này.
- Regex chặn control character trong mail/OAuth, vòng lặp phân trang và catch phục hồi queue không phải code thừa chỉ vì lint cảnh báo.

## 4. Trình tự thực hiện

### Đợt 1 — Dọn phần chắc chắn dư

1. Bỏ `try/catch` ném lại lỗi; xác minh rồi xóa asset và icon ứng viên.
2. Ghi nhận và xử lý hàm không gọi; bỏ hằng ZIP chưa dùng nếu giữ parser hiện tại.
3. Làm sạch README template và tham chiếu tài liệu thiếu.
4. Thêm script test/lint thuận tiện ở root để có một cách kiểm tra nhất quán. Chưa bật mọi warning thành error; lập baseline và chặn warning mới trước.

Nghiệm thu: test giữ nguyên kết quả; lint không phát sinh cảnh báo mới; frontend build thành công; không đổi contract API, quyền truy cập hay database. Với icon/asset, xác minh các màn hình liên quan vẫn hiển thị đủ.

### Đợt 2 — Dọn CSS theo nhóm màn hình

1. Chốt class động từ template string, map và helper; mở rộng kiểm tra tới HTML, service worker và shared module.
2. Xóa nhóm Kanban/header/template không còn dùng, từng nhóm nhỏ.
3. Đối chiếu selector lặp, media query, specificity và thứ tự khai báo trước khi gộp. Selector lặp có thể bổ sung thuộc tính, không mặc định là dư.
4. Tách CSS layout/common/views/theme khi đã xác nhận cascade. Giữ thứ tự import để tránh đổi giao diện.

Nghiệm thu: kiểm tra dark/light, desktop/mobile, 3 role, menu chuông, filter, modal/portal, bảng deadline/error/salary. So sánh ảnh trước/sau trên dữ liệu cố định. Đo lại CSS; không đặt mục tiêu giảm phần trăm khi chưa đo phần có thể xóa an toàn.

### Đợt 3 — Hợp nhất nghiệp vụ và xử lý warning React

1. Hợp nhất bonus vào `apps/shared`, giữ wrapper export hiện tại trong giai đoạn chuyển đổi nếu cần.
2. Cập nhật Dockerfile và cách đóng gói service để shared module luôn có mặt. README backend từng hỗ trợ Root Directory riêng; xác minh cách deploy thực tế trước khi bỏ bản cục bộ. Docker hiện chỉ copy riêng shared bell notifications.
3. Chạy test bonus/lương giữa các bản và thêm kiểm tra đồng bộ nếu còn sinh bản đóng gói.
4. Tách toast dispatcher; xử lý warning effect theo từng màn hình. Không thêm dependency `profile` một cách máy móc nếu làm thay đổi nhịp heartbeat.

Nghiệm thu: bonus KPI/mốc cộng dồn, tiền tính bằng cents, task thiếu ngày nộp, QC transfer, dữ liệu legacy giữ nguyên; test pass; cả build frontend và đóng gói backend có đầy đủ module.

### Đợt 4 — Tách file lớn và giảm tải ban đầu

1. Trước khi di chuyển code, thay test đang đọc source bằng regex/slice/VM bằng import module hoặc harness route có dependency injection, giữ assertion nghiệp vụ hiện tại.
2. Tách backend theo nhóm: khởi tạo app và worker; auth/account; deadline; pricing/salary; errors/Fix-Check; Google auth/Sheets/Drive; parser XLSX/ảnh. Di chuyển từng cụm, tránh viết lại hàng loạt.
3. Tách component/hook cho bảng deadline và lỗi: filter, cell editor, modal, screenshot, polling. Giữ optimistic update, rollback, quyền role và queue.
4. Gom filter/định dạng thực sự trùng; tránh gom các quy tắc ngày tháng hoặc quyền khác nhau vào một helper chung thiếu rõ ràng.
5. Lazy-load các view lớn qua `React.lazy`/`Suspense`, đo initial chunk và kiểm tra chuyển trang. Theo dõi tổng dung lượng và thời gian tải, không chỉ làm mất cảnh báo 500 kB.

Nghiệm thu: test import trực tiếp và test route giữ độ bao phủ nghiệp vụ; test PostgreSQL chạy trên database dùng riêng; kiểm tra login/logout/chuyển role, CRUD, sync, Fix/Check, lương, mail/push trên staging; build/deploy không thiếu module.

## 5. Điểm nghiệp vụ cần xác minh riêng

README nói xóa deadline trên web được phản ánh tới Google Sheet. Route `DELETE /api/deadlines/:seriesId/:chapterNumber` hiện đồng bộ trước rồi xóa database, không gọi helper xóa Sheet; `reset-all` cũng chỉ xóa database và ghi thời điểm sync. Có nguy cơ dòng được nhập lại khi đồng bộ tiếp theo nếu vẫn còn ở Sheet. Đây là suy luận từ code, chưa chạy xác minh với Sheet thật.

Lượt dọn code không nên tự nối helper đang chết vào route vì việc đó sẽ tạo thêm hành động xóa bên ngoài. Tách thành việc kiểm chứng trên Sheet/database thử nghiệm, xác định hành vi mong muốn, rồi mới quyết định bỏ helper hoặc sửa luồng đồng bộ. Bổ sung test xóa → đồng bộ lại trước khi thay đổi hành vi.

## 6. Cách chia thay đổi để dễ review

Mỗi đợt là một nhóm commit/PR riêng; CSS chia nhỏ theo màn hình, backend chia nhỏ theo domain. Hoàn thành và kiểm tra đợt trước rồi mới làm đợt sau. Khi một bước thay đổi tiền, quyền, đồng bộ hay gửi thông báo, chuyển nó thành thay đổi nghiệp vụ riêng với test tương ứng.

Ưu tiên bắt đầu bằng đợt 1 và 2. Đợt 3 và 4 là cải thiện bảo trì có rủi ro cao hơn, cần giữ baseline và xác minh cách đóng gói trước khi triển khai.

## 7. Kết quả dọn code theo yêu cầu giữ nguyên luồng

Đã thực hiện ngày 07/10/2026:

- Xóa helper `deleteDeadlinesFromGoogleSheet` không được gọi và hằng `localFileSignature` không dùng; bỏ `try/catch` chỉ ném lại lỗi trong route xóa deadline.
- Giữ nguyên việc loại metadata Sheet khỏi response Freelancer; đặt alias `_sourceSheetUrl`, `_sourceUrl`, `_sourceRow` để thể hiện rõ các giá trị cố ý không dùng.
- Xóa 13 icon không có nơi dùng trong ứng dụng hoặc source tính năng giữ cục bộ; xóa hai asset template `hero.png` và `icons.svg`.
- Xóa 71 rule CSS hoàn toàn không dùng (45 ở App.css, 26 ở index.css), cùng selector chết trong các rule dùng chung. Tổng cộng loại 81 selector. Các selector còn lại giữ nguyên khai báo, thứ tự và ngữ cảnh media/theme.
- Giữ các class tạo động cho role, trạng thái task, loại lỗi, deadline column và thông báo; giữ các override đang hoạt động.
- Bỏ README template, sửa tham chiếu tài liệu không tồn tại và bổ sung script `npm test`, `npm run lint` ở root.

Kiểm tra sau thay đổi:

- Toàn bộ test client/server: **152 pass, 0 fail, 3 skip** trên tổng 155 test, giống baseline. Ba test PostgreSQL chưa chạy vì chưa có cấu hình database kiểm thử riêng.
- Root lint theo script mới: **20 warning, 0 error**, giảm từ 26 warning của lượt quét root ban đầu. Client lint vẫn có 13 warning cũ; không sửa luồng effect chỉ để xóa warning.
- Frontend build thành công. CSS giảm từ **107,86 kB xuống 100,24 kB**; gzip giảm từ **18,67 xuống 17,43 kB**. Cảnh báo JS chunk vượt 500 kB có sẵn vẫn còn.
- Đối chiếu JavaScript đóng gói trước/sau: nội dung giống nhau sau khi chuẩn hóa tên file CSS được tham chiếu.
- Đối chiếu cấu trúc CSS bằng PostCSS: selector còn lại, khai báo, thứ tự và ngữ cảnh media/keyframes giữ nguyên.
- Chạy harness tạm đối chiếu 14 tình huống route xóa deadline và GET errors trước/sau: response và thứ tự thao tác dữ liệu giống nhau; metadata nguồn vẫn được ẩn khỏi Freelancer.
- `git diff --check` sạch. Không thay dependency hoặc lockfile.

Các kiểm tra dùng cùng Node bundled và lệnh test/lint/build ở mục 1; root lint được chạy với các đối số của script mới (`apps scripts`) và định dạng JSON để đếm warning/error. Harness và bản build baseline nằm trong thư mục tạm ngoài repository.

Lượt này giữ nguyên module bonus/lương, auth, queue sync, mail/push, migration và cấu hình deploy. Việc hợp nhất bonus, thay effect, lazy-load và tách file lớn là các thay đổi kiến trúc cần kiểm chứng riêng, nên không gộp vào dọn code giữ nguyên hành vi. Chưa chạy trình duyệt, Docker build hoặc tích hợp Google/database production; chưa deploy hay thay dữ liệu.
