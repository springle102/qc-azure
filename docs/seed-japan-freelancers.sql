-- Tạo account Freelancer cho danh sách Japan.
-- Username được đặt duy nhất theo thứ tự; mật khẩu mặc định của tất cả account là: 123456
-- Có thể chạy lại script: các email/username đã tồn tại sẽ được bỏ qua.
-- Trigger của bảng Accounts sẽ tự tạo hồ sơ tương ứng trong bảng Freelancer.

BEGIN;

INSERT INTO "Fields" ("name")
VALUES ('Japan')
ON CONFLICT ("name") DO NOTHING;

WITH seed ("username", "displayName", "email", "passwordHash", "passwordSalt") AS (
  VALUES
    ('jp_freelancer_01', 'Đoàn Như Quỳnh', 'doannhuquynh23042008@gmail.com', '5675ab6607814bb274be0850e6250213fae0496d523dbaf98c21e18c75a7f6a0ef6a44a7ed135e831fe048d481172c7b882c442d44f627c41f9942eb72947edc', 'jp-freelancer-salt-0100000000000'),
    ('jp_freelancer_02', 'Huỳnh Khánh Châu', 'khanhchau2310@gmail.com', '9b6694f68180227a1c52eb68fa5404fa2964ad0979ae24988fd771628a508c3c84876a89506da79a8a05e9c6eeeb7aa5ff1bc660e963c7f3cbec833c59fcf516', 'jp-freelancer-salt-0200000000000'),
    ('jp_freelancer_03', 'Huỳnh Thúy Ngân', 'nganhuyh37@gmail.com', '604c53d89f9fa04d7dca7157eb6b9cf0f5fa3601b4d427fa95ebd78d9e1b005c570f76041be2f0a99697af2c5161982ada5781459332ec7f9efd38968c23dea7', 'jp-freelancer-salt-0300000000000'),
    ('jp_freelancer_04', 'Lê Kim Ngân', 'lekimngan10122@gmail.com', '101808b8bfb41a13d2b5d143d63daa884258b1ec52826ef7fdd32a2d75f259bde159f7aefa6bfe3cbdb1bcc33f60689c2cf0b5af3f04831b51e81476110dbc05', 'jp-freelancer-salt-0400000000000'),
    ('jp_freelancer_05', 'Lê Linh Chi', 'clelinh44@gmail.com', '49673980ab57050fa362af3655beeed53c36ce88b37b8baeba4a0a1f1117acbf516029909bc299e7f7c6513f4e06307c6ed52d5cc916c89cef817674764f75c9', 'jp-freelancer-salt-0500000000000'),
    ('jp_freelancer_06', 'Mai Thị Thanh Huyền', 'hoalanhodiep10@gmail.com', 'e22cfa2969944d2adf0ff725b9ea7a6c174f74c54ffbbb36638780fc7275176afeaafd71d550941ce4a54ffe5dd9107f649cf07c8264b9fa50e1f0c2302a9145', 'jp-freelancer-salt-0600000000000'),
    ('jp_freelancer_07', 'Nguyễn Hồng Bảo Trân', 'bbaotran000@gmail.com', '6c611f8065d2a5e01d321dce910f12d4b721893f7d713812a6ff227b565185eaf6405a0044692146fe424c47cfc8690bfa4dc81a0ef3bd11b1704fd81db9eaed', 'jp-freelancer-salt-0700000000000'),
    ('jp_freelancer_08', 'Nguyễn Thanh Hoài', 'loannguyen99@gmail.com', '5b24dcf3cb0ac5bab8d291d2453b03b1fd3ea1052f7a57a652ea32c06137ea37dd153439b42c047578e6be52e8c5c73291b73e28c6a11fd2a67db70a88fd13c4', 'jp-freelancer-salt-0800000000000'),
    ('jp_freelancer_09', 'Nguyễn Thị Như Ý', 'tieusongnhu1204@gmail.com', '8459be175e518b4dcd41c74212706e4458d2e5e811407a7485ffd634348dab0c220ee2ed4502a03c782e21e630f20957a264747b3955e03a1048785224e89a38', 'jp-freelancer-salt-0900000000000'),
    ('jp_freelancer_10', 'Trần Nguyễn Ngọc Anh', 'tobio1807@gmail.com', '3985d44a3278d03cd33bde594e53dcb50fd0f3b85378750647f136a4023612c9158a80be45034193413be2c98b0228a07c4f7242cc1ea773fdac8bd5a8980a8e', 'jp-freelancer-salt-1000000000000'),
    ('jp_freelancer_11', 'Vũ Bảo Nhi', 'giangto1102@gmail.com', '523a9bca15a11a015dad8f477e086237b06ab580a8336e052155f4b4eea6cfc47ebf79c6bf2e08e2c4cada03eab02a28b297bea6c573d032b0f91592c927f1fa', 'jp-freelancer-salt-1100000000000'),
    ('jp_freelancer_12', 'Lê Ánh Xuân', 'miyanoharu123@gmail.com', 'a7f2b317f2277aa99ce053b312c18e82d805e85561f3c551361d0913656fe1e7ed69e6b14ff92bcb804c430f4cddb0c98ad205ac3584d2ad6c0044f73671fc9b', 'jp-freelancer-salt-1200000000000')
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
  'Japan',
  ARRAY['Japan']::text[],
  true
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM "Accounts" existing
  WHERE existing."username" = seed."username"
     OR lower(COALESCE(existing."email", '')) = lower(seed."email")
);

COMMIT;
