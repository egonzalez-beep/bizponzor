const multer = require('multer');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

const avatarMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Solo se permiten JPEG, PNG o WebP'));
  }
});

module.exports = { avatarMulter };
