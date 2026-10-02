import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import productRoutes from './productRoutes.js';
import customerRoutes from './customerRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import authRoutes from './authRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import userRoutes from './userRoutes.js';
import cashRoutes from './cashRoutes.js';
import { authenticate } from '../auth.js';

const router = Router();

router.use('/api', healthRoutes);
router.use('/api', authRoutes);
router.use('/api', authenticate);
router.use('/api', productRoutes);
router.use('/api', customerRoutes);
router.use('/api', serviceRoutes);
router.use('/api', transactionRoutes);
router.use('/api', settingsRoutes);
router.use('/api', notificationRoutes);
router.use('/api', userRoutes);
router.use('/api', cashRoutes);

export default router;