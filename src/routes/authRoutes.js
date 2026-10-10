import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isIP } from 'node:net';
import { authenticate, changePassword, login, logout, me } from '../auth.js';

const router = Router();
const trustCloudflareIpHeader = process.env.TRUST_CLOUDFLARE_IP_HEADER === 'true';
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	keyGenerator: (request) => {
		const cloudflareIp = trustCloudflareIpHeader ? request.get('cf-connecting-ip')?.trim() : null;
		const clientIp = cloudflareIp && isIP(cloudflareIp) ? cloudflareIp : request.ip;
		return ipKeyGenerator(clientIp || request.socket.remoteAddress || 'unknown');
	},
	message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

router.post('/auth/login', loginLimiter, login);
router.get('/auth/me', authenticate, me);
router.put('/auth/password', authenticate, changePassword);
router.post('/auth/logout', authenticate, logout);
export default router;
