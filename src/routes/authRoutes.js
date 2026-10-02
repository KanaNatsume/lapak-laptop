import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, changePassword, login, logout, me } from '../auth.js';

const router = Router();
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

router.post('/auth/login', loginLimiter, login);
router.get('/auth/me', authenticate, me);
router.put('/auth/password', authenticate, changePassword);
router.post('/auth/logout', authenticate, logout);
export default router;
