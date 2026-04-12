
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

function totalLikesForCreator(creatorId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM content_likes cl
       INNER JOIN content c ON c.id = cl.content_id
       WHERE c.creator_id = ?`
    )
    .get(creatorId);
  return row ? row.n : 0;
}

function countPhotosVideos(creatorId) {
  const photos = db
    .prepare("SELECT COUNT(*) as n FROM content WHERE creator_id=? AND type='photo'")
    .get(creatorId);
  const videos = db
    .prepare("SELECT COUNT(*) as n FROM content WHERE creator_id=? AND type='video'")
    .get(creatorId);
  return { count_photos: photos ? photos.n : 0, count_videos: videos ? videos.n : 0 };
}

// Listar creadores
router.get('/', (req, res) => {
  const creators = db.prepare("SELECT u.id, u.name, u.handle, u.bio, u.category, u.location, u.avatar_url, u.banner_url, u.avatar_color, COUNT(DISTINCT s.id) as subscribers FROM users u LEFT JOIN subscriptions s ON u.id=s.creator_id AND s.status='active' WHERE u.role='creator' GROUP BY u.id ORDER BY subscribers DESC").all();
  res.json(creators);
});

// Perfil del creador autenticado
router.get('/me', auth, (req, res) => {
  const creator = db
    .prepare(
      `SELECT id, name, handle, bio, category, location, avatar_url, banner_url, avatar_color,
              social_instagram, social_facebook, social_tiktok, social_other
       FROM users WHERE id=? AND role='creator'`
    )
    .get(req.user.id);
  if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });
  const subs = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'").get(creator.id);
  const contentCount = db.prepare("SELECT COUNT(*) as count FROM content WHERE creator_id=?").get(creator.id);
  const pv = countPhotosVideos(creator.id);
  const stars = totalLikesForCreator(creator.id);
  res.json({
    ...creator,
    subscribers: subs.count,
    content_count: contentCount.count,
    count_photos: pv.count_photos,
    count_videos: pv.count_videos,
    total_stars: stars,
    total_likes: stars
  });
});

// Perfil de un creador
router.get('/:handle', (req, res) => {
  const creator = db
    .prepare(
      "SELECT id, name, handle, bio, category, location, avatar_url, banner_url, avatar_color, social_instagram, social_facebook, social_tiktok, social_other FROM users WHERE handle=? AND role='creator'"
    )
    .get(req.params.handle);
  if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });
  const subs = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'").get(creator.id);
  const contentCount = db.prepare("SELECT COUNT(*) as count FROM content WHERE creator_id=?").get(creator.id);
  const pv = countPhotosVideos(creator.id);
  const stars = totalLikesForCreator(creator.id);
  res.json({
    ...creator,
    subscribers: subs.count,
    content_count: contentCount.count,
    count_photos: pv.count_photos,
    count_videos: pv.count_videos,
    total_stars: stars,
    total_likes: stars
  });
});

module.exports = router;
