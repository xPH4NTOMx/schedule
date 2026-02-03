const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite',
  logging: false 
});

// 1. Model: ภาคเรียน (เพิ่มใหม่)
const Term = sequelize.define('Term', {
  term_name: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    unique: true, 
    primaryKey: true // ใช้ชื่อเทอมเป็น Key (เช่น "1/2568", "2/2568")
  },
  is_default: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: false 
  }
}, { tableName: 'Terms' });

// 2. Model: ผู้ใช้งาน
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  fullname: { type: DataTypes.STRING },
  role: { 
    type: DataTypes.ENUM('admin', 'curriculum_manager', 'scheduler', 'teacher', 'student'),
    allowNull: false 
  },
  groupId: { type: DataTypes.STRING, allowNull: true }
}, { tableName: 'Users' });

// 3. Model: รายวิชา
const Subject = sequelize.define('Subject', {
  subject_code: { type: DataTypes.STRING, primaryKey: true },
  name_th: { type: DataTypes.STRING },
  theory_hrs: { type: DataTypes.INTEGER },
  practice_hrs: { type: DataTypes.INTEGER },
  credits: { type: DataTypes.INTEGER }
}, { tableName: 'Subjects' });

// 4. Model: ห้องเรียน
const Room = sequelize.define('Room', {
  room_id: { type: DataTypes.STRING, primaryKey: true }
}, { tableName: 'Rooms' });

// 5. Model: กลุ่มเรียน
const Group = sequelize.define('Group', {
  group_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  name_description: { type: DataTypes.STRING, allowNull: true }
}, { tableName: 'Groups' });

// 6. Model: ตารางเรียน
const Schedule = sequelize.define('Schedule', {
  day: { type: DataTypes.ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday') },
  start_slot: { type: DataTypes.INTEGER },
  end_slot: { type: DataTypes.INTEGER },
  studentGroupId: { type: DataTypes.STRING },
  term: { type: DataTypes.STRING, allowNull: false, defaultValue: '2/2568' }
}, { tableName: 'Schedules' });

// --- ตั้งค่าความสัมพันธ์ (Associations) ---

// กลุ่มเรียน กับ ผู้ใช้งาน
Group.hasMany(User, { foreignKey: 'groupId', constraints: false });
User.belongsTo(Group, { foreignKey: 'groupId', constraints: false });

// กลุ่มเรียน กับ ตารางเรียน
Group.hasMany(Schedule, { foreignKey: 'studentGroupId', constraints: false });
Schedule.belongsTo(Group, { foreignKey: 'studentGroupId', constraints: false });

// ตารางเรียน เชื่อมกับ วิชา, ครู, และห้อง
Schedule.belongsTo(Subject, { foreignKey: 'SubjectSubjectCode', constraints: false }); 
Schedule.belongsTo(User, { as: 'Teacher', foreignKey: 'teacherId', constraints: false });
Schedule.belongsTo(Room, { foreignKey: 'RoomId', constraints: false });

// ส่งออก Model ทั้งหมดรวมถึง Term
module.exports = { sequelize, User, Schedule, Subject, Room, Group, Term };