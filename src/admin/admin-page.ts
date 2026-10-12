// The admin page. The script is plain browser JavaScript inside a template literal, so it must not
// contain backticks, backslashes or dollar-brace sequences.
export function adminHtml(): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zalo Bot</title>
<style>
body{font-family:system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;background:#f4f6fa;color:#172033}
.card{background:white;border:1px solid #dfe4ee;border-radius:12px;padding:1rem;margin:.7rem 0}
.muted{color:#667085}
.error{color:#b42318;min-height:1.2rem}
.ok{color:#067647}
.warn{color:#b54708}
button{padding:.55rem .8rem;border:0;border-radius:8px;background:#2563eb;color:white;cursor:pointer;margin:.2rem}
button.secondary{background:#475467}
button.danger{background:#b42318}
label{display:flex;gap:.6rem;align-items:center;margin:.35rem 0}
.row{display:flex;gap:.5rem;margin:.5rem 0}
.row input,#group-search{flex:1;padding:.55rem;border:1px solid #cbd5e1;border-radius:8px}
#group-search{width:100%;box-sizing:border-box}
.kick-rule{margin:.45rem 0 .45rem 1.6rem;line-height:2.1}
.kick-rule.off{color:#98a2b3}
.kick-rule input{width:4rem;padding:.3rem;border:1px solid #cbd5e1;border-radius:8px}
.kick-rule select{padding:.3rem;border:1px solid #cbd5e1;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}
.grid .card{margin:0}
h3{font-size:1rem;margin:.9rem 0 .2rem}
ul.items{padding-left:1.1rem}
ul.items li{margin:.3rem 0}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid #eaecf0;white-space:nowrap}
td.number,th.number{text-align:right}
.message-text{white-space:pre-wrap;word-break:break-word}
#bot{display:flex;gap:1rem;align-items:center}
#bot img{width:64px;height:64px;border-radius:50%;object-fit:cover}
#bot h2,#bot p{margin:.2rem 0}
[hidden]{display:none}
</style>
</head>
<body>
<h1>Zalo group assistant</h1>
<p id="status" class="muted">Đang tải...</p>
<p><button id="refresh">Làm mới</button><button id="logout" class="secondary">Đăng xuất</button></p>

<section id="bot" class="card">
<img id="bot-avatar" alt="" hidden>
<div>
<h2 id="bot-name">Bot</h2>
<p class="muted">ID: <span id="bot-id"></span></p>
<p id="bot-connection"></p>
<p>Hoạt động từ <span id="bot-started"></span> · đã chạy <strong id="bot-uptime"></strong></p>
<p class="muted">Từ lúc khởi động: đã nhận <span id="bot-messages"></span> tin nhắn nhóm, xử lý <span id="bot-violations"></span> tin vi phạm.</p>
</div>
</section>

<section class="card">
<h2>Link bị chặn thêm</h2>
<p class="muted">Link mời nhóm Zalo luôn bị chặn. Thêm tên miền (ví dụ shopee.vn) hoặc tên miền kèm đường dẫn (ví dụ facebook.com/groups) để chặn cả link của các trang đó. Danh sách áp dụng cho mọi nhóm đang bật chặn link.</p>
<form id="link-form" class="row"><input id="link-input" placeholder="example.com" maxlength="200" required><button type="submit">Thêm</button></form>
<p id="link-error" class="error"></p>
<ul id="links" class="items"></ul>
</section>

<section class="card">
<h2>Từ cấm</h2>
<p class="muted">Thêm từ hoặc cụm từ cần chặn. Từ chỉ bị bắt khi đứng riêng, không bắt khi nằm trong một từ khác; có phân biệt dấu tiếng Việt. Danh sách áp dụng cho mọi nhóm đang bật lọc từ cấm.</p>
<form id="word-form" class="row"><input id="word-input" placeholder="Từ hoặc cụm từ" maxlength="50" required><button type="submit">Thêm</button></form>
<p id="word-error" class="error"></p>
<p id="word-notice" class="error"></p>
<ul id="words" class="items"></ul>
<h3>Thử một câu</h3>
<form id="check-form" class="row"><input id="check-input" placeholder="Nhập câu để xem có bị tính là vi phạm không" maxlength="500" required><button type="submit" class="secondary">Kiểm tra</button></form>
<p id="check-result" class="muted"></p>
</section>

<section id="stats" class="card" hidden>
<h2>Thống kê vi phạm: <span id="stats-name"></span></h2>
<p><button id="stats-refresh" class="secondary">Tải lại</button><button id="stats-clear" class="danger">Xóa thống kê nhóm này</button><button id="stats-close" class="secondary">Đóng</button></p>
<p id="stats-message" class="muted"></p>
<div class="table-wrap"><table id="stats-table">
<thead><tr><th>Thành viên</th><th class="number">Link</th><th class="number">Từ cấm</th><th class="number">Tổng</th><th class="number">Đã bị kick</th><th>Lần gần nhất</th><th></th></tr></thead>
<tbody></tbody>
</table></div>
<div id="messages-panel" hidden>
<h3>Tin vi phạm của <span id="messages-name"></span></h3>
<p class="muted">50 tin gần nhất. Nội dung tin vi phạm được lưu 90 ngày; ảnh và tệp không được lưu, chỉ lưu phần chữ và link.</p>
<p id="messages-message" class="muted"></p>
<ul id="messages" class="items"></ul>
</div>
</section>

<h2>Nhóm</h2>
<p class="muted">Bot cần là trưởng/phó nhóm để xóa tin và kick. Ở nhóm bot không có quyền, vi phạm vẫn được ghi nhận vào thống kê. Công tắc "Cho phép kick" chỉ bật được ở nhóm bot là QTV; khi bật, kick tính riêng từng quy tắc theo số lần vi phạm trong một khoảng thời gian (đặt 0 lần để không kick theo quy tắc đó).</p>
<input id="group-search" placeholder="Tìm nhóm theo tên">
<main id="groups" class="grid"></main>

<script>
const $ = (selector) => document.querySelector(selector);
const ruleNames = { link: 'Link', badWord: 'Từ cấm' };
const statusNames = { deleted: 'Đã xóa', deleteFailed: 'Xóa thất bại', recorded: 'Chỉ ghi nhận (bot không phải QTV)' };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  if (response.status === 401) { window.location.href = '/login'; throw new Error('Phiên đăng nhập đã hết hạn'); }
  const isJson = (response.headers.get('content-type') || '').includes('json');
  const result = isJson ? await response.json() : undefined;
  if (!response.ok) throw new Error(result && result.error || 'Yêu cầu thất bại');
  return result;
}
function send(method, url, body) { return request(url, { method, body: JSON.stringify(body) }); }
function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// A list of strings with an add form and a remove button per item (blocked links, banned words).
function setupList({ url, field, list, form, input, error, empty, onChange }) {
  const show = (items) => {
    list.innerHTML = items.length
      ? items.map((item) => '<li><code>' + esc(item) + '</code> <button class="secondary" data-item="' + esc(item) + '">Xóa</button></li>').join('')
      : '<li class="muted">' + empty + '</li>';
    if (onChange) onChange(items);
  };
  const change = async (method, value) => {
    error.textContent = '';
    try {
      show(await send(method, url, { [field]: value }));
      if (method === 'POST') input.value = '';
    } catch (exception) { error.textContent = exception.message; }
  };
  list.addEventListener('click', (event) => { if (event.target.dataset.item !== undefined) change('DELETE', event.target.dataset.item); });
  form.addEventListener('submit', (event) => { event.preventDefault(); change('POST', input.value); });
  request(url).then(show).catch((exception) => { error.textContent = exception.message; });
}

let wordCount = 0;
let groups = [];
function updateWordNotice() {
  const filtering = groups.filter((group) => group.badWordFilterEnabled).length;
  $('#word-notice').textContent = wordCount > 0 && groups.length > 0 && filtering === 0
    ? 'Chưa nhóm nào bật "Lọc từ cấm", nên danh sách này chưa có tác dụng. Hãy bật ở nhóm cần lọc bên dưới.'
    : '';
}
setupList({ url: '/api/blocked-links', field: 'link', list: $('#links'), form: $('#link-form'), input: $('#link-input'), error: $('#link-error'), empty: 'Chưa có link nào' });
setupList({ url: '/api/banned-words', field: 'word', list: $('#words'), form: $('#word-form'), input: $('#word-input'), error: $('#word-error'), empty: 'Chưa có từ nào', onChange: (items) => { wordCount = items.length; updateWordNotice(); } });
$('#check-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await send('POST', '/api/banned-words/check', { text: $('#check-input').value });
    $('#check-result').textContent = result.match ? 'Vi phạm vì có: "' + result.match + '"' : 'Không vi phạm';
  } catch (exception) { $('#check-result').textContent = exception.message; }
});

// Bot status
let botStatus;
let botStatusAt = 0;
function formatDuration(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (days > 0) return days + ' ngày ' + hours + ' giờ ' + minutes + ' phút';
  if (hours > 0) return hours + ' giờ ' + minutes + ' phút';
  if (minutes > 0) return minutes + ' phút ' + seconds + ' giây';
  return seconds + ' giây';
}
// The uptime keeps counting between refreshes from the value the server last reported.
function showUptime() {
  if (botStatus) $('#bot-uptime').textContent = formatDuration(botStatus.uptimeSeconds + (Date.now() - botStatusAt) / 1000);
}
async function loadStatus() {
  botStatus = await request('/api/status');
  botStatusAt = Date.now();
  $('#bot-name').textContent = botStatus.displayName || 'Bot';
  $('#bot-id').textContent = botStatus.userId;
  $('#bot-avatar').hidden = !botStatus.avatar;
  if (botStatus.avatar) $('#bot-avatar').src = botStatus.avatar;
  const since = new Date(botStatus.connectionChangedAt).toLocaleString('vi-VN');
  $('#bot-connection').className = botStatus.connected ? 'ok' : 'error';
  $('#bot-connection').textContent = botStatus.connected ? 'Đang kết nối Zalo (từ ' + since + ')' : 'Mất kết nối Zalo (từ ' + since + ')';
  $('#bot-started').textContent = new Date(botStatus.startedAt).toLocaleString('vi-VN');
  $('#bot-messages').textContent = botStatus.groupMessagesSeen;
  $('#bot-violations').textContent = botStatus.violationsHandled;
  showUptime();
}
setInterval(showUptime, 1000);

// Groups
const windowUnits = [['86400', 'ngày'], ['3600', 'giờ'], ['60', 'phút'], ['1', 'giây']];
// One line of the form "<rule>: kick khi đủ N lần trong T <đơn vị>", using the largest unit that divides the window evenly.
function kickRuleRow(group, rule) {
  const id = esc(group.groupId);
  const kickRule = group.kickRules[rule];
  const active = group.kickEnabled && group.botIsAdmin;
  const disabled = active ? '' : ' disabled';
  const unit = windowUnits.find((item) => kickRule.windowSeconds % Number(item[0]) === 0)[0];
  const options = windowUnits.map((item) => '<option value="' + item[0] + '"' + (item[0] === unit ? ' selected' : '') + '>' + item[1] + '</option>').join('');
  return '<div class="kick-rule' + (active ? '' : ' off') + '" data-id="' + id + '" data-rule="' + rule + '">' + ruleNames[rule] + ': kick khi đủ '
    + '<input type="number" class="kick-count" min="0" max="100" value="' + kickRule.count + '"' + disabled + '> lần trong '
    + '<input type="number" class="kick-window" min="1" value="' + (kickRule.windowSeconds / Number(unit)) + '"' + disabled + '> '
    + '<select class="kick-unit"' + disabled + '>' + options + '</select></div>';
}
function groupCard(group) {
  const id = esc(group.groupId);
  const rights = group.botIsAdmin
    ? '<p class="ok">Bot là QTV: xóa tin và kick được</p>'
    : '<p class="warn">Bot không phải QTV: chỉ ghi nhận vi phạm</p>';
  return '<article class="card"><h3>' + esc(group.name) + '</h3>'
    + '<p class="muted">' + id + ' · ' + group.memberCount + ' thành viên</p>' + rights
    + '<label><input type="checkbox" class="toggle" data-id="' + id + '" data-toggle="bot"' + (group.botEnabled ? ' checked' : '') + '> Chặn link</label>'
    + '<label><input type="checkbox" class="toggle" data-id="' + id + '" data-toggle="bad-words"' + (group.badWordFilterEnabled ? ' checked' : '') + '> Lọc từ cấm</label>'
    + '<label><input type="checkbox" class="toggle" data-id="' + id + '" data-toggle="kick"' + (group.kickEnabled && group.botIsAdmin ? ' checked' : '') + (group.botIsAdmin ? '' : ' disabled') + '> Cho phép kick' + (group.botIsAdmin ? '' : ' (cần bot là QTV)') + '</label>'
    + kickRuleRow(group, 'link') + kickRuleRow(group, 'badWord')
    + '<button class="secondary stats-button" data-id="' + id + '" data-name="' + esc(group.name) + '">Thống kê</button></article>';
}
function renderGroups() {
  // Rebuilding the cards would throw away a kick rule that is still being edited.
  const active = document.activeElement;
  if (active && active.closest('.kick-rule')) return;
  const query = $('#group-search').value.trim().toLowerCase();
  const visible = groups.filter((group) => group.name.toLowerCase().includes(query));
  $('#groups').innerHTML = visible.map(groupCard).join('');
  const moderating = groups.filter((group) => group.botIsAdmin).length;
  $('#status').textContent = 'Đã tải ' + groups.length + ' nhóm, bot là QTV ở ' + moderating + ' nhóm · dữ liệu lấy trực tiếp từ Zalo';
  updateWordNotice();
}
async function loadGroups() { groups = await request('/api/groups'); renderGroups(); }
function showLoadError(exception) { $('#status').textContent = exception.message; }
async function changeGroup(id, path, body) {
  try { await send('PATCH', '/api/groups/' + encodeURIComponent(id) + '/' + path, body); }
  catch (exception) { alert(exception.message); }
  await loadGroups().catch(showLoadError);
}
$('#groups').addEventListener('change', (event) => {
  const target = event.target;
  if (target.classList.contains('toggle')) changeGroup(target.dataset.id, target.dataset.toggle, { enabled: target.checked });
  const row = target.closest('.kick-rule');
  if (row) {
    target.blur();
    const count = row.querySelector('.kick-count').value;
    const amount = row.querySelector('.kick-window').value;
    // An emptied field is not a 0; put the saved values back instead of saving it.
    if (count === '' || amount === '') { renderGroups(); return; }
    changeGroup(row.dataset.id, 'kick-rule', { rule: row.dataset.rule, count: Number(count), windowSeconds: Number(amount) * Number(row.querySelector('.kick-unit').value) });
  }
});
$('#groups').addEventListener('click', (event) => {
  const target = event.target;
  if (target.classList.contains('stats-button')) openStats(target.dataset.id, target.dataset.name);
});
$('#group-search').addEventListener('input', renderGroups);
$('#refresh').onclick = () => { loadStatus().catch(showLoadError); loadGroups().catch(showLoadError); };
$('#logout').onclick = async () => { await fetch('/logout', { method: 'POST' }); window.location.href = '/login'; };

// Statistics
let statsGroupId;
function statsUrl() { return '/api/groups/' + encodeURIComponent(statsGroupId) + '/violations'; }
function showStats(members) {
  $('#messages-panel').hidden = true;
  $('#stats-message').textContent = members.length ? '' : 'Nhóm này chưa có vi phạm nào được ghi nhận.';
  $('#stats-table').hidden = members.length === 0;
  $('#stats-table tbody').innerHTML = members.map((member) => {
    const total = member.counts.link + member.counts.badWord;
    return '<tr><td>' + esc(member.userName || 'Không rõ tên') + '<br><span class="muted">' + esc(member.userId) + '</span></td>'
      + '<td class="number">' + member.counts.link + '</td><td class="number">' + member.counts.badWord + '</td><td class="number">' + total + '</td>'
      + '<td class="number">' + member.kicks + '</td>'
      + '<td>' + new Date(member.lastAt).toLocaleString('vi-VN') + '<br><span class="muted">' + (ruleNames[member.lastRule] || esc(member.lastRule)) + '</span></td>'
      + '<td><button data-view="' + esc(member.userId) + '" data-name="' + esc(member.userName || member.userId) + '">Xem tin</button><button class="secondary" data-user="' + esc(member.userId) + '">Xóa</button></td></tr>';
  }).join('');
}
async function loadStats() {
  try { showStats(await request(statsUrl())); }
  catch (exception) { $('#stats-message').textContent = exception.message; }
}
async function clearStats(body) {
  try { showStats(await send('DELETE', statsUrl(), body)); }
  catch (exception) { $('#stats-message').textContent = exception.message; }
}
async function loadMessages(userId, name) {
  $('#messages-name').textContent = name;
  $('#messages-panel').hidden = false;
  $('#messages').innerHTML = '';
  try {
    const messages = await request('/api/groups/' + encodeURIComponent(statsGroupId) + '/members/' + encodeURIComponent(userId) + '/messages');
    $('#messages-message').textContent = messages.length ? '' : 'Chưa lưu tin nào của thành viên này.';
    $('#messages').innerHTML = messages.map((message) => {
      const matches = message.matches.map((match) => (ruleNames[match.rule] || esc(match.rule)) + ': ' + esc(match.detail)).join(', ');
      return '<li><strong>' + new Date(message.at).toLocaleString('vi-VN') + '</strong> · ' + matches + ' · ' + (statusNames[message.status] || esc(message.status))
        + '<br><span class="message-text">' + (message.text ? esc(message.text) : '<span class="muted">(không có nội dung chữ)</span>') + '</span>'
        + (message.link ? '<br><span class="muted">' + esc(message.link) + '</span>' : '') + '</li>';
    }).join('');
    $('#messages-panel').scrollIntoView({ behavior: 'smooth' });
  } catch (exception) { $('#messages-message').textContent = exception.message; }
}
function openStats(id, name) {
  statsGroupId = id;
  $('#stats-name').textContent = name;
  $('#stats').hidden = false;
  $('#stats').scrollIntoView({ behavior: 'smooth' });
  loadStats();
}
$('#stats-refresh').onclick = loadStats;
$('#stats-close').onclick = () => { $('#stats').hidden = true; };
$('#stats-clear').onclick = () => { if (confirm('Xóa toàn bộ thống kê vi phạm của nhóm này?')) clearStats({}); };
$('#stats-table').addEventListener('click', (event) => {
  const view = event.target.dataset.view;
  if (view !== undefined) { loadMessages(view, event.target.dataset.name); return; }
  const userId = event.target.dataset.user;
  if (userId !== undefined && confirm('Xóa thống kê của thành viên này?')) clearStats({ userId });
});

loadStatus().catch(showLoadError);
loadGroups().catch(showLoadError);
setInterval(() => { loadStatus().catch(() => undefined); loadGroups().catch(() => undefined); }, 30000);
</script>
</body>
</html>`;
}
