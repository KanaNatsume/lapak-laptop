import { Router } from 'express';
import * as userController from '../controllers/userController.js';
import { authorize } from '../auth.js';

const router = Router();

router.get('/users', authorize('admin'), userController.listUsers);
router.get('/users/:id', authorize('admin'), userController.getUser);
router.post('/users', authorize('admin'), userController.createUser);
router.put('/users/:id', authorize('admin'), userController.updateUser);
router.put('/users/:id/password', authorize('admin'), userController.resetUserPassword);
router.delete('/users/:id', authorize('admin'), userController.deleteUser);
router.patch('/users/:id/toggle-status', authorize('admin'), userController.toggleUserStatus);

export default router;
