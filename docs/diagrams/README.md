# Sơ đồ QC Webtoon trên draw.io

Đối chiếu mã nguồn và metadata PostgreSQL ngày 06/10/2026. Các file `.drawio` chứa hình, bảng, cột và đường nối có thể chỉnh sửa trực tiếp.

## File trên Google Drive

- [QC Webtoon – Use Case.drawio](https://drive.google.com/file/d/1FfiVZfZ4cg7iiLYFrdZjou5PvPflw0rh/view): 4 trang gồm chức năng chung, Admin/QC, Freelancer và tích hợp ngoài.
- [QC Webtoon – Database ERD.drawio](https://drive.google.com/file/d/1J4VEWUvtXXGlVLtkeeM894EvAdS_OtVA/view): 2 trang gồm cơ sở dữ liệu nghiệp vụ và hạ tầng email/Web Push.

Mở file trong Google Drive rồi chọn **Mở bằng → draw.io** để draw.io được truy cập đúng file. Sau lần mở đầu tiên có thể dùng liên kết trực tiếp:

- [Mở Use Case trong draw.io](https://app.diagrams.net/#G1FfiVZfZ4cg7iiLYFrdZjou5PvPflw0rh).
- [Mở ERD trong draw.io](https://app.diagrams.net/#G1J4VEWUvtXXGlVLtkeeM894EvAdS_OtVA).

## Căn cứ và ký hiệu

- Use case dựa trên route/quyền trong `apps/server/server.js`, giao diện React và README hiện tại. Freelancer không được tự cấp tài khoản. Admin/QC xem toàn bộ bảng lương; task và lỗi của QC được giới hạn theo mảng.
- ERD bao phủ 15 bảng, 149 cột và 8 FK được đọc trực tiếp từ `information_schema`; không đọc hoặc đưa dữ liệu người dùng vào sơ đồ.
- Xanh liền là FK thực tế. Vàng đứt là liên kết do ứng dụng xử lý, không phải ràng buộc database.
- PK là khóa chính, FK là khóa ngoại, `?` là cột nullable. Chân quạ là 0..n; vạch đơn là 1; tròn và vạch là 0..1.
- `SeriesList` có PK ghép `(seriesId, chapterNumber)`. `DifficultyLevels` và `DifficultyPricing` có UNIQUE ghép `(field, difficulty)`.
- Lương được tính từ task và cấu hình thưởng, không có bảng `Salaries`. Không tự thêm bảng `Series`, `Companies` hoặc bảng nối mảng vào mô hình hiện tại.
- `GeneralSettings.googleDriveRawTransfer` và `googleDriveRawTransferAuth` vẫn tồn tại trong schema; API hiện tại ẩn chúng và không có thao tác sao chép raw đang được cung cấp. Use case Drive chỉ thể hiện tra cứu folder và gắn link bộ truyện.

## Bản cục bộ và tái tạo

- `qc-webtoon-use-case.drawio`, `qc-webtoon-database.drawio`: hai bản gốc.
- `schema-metadata.json`: snapshot cấu trúc, kiểu cột và ràng buộc; không chứa bản ghi nghiệp vụ hay khóa kết nối.
- `generate-diagrams.mjs`: tạo lại các file từ snapshot. Chạy từ gốc repository bằng `node docs/diagrams/generate-diagrams.mjs`.
- `preview-links.json`: liên kết xem trước bằng dữ liệu nén của file cục bộ; mở bản xem trước không tự cập nhật file Drive.

Kiểm tra đã chạy: parse XML cả 6 trang; kiểm tra ID và tham chiếu đường nối; đối chiếu đủ 149 cột và 8 FK với metadata nguồn. Việc tạo sơ đồ không thay đổi schema, dữ liệu database hoặc mã ứng dụng.
