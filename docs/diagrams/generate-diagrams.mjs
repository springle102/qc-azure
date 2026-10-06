import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'schema-metadata.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const palette = { blue: ['#eaf2ff', '#315b96'], teal: ['#e7f6f2', '#23766c'], violet: ['#f0eafe', '#7051a3'], amber: ['#fff4dd', '#a57721'], gray: ['#f3f5f8', '#667085'] };
class Page {
  constructor(id, name, width, height) { this.id=id; this.name=name; this.width=width; this.height=height; this.cells=[]; this.ids=new Set(['0','1']); this.edges=[]; }
  vertex(id, value, x,y,w,h, style='', parent='1') {
    if(this.ids.has(id)) throw new Error(`Duplicate ${id}`); this.ids.add(id);
    this.cells.push(`<mxCell id="${esc(id)}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="${esc(parent)}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`); return id;
  }
  edge(id,source,target,value='',style='',points=[]) {
    this.ids.add(id); this.edges.push({source,target});
    const pts=points.length?`<Array as="points">${points.map(([x,y])=>`<mxPoint x="${x}" y="${y}"/>`).join('')}</Array>`:'';
    this.cells.push(`<mxCell id="${esc(id)}" value="${esc(value)}" style="${esc('edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontFamily=Arial;fontSize=12;strokeColor=#64748b;labelBackgroundColor=#ffffff;'+style)}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
  }
  text(id,value,x,y,w,h,size=15,color='#475569',bold=false) {return this.vertex(id,value,x,y,w,h,`text;html=1;whiteSpace=wrap;align=left;verticalAlign=middle;fontFamily=Arial;fontSize=${size};fontColor=${color};fontStyle=${bold?1:0};spacing=0;`);}
  note(id,value,x,y,w,h,tone='gray') {const [fill,stroke]=palette[tone]; return this.vertex(id,value,x,y,w,h,`rounded=1;arcSize=10;html=1;whiteSpace=wrap;align=left;verticalAlign=top;spacing=14;fontFamily=Arial;fontSize=14;fillColor=${fill};strokeColor=${stroke};fontColor=#334155;`);}
  title(title,subtitle) {this.text('title',title,50,30,this.width-100,42,30,'#172b4d',true); this.text('subtitle',subtitle,50,80,this.width-100,40,15);}
  actor(id,label,x,y,tone='blue') {const [fill,stroke]=palette[tone];return this.vertex(id,label,x,y,95,105,`shape=umlActor;html=1;verticalLabelPosition=bottom;verticalAlign=top;align=center;fontFamily=Arial;fontSize=16;fontStyle=1;fillColor=${fill};strokeColor=${stroke};`);}
  uc(id,label,x,y,w=300,tone='blue') {const [fill,stroke]=palette[tone];return this.vertex(id,label,x,y,w,72,`ellipse;html=1;whiteSpace=wrap;fontFamily=Arial;fontSize=16;fillColor=${fill};strokeColor=${stroke};strokeWidth=1.4;fontColor=#243b53;`);}
  boundary(id,label,x,y,w,h) {return this.vertex(id,label,x,y,w,h,'swimlane;html=1;startSize=42;horizontal=1;fontFamily=Arial;fontSize=17;fontStyle=1;fillColor=#f8fafc;swimlaneFillColor=#ffffff;strokeColor=#94a3b8;');}
  assoc(id,source,target,points=[],ports='') {this.edge(id,source,target,'','startArrow=none;endArrow=none;strokeWidth=1.2;'+ports,points);}
  xml() {for(const e of this.edges) if(!this.ids.has(e.source)||!this.ids.has(e.target)) throw new Error('Dangling edge'); return `<diagram id="${this.id}" name="${esc(this.name)}"><mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${this.width}" pageHeight="${this.height}" math="0" shadow="0" background="#ffffff"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${this.cells.join('')}</root></mxGraphModel></diagram>`;}
}

const common=new Page('uc-common','01 · Chức năng chung',1400,1040);
common.title('USE CASE · QC WEBTOON','Chức năng chung cho Admin, QC và Freelancer · Đối chiếu API và giao diện ngày 06/10/2026');
common.boundary('system','HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON',430,170,790,630);
common.actor('user','Người dùng',280,420);
common.actor('admin','Admin',70,230,'violet');common.actor('qc','QC',70,430,'teal');common.actor('fl','Freelancer',70,630,'amber');
for(const [id,y] of [['admin',280],['qc',480],['fl',680]]) common.edge('gen-'+id,id,'user','','endArrow=block;endFill=0;startArrow=none;',[ [230,y],[230,475] ]);
const shared=[['login','Đăng nhập',500,250],['logout','Đăng xuất',880,250],['dashboard','Xem dashboard',500,385],['profile','Cập nhật hồ sơ cá nhân',880,385],['password','Đổi mật khẩu',500,520],['reset','Khôi phục mật khẩu bằng OTP',880,520],['push','Bật / tắt thông báo thiết bị',500,655]];
for(const [id,label,x,y] of shared){common.uc(id,label,x,y);common.assoc('a-'+id,'user',id,x>800?[[395,475],[395,y-25],[x+150,y-25]]:[[395,475],[395,y+36]],x>800?'exitX=1;exitY=0.5;entryX=0.5;entryY=0;':'exitX=1;exitY=0.5;entryX=0;entryY=0.5;');}
common.note('scope','<b>Phạm vi dữ liệu</b><br>Admin: toàn hệ thống. QC: task/lỗi theo mảng được cấp; bảng lương Admin/QC xem toàn bộ. Freelancer: task, lỗi và lương của chính mình.<br><br>Tam giác rỗng: kế thừa tác nhân. Đường liền không mũi tên: tác nhân tham gia use case.',430,840,790,140);

const manager=new Page('uc-manager','02 · Admin và QC',1720,1530);
manager.title('USE CASE · ADMIN VÀ QC','Các chức năng quản lý dựa trên route requireManager (Admin/QC) và requireAdmin (Admin)');
manager.boundary('sys','HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON',290,160,1240,1100);
manager.actor('manager','Quản lý\n(Admin / QC)',120,600,'teal');manager.actor('admin','Admin',80,1110,'violet');manager.actor('qc','QC',80,340,'teal');
manager.edge('gen-admin','admin','manager','','endArrow=block;endFill=0;startArrow=none;',[[225,1160],[225,655]]);
manager.edge('gen-qc','qc','manager','','endArrow=block;endFill=0;startArrow=none;',[[225,390],[225,655]]);
manager.text('mh','QUẢN LÝ NGHIỆP VỤ · ADMIN / QC',350,220,660,28,15,'#23766c',true);
const managed=[['freelancers','Xem / cập nhật hồ sơ freelancer'],['registrations','Quản lý đăng ký năng lực nhận chapter'],['create','Tạo / sửa / xóa deadline'],['assign','Phân công Freelancer và QC'],['review','Kiểm tra chapter / cập nhật trạng thái'],['pay','Duyệt thanh toán / cập nhật mức hoàn thành'],['errors','Tạo / sửa / xóa lỗi và Fix/Check'],['syncerrors','Đồng bộ bảng lỗi từ Google Sheets'],['levels','Quản lý độ khó và màu hiển thị'],['prices','Quản lý giá theo mảng và độ khó'],['bonus','Cấu hình chính sách thưởng'],['salary','Xem tổng lương và chi tiết thưởng']];
managed.forEach(([id,label],i)=>{const x=350+(i%2)*390,y=275+Math.floor(i/2)*145;manager.uc(id,label,x,y,330,'teal');manager.assoc('a-'+id,'manager',id,i%2?[[265,655],[265,y-20],[x+165,y-20]]:[[265,655],[265,y+36]],i%2?'exitX=1;exitY=0.5;entryX=0.5;entryY=0;':'exitX=1;exitY=0.5;entryX=0;entryY=0.5;');});
manager.text('ah','CHỈ ADMIN',1170,220,300,28,15,'#7051a3',true);
[['accounts','Cấp / sửa / khóa / xóa tài khoản'],['fields','Quản lý mảng và link Guide / Tài nguyên'],['settings','Cấu hình Sheets, Drive, checklist, nhắc hạn'],['sync','Đồng bộ deadline hai chiều với Sheets'],['history','Xem lịch sử gửi email nhắc deadline'],['screenshots','Chuyển ảnh lỗi cũ lên Storage']].forEach(([id,label],i)=>{const y=275+i*145;manager.uc(id,label,1170,y,300,'violet');manager.assoc('ad-'+id,'admin',id,[[240,1380],[1570,1380],[1570,y+36]]);});
manager.note('rules','<b>Quy tắc thể hiện trên sơ đồ</b><br>• Freelancer không được tự tạo tài khoản; Admin cấp tài khoản.<br>• QC thao tác theo quyền/mảng của tài khoản; chức năng xem lương Admin/QC trả toàn bộ dữ liệu lương.<br>• Chỉ Admin gán <i>assignedAdminId</i> cho task. Phân công Freelancer/QC thuộc chức năng quản lý.<br>• Lương Freelancer tính từ task đã duyệt Thanh toán; lương QC thêm điều kiện trạng thái Done.',290,1400,1240,115);

const freelancer=new Page('uc-fl','03 · Freelancer',1400,1280);
freelancer.title('USE CASE · FREELANCER','Các thao tác chỉ áp dụng cho task và lỗi được giao cho người đang đăng nhập');
freelancer.boundary('sys','HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON',290,160,880,880);
freelancer.actor('fl','Freelancer',110,540,'amber');
[ ['tasks','Xem task được giao'],['register','Đăng ký / sửa / xóa năng lực nhận chapter'],['doing','Bắt đầu làm task (Doing)'],['submit','Nộp chapter (Submitted)'],['feedback','Cập nhật Feedback của task'],['errors','Xem lỗi được giao'],['fix','Tick / bỏ tick Fix/Check'],['salary','Xem lương và thưởng cá nhân'],['links','Mở Guide / Tài nguyên theo mảng'],['notifications','Xem thông báo và nhận nhắc hạn']].forEach(([id,label],i)=>{const x=360+(i%2)*400,y=260+Math.floor(i/2)*145;freelancer.uc(id,label,x,y,330,'amber');freelancer.assoc('a-'+id,'fl',id,i%2?[[250,595],[250,y-25],[x+165,y-25]]:[[250,595],[250,y+36]],i%2?'exitX=1;exitY=0.5;entryX=0.5;entryY=0;':'exitX=1;exitY=0.5;entryX=0;entryY=0.5;');});
freelancer.note('rules','<b>Giới hạn quyền Freelancer</b><br>Chỉ sửa Status và Feedback của task của mình; Status chỉ được chọn Doing hoặc Submitted. Chỉ cập nhật Fix/Check cho lỗi có <i>editorFreelancerId</i> trùng hồ sơ của mình. Không tạo task, phân công, duyệt thanh toán hoặc quản lý tài khoản.<br><br>Đăng ký deadline là đăng ký năng lực nhận chapter theo tuần/tháng; không phải tạo một task deadline mới.',290,1080,880,155,'amber');

const integration=new Page('uc-integrations','04 · Tích hợp ngoài',1600,1500);
integration.title('USE CASE · TÍCH HỢP VÀ TỰ ĐỘNG HÓA','Tác nhân bên ngoài hệ thống · Chức năng có điều kiện cấu hình dịch vụ');
integration.boundary('sys','HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON',300,160,930,1080);
integration.actor('admin','Admin',100,240,'violet');integration.actor('manager','Admin / QC',100,430,'teal');integration.actor('user','Người dùng',100,660);integration.actor('timer','Bộ lập lịch',100,870,'gray');
integration.actor('sheets','Google Sheets',1330,220,'teal');integration.actor('drive','Google Drive',1330,420,'teal');integration.actor('storage','Supabase Storage',1330,620,'teal');integration.actor('mail','Gmail / Email',1330,820,'teal');integration.actor('push','Dịch vụ Web Push',1330,1020,'teal');
const integrated=[['deadlines','Đồng bộ deadline hai chiều'],['errors','Nhập lỗi / đồng bộ checkbox Fix/Check'],['driveuc','Tra cứu folder Drive / gắn link bộ truyện'],['images','Lưu ảnh đại diện, QR và ảnh lỗi'],['otp','Gửi OTP khôi phục mật khẩu'],['remind','Gửi email nhắc deadline'],['device','Gửi thông báo thiết bị']];
integrated.forEach(([id,label],i)=>integration.uc(id,label,520,240+i*140,490,'teal'));
const associations=[['admin','deadlines'],['timer','deadlines'],['deadlines','sheets'],['manager','errors'],['user','errors'],['errors','sheets'],['admin','driveuc'],['driveuc','drive'],['user','images'],['manager','images'],['images','storage'],['user','otp'],['otp','mail'],['timer','remind'],['remind','mail'],['timer','device'],['device','push']];
associations.forEach(([s,t],i)=>{const sourceIndex=integrated.findIndex(a=>a[0]===s),targetIndex=integrated.findIndex(a=>a[0]===t);const y=240+(sourceIndex>=0?sourceIndex:targetIndex)*140+36;integration.assoc('a-'+i,s,t,sourceIndex>=0?[[1260,y]]:[[265,y]],'exitX=1;exitY=0.5;entryX=0;entryY=0.5;');});
integration.note('notes','<b>Điều kiện và hành vi</b><br>• Đồng bộ Sheets/Drive cần cấu hình và quyền Service Account phù hợp. Drive dùng để tra cứu folder và gắn link truyện khi đồng bộ task.<br>• OTP được yêu cầu bằng username; email gửi tới địa chỉ lưu trong Accounts.<br>• Bộ lập lịch nhắc trước hạn 24h / 6h / 3h và quá hạn; có lưu trạng thái để tránh gửi trùng.<br>• Freelancer sửa Fix/Check của lỗi của mình; Admin/QC quản lý và nhập bảng lỗi theo quyền.<br>• Database lưu URL ảnh; file ảnh nằm trong Supabase Storage.',300,1290,930,175);

const tables=new Map();
const type=(c)=>({int8:'bigint',int4:'integer',bool:'boolean',_text:'text[]',timestamptz:'timestamptz',varchar:'varchar'}[c.udt_name]||c.udt_name);
function keys(table,kind){return [...new Set(schema.constraints.filter(r=>r.table_name===table&&r.constraint_type===kind).map(r=>r.column_name))];}
function entity(p,name,x,y,w,tone='blue',selected=null,prefix=name){
  const cols=schema.columns.filter(c=>c.table_name===name&&(!selected||selected.includes(c.column_name)));
  const pk=keys(name,'PRIMARY KEY'),fk=keys(name,'FOREIGN KEY');
  const [fill,stroke]=palette[tone],h=38+cols.length*25;
  p.vertex(prefix,name+(selected?' · tham chiếu':''),x,y,w,h,`swimlane;startSize=38;html=1;horizontal=1;fontFamily=Arial;fontSize=17;fontStyle=1;align=left;spacingLeft=12;fillColor=${fill};swimlaneFillColor=#ffffff;strokeColor=${stroke};collapsible=0;`);
  cols.forEach((c,i)=>{const mark=[pk.includes(c.column_name)?'PK':'',fk.includes(c.column_name)?'FK':''].filter(Boolean).join('/'); const nullable=c.is_nullable==='YES'?' ?':'';
    p.vertex(prefix+'-'+c.column_name,`<b>${mark?mark+' · ':''}${c.column_name}</b> <font color="#64748b">${type(c)}${nullable}</font>`,0,38+i*25,w,25,'shape=rectangle;html=1;whiteSpace=wrap;fillColor=none;strokeColor=#e2e8f0;strokeWidth=0.4;align=left;verticalAlign=middle;spacingLeft=10;fontFamily=Arial;fontSize=13;',prefix);
  }); tables.set(prefix,{x,y,w,h,cols}); return prefix;
}
function relation(p,id,sourceTable,sourceCol,targetTable,targetCol,label,logical=false,points=[],side='left',sourceArrow='ERzeroToMany'){
  const nullable=schema.columns.find(c=>c.table_name===sourceTable&&c.column_name===sourceCol)?.is_nullable==='YES';
  const port=side==='left'?'exitX=0;exitY=0.5;entryX=1;entryY=0.5;':'exitX=1;exitY=0.5;entryX=0;entryY=0.5;';
  p.edge(id,sourceTable+'-'+sourceCol,targetTable+'-'+targetCol,label,`startArrow=${sourceArrow};endArrow=${nullable||logical?'ERzeroToOne':'ERone'};startFill=0;endFill=0;strokeColor=${logical?'#a57721':'#315b96'};strokeWidth=1.5;${logical?'dashed=1;dashPattern=6 4;':''}${port}`,points);
}

const core=new Page('erd-core','01 · Cơ sở dữ liệu nghiệp vụ',2310,1810);
core.title('ERD · CƠ SỞ DỮ LIỆU NGHIỆP VỤ','11 bảng nghiệp vụ · Metadata trực tiếp từ PostgreSQL ngày 06/10/2026 · Không chứa dữ liệu tài khoản');
entity(core,'Fields',55,220,370,'teal');entity(core,'DifficultyLevels',55,610,370,'teal');entity(core,'DifficultyPricing',55,980,370,'teal');entity(core,'BonusSettings',55,1320,370,'teal');
entity(core,'Accounts',630,200,405,'violet');entity(core,'Freelancer',630,700,405,'blue');entity(core,'DeadlineRegistrations',630,1170,405,'blue');
entity(core,'QC',1260,200,420,'violet');entity(core,'SeriesList',1260,480,420,'blue');
entity(core,'Errors',1830,440,425,'amber');entity(core,'GeneralSettings',1830,1040,425,'gray');
relation(core,'fk-acc-fl','Accounts','freelancerId','Freelancer','fIld','hồ sơ',false,[[540,475],[540,750]],'left');
relation(core,'fk-reg-fl','DeadlineRegistrations','fIld','Freelancer','fIld','đăng ký',false,[[555,1245],[555,750]],'left');
relation(core,'fk-task-fl','SeriesList','fIld','Freelancer','fIld','thực hiện',false,[[1130,755],[1130,750]],'left');
relation(core,'fk-task-admin','SeriesList','assignedAdminId','Accounts','id','Admin được gán',false,[[1165,1055],[1165,250]],'left');
relation(core,'fk-task-qc','SeriesList','qcId','QC','qcId','kiểm tra',false,[[1750,780],[1750,250]],'right');
relation(core,'fk-error-fl','Errors','editorFreelancerId','Freelancer','fIld','người sửa lỗi',false,[[1770,715],[1770,1160],[1080,1160],[1080,750]],'left');
relation(core,'fk-error-field','Errors','field','Fields','name','mảng (FK)',false,[[2280,515],[2280,165],[480,165],[480,295]],'right');
relation(core,'logic-level-field','DifficultyLevels','field','Fields','name','mảng · ứng dụng',true,[[465,685],[465,295]],'right');
relation(core,'logic-price-level','DifficultyPricing','difficulty','DifficultyLevels','difficulty','(field, difficulty)',true,[[470,1080],[470,710]],'right','ERzeroToOne');
relation(core,'logic-bonus-field','BonusSettings','field','Fields','name','field · ứng dụng',true,[[505,1480],[505,295]],'right');
relation(core,'logic-task-price','SeriesList','difficulty','DifficultyPricing','difficulty','(type, difficulty) → (field, difficulty)',true,[[1105,805],[1105,1115],[480,1115],[480,1080]],'left');
core.note('legend','<b>KÝ HIỆU</b><br>PK: khóa chính · FK: khóa ngoại · ?: cột cho phép NULL.<br>Đường xanh liền: FK thực sự trong database.<br>Đường vàng đứt: liên kết logic do ứng dụng xử lý.<br>Chân quạ: 0..n · vạch đơn: 1 · tròn + vạch: 0..1.<br><br><b>Khóa ghép / duy nhất</b><br>SeriesList PK (seriesId, chapterNumber).<br>DifficultyLevels và DifficultyPricing UNIQUE (field, difficulty).<br>Accounts.username và Fields.name là UNIQUE.',1120,1230,605,285);
core.note('modelnotes','<b>GHI CHÚ MÔ HÌNH HIỆN TẠI</b><br>• Một dòng SeriesList là một task/chapter; không có bảng Series riêng.<br>• SeriesList.type và difficulty tra giá bằng (DifficultyPricing.field, difficulty); không có FK cho cặp này.<br>• Accounts/Freelancer.fields là text[]; tên mảng do ứng dụng đối chiếu Fields.name.<br>• Errors liên kết task qua title/chapter trong nghiệp vụ; không có FK tới SeriesList.<br>• Lương/bonus được tính từ task và cấu hình; không có bảng Salaries.<br>• QC là bảng hồ sơ cũ; ứng dụng hợp nhất thêm account role QC.<br>• GeneralSettings là bảng cấu hình độc lập; các cột RawTransfer là cấu hình cũ chưa được API hiện tại cung cấp.',55,1560,2200,220);

const notify=new Page('erd-notify','02 · Email và Web Push',1850,1600);
notify.title('ERD · NHẮC DEADLINE VÀ THÔNG BÁO','4 bảng hạ tầng · Bảng nghiệp vụ được lặp lại ở dạng tham chiếu rút gọn');
entity(notify,'Accounts',65,260,360,'violet',['id','role','roles','freelancerId','email','isActive']);
entity(notify,'WebPushSubscriptions',610,260,420,'teal');entity(notify,'WebPushDeliveries',1280,260,480,'teal');
entity(notify,'WebPushNotificationState',610,700,420,'teal');
entity(notify,'SeriesList',65,1000,395,'blue',['seriesId','chapterNumber','fIld','endTask','status','submittedAt']);
entity(notify,'Freelancer',65,1330,395,'blue',['fIld','email']);
entity(notify,'TaskReminderDeliveries',1280,800,480,'amber');
relation(notify,'fk-push-sub','WebPushDeliveries','subscriptionId','WebPushSubscriptions','id','ON DELETE CASCADE',false,[[1140,335],[1140,310]],'left');
relation(notify,'logic-sub-account','WebPushSubscriptions','accountId','Accounts','id','accountId text ↔ id bigint',true,[[530,335],[530,310]],'left');
relation(notify,'logic-state-account','WebPushNotificationState','accountId','Accounts','id','accountId · ứng dụng',true,[[500,750],[500,310]],'left');
relation(notify,'logic-delivery-account','WebPushDeliveries','accountId','Accounts','id','accountId · ứng dụng',true,[[1800,360],[1800,180],[470,180],[470,310]],'right');
relation(notify,'logic-mail-task','TaskReminderDeliveries','seriesId','SeriesList','seriesId','(seriesId, chapterNumber) · snapshot',true,[[1150,875],[1150,985],[490,985],[490,1050]],'left');
relation(notify,'logic-mail-fl','TaskReminderDeliveries','freelancerId','Freelancer','fIld','freelancerId text ↔ fIld integer',true,[[1100,925],[1100,1530],[490,1530],[490,1380]],'left');
notify.note('notes','<b>FK VÀ LIÊN KẾT LOGIC</b><br>WebPushDeliveries.subscriptionId là FK duy nhất trong 4 bảng hạ tầng. Các accountId/seriesId/freelancerId kiểu text là snapshot hoặc liên kết ứng dụng; không phải FK.<br><br><b>Khóa chính ghép</b><br>WebPushNotificationState: (accountId, role, eventId).<br><br><b>Chống trùng email</b><br>UNIQUE (seriesId, chapterNumber, freelancerId, dueAt, milestone).<br>milestone: 24h / 6h / 3h / overdue.<br><br><b>Thông báo</b><br>subscription là JSON của đăng ký thiết bị. Bảng trạng thái lưu fingerprint/version để nhận diện thay đổi sự kiện. Bảng delivery lưu lần gửi và lease/retry.',610,1050,420,450);
notify.note('legend','<b>Chú giải</b><br>Xanh liền: FK thực tế · Vàng đứt: ứng dụng.<br>PK: khóa chính · ?: cho phép NULL.<br>Chân quạ: 0..n · vạch: 1 · tròn + vạch: 0..1.<br>Các bảng hạ tầng bật RLS; backend vận hành worker.',65,690,395,195,'gray');

const outputs=[['qc-webtoon-use-case.drawio',[common,manager,freelancer,integration]],['qc-webtoon-database.drawio',[core,notify]]];
const links={};
for(const [name,pages] of outputs){const xml=`<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net" modified="2026-10-06T00:00:00.000Z" agent="Codex" version="26.0.0" type="google" pages="${pages.length}">${pages.map(p=>p.xml()).join('')}</mxfile>`;
  fs.writeFileSync(path.join(dir,name),xml,'utf8');
  links[name]='https://app.diagrams.net/?splash=0#R'+encodeURIComponent(zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64'));
  console.log(`${name}: ${pages.length} pages, ${Buffer.byteLength(xml)} bytes, ${pages.reduce((n,p)=>n+p.cells.length,0)} cells`);
}
fs.writeFileSync(path.join(dir,'preview-links.json'),JSON.stringify(links,null,2));
