-- Tạo account Freelancer cho danh sách Latin.
-- Username được đặt duy nhất theo thứ tự; mật khẩu mặc định của tất cả account là: 123456
-- Có thể chạy lại script: các email/username đã tồn tại sẽ được bỏ qua.
-- Trigger của bảng Accounts sẽ tự tạo hồ sơ tương ứng trong bảng Freelancer.

BEGIN;

INSERT INTO "Fields" ("name")
VALUES ('Latin')
ON CONFLICT ("name") DO NOTHING;

WITH seed ("username", "displayName", "email", "passwordHash", "passwordSalt") AS (
  VALUES
    ('latin_freelancer_01', 'Nguyễn Thảo My', 'thaomy280409@gmail.com', 'd91d62a15e723dc0ba4ee3c18e0b87f0823561a254a46c98e8c83722a8a252ec734cf08bc0faff22140eeddd3470174de4dcec57e6da1ff0267139098637baea', 'latin-freelancer-salt-0100000000'),
    ('latin_freelancer_02', 'Võ Thị Minh Thúy', 'vothiminhthuy11@gmail.com', 'd5b5f9a1f2528eefaa99cd657603a0e9c872a8102d27d825f91ea99da8603500d210b72156695b14950e373bf04ad5c412c17331fac5081a12eec82e97dfe73a', 'latin-freelancer-salt-0200000000'),
    ('latin_freelancer_03', 'Trương Cao Bảo Trân', 'pnbaotran2k@gmail.com', '26b56452e6f0b174e6b25e9a86e9207563a022412301910186b45febbff0eee7720fc4943ece26bbe42d2003bcd77247351a0d736aeaf36ef83a1e7aa4075a4f', 'latin-freelancer-salt-0300000000'),
    ('latin_freelancer_04', 'Nguyễn Thùy Bảo Trà', 'ntbtram2108@gmail.com', 'd1e143994e517c4ee563c0a7bfd4329bc22d52f2c65ad6a5ac5aeb7838b780b070b4c4d585827d8bac333fc364e492639dd6eae456d713e947644126f38f275e', 'latin-freelancer-salt-0400000000')
)
INSERT INTO "Accounts" (
  "username", "passwordHash", "passwordSalt", "role", "displayName", "email", "field", "fields", "isActive"
)
SELECT
  seed."username",
  seed."passwordHash",
  seed."passwordSalt",
  'Freelancer',
  seed."displayName",
  seed."email",
  'Latin',
  ARRAY['Latin']::text[],
  true
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM "Accounts" existing
  WHERE existing."username" = seed."username"
     OR lower(COALESCE(existing."email", '')) = lower(seed."email")
);

COMMIT;
