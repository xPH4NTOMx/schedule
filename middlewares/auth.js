// ตรวจสอบว่า Login หรือยัง
const isLogin = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// ตรวจสอบระดับ User
const permit = (...allowedRoles) => {
    return (req, res, next) => {
        const { role } = req.session;
        if (req.session.userId && allowedRoles.includes(role)) {
            next(); // มีสิทธิ์ เข้าไปได้
        } else {
            res.status(403).send('คุณไม่มีสิทธิ์เข้าถึงหน้านี้'); // ไม่มีสิทธิ์
        }
    }
}

module.exports = { isLogin, permit };