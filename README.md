# Zalo group assistant

Bot TypeScript dùng `zca-js`, Express và MongoDB. Bot kiểm duyệt nhóm Zalo: xóa tin chứa link mời nhóm Zalo (`zalo.me/g/...`, `zaloapp.com/qr/g/...`), link của các trang web bị chặn thêm, và tin chứa từ cấm.

Bot sẽ:

- Phát hiện link nhóm Zalo (`zalo.me/g/...` hoặc `zaloapp.com/qr/g/...`), kể cả link nằm trong nội dung `chat.recommended`, URL encode hoặc bị chèn khoảng trắng/ký tự ẩn.
- Đọc QR trong ảnh JPEG/PNG bằng `jsQR`; ảnh chỉ bị tính là vi phạm khi nội dung QR là link bị chặn.
- Phát hiện thêm link của các trang web do quản trị viên tự thêm trên dashboard (xem [Link bị chặn thêm](#link-bị-chặn-thêm)).
- Phát hiện từ cấm do quản trị viên tự thêm (xem [Lọc từ cấm](#lọc-từ-cấm)).
- Phát hiện spam theo hành vi: gửi dồn dập, lặp nội dung, tin có số điện thoại hoặc số tài khoản (xem [Chống spam](#chống-spam)).
- Ghi nhận mỗi vi phạm vào thống kê theo nhóm, xóa tin vi phạm, và kick thành viên vi phạm dồn dập trong khoảng thời gian do bạn đặt (xem [Xử lý vi phạm và thống kê](#xử-lý-vi-phạm-và-thống-kê)).
- Bỏ qua tin nhắn của chủ nhóm/QTV.
- Hoạt động cả ở nhóm bot không phải QTV: ở đó bot chỉ ghi nhận vi phạm, không xóa tin và không kick.
- Hiển thị mọi nhóm tài khoản bot đang tham gia trên dashboard.
- Không có lệnh chat để bật/tắt hoặc kick; mọi thao tác cấu hình thực hiện trên dashboard.
- Không xử lý poll/vote và không lưu danh sách bình chọn.

QR được xử lý cục bộ, không gửi ảnh sang dịch vụ bên ngoài. Ảnh được giới hạn 8 MB, JPEG tối đa 12 MP/64 MB bộ nhớ giải mã và thời gian tải tối đa 5 giây để tránh làm nặng bot.

## Chạy

Dự án gồm hai phần: bot (thư mục gốc, cung cấp API) và dashboard Next.js (thư mục `web/`).

```powershell
npm install
npm run install:web
```

Chạy mỗi lệnh ở một cửa sổ riêng:

```powershell
npm run dev
npm run dev:web
```

Cần MongoDB đang chạy (mặc định `mongodb://127.0.0.1:27017`). Mở dashboard tại `http://localhost:3000`.

Cả bot lẫn dashboard chỉ nghe ở `127.0.0.1`, tức chỉ mở được từ chính máy đang chạy. Dashboard chuyển tiếp mọi request `/api` tới bot, nên nếu cho nó nghe trên mạng thì trang đăng nhập và API của bot cũng lộ ra theo. Chỉ đổi `--hostname` trong `web/package.json` khi bạn chủ động muốn truy cập từ máy khác, và khi đó nên đặt sau HTTPS.

Để chạy bản build: `npm run build` rồi `npm start` cho bot, `npm run build:web` rồi `npm run start:web` cho dashboard.

## Dashboard

Dashboard là ứng dụng Next.js (App Router, Tailwind CSS, SWR) trong `web/`. Nó không có cơ sở dữ liệu riêng: mọi request `/api/*` được chuyển tiếp tới API của bot, nên trình duyệt chỉ làm việc với một địa chỉ và cookie phiên của bot dùng được nguyên vẹn.

| Trang | Nội dung |
|---|---|
| `/login` | Đăng nhập bằng mã gửi qua Zalo |
| `/dashboard` | Thông tin bot, các con số tổng quan, biểu đồ vi phạm 14 ngày, 20 tin vi phạm gần nhất |
| `/groups` | Danh sách nhóm, có công tắc bật tắt bot cho từng nhóm, tìm kiếm, bộ lọc và phân trang (lưu trên URL). Bot thực hiện việc tìm, lọc và chia trang; ô tìm chờ 250ms sau khi ngừng gõ rồi mới gửi yêu cầu, và tìm được theo tên không dấu, hoặc theo ID nhóm khi gõ từ 6 chữ số trở lên |
| `/group/<id>` | Bật bot cho nhóm, từng tính năng kèm cài đặt kick riêng của nó, link bị chặn và từ cấm riêng, thống kê vi phạm theo thành viên, tin vi phạm đã lưu |
| `/features` | Cài đặt dùng chung của từng tính năng (Chặn link, Lọc từ cấm, Chống spam): danh sách link và từ cấm chung, ô thử một câu, mô tả chống spam |
| `/violations` | Nhật ký vi phạm trên mọi nhóm, lọc theo quy tắc, tải thêm tin cũ hơn |
| `/reminders` | Lịch nhắc hẹn của Zalo ở mọi nhóm đang bật bot: nội dung, giờ bắt đầu, số người tham gia và từ chối, danh sách thành viên đã trả lời |
| `/reminders/new` | Tạo một nhắc hẹn cho một hoặc nhiều nhóm cùng lúc |
| `/broadcast` | Gửi tin nhắn hàng loạt: một tin của bot cho một hoặc nhiều nhóm, gửi ngay hoặc hẹn giờ |
| `/setting` | Cài đặt của chính bảng điều khiển: sáng/tối, tự làm mới, số nhóm mỗi trang, kết nối tới bot, đăng xuất |

Trang `/setting` không chứa cài đặt của bot. Những gì chọn ở đó chỉ lưu trên trình duyệt đang dùng.

Dashboard đọc địa chỉ API của bot từ biến `BOT_API_URL` (mặc định `http://127.0.0.1:3400`). Nếu bot chạy ở `PORT` khác, tạo file `web/.env.local` theo mẫu `web/.env.example`.

Dashboard chỉ hiện những nhóm tài khoản bot **đang ở trong**. Danh sách thành viên nhóm được hỏi trực tiếp từ Zalo (nhớ tạm 15 giây, và làm mới ngay khi Zalo báo có thay đổi về nhóm), nên nhóm bot đã rời hoặc bị xóa khỏi sẽ biến mất khỏi mọi trang; cài đặt đã lưu của nhóm đó vẫn nằm trong MongoDB và có hiệu lực lại nếu bot vào lại nhóm, nhưng không xem hay sửa được qua API khi bot không ở trong nhóm. Các hàng đang hiển thị ở trang `/groups` được đọc lại từ Zalo trong một request (tên, số thành viên, quyền QTV của bot); nếu Zalo không phản hồi thì dùng bản đã lưu. Nút `Đồng bộ từ Zalo` đọc lại toàn bộ nhóm.

Giao diện mặc định theo sáng/tối của hệ điều hành; có thể chọn cố định ở trang `/setting`.

### Chọn nhiều và thao tác một lần

Các danh sách và bảng đều đánh số thứ tự. Những danh sách có thao tác thì có thêm ô tick ở mỗi dòng và ô `Chọn tất cả`; khi có dòng được tick, thanh thao tác nổi lên ở một vị trí cố định sát đáy cửa sổ:

| Danh sách | Thao tác cho các dòng đã chọn |
|---|---|
| Nhóm (`/groups`) | `Bật bot`, `Tắt bot`, `Rời nhóm`. Lựa chọn được giữ khi chuyển trang hoặc tìm kiếm |
| Lịch nhắc hẹn (`/reminders`) | `Xuất Excel` (một file gồm phản hồi của mọi nhắc hẹn đã chọn), `Xóa` |
| Tin nhắn chờ gửi (`/broadcast`) | `Hủy tin nhắn` |
| Link bị chặn, từ cấm (chung và riêng của nhóm) | `Xóa mục đã chọn` |
| Thống kê vi phạm của một nhóm | `Xóa thống kê` của các thành viên đã chọn |

Thao tác xóa và rời nhóm đều hỏi lại trước khi làm. Bot xử lý lần lượt từng dòng và báo kết quả; dòng nào lỗi được liệt kê kèm lý do, các dòng còn lại vẫn được xử lý.

`Rời nhóm` đưa tài khoản bot ra khỏi nhóm trên Zalo. Nhóm mà bot đang là trưởng nhóm không rời được: phải chuyển quyền trưởng nhóm cho người khác trên Zalo trước, nên các nhóm đó được bỏ qua và nêu tên trong hộp xác nhận. Sau khi rời, cài đặt của nhóm vẫn nằm trong MongoDB, còn tin nhắn đang chờ gửi vào nhóm bị hủy.

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

Trang `/dashboard` có thẻ thông tin bot: tên, ảnh đại diện và ID của tài khoản Zalo đang chạy bot, trạng thái kết nối tới Zalo (đang kết nối hay mất kết nối, từ lúc nào), thời điểm bot khởi động, thời gian đã chạy, và số tin nhắn nhóm đã nhận cùng số tin vi phạm đã xử lý kể từ lúc khởi động. Các số này về 0 mỗi khi bot khởi động lại.

## Đăng nhập quản trị

Trang quản trị không dùng tài khoản/mật khẩu. Bấm `Gửi mã đăng nhập`, bot sẽ nhắn một mã 8 chữ số tới tài khoản Zalo của người quản trị, rồi nhập mã đó để đăng nhập. Zalo không cho một tài khoản tự nhắn cho chính nó, nên tài khoản nhận mã phải khác tài khoản bot.

Đặt một trong hai biến trong `.env`: `ADMIN_ZALO_PHONE` (số điện thoại, bot tự tra ra ID và in `ADMIN_ZALO_ID=...` ra console ở lần gửi đầu) hoặc `ADMIN_ZALO_ID` (ID Zalo, được ưu tiên nếu có cả hai). Tra theo số điện thoại chỉ hoạt động khi tài khoản đó cho phép tìm bằng số điện thoại.

- Mã có hiệu lực 5 phút, dùng một lần, tối đa 5 lần nhập sai; mỗi phút chỉ gửi được một mã.
- Phiên đăng nhập lưu trong MongoDB (collection `admin_sessions`, chỉ lưu mã băm) và bị xóa khi đăng xuất.
- `Ghi nhớ đăng nhập 30 ngày` giữ phiên 30 ngày; bỏ chọn thì cookie mất khi đóng trình duyệt và phiên hết hạn sau 12 giờ.
- Ai đọc được tin nhắn của tài khoản Zalo quản trị hoặc của tài khoản bot thì đăng nhập được trang quản trị. Nếu mở trang ra ngoài máy này, hãy đặt sau HTTPS.

## Link bị chặn thêm

Ngoài link mời nhóm Zalo (luôn bị chặn), trang `/features` có mục `Link bị chặn chung` để thêm/xóa các trang web khác. Danh sách dùng chung cho mọi nhóm đang bật `Chặn link` và lưu trong MongoDB (collection `settings`).

- Nhập tên miền, ví dụ `shopee.vn`: chặn mọi link của trang đó và các tên miền con (`s.shopee.vn`).
- Nhập tên miền kèm đường dẫn, ví dụ `facebook.com/groups`: chỉ chặn link bắt đầu bằng đường dẫn đó, `facebook.com/profile/...` không bị ảnh hưởng.
- Bot nhận ra link viết hoa, URL encode, viết `shopee[.]vn`, nằm trong thẻ xem trước hoặc trong mã QR. Khác với link Zalo, link bị chèn khoảng trắng vào giữa tên miền (`shopee . vn`) không bị phát hiện, để tránh xóa nhầm tin nhắn thường.
- Link trong danh sách được tính là vi phạm loại `Link`, giống link nhóm Zalo.

## Danh sách chung và danh sách riêng của nhóm

Link bị chặn thêm và từ cấm đều có hai tầng:

- **Danh sách chung**, quản lý ở trang `/features`, áp dụng cho mọi nhóm đang bật tính năng tương ứng.
- **Danh sách riêng của từng nhóm**, quản lý ở trang `/group/<id>`, chỉ áp dụng cho nhóm đó.

Một nhóm được kiểm tra với cả hai: tin vi phạm nếu khớp danh sách chung hoặc danh sách riêng của nhóm. Danh sách riêng chỉ thêm vào chứ không thay thế hay loại bớt danh sách chung. Cách nhập và cách so khớp giống hệt nhau ở cả hai tầng; mỗi danh sách tối đa 200 link hoặc 500 từ.

## Lọc từ cấm

Mỗi nhóm có công tắc riêng `Lọc từ cấm` trên dashboard (mặc định tắt, độc lập với công tắc `Chặn link`). Khi bật, tin của thành viên thường chứa từ cấm được tính là vi phạm loại `Từ cấm`; quản trị viên nhóm được bỏ qua.

Bot không có sẵn từ cấm nào: danh sách hoàn toàn do quản trị viên tự thêm ở mục `Từ cấm chung` trên trang `/features`, lưu trong MongoDB (collection `settings`) và dùng chung cho mọi nhóm đang bật công tắc.

- `Thêm`: thêm từ hoặc cụm từ (2–50 ký tự, tối đa 500 mục).
- `Thử một câu`: kiểm tra một câu có bị xóa không và vì từ nào.

Cách so khớp:

- Từ chỉ bị bắt khi đứng riêng: `dcm` bị bắt trong `ôi dcm!` nhưng không bị bắt trong `hjhdcm`. Muốn chặn dạng viết liền thì thêm đúng dạng đó.
- Không phân biệt hoa thường; bắt được dấu câu bao quanh, từ bị đánh vần từng chữ (`d.c.m`, `d-c-m`, `v.l`) và chữ kéo dài (`dcmmmm`). Hai chữ cái nối bằng gạch ngang (`size m-l`) không bị coi là đánh vần.
- Dấu tiếng Việt được giữ nguyên: thêm `cac` không chặn `các`. Muốn chặn cả dạng có dấu và không dấu thì thêm cả hai.
- Link thật trong tin nhắn (bắt đầu bằng `http://`, `https://` hoặc `www.` và có tên miền) được bỏ qua, nên một đoạn đường dẫn trùng từ cấm không làm tin bị xóa. Chuỗi chỉ trông giống link (`a.vn/dcm`) vẫn bị kiểm tra.
- Nếu đã có từ cấm mà chưa nhóm nào bật `Lọc từ cấm`, mục `Từ cấm chung` ở trang `/features` ghi rõ đang bật ở 0 nhóm.
- Chỉ kiểm tra nội dung chữ của tin nhắn và tiêu đề/mô tả của tin link hoặc ảnh.

## Chống spam

Hai tính năng trên xét nội dung của từng tin; chống spam xét cách một thành viên gửi tin. Mỗi nhóm bật riêng trong thẻ `Chống spam` ở trang `/group/<id>` (mặc định tắt), và tự chọn kiểu spam nào được tính:

| Kiểu | Bị tính là spam khi | Mặc định |
|---|---|---|
| Gửi dồn dập | một thành viên gửi đủ N tin (loại nào cũng tính) trong T giây | bật, 5 tin trong 10 giây |
| Lặp nội dung | cùng một đoạn chữ được gửi đủ N lần trong T giây | bật, 3 lần trong 60 giây |
| Số điện thoại, số tài khoản | tin có số di động Việt Nam, hoặc dãy số đi kèm chữ như `stk`, `số tài khoản` | tắt |

- Lặp nội dung không phân biệt hoa thường hay khoảng trắng thừa, và bỏ qua đoạn chữ ngắn hơn 10 ký tự (`ok`, `haha`) để không bắt nhầm câu trả lời thường ngày.
- Số điện thoại được nhận ra dù viết cách bằng dấu cách, chấm hay gạch (`0912 345 678`, `+84.912.345.678`). Kiểu này tắt sẵn vì thành viên cũng hay gửi số điện thoại cho việc bình thường.
- N từ 2 đến 50, T từ 1 giây đến 1 giờ. Quản trị viên nhóm được bỏ qua.
- Tin làm vượt ngưỡng (và các tin tiếp theo khi vẫn còn vượt) bị xóa và ghi nhận là vi phạm loại `Spam`, kèm lý do. Các tin trước đó của đợt spam vẫn còn trong nhóm.
- Nhiều ảnh gửi cùng một lần là một tin: Zalo tách album thành mỗi ảnh một tin, bot gộp lại theo mã album của Zalo, hoặc theo việc các ảnh đến liền nhau trong vòng 3 giây khi không có mã đó.
- Bộ đếm nằm trong bộ nhớ của bot, nên bắt đầu lại từ đầu mỗi khi bot khởi động lại. Bot chỉ nhớ thời điểm gửi và một mã băm của mỗi tin (không giữ nội dung), và chỉ trong khoảng thời gian mà cài đặt của nhóm đang dùng.

## Lịch nhắc hẹn

Bot dùng tính năng `Nhắc hẹn` có sẵn của Zalo, nên thành viên thấy và trả lời nhắc hẹn như khi tạo bằng tay, và Zalo tự nhắc đúng giờ kể cả khi bot đang tắt.

- **Tạo cho nhiều nhóm:** ở trang `/reminders/new`, chọn một hoặc nhiều nhóm (tối đa 100 nhóm mỗi lần), nhập nội dung (tối đa 200 ký tự), thời gian nhắc (chọn nhanh `15 phút nữa`, `30 phút nữa`, `9:00 ngày mai`, hoặc bấm ô ngày để tự chọn; mặc định 30 phút nữa) và kiểu lặp lại (không lặp, hằng ngày, hằng tuần, hằng tháng). Bot tạo lần lượt từng nhóm rồi báo kết quả của từng nhóm; nhóm lỗi có thể thử lại riêng.
- **Tin nhắn kèm theo (không bắt buộc):** khi tạo nhắc hẹn có thể bật thêm hai tin nhắn do bot gửi vào nhóm, mỗi tin gồm chữ (tối đa 2000 ký tự), tối đa 6 ảnh (JPEG, PNG hoặc WebP), hoặc cả hai:
  - `Gửi tin nhắn khi tạo nhắc hẹn`: gửi ngay sau khi nhắc hẹn được tạo ở nhóm đó.
  - `Gửi tin nhắn khi đến giờ nhắc`: gửi đúng giờ nhắc, và mỗi lần nhắc nếu nhắc hẹn lặp lại. Tin này do bot gửi chứ không phải Zalo, nên bot phải đang chạy vào lúc đó; bot kiểm tra 15 giây một lần, và bỏ qua tin đã trễ hơn 30 phút hoặc thuộc nhóm đã tắt bot. Tin chờ gửi được lưu trong MongoDB (`reminder_messages`), nên bot khởi động lại không làm mất. Xóa nhắc hẹn từ dashboard thì tin chờ cũng bị hủy; xóa hoặc đổi giờ nhắc hẹn trực tiếp trên Zalo thì tin vẫn gửi theo giờ ban đầu, cho tới khi bạn hủy nó ở tab `Tin nhắn chờ gửi` của trang `/broadcast`.
  - Thêm ảnh bằng nút `Chọn ảnh`, bằng cách kéo file ảnh thả vào ô soạn tin, hoặc dán ảnh đã sao chép (ví dụ ảnh chụp màn hình) vào ô nội dung.
  - Nhiều ảnh trong một tin được gửi thành một album, theo đúng thứ tự đã chọn. Khi đó Zalo hiện phần chữ thành một tin riêng thay vì chú thích dưới ảnh.
  - Ảnh nặng hơn 1 MB hoặc lớn hơn 2048 px được trình duyệt thu nhỏ và lưu thành JPEG trước khi gửi; mỗi ảnh sau khi thu nhỏ tối đa 5 MB, và các ảnh của một tin cộng lại tối đa 12 MB.
  - Nếu nhắc hẹn tạo được nhưng tin nhắn gặp lỗi, kết quả của nhóm đó ghi rõ lý do.
- **Gửi tin nhắn hàng loạt:** trang `/broadcast` (mục riêng ở sidebar, tab `Soạn tin`) cho bot gửi một tin vào nhiều nhóm mà không tạo nhắc hẹn nào: chọn nhóm, soạn tin (chữ, tối đa 6 ảnh, hoặc cả hai), rồi chọn thời điểm gửi.
  - `Gửi ngay`: sau khi bạn xác nhận, bot gửi lần lượt từng nhóm và báo kết quả của từng nhóm; nhóm lỗi có thể thử lại riêng. Tin đã gửi không thu hồi được từ dashboard.
  - `Hẹn giờ`: chọn giờ và kiểu lặp lại như khi tạo nhắc hẹn. Tin dùng chung hàng chờ với tin `khi đến giờ nhắc`, nên cũng cần bot đang chạy vào giờ gửi, cũng bị bỏ qua nếu trễ hơn 30 phút hoặc nhóm đã tắt bot, và tin lặp lại được gửi tiếp cho tới khi bị hủy.
- **Tin nhắn chờ gửi:** tab `Tin nhắn chờ gửi` ở trang `/broadcast` liệt kê mọi tin bot còn phải gửi (kèm nhắc hẹn lẫn hẹn giờ riêng), tin sớm nhất trước: nội dung, ảnh, giờ gửi, nhóm và nhắc hẹn của nó. Mỗi tin có nút `Sửa` (đổi nội dung, thêm hoặc bỏ từng ảnh) và `Xóa` (hủy tin; nhắc hẹn trên Zalo giữ nguyên). Tin có nhãn `Không thấy nhắc hẹn trong lịch` là tin mà nhắc hẹn của nó không còn trên bảng của nhóm, thường vì đã bị xóa trực tiếp trên Zalo.
- **Lịch:** trang `/reminders` đọc bảng nhắc hẹn của mọi nhóm đang bật bot, kể cả nhắc hẹn do thành viên tạo, xếp theo ngày và chia thành `Sắp tới` / `Đã qua`. Nhắc hẹn lặp lại được xếp theo lần nhắc kế tiếp. Nhắc hẹn còn tin nhắn chờ gửi có nhãn `Có tin nhắn khi đến giờ`.
- **Phản hồi:** mỗi nhắc hẹn hiện số người tham gia và từ chối; bấm `Thành viên` để xem tên từng người.
- **Xuất danh sách:** nút `Xuất danh sách` trong bảng `Thành viên` tải về file Excel (`.xlsx`, cột đã chỉnh sẵn độ rộng theo nội dung) gồm những người tham gia và từ chối của nhắc hẹn đó. Mỗi dòng là một thành viên: nhóm, ID nhóm, nội dung, thời gian nhắc, kiểu lặp, tên, ID và phản hồi.
- **Xóa:** nút `Xóa` gỡ nhắc hẹn khỏi nhóm trên Zalo.

Chỉ nhóm đang bật bot mới được đọc và chọn. Bot nhớ tạm bảng nhắc hẹn của mỗi nhóm trong 5 phút và đọc lại ngay khi nhóm đó có thay đổi; nút `Làm mới` đọc lại mọi nhóm. Nhóm tắt quyền tạo nhắc hẹn của thành viên sẽ báo lỗi nếu bot không phải trưởng/phó nhóm. Nhắc hẹn của Zalo chỉ có giờ bắt đầu, không có giờ kết thúc.

## Bật bot theo nhóm

Bot chỉ hoạt động ở những nhóm đã bật bot (công tắc ở cột `Trạng thái` của trang `/groups`, hoặc `Bật bot ở nhóm này` trên trang `/group/<id>`), mặc định tắt. Ở nhóm chưa bật, bot bỏ qua hoàn toàn: không kiểm tra tin nhắn, không ghi nhận, không xóa, không kick, và cũng không gọi Zalo để lấy thông tin nhóm. Các tính năng (`Chặn link`, `Lọc từ cấm`, `Chống spam`) là công tắc con, chỉ có tác dụng khi bot đang bật ở nhóm đó.

Nhóm lưu từ phiên bản trước, khi chưa có công tắc này, được chuyển đổi một lần lúc bot khởi động: nhóm nào đang bật chặn link hoặc lọc từ cấm thì bot được bật sẵn, các tính năng giữ nguyên.

## Xử lý vi phạm và thống kê

Một tin là vi phạm khi nhóm đang bật bot và bật tính năng tương ứng (`Chặn link`, `Lọc từ cấm` hoặc `Chống spam`), người gửi không phải chủ nhóm/QTV, và nội dung khớp quy tắc đó. Với mỗi vi phạm, bot:

1. Ghi nhận vào thống kê của nhóm.
2. Xóa tin nhắn, nếu bot là QTV của nhóm.
3. Kick người gửi, nếu tính năng đó đang bật kick ở nhóm, bot là QTV, và người đó đã vi phạm đúng tính năng đó đủ số lần trong khoảng thời gian đã đặt.

Việc xóa tin không chờ cơ sở dữ liệu: nếu MongoDB lỗi, tin vẫn bị xóa, chỉ có phần ghi nhận và kick của tin đó bị bỏ qua (console in `[VIOLATION RECORD FAILED]`).

Kick không phải cài đặt chung của nhóm mà thuộc về từng tính năng: trên trang của nhóm, mỗi thẻ tính năng (`Chặn link`, `Lọc từ cấm`, `Chống spam`) có công tắc `Kick khi vi phạm nhiều lần` riêng, mặc định tắt. Ví dụ có thể để chặn link kick còn lọc từ cấm thì chỉ xóa tin.

- Công tắc kick của một tính năng chỉ bật được khi tính năng đó đang bật và bot là QTV của nhóm (máy chủ cũng từ chối nếu không); tắt thì lúc nào cũng được.
- Khi bật, đặt ngưỡng dạng `kick khi đủ N lần trong T`. Mặc định `Chặn link` là 3 lần trong 10 giây (bắt spam dồn dập), `Lọc từ cấm` là 3 lần trong 10 phút, `Chống spam` là 3 lần trong 60 giây. `N` từ 1 đến 100, khoảng thời gian từ 1 giây đến 7 ngày.
- Hai quy tắc đếm riêng: 2 link và 1 từ cấm không cộng lại với nhau.
- Chỉ các vi phạm nằm trong khoảng thời gian mới được tính; vi phạm cũ hơn không dẫn tới kick dù tổng số trong thống kê có lớn.
- Sau khi bị kick, các vi phạm trước đó của thành viên không còn được tính cho lần kick sau. Nếu Zalo từ chối lệnh kick, bot thử lại ở vi phạm kế tiếp trong khoảng thời gian.
- Nhóm lưu từ các phiên bản cũ được đọc lại theo cách mới: công tắc `Kick khi đủ 3 link / 10 giây` thành chặn link kick 3 lần trong 10 giây; công tắc kick chung của nhóm thành bật kick cho những tính năng đã có ngưỡng riêng lớn hơn 0.

Ở nhóm bot không phải QTV, bot không xóa được tin và không kick được, nên chỉ có bước ghi nhận; dashboard ghi rõ trạng thái này trên từng nhóm.

Trang của mỗi nhóm có bảng vi phạm của nhóm đó: từng thành viên, tổng số lần theo từng quy tắc từ trước tới nay, số lần đã bị kick và lần vi phạm gần nhất. Thống kê là tổng dài hạn để bạn theo dõi; nó không quyết định việc kick. Có thể xóa thống kê của một thành viên hoặc của cả nhóm. Dữ liệu lưu trong MongoDB (collection `violations`).

Nút `Xem tin` trên từng thành viên hiện 50 tin vi phạm gần nhất của người đó: thời gian, quy tắc và nội dung phát hiện, trạng thái (`Đã xóa`, `Xóa thất bại`, hoặc `Chỉ ghi nhận` ở nhóm bot không phải QTV) và nội dung tin. Bot chỉ lưu phần chữ (tối đa 2.000 ký tự) và link của tin; ảnh và tệp không được lưu. Các tin này nằm trong collection `violation_messages`, tự xóa sau 90 ngày, và bị xóa cùng khi bạn xóa thống kê. Việc đếm vi phạm trong khoảng thời gian để kick cũng dựa trên các tin này, nên xóa thống kê của một thành viên là đặt lại số đếm của họ.

Console ghi log theo dạng text có màu: `[VIOLATION]` (kèm quy tắc và nội dung phát hiện), `[VIOLATION RECORD FAILED]`, `[MESSAGE DELETED]`, `[MESSAGE DELETE FAILED]`, `[KICKED]`, `[KICK REJECTED]`, `[KICK FAILED]`, cùng `[FEATURE FAILED]` khi một tính năng gặp lỗi.

## Kiểm tra mã nguồn

```powershell
npm run check
npm run lint
npm test
```

`npm run check` gồm typecheck, build và test.
