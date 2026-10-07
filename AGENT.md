# Hướng dẫn cho agent

Tài liệu này áp dụng cho toàn bộ repository QC Webtoon. Trước khi sửa, hãy đọc phần liên quan trong `README.md`, README của ứng dụng con, `docs/diagrams/README.md` và các migration/metadata schema hiện có để giữ thay đổi nhất quán với hành vi và dữ liệu của dự án.

## Kiến trúc repository

- `apps/client`: giao diện React 19, chạy và đóng gói bằng Vite. Mã ứng dụng nằm trong `src/`, gồm component, view, service gọi API, tiện ích và dữ liệu giao diện.
- `apps/server`: REST API Node.js/Express. Backend đọc PostgreSQL qua `DATABASE_URL`, hoặc dùng Supabase REST khi không cấu hình PostgreSQL.
- `apps/shared`: các module dùng chung hoặc được đồng bộ giữa frontend và backend. Khi thay đổi quy tắc nghiệp vụ ở đây, kiểm tra các bản tương ứng trong client/server và cập nhật đồng bộ nếu cần.
- `docs`: schema mẫu, migration SQL, dữ liệu khởi tạo và tài liệu nghiệp vụ. Xem migration gần nhất và quy ước hiện có trước khi thêm thay đổi database.

## Cài đặt và chạy

Cài dependencies riêng cho từng ứng dụng:

```bash
cd apps/client && npm install
cd ../server && npm install
```

Chạy frontend và backend trong hai terminal riêng:

```bash
cd apps/client && npm run dev
cd apps/server && npm run dev
```

Frontend mặc định gọi API tại `http://localhost:5000/api`; có thể cấu hình `VITE_API_URL`. Backend dùng cấu hình trong `apps/server/.env`; xem `apps/server/.env.example` và README để biết các biến cần thiết.

Các lệnh kiểm tra hiện có:

```bash
npm test
npm run lint
cd apps/client && npm run lint
cd apps/client && npm run build
```

Chạy `npm test` và `npm run lint` từ thư mục gốc sau khi đã cài dependencies của client và server. Các test database chỉ chạy khi có biến `TEST_*_DATABASE_URL` tương ứng trỏ tới database kiểm thử riêng.

Chạy một bài test backend từ thư mục gốc bằng Node.js test runner:

```bash
node --test apps/server/tests/<ten-file>.test.mjs
```

Có thể chạy toàn bộ test backend bằng `node --test apps/server/tests/*.test.mjs`; Node.js 24 hỗ trợ glob của test runner. Kiểm tra các script trong `package.json` trước khi giả định có lệnh lint, build hoặc test ở cấp server.

## Quy tắc khi thay đổi

- Giữ frontend, API và quy tắc nghiệp vụ nhất quán. Kiểm tra nơi gọi API trong `apps/client/src/services/` và route/xử lý tương ứng trong `apps/server/`.
- Khi thay đổi cấu trúc hoặc dữ liệu PostgreSQL/Supabase, cập nhật migration trong `docs/migrations/` và các schema/tài liệu liên quan. Không dựa vào thay đổi thủ công chỉ trong giao diện quản trị database.
- Không làm mất khả năng tương thích với schema hoặc dữ liệu cũ nếu chưa xem migration và cách backend đang đọc/ghi bảng, cột đó.
- Dùng tên bảng/cột và trạng thái theo schema cùng tài liệu nghiệp vụ hiện có; không tự tạo biến thể tên hoặc giá trị trạng thái.
- Giữ các thay đổi tập trung vào yêu cầu. Tránh sửa định dạng hoặc tái cấu trúc không liên quan.
- Nếu thay đổi cách cấu hình, chạy, nghiệp vụ hoặc database, cập nhật README/tài liệu liên quan để phản ánh hành vi mới.

## Bí mật và cấu hình

- Đặt thông tin kết nối database, khóa Supabase, thông tin Google Service Account và các bí mật khác trong file `.env` cục bộ hoặc secret store phù hợp; không commit chúng, không đưa giá trị bí mật vào mã nguồn, log, test fixture hay tài liệu.
- Dùng `apps/server/.env.example` làm nơi mô tả tên biến và giá trị mẫu không nhạy cảm. Không sao chép khóa hoặc thông tin xác thực thật vào file mẫu.
- Trước khi thêm file cấu hình hoặc dữ liệu kiểm thử, kiểm tra để chắc chắn không chứa dữ liệu tài khoản hay thông tin cá nhân thật.

## Hoàn tất thay đổi

- Chọn kiểm tra phù hợp với phần đã sửa: lint/build client cho giao diện; `node --test` cho logic/API backend; rà migration và tài liệu khi có thay đổi database.
- Nếu môi trường thiếu biến cấu hình hoặc dịch vụ ngoài khiến kiểm tra không chạy được, ghi rõ giới hạn đó.
- Trong phần bàn giao, tóm tắt thay đổi và nêu chính xác những lệnh kiểm tra đã chạy cùng kết quả; không khẳng định đã kiểm tra những phần chưa chạy.
