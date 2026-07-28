import express from 'express';
import { handleAgentChat } from '../controllers/aiAgentController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { validate, agentChatSchema } from '../middleware/validators.js';

const router = express.Router();

// POST /api/agent/chat - Protected by authMiddleware + validated
router.post('/chat', authMiddleware, validate(agentChatSchema), handleAgentChat);

export default router;
