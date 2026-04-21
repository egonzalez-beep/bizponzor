
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

async function totalStarsForCreator(creatorId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as n FROM stars s
       INNER JOIN content c ON c.id = s.content_id
       WHERE c.creator_id = ?`
    )
    .get(creatorId);
  return row ? Number(row.n) : 0;
}

async function countPhotosVideos(creatorId) {
  const photos = await db
    .prepare("SELECT COUNT(*) as n FROM content WHERE creator_id=? AND type='photo'")
    .get(creatorId);
  const videos = await db
    .prepare("SELECT COUNT(*) as n FROM content WHERE creator_id=? AND type='video'")
    .get(creatorId);
  return { count_photos: photos ? Number(photos.n) : 0, count_videos: videos ? Number(videos.n) : 0 };
}

// Listar creadores
router.get('/', async (req, res) => {
  const creators = await db
    .prepare(
      "SELECT u.id, u.name, u.handle, u.bio, u.category, u.location, u.avatar_url, u.banner_url, u.avatar_color, u.updated_at, COUNT(DISTINCT s.id) as subscribers FROM users u LEFT JOIN subscriptions s ON u.id=s.creator_id AND s.status='active' WHERE u.role='creator' AND COALESCE(u.is_public, TRUE) = TRUE GROUP BY u.id ORDER BY subscribers DESC"
    )
    .all();
  res.json(creators);
});

// Perfil del creador autenticado
router.get('/me', auth, async (req, res) => {
  const creator = await db
    .prepare(
      `SELECT id, name, handle, bio, category, location, avatar_url, banner_url, avatar_color,
              social_instagram, social_facebook, social_tiktok, social_other, updated_at
       FROM users WHERE id=? AND role='creator'`
    )
    .get(req.user.id);
  if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });
  const subs = await db
    .prepare("SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'")
    .get(creator.id);
  const contentCount = await db.prepare("SELECT COUNT(*) as count FROM content WHERE creator_id=?").get(creator.id);
  const pv = await countPhotosVideos(creator.id);
  const stars = await totalStarsForCreator(creator.id);
  res.json({
    ...creator,
    subscribers: Number(subs.count),
    content_count: Number(contentCount.count),
    count_photos: pv.count_photos,
    count_videos: pv.count_videos,
    total_stars: stars,
    total_likes: stars
  });
});

router.patch('/visibility', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { is_public } = req.body;

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId);

    if (!user || user.role !== 'creator') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    await db.prepare('UPDATE users SET is_public = ? WHERE id = ?').run(is_public, userId);

    res.json({ success: true, is_public });
  } catch (error) {
    console.error('Error updating visibility:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Perfil de un creador
router.get('/:handle', async (req, res) => {
  const creator = await db
    .prepare(
      "SELECT id, name, handle, bio, category, location, avatar_url, banner_url, avatar_color, social_instagram, social_facebook, social_tiktok, social_other, updated_at FROM users WHERE handle=? AND role='creator'"
    )
    .get(req.params.handle);
  if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });
  const subs = await db
    .prepare("SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'")
    .get(creator.id);
  const contentCount = await db.prepare("SELECT COUNT(*) as count FROM content WHERE creator_id=?").get(creator.id);
  const pv = await countPhotosVideos(creator.id);
  const stars = await totalStarsForCreator(creator.id);
  res.json({
    ...creator,
    subscribers: Number(subs.count),
    content_count: Number(contentCount.count),
    count_photos: pv.count_photos,
    count_videos: pv.count_videos,
    total_stars: stars,
    total_likes: stars
  });
});

module.exports = router;
