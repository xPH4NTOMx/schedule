const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const XLSX = require('xlsx'); 
const multer = require('multer');

// ใช้ memoryStorage เพื่อความเร็วและลดปัญหาสิทธิ์ในการเขียนไฟล์บน Server
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const { sequelize, User, Schedule, Subject, Room, Group, Term } = require('./models');

const app = express();

// --- [ตัวแปรระบบ] ---
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
        const subjects = await Subject.findAll({ order: [['subject_code', 'ASC']] });
        const rooms = await Room.findAll();
        const teachers = await User.findAll({ where: { role: 'teacher' } });
        const groups = await Group.findAll();
        const allTerms = await Term.findAll({ order: [['term_name', 'DESC']] });

        res.render('manage', { 
            subjects, rooms, teachers, groups, 
            role: req.session.role,
            currentTerm: globalSettings.currentTerm, 
            allTerms: allTerms
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/admin/set-current-term', checkRole(['admin', 'scheduler']), (req, res) => {
    if (req.body.term) {
        globalSettings.currentTerm = req.body.term;
    }
    res.send("<script>alert('✅ ตั้งค่าภาคเรียนปัจจุบันสำเร็จ'); window.location='/admin/manage';</script>");
});

app.post('/admin/add-term', checkRole(['admin', 'scheduler']), async (req, res) => {
    try {
        const { newTerm } = req.body;
        if (newTerm) {
            await Term.findOrCreate({ where: { term_name: newTerm.trim() } });
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

// ---------------------------------------------------------------------------
// นำเข้าข้อมูลรายวิชาจาก Excel
// ---------------------------------------------------------------------------
app.post('/admin/import-subjects', checkRole(['admin', 'scheduler', 'program_manager']), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('❌ กรุณาเลือกไฟล์ Excel');

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) return res.send("<script>alert('❌ ไฟล์ไม่มีข้อมูล'); history.back();</script>");

        const importPromises = jsonData.map(item => {
            const code = (item['รหัสวิชา'] || item['subject_code'])?.toString().trim();
            if (!code) return null;

            return Subject.upsert({
                subject_code: code,
                name_th: (item['ชื่อวิชา (ภาษาไทย)'] || item['ชื่อวิชา'] || item['name_th'] || 'ไม่ระบุชื่อวิชา').toString().trim(),
                theory_hrs: parseInt(item['ทฤษฎี'] || item['ทฤษฎี (ชม.)'] || item['theory_hrs'] || 0),
                practice_hrs: parseInt(item['ปฏิบัติ'] || item['ปฏิบัติ (ชม.)'] || item['practice_hrs'] || 0),
                credits: parseInt(item['หน่วยกิต'] || item['credits'] || 0)
            });
        });

        await Promise.all(importPromises.filter(p => p !== null));
        res.send("<script>alert('✅ นำเข้าข้อมูลวิชาเรียบร้อยแล้ว'); window.location='/admin/manage';</script>");
    } catch (err) {
        console.error("Import Error:", err);
        res.status(500).send("❌ เกิดข้อผิดพลาดในการนำเข้า: " + err.message);
    }
});

// ---------------------------------------------------------------------------
// ส่งออกข้อมูลรายวิชาเป็น Excel
// ---------------------------------------------------------------------------
app.get('/admin/export-excel', checkRole(['admin', 'scheduler', 'program_manager']), async (req, res) => {
    try {
        const subjects = await Subject.findAll({ order: [['subject_code', 'ASC']] });
        if (!subjects || subjects.length === 0) {
            return res.send("<script>alert('❌ ไม่พบข้อมูลรายวิชาในระบบ'); window.location='/admin/manage';</script>");
        }

        const data = subjects.map(s => ({
            'รหัสวิชา': s.subject_code,
            'ชื่อวิชา (ภาษาไทย)': s.name_th,
            'ทฤษฎี (ชม.)': s.theory_hrs || 0,
            'ปฏิบัติ (ชม.)': s.practice_hrs || 0,
            'หน่วยกิต': s.credits || 0
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "รายวิชาทั้งหมด");
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Disposition', 'attachment; filename=subjects_list.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) { res.status(500).send("❌ Export Error: " + err.message); }
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
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });

        res.render('schedule', { 
            scheduleData, groupId, role: req.session.role, 
            canEdit: ['admin', 'scheduler'].includes(req.session.role),
            currentTerm: term, latestTerm: globalSettings.currentTerm,
            allTerms: allTermsFromDB,
            subjects: await Subject.findAll(),
            teachers: await User.findAll({ where: { role: 'teacher' } }),
            rooms: await Room.findAll()
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
    // รับค่า term จาก query string เพื่อใช้ redirect กลับไปหน้าเดิม
    const item = await Schedule.findByPk(req.params.id);
    const term = req.query.term || (item ? item.term : globalSettings.currentTerm);
    
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

app.get('/admin/delete-user/:id', checkRole(['admin']), async (req, res) => {
    try {
        if (req.params.id == req.session.userId) {
            return res.send("<script>alert('❌ ไม่สามารถลบตัวเองได้'); history.back();</script>");
        }
        await User.destroy({ where: { id: req.params.id } });
        res.send("<script>alert('✅ ลบผู้ใช้งานเรียบร้อยแล้ว'); window.location='/admin/users';</script>");
    } catch (err) { res.status(500).send(err.message); }
});

// --- 6. View Schedules (Teacher/Room/Group) ---
app.get('/teacher/schedule', checkRole(['admin', 'teacher', 'scheduler']), async (req, res) => {
    try {
        const teacherId = (req.session.role === 'teacher' && !req.query.teacherId) ? req.session.userId : req.query.teacherId;
        const term = req.query.term || globalSettings.currentTerm;
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        if (!teacherId) {
            const teachers = await User.findAll({ where: { role: 'teacher' } });
            return res.render('teacher_select', { teachers, role: req.session.role, allTerms: termList, currentTerm: term });
        }
        const scheduleData = await Schedule.findAll({
            where: { teacherId, term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });
        const teacherInfo = await User.findByPk(teacherId);

        res.render('schedule', { 
            scheduleData, 
            groupId: `อาจารย์ ${teacherInfo.fullname.split(' ')[0]}`, 
            role: req.session.role, 
            currentTerm: term,
            allTerms: allTermsFromDB,
            subjects: [], teachers: [], rooms: [] 
        });
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/room/schedule', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { roomId } = req.query;
        const term = req.query.term || globalSettings.currentTerm;
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });
        const termList = allTermsFromDB.map(t => t.term_name);

        if (!roomId) {
            const rooms = await Room.findAll();
            const groups = await Group.findAll({ order: [['group_id', 'ASC']] }); 
            return res.render('room_select', { 
                rooms, 
                groups, 
                role: req.session.role, 
                allTerms: termList, 
                currentTerm: term 
            });
        }

        const scheduleData = await Schedule.findAll({
            where: { RoomId: roomId, term: term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        res.render('schedule', { 
            scheduleData, 
            groupId: `ห้องเรียน ${roomId}`, 
            role: req.session.role, 
            currentTerm: term,
            allTerms: allTermsFromDB,
            subjects: [], teachers: [], rooms: [] 
        });

    } catch (err) { 
        console.error(err);
        res.status(500).send("เกิดข้อผิดพลาด: " + err.message); 
    }
});

app.get('/group/schedule/:groupId', checkRole(['admin', 'scheduler', 'teacher', 'student']), async (req, res) => {
    try {
        const { groupId } = req.params;
        const term = req.query.term || globalSettings.currentTerm;
        const allTermsFromDB = await Term.findAll({ order: [['term_name', 'DESC']] });

        const scheduleData = await Schedule.findAll({
            where: { studentGroupId: groupId, term: term },
            include: [{ model: Subject }, { model: User, as: 'Teacher' }, { model: Room }]
        });

        res.render('schedule', { 
            scheduleData, 
            groupId, 
            role: req.session.role, 
            currentTerm: term,
            allTerms: allTermsFromDB,
            subjects: [], teachers: [], rooms: [] 
        });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 7. Server Start ---
sequelize.sync({ force: false }).then(async () => {
    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('1234', 10);
        await User.create({
            username: 'admin', password: hashedPassword,
            fullname: 'ผู้ดูแลระบบ', role: 'admin'
        });
        console.log('✅ Created initial admin user: admin / 1234');
    }

    const termCount = await Term.count();
    if (termCount === 0) {
        await Term.bulkCreate([{ term_name: '1/2568' }, { term_name: '2/2568' }]);
        console.log('✅ Created initial terms: 1/2568, 2/2568');
    }

    app.listen(3000, () => console.log('🚀 ระบบพร้อมใช้งานที่พอร์ต 3000'));
}).catch(err => {
    console.error('❌ Database Sync Error:', err);
});