-- Lưu ảnh đại diện của account để hiển thị ổn định sau khi đăng nhập lại.
ALTER TABLE public."Accounts"
  ADD COLUMN IF NOT EXISTS "avatar" text;
