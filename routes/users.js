const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const { avatarMulter } = require('../lib/avatarUpload');
const { handleAvatarUpload } = require('../lib/handleAvatarUpload');

router.patch('/avatar', authMiddleware, (req, res, next) => {
  avatarMulter.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera 2 MB' });
      return res.status(400).json({ error: String(err.message || 'Archivo inválido') });
    }
    Promise.resolve(handleAvatarUpload(req, res)).catch(next);
  });
});

module.exports = router;
