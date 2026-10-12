# Zalo group assistant

Bot TypeScript dùng `zca-js`, Express và MongoDB. Bot kiểm duyệt nhóm Zalo: xóa tin chứa link mời nhóm Zalo (`zalo.me/g/...`, `zaloapp.com/qr/g/...`), link của các trang web bị chặn thêm, và tin chứa từ cấm.

Bot sẽ:

- Phát hiện link nhóm Zalo (`zalo.me/g/...` hoặc `zaloapp.com/qr/g/...`), kể cả link nằm trong nội dung `chat.recommended`, URL encode hoặc bị chèn khoảng trắng/ký tự ẩn.
- Đọc QR trong ảnh JPEG/PNG bằng `jsQR`; ảnh chỉ bị tính là vi phạm khi nội dung QR là link bị chặn.
- Phát hiện thêm link của các trang web do quản trị viên tự thêm trên `/admin` (xem [Link bị chặn thêm](#link-bị-chặn-thêm)).
- Phát hiện từ cấm do quản trị viên tự thêm (xem [Lọc từ cấm](#lọc-từ-cấm)).
- Ghi nhận mỗi vi phạm vào thống kê theo nhóm, xóa tin vi phạm, và kick thành viên vi phạm dồn dập trong khoảng thời gian do bạn đặt (xem [Xử lý vi phạm và thống kê](#xử-lý-vi-phạm-và-thống-kê)).
- Bỏ qua tin nhắn của chủ nhóm/QTV.
- Hoạt động cả ở nhóm bot không phải QTV: ở đó bot chỉ ghi nhận vi phạm, không xóa tin và không kick.
- `/api/groups` lấy thông tin nhóm trực tiếp từ Zalo và hiển thị mọi nhóm tài khoản bot đang tham gia.
- Không có lệnh chat để bật/tắt hoặc kick; mọi thao tác cấu hình thực hiện trên `/admin`.
- Không xử lý poll/vote và không lưu danh sách bình chọn.

QR được xử lý cục bộ, không gửi ảnh sang dịch vụ bên ngoài. Ảnh được giới hạn 8 MB, JPEG tối đa 12 MP/64 MB bộ nhớ giải mã và thời gian tải tối đa 5 giây để tránh làm nặng bot.

## Chạy

```powershell
npm install
npm run dev
```

Cần MongoDB đang chạy (mặc định `mongodb://127.0.0.1:27017`).

Mở `http://127.0.0.1:3000/admin`. Trang sẽ chuyển tới giao diện đăng nhập quản trị.

## Cấu hình

```text
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=zalo_bot
ZALO_CREDENTIALS_KEY=<khóa 32 byte dạng base64>
ADMIN_ZALO_PHONE=<số điện thoại Zalo của người quản trị>
```

Tạo `ZALO_CREDENTIALS_KEY` một lần rồi đặt vào `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Phiên Zalo của bot (cookie, IMEI) được mã hóa AES-256-GCM bằng khóa này rồi lưu trong MongoDB (collection `secrets`), nên các lần chạy sau không cần quét QR nếu phiên còn hạn. Khóa chỉ nằm trong `.env`, không nằm trong MongoDB hay mã nguồn. Nếu mất hoặc đổi khóa, bot không đọc được phiên cũ và sẽ yêu cầu quét QR lại.

## Thông tin bot

Đầu trang `/admin` có thẻ thông tin bot: tên, ảnh đại diện và ID của tài khoản Zalo đang chạy bot, trạng thái kết nối tới Zalo (đang kết nối hay mất kết nối, từ lúc nào), thời điểm bot khởi động, thời gian đã chạy, và số tin nhắn nhóm đã nhận cùng số tin vi phạm đã xử lý kể từ lúc khởi động. Các số này về 0 mỗi khi bot khởi động lại.

## Đăng nhập quản trị

Trang quản trị không dùng tài khoản/mật khẩu. Bấm `Gửi mã đăng nhập`, bot sẽ nhắn một mã 8 chữ số tới tài khoản Zalo của người quản trị, rồi nhập mã đó để đăng nhập. Zalo không cho một tài khoản tự nhắn cho chính nó, nên tài khoản nhận mã phải khác tài khoản bot.

Đặt một trong hai biến trong `.env`: `ADMIN_ZALO_PHONE` (số điện thoại, bot tự tra ra ID và in `ADMIN_ZALO_ID=...` ra console ở lần gửi đầu) hoặc `ADMIN_ZALO_ID` (ID Zalo, được ưu tiên nếu có cả hai). Tra theo số điện thoại chỉ hoạt động khi tài khoản đó cho phép tìm bằng số điện thoại.

- Mã có hiệu lực 5 phút, dùng một lần, tối đa 5 lần nhập sai; mỗi phút chỉ gửi được một mã.
- Phiên đăng nhập lưu trong MongoDB (collection `admin_sessions`, chỉ lưu mã băm) và bị xóa khi đăng xuất.
- `Ghi nhớ đăng nhập 30 ngày` giữ phiên 30 ngày; bỏ chọn thì cookie mất khi đóng trình duyệt và phiên hết hạn sau 12 giờ.
- Ai đọc được tin nhắn của tài khoản Zalo quản trị hoặc của tài khoản bot thì đăng nhập được trang quản trị. Nếu mở trang ra ngoài máy này, hãy đặt sau HTTPS.

## Link bị chặn thêm

Ngoài link mời nhóm Zalo (luôn bị chặn), trang `/admin` có mục `Link bị chặn thêm` để thêm/xóa các trang web khác. Danh sách dùng chung cho mọi nhóm đang bật `Chặn link` và lưu trong MongoDB (collection `settings`).

- Nhập tên miền, ví dụ `shopee.vn`: chặn mọi link của trang đó và các tên miền con (`s.shopee.vn`).
- Nhập tên miền kèm đường dẫn, ví dụ `facebook.com/groups`: chỉ chặn link bắt đầu bằng đường dẫn đó, `facebook.com/profile/...` không bị ảnh hưởng.
- Bot nhận ra link viết hoa, URL encode, viết `shopee[.]vn`, nằm trong thẻ xem trước hoặc trong mã QR. Khác với link Zalo, link bị chèn khoảng trắng vào giữa tên miền (`shopee . vn`) không bị phát hiện, để tránh xóa nhầm tin nhắn thường.
- Link trong danh sách được tính là vi phạm loại `Link`, giống link nhóm Zalo.

## Lọc từ cấm

Mỗi nhóm có công tắc riêng `Lọc từ cấm` trên `/admin` (mặc định tắt, độc lập với công tắc `Chặn link`). Khi bật, tin của thành viên thường chứa từ cấm được tính là vi phạm loại `Từ cấm`; quản trị viên nhóm được bỏ qua.

Bot không có sẵn từ cấm nào: danh sách hoàn toàn do quản trị viên tự thêm ở mục `Từ cấm` trên `/admin`, lưu trong MongoDB (collection `settings`) và dùng chung cho mọi nhóm đang bật công tắc.

- `Thêm`: thêm từ hoặc cụm từ (2–50 ký tự, tối đa 500 mục).
- `Thử một câu`: kiểm tra một câu có bị xóa không và vì từ nào.

Cách so khớp:

- Từ chỉ bị bắt khi đứng riêng: `dcm` bị bắt trong `ôi dcm!` nhưng không bị bắt trong `hjhdcm`. Muốn chặn dạng viết liền thì thêm đúng dạng đó.
- Không phân biệt hoa thường; bắt được dấu câu bao quanh, từ bị đánh vần từng chữ (`d.c.m`, `d-c-m`, `v.l`) và chữ kéo dài (`dcmmmm`). Hai chữ cái nối bằng gạch ngang (`size m-l`) không bị coi là đánh vần.
- Dấu tiếng Việt được giữ nguyên: thêm `cac` không chặn `các`. Muốn chặn cả dạng có dấu và không dấu thì thêm cả hai.
- Link thật trong tin nhắn (bắt đầu bằng `http://`, `https://` hoặc `www.` và có tên miền) được bỏ qua, nên một đoạn đường dẫn trùng từ cấm không làm tin bị xóa. Chuỗi chỉ trông giống link (`a.vn/dcm`) vẫn bị kiểm tra.
- Nếu đã có từ cấm mà chưa nhóm nào bật `Lọc từ cấm`, mục `Từ cấm` sẽ hiện cảnh báo.
- Chỉ kiểm tra nội dung chữ của tin nhắn và tiêu đề/mô tả của tin link hoặc ảnh.

## Xử lý vi phạm và thống kê

Một tin là vi phạm khi nhóm đang bật quy tắc tương ứng (`Chặn link` hoặc `Lọc từ cấm`), người gửi không phải chủ nhóm/QTV, và nội dung khớp quy tắc đó. Với mỗi vi phạm, bot:

1. Ghi nhận vào thống kê của nhóm.
2. Xóa tin nhắn, nếu bot là QTV của nhóm.
3. Kick người gửi, nếu nhóm đang bật `Cho phép kick`, bot là QTV, và người đó đã vi phạm cùng quy tắc đủ số lần trong khoảng thời gian của nhóm.

Việc xóa tin không chờ cơ sở dữ liệu: nếu MongoDB lỗi, tin vẫn bị xóa, chỉ có phần ghi nhận và kick của tin đó bị bỏ qua (console in `[VIOLATION RECORD FAILED]`).

Mỗi nhóm có công tắc `Cho phép kick` trên `/admin`, mặc định tắt. Công tắc chỉ bật được ở nhóm bot là QTV (trang admin khóa ô này ở các nhóm khác, và máy chủ cũng từ chối); tắt thì lúc nào cũng được. Khi tắt, bot chỉ ghi nhận và xóa tin.

Khi bật, hai dòng bên dưới công tắc quyết định lúc nào kick, một dòng cho mỗi quy tắc, dạng `kick khi đủ N lần trong T`:

- `Link`: mặc định 3 lần trong 10 giây, để bắt kiểu spam dồn dập.
- `Từ cấm`: mặc định 3 lần trong 10 phút, vì chửi bậy thường rải rác hơn.
- `N` từ 0 đến 100, khoảng thời gian từ 1 giây đến 7 ngày. Đặt `N = 0` để không kick theo quy tắc đó.
- Hai quy tắc đếm riêng: 2 link và 1 từ cấm không cộng lại với nhau.
- Chỉ các vi phạm nằm trong khoảng thời gian mới được tính; vi phạm cũ hơn không dẫn tới kick dù tổng số trong thống kê có lớn.
- Sau khi bị kick, các vi phạm trước đó của thành viên không còn được tính cho lần kick sau. Nếu Zalo từ chối lệnh kick, bot thử lại ở vi phạm kế tiếp trong khoảng thời gian.
- Nhóm lưu từ phiên bản cũ đang bật `Kick khi đủ 3 link / 10 giây` được đọc thành `Cho phép kick` bật với `Link: 3 lần trong 10 giây`.

Ở nhóm bot không phải QTV, bot không xóa được tin và không kick được, nên chỉ có bước ghi nhận; trang `/admin` ghi rõ trạng thái này trên từng nhóm.

Nút `Thống kê` trên mỗi nhóm mở bảng vi phạm của nhóm đó: từng thành viên, tổng số lần theo từng quy tắc từ trước tới nay, số lần đã bị kick và lần vi phạm gần nhất. Thống kê là tổng dài hạn để bạn theo dõi; nó không quyết định việc kick. Có thể xóa thống kê của một thành viên hoặc của cả nhóm. Dữ liệu lưu trong MongoDB (collection `violations`).

Nút `Xem tin` trên từng thành viên hiện 50 tin vi phạm gần nhất của người đó: thời gian, quy tắc và nội dung phát hiện, trạng thái (`Đã xóa`, `Xóa thất bại`, hoặc `Chỉ ghi nhận` ở nhóm bot không phải QTV) và nội dung tin. Bot chỉ lưu phần chữ (tối đa 2.000 ký tự) và link của tin; ảnh và tệp không được lưu. Các tin này nằm trong collection `violation_messages`, tự xóa sau 90 ngày, và bị xóa cùng khi bạn xóa thống kê. Việc đếm vi phạm trong khoảng thời gian để kick cũng dựa trên các tin này, nên xóa thống kê của một thành viên là đặt lại số đếm của họ.

Console ghi log theo dạng text có màu: `[VIOLATION]` (kèm quy tắc và nội dung phát hiện), `[VIOLATION RECORD FAILED]`, `[MESSAGE DELETED]`, `[MESSAGE DELETE FAILED]`, `[KICKED]`, `[KICK REJECTED]`, `[KICK FAILED]`, cùng `[FEATURE FAILED]` khi một tính năng gặp lỗi.

## Kiểm tra mã nguồn

```powershell
npm run check
npm run lint
npm test
```

`npm run check` gồm typecheck, build và test.
