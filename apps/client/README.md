# React + Vite

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
