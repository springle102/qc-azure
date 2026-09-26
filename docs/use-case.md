%%{init: {
  "flowchart": {
    "nodeSpacing": 10,
    "rankSpacing": 20,
    "curve": "linear"
  }
}}%%

flowchart TB

    subgraph ACTORS["Vai trò người dùng"]
        direction LR
        Admin(["Admin"])
        QC(["QC"])
        Freelancer(["Freelancer"])
    end

    subgraph System["HỆ THỐNG QUẢN LÝ QC WEBTOON"]
        direction TB

        U1(["Đăng nhập"])
        U2(["Đăng xuất"])
        U3(["Xem dashboard"])
        U4(["Xem task<br/>được giao"])
        U5(["Nhận task"])
        U6(["Cập nhật<br/>trạng thái task"])
        U7(["Xem lỗi"])
        U8(["Xem mã QR"])
        U9(["Cập nhật mã QR"])

        U10(["Tạo tài khoản"])
        U11(["Tải lên guide"])
        U12(["Tải lên folder<br/>tài nguyên"])

        U13(["Tạo task"])
        U14(["Phân công task<br/>cho Freelancer"])
        U15(["Ghi nhận lỗi QC"])

        U1 ~~~ U2
        U2 ~~~ U3
        U3 ~~~ U4
        U4 ~~~ U5
        U5 ~~~ U6
        U6 ~~~ U7
        U7 ~~~ U8
        U8 ~~~ U9
        U9 ~~~ U10
        U10 ~~~ U11
        U11 ~~~ U12
        U12 ~~~ U13
        U13 ~~~ U14
        U14 ~~~ U15
    end

    Admin --> U1
    Admin --> U2
    Admin --> U3
    Admin --> U10
    Admin --> U11
    Admin --> U12

    QC --> U1
    QC --> U2
    QC --> U3
    QC --> U4
    QC --> U5
    QC --> U6
    QC --> U7
    QC --> U8
    QC --> U9
    QC --> U13
    QC --> U14
    QC --> U15

    Freelancer --> U1
    Freelancer --> U2
    Freelancer --> U3
    Freelancer --> U4
    Freelancer --> U5
    Freelancer --> U6
    Freelancer --> U7
    Freelancer --> U8
    Freelancer --> U9