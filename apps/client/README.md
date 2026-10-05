# React + Vite

## Thông báo trên thiết bị

Khi backend Web Push sẵn sàng, lời mời **Bạn muốn cho phép trang web này gửi thông báo cho bạn không?** xuất hiện sau đăng nhập. Chỉ khi bấm **Cho phép**, client mới gọi `Notification.requestPermission()` trực tiếp trong thao tác bấm; trình duyệt quyết định câu chữ và cách hiển thị hộp thoại. **Không cho phép** ghi nhớ lựa chọn trên thiết bị, không mở quyền và không hỏi lại tự động. Có thể bật lại, tắt hoặc gửi thử từ menu chuông. Nếu đã Chặn ở trình duyệt, cần sửa quyền trang web rồi tải lại.

Trang production phải dùng HTTPS. iPhone/iPad từ iOS 16.4 cần thêm trang vào màn hình chính và mở từ biểu tượng đó; lời mời có hướng dẫn khi chưa cài. Manifest và icon được đóng gói trong `public/`; `notification-sw.js` chỉ xử lý push và click, không cache hay chặn request trang/API. Quyền gắn theo origin, đăng ký gắn theo tài khoản và từng thiết bị. Đăng xuất xóa binding trong service worker, đóng thông báo cũ và hủy đăng ký của thiết bị; đăng nhập lại có thể khôi phục lựa chọn đã bật mà không xin quyền lại. Không tự đăng ký cho tài khoản khác chỉ vì trình duyệt đã cấp quyền.

Xem [cấu hình backend và kiểm thử](../../docs/deployment.md#web-push-thông-báo-trên-thiết-bị).

## Bảng lương

Dòng cuối bảng giữ tổng từng cột theo các hàng đang được lọc và hiển thị thêm tổng của hai cột tiền ở ô ngoài cùng bên phải. Ô mới là phép cộng hai cột hiển thị, không thay đổi cách tính lương/bonus: `Tổng lương` đã bao gồm bonus nên ô mới không phải số tiền thanh toán thực tế.

Bonus cộng dồn mọi chap đã tick Thanh toán theo từng freelancer và từng mảng, không chia tháng hoặc lọc status. Task thiếu Ngày nộp vẫn được tính trong bảng tổng; mốc thưởng và điều kiện % hoàn thành giữ nguyên. Chi tiết bonus mỗi mảng chỉ có một nhóm; KPI nhận một lần, không đặt lại mốc vào tháng mới.

## Deadline quá hạn

Dòng deadline được tô đỏ khi đã qua ngày Hạn DL (hết ngày theo múi giờ Việt Nam) và status là Doing hoặc chưa được đặt (Chưa bắt đầu). Submitted/Checking/Fixing/Done không tô đỏ cả dòng theo quy tắc này; cảnh báo Ngày nộp trễ giữ nguyên. Màu dòng dùng status đang hiển thị, kể cả lúc cập nhật status chưa lưu xong.

## Deploy Cloudflare Pages

Dùng Root Directory `apps/client`, Build command `npm run build:cloudflare`, Output directory `dist`. File `.node-version` khóa Node.js 24.16.0. Đặt `VITE_API_URL=https://qc-azure-production.up.railway.app/api` trong Cloudflare cho Production và Preview trước khi build. Lệnh build này từ chối URL thiếu, placeholder, localhost hoặc `/api` tương đối. Không đặt khóa database, Supabase service role hay Google trong frontend.

Xem [hướng dẫn triển khai](../../docs/deployment.md). `npm run build` vẫn dùng cho local; Docker local tự cấu hình `/api` thông qua Nginx.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
