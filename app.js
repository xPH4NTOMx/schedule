const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const XLSX = require('xlsx'); 
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); 
// เพิ่ม Term เข้ามาในบรรทัดดึง Model
const { sequelize, User, Schedule, Subject, Room, Group, Term } = require('./models');

const app = express();

// --- [ตัวแปรระบบ] ---
// globalSettings ยังคงไว้สำหรับจำค่า session ปัจจุบัน แต่ข้อมูลเทอมจะดึงจาก DB แทน
let globalSettings = { currentTerm: "2/2568" }; 

// --- 1. Settings & Middleware ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'it-lampang-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware ตรวจสอบสิทธิ์
const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.session.userId) return res.redirect('/login');
        if (roles.includes(req.session.role)) return next();
        res.status(403).send("<script>alert('❌ คุณไม่มีสิทธิ์เข้าถึงส่วนนี้'); window.location='/dashboard';</script>");
    }
};

// --- 2. Routes: Authentication ---
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.role = user.role; 
            req.session.fullname = user.fullname;
            req.session.groupId = user.groupId || user.studentGroupId || null; 
            return res.redirect('/dashboard');
        }
        res.send("<script>alert('ชื่อผู้ใช้หรือรหัสผ่านผิด'); window.location='/login';</script>");
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('dashboard', { 
        role: req.session.role, 
        fullname: req.session.fullname,
        groupId: req.session.groupId,
        currentTerm: globalSettings.currentTerm 
    });
});

// --- 3. Manage Page (Master Data) ---
app.get('/admin/manage', checkRole(['admin', 'program_manager', 'scheduler']), async (req, res) => {
    try {
        const subjects = await Subject.findAll();
        const rooms = await Room.findAll();
        const teachers = await User.findAll({ where: { role: 'teacher' } });
        const groups = await Group.findAll();
        
        // แก้ไข: ดึงข้อมูลเทอมจาก Database และเรียงลำดับจากใหม่ไปเก่า
        const allTerms = await Term.findAll({
            order: [['term_name', 'DESC']]
        });

        res.render('manage', { 
            subjects, rooms, teachers, groups, 
            role: req.session.role,
            currentTerm: globalSettings.currentTerm, 
            allTerms: allTerms // ส่งค่าที่ดึงจาก DB ไป
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/set-current-term', checkRole(['admin', 'scheduler']), (req, res) => {
    if (req.body.term) {
        globalSettings.currentTerm = req.body.term;
    }
    res.send("<script>alert('✅ ตั้งค่าภาคเรียนปัจจุบันสำเร็จ'); window.location='/admin/manage';</script>");
});

// แก้ไข: บันทึกเทอมใหม่ลงใน Database แทนตัวแปรชั่วคราว
app.post('/admin/add-term', checkRole(['admin', 'scheduler']), async (req, res) => {
    try {
        const { newTerm } = req.body;
        if (newTerm) {
            // ใช้ findOrCreate เพื่อป้องกันข้อมูลซ้ำ
            await Term.findOrCreate({
                where: { term_name: newTerm.trim() }
            });
        }
        res.redirect('/admin/manage');
    } catch (err) { res.status(500).send(err.message); }
});

// เพิ่มวิชา: รองรับ ท/ป/น
app.post('/admin/add-subject', checkRole(['admin', 'program_manager']), async (req, res) => {
    try {
        const { subject_code, name_th, theory_hrs, practice_hrs, credits } = req.body;
        await Subject.create({
            subject_code: subject_code.trim(),
            name_th: name_th.trim(),
            theory_hrs: Number(theory_hrs) || 0,
            practice_hrs: Number(practice_hrs) || 0,
            credits: Number(credits) || 0
        });
        res.redirect('/admin/manage');
    } catch (err) { res.status(500).send("❌ ไม่สามารถเพิ่มวิชาได้: " + err.message); }
});

app.get('/admin/delete-subject/:id', checkRole(['admin', 'program_manager']), async (req, res) => {
    try {
        await Subject.destroy({ where: { subject_code: req.params.id } });
        res.redirect('/admin/manage');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/add-room', checkRole(['admin', 'program_manager']), async (req, res) => {
    await Room.create(req.body);
    res.redirect('/admin/manage');
});

app.get('/admin/delete-room/:id', checkRole(['admin', 'program_manager']), async (req, res) => {
    await Room.destroy({ where: { room_id: req.params.id } });
    res.redirect('/admin/manage');
});

app.post('/admin/add-group', checkRole(['admin', 'program_manager']), async (req, res) => {
    try {
        const { group_id } = req.body;
        const exists = await Group.findByPk(group_id);
        if (exists) return res.send("<script>alert('❌ มีกลุ่มเรียนนี้อยู่แล้ว'); history.back();</script>");
        await Group.create({ group_id });
        res.redirect('/admin/manage');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/admin/delete-group/:id', checkRole(['admin', 'program_manager']), async (req, res) => {
    try {
        await Group.destroy({ where: { group_id: req.params.id } });
        res.redirect('/admin/manage');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/import-subjects', checkRole(['admin', 'program_manager']), upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) return res.send("<script>alert('❌ กรุณาเลือกไฟล์'); history.back();</script>");
        const workbook = XLSX.readFile(req.file.path);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        for (let row of data) {
            await Subject.upsert({
                subject_code: String(row['subject_code'] || row['รหัสวิชา'] || '').trim(),
                name_th: row['name_th'] || row['ชื่อวิชา'],
                theory_hrs: Number(row['theory_hrs'] || row['ท']) || 0,
                practice_hrs: Number(row['practice_hrs'] || row['ป']) || 0,
                credits: Number(row['credits'] || row['น']) || 0
            });
        }
        res.send("<script>alert('✅ นำเข้าข้อมูลรายวิชาสำเร็จ!'); window.location='/admin/manage';</script>");
    } catch (error) { res.status(500).send("❌ การ Import ล้มเหลว: " + error.message); }
});

// --- 4. Scheduling (หน้าจัดตาราง) ---
app.get('/schedule/:groupId', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { groupId } = req.params;
        const term = req.query.term || globalSettings.currentTerm;

        const scheduleData = await Schedule.findAll({
            where: { studentGroupId: groupId, term: term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });
        
        const canEdit = ['admin', 'scheduler'].includes(req.session.role);
        
        // แก้ไข: ดึงข้อมูลเทอมจาก Database สำหรับหน้าตารางเรียน
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });

        res.render('schedule', { 
            scheduleData, 
            groupId, 
            role: req.session.role, 
            canEdit,
            currentTerm: term, 
            latestTerm: globalSettings.currentTerm,
            allTerms: allTermsFromDB, // ส่งค่าจาก DB
            subjects: canEdit ? await Subject.findAll() : [], 
            teachers: canEdit ? await User.findAll({ where: { role: 'teacher' } }) : [], 
            rooms: canEdit ? await Room.findAll() : []
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/add-schedule', checkRole(['admin', 'scheduler']), async (req, res) => {
    const { day, start_slot, teacherId, roomId, subjectCode, studentGroupId, term } = req.body;
    try {
        let start = Number(start_slot);
        let end;
        const currentSelectedTerm = term || globalSettings.currentTerm;

        if (subjectCode === 'BREAK') {
            end = start + 1;
            await Schedule.create({
                day, start_slot: start, end_slot: end,
                teacherId: null, RoomId: null, SubjectSubjectCode: null, 
                studentGroupId, term: currentSelectedTerm
            });
            return res.redirect(`/schedule/${studentGroupId}?term=${currentSelectedTerm}`);
        }

        const subject = await Subject.findByPk(subjectCode);
        if (!subject) return res.send("<script>alert('❌ ไม่พบวิชา'); history.back();</script>");

        const totalHours = Number(subject.theory_hrs || 0) + Number(subject.practice_hrs || 0);
        end = start + totalHours;

        if (end > 13) return res.send(`<script>alert('❌ เกินเวลาตารางเรียน!'); history.back();</script>`);
        if (start < 5 && end > 5) return res.send("<script>alert('❌ คร่อมเวลาพักกลางวันไม่ได้'); history.back();</script>");

        const conflict = await Schedule.findOne({
            where: {
                day, term: currentSelectedTerm,
                [Op.or]: [{ teacherId }, { RoomId: roomId }, { studentGroupId }],
                [Op.and]: [{ start_slot: { [Op.lt]: end } }, { end_slot: { [Op.gt]: start } }]
            }
        });

        if (conflict) return res.send("<script>alert('❌ เวลาทับซ้อนในภาคเรียนนี้'); history.back();</script>");

        await Schedule.create({
            day, start_slot: start, end_slot: end, 
            teacherId, RoomId: roomId, SubjectSubjectCode: subjectCode, 
            studentGroupId, term: currentSelectedTerm
        });
        res.redirect(`/schedule/${studentGroupId}?term=${currentSelectedTerm}`);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/delete-schedule/:id/:groupId', checkRole(['admin', 'scheduler']), async (req, res) => {
    const item = await Schedule.findByPk(req.params.id);
    const term = item ? item.term : globalSettings.currentTerm;
    await Schedule.destroy({ where: { id: req.params.id } });
    res.redirect(`/schedule/${req.params.groupId}?term=${term}`);
});

app.get('/clear-schedule/:groupId', checkRole(['admin']), async (req, res) => {
    const term = req.query.term || globalSettings.currentTerm;
    await Schedule.destroy({ where: { studentGroupId: req.params.groupId, term: term } });
    res.redirect(`/schedule/${req.params.groupId}?term=${term}`);
});

// --- 5. User Management ---
app.get('/admin/users', checkRole(['admin']), async (req, res) => {
    try {
        const users = await User.findAll();
        const groups = await Group.findAll(); 
        res.render('users', { users, groups, role: req.session.role }); 
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/add-user', checkRole(['admin']), async (req, res) => {
    try {
        const { fullname, username, password, role, groupId } = req.body; 
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ 
            fullname, username, password: hashedPassword, role, groupId: groupId || null
        });
        res.redirect('/admin/users');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/edit-user', checkRole(['admin']), async (req, res) => {
    try {
        const { userId, fullname, username, password, role, groupId } = req.body;
        const user = await User.findByPk(userId);
        if (!user) return res.send("<script>alert('❌ ไม่พบผู้ใช้งาน'); history.back();</script>");

        let updateData = { fullname, username, role, groupId: groupId || null }; 
        if (password && password.trim() !== "") {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await User.update(updateData, { where: { id: userId } });
        res.send("<script>alert('✅ แก้ไขข้อมูลสำเร็จ'); window.location='/admin/users';</script>");
    } catch (err) { res.status(500).send(err.message); }
});

// --- 6. View Schedules ---
app.get('/teacher/schedule', checkRole(['admin', 'teacher']), async (req, res) => {
    try {
        const teacherId = (req.session.role === 'teacher') ? req.session.userId : req.query.teacherId;
        const term = req.query.term || globalSettings.currentTerm;

        if (!teacherId) {
            const teachers = await User.findAll({ where: { role: 'teacher' } });
            return res.render('teacher_select', { teachers, role: req.session.role });
        }
        const scheduleData = await Schedule.findAll({
            where: { teacherId, term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });
        const teacherInfo = await User.findByPk(teacherId);
        
        // เพิ่ม: ดึงรายการเทอมทั้งหมดส่งไปให้ Dropdown
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        res.render('schedule_view', { 
            scheduleData, title: `ตารางสอน: ${teacherInfo.fullname}`,
            role: req.session.role, type: 'teacher', currentTerm: term,
            teacherId: teacherId, // ส่งไปแก้ ReferenceError
            allTerms: termList     // ส่งรายการเทอมไปวน Loop
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/room/schedule', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { roomId } = req.query;
        const term = req.query.term || globalSettings.currentTerm;

        if (!roomId) {
            const rooms = await Room.findAll();
            const groups = await Group.findAll(); 
            return res.render('room_select', { rooms, groups, role: req.session.role });
        }
        const scheduleData = await Schedule.findAll({
            where: { RoomId: roomId, term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        res.render('schedule_view', { 
            scheduleData, title: `ตารางการใช้ห้อง: ${roomId}`,
            role: req.session.role, type: 'room', currentTerm: term,
            allTerms: termList,
            teacherId: null // ใส่ไว้กันพังในกรณีใช้ไฟล์ View ร่วมกัน
        });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 6. View Schedules (ส่วนที่เพิ่มใหม่) ---

// เพิ่ม Route สำหรับดูตารางเรียนรายกลุ่ม (สำหรับพิมพ์)
app.get('/group/schedule/:groupId', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { groupId } = req.params;
        const term = req.query.term || globalSettings.currentTerm;

        // 1. ดึงข้อมูลตาราง
        const scheduleData = await Schedule.findAll({
            where: { studentGroupId: groupId, term: term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        // 2. ดึงข้อมูลกลุ่ม (เพิ่มข้อมูลเพื่อไปโชว์หัวกระดาษ)
        const groupInfo = await Group.findByPk(groupId) || { 
            group_name: groupId, 
            level: 'ไม่ระบุ', 
            group_no: '-', 
            major_name: 'ไม่ระบุ' 
        };

        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });

        res.render('schedule_view', { 
            scheduleData, 
            title: `ตารางเรียนกลุ่ม: ${groupId}`,
            role: req.session.role, 
            type: 'group', 
            currentTerm: term,
            allTerms: allTermsFromDB.map(t => t.term_name),
            teacherId: null,
            groupInfo: groupInfo, // ส่งไปแก้ ReferenceError
            allSubjectsInPlan: []  // ส่งไปกันพัง
        });
    } catch (err) { res.status(500).send(err.message); }
});
// --- 6. View Schedules (ฉบับสมบูรณ์สำหรับ EJS ของพี่) ---

// 1. ตารางสอนของครู
app.get('/teacher/schedule', checkRole(['admin', 'teacher']), async (req, res) => {
    try {
        const teacherId = (req.session.role === 'teacher') ? req.session.userId : req.query.teacherId;
        const term = req.query.term || globalSettings.currentTerm;

        // ดึงรายการเทอมสำหรับ Dropdown (กันหาย)
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        if (!teacherId) {
            const teachers = await User.findAll({ where: { role: 'teacher' } });
            return res.render('teacher_select', { 
                teachers, 
                role: req.session.role,
                allTerms: termList, 
                currentTerm: term 
            });
        }

        const scheduleData = await Schedule.findAll({
            where: { teacherId, term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });
        const teacherInfo = await User.findByPk(teacherId);

        res.render('schedule_view', { 
            scheduleData, 
            title: `ตารางสอน: ${teacherInfo.fullname}`,
            role: req.session.role, 
            type: 'teacher', 
            currentTerm: term, // ส่งตามชื่อที่ EJS ใช้ในบรรทัด 42, 54
            allTerms: termList,
            teacherId: teacherId,
            // ส่ง groupInfo หลอกไปให้หน้าครู/ห้อง เพื่อไม่ให้บรรทัด 53 Error
            groupInfo: { group_name: 'อาจารย์ผู้สอน', level: '-', group_no: '-', major_name: '-' },
            allSubjectsInPlan: [] // ส่งไปให้บรรทัด 72 ของ EJS ทำงานได้
        });
    } catch (err) { res.status(500).send(err.message); }
});

// 2. ตารางการใช้ห้อง
app.get('/room/schedule', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { roomId } = req.query;
        const term = req.query.term || globalSettings.currentTerm;

        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        if (!roomId) {
            const rooms = await Room.findAll();
            const groups = await Group.findAll(); 
            return res.render('room_select', { 
                rooms, groups, role: req.session.role,
                allTerms: termList, currentTerm: term 
            });
        }

        const scheduleData = await Schedule.findAll({
            where: { RoomId: roomId, term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        res.render('schedule_view', { 
            scheduleData, title: `ตารางการใช้ห้อง: ${roomId}`,
            role: req.session.role, type: 'room', currentTerm: term,
            allTerms: termList,
            teacherId: null,
            groupInfo: { group_name: roomId, level: 'ห้องเรียน', group_no: '-', major_name: '-' },
            allSubjectsInPlan: []
        });
    } catch (err) { res.status(500).send(err.message); }
});

// 3. ตารางเรียนกลุ่มเรียน (เพิ่มใหม่เพื่อให้ข้อมูล groupInfo มาครบๆ)
app.get('/group/schedule/:groupId', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { groupId } = req.params;
        const term = req.query.term || globalSettings.currentTerm;

        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        const scheduleData = await Schedule.findAll({
            where: { studentGroupId: groupId, term: term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        const groupInfo = await Group.findByPk(groupId) || { group_name: groupId, level: '-', group_no: '-', major_name: '-' };

        res.render('schedule_view', { 
            scheduleData, 
            title: `ตารางเรียนกลุ่ม: ${groupId}`,
            role: req.session.role, 
            type: 'group', 
            currentTerm: term,
            allTerms: termList,
            teacherId: null,
            groupInfo: groupInfo, // ส่งข้อมูลกลุ่มจริงๆ ไปให้บรรทัด 53, 57-59
            allSubjectsInPlan: []
        });
    } catch (err) { res.status(500).send(err.message); }
});

// --- [เพิ่มส่วนนี้] 6.5 Export Excel ---
// เพิ่ม program_manager ให้เข้าถึงได้ตามที่พี่ต้องการ
app.get('/admin/export-excel', checkRole(['admin', 'scheduler', 'program_manager']), async (req, res) => {
    try {
        const schedules = await Schedule.findAll({
            include: [
                { model: Subject }, 
                { model: User, as: 'Teacher' }, 
                { model: Room }
            ]
        });

        const data = schedules.map(s => {
            const item = s.get({ plain: true });
            
            // ตรวจสอบกรณีเป็น "เวลาพัก" (BREAK)
            const isBreak = item.SubjectSubjectCode === 'BREAK' || !item.SubjectSubjectCode;

            return {
                'ภาคเรียน': item.term || '-',
                'กลุ่มเรียน': item.studentGroupId || '-',
                'วัน': item.day || '-',
                'คาบเริ่ม': item.start_slot || 0,
                'คาบสิ้นสุด': item.end_slot || 0,
                // แก้ไข: ดึงรหัสวิชาจาก Subject Direct หรือ Foreign Key
                'รหัสวิชา': isBreak ? '-' : (item.Subject?.subject_code || item.SubjectSubjectCode || '-'),
                // แก้ไข: ดึงชื่อวิชาจาก Model Subject
                'ชื่อวิชา': isBreak ? 'พัก' : (item.Subject?.name_th || 'ไม่ระบุชื่อวิชา'),
                'ผู้สอน': item.Teacher?.fullname || '-',
                'ห้อง': item.RoomId || '-'
            };
        });

        // --- ส่วนการสร้างไฟล์ Excel (เหมือนเดิม) ---
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Schedules");
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Disposition', 'attachment; filename=schedule_export.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("❌ ไม่สามารถส่งออกข้อมูลได้: " + err.message);
    }
});

// --- 7. Server Start ---
sequelize.sync({ alter: true }).then(async () => {
    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('1234', 10);
        await User.create({
            username: 'admin',
            password: hashedPassword,
            fullname: 'ผู้ดูแลระบบ',
            role: 'admin'
        });
        console.log('✅ Created initial admin user: admin / 1234');
    }

    // สร้างข้อมูลเทอมเริ่มต้นหากในตาราง Terms ยังว่างอยู่
    const termCount = await Term.count();
    if (termCount === 0) {
        await Term.bulkCreate([
            { term_name: '1/2568' },
            { term_name: '2/2568' }
        ]);
        console.log('✅ Created initial terms: 1/2568, 2/2568');
    }

    app.listen(3000, () => console.log('🚀 ระบบพร้อมใช้งานที่พอร์ต 3000'));
}).catch(err => {
    console.error('❌ Database Sync Error:', err);
});