/**
 * Route table.
 *
 * Refactoring applied: Extract Class. Routing is now declarative wiring only;
 * handlers live in controllers and rules live in services. asyncHandler removes
 * the try/catch that was copy-pasted into every v1 handler.
 */
import { Router } from 'express';

import * as authController from '../controllers/authController.js';
import * as logController from '../controllers/logController.js';
import * as wearableController from '../controllers/wearableController.js';
import * as riskController from '../controllers/riskController.js';
import * as userController from '../controllers/userController.js';
import authenticate, { authenticateOrRedirect } from '../middleware/authenticate.js';
import asyncHandler from '../middleware/asyncHandler.js';

const router = Router();

// --- Authentication ---
router.post('/auth/register', asyncHandler(authController.register));
router.post('/auth/login', authController.login);
router.post('/auth/logout', authController.logout);
router.get('/auth/me', authenticate, authController.me);

// Google Identity Services. Non-sensitive scopes (openid, email, profile), so
// this needs no OAuth review and works for every user.
router.post('/auth/google', asyncHandler(authController.google));

// Google Health API consent. Separate from sign-in on purpose: these scopes are
// Restricted, so until the app passes OAuth verification only accounts added as
// test users in the Google Cloud console can complete this flow.
// authenticateOrRedirect, not authenticate: these two are browser navigations,
// so an unauthenticated hit belongs on the sign-in screen, not in a JSON 401.
router.get('/auth/google/health', authenticateOrRedirect,
  asyncHandler(wearableController.googleHealthStart));
router.get('/auth/google/health/callback', authenticateOrRedirect,
  asyncHandler(wearableController.googleHealthCallback));

// --- Profile and wearable data ---
router.get('/api/user/status', authenticate, asyncHandler(userController.getStatus));
router.post('/api/user/profile', authenticate, asyncHandler(userController.saveProfile));
router.post('/api/user/weight', authenticate, asyncHandler(userController.updateWeight));
router.get('/api/user/wearable', authenticate, asyncHandler(userController.getWearableData));
router.post('/api/user/wearable', authenticate, asyncHandler(userController.recordWearableData));

// Food search is authenticated; v1 left it open.
router.get('/api/food/search', authenticate, asyncHandler(userController.searchFood));

// --- Logging: meals, vitals, activity ---
router.post('/api/logs/meals', authenticate, asyncHandler(logController.logMeal));
router.get('/api/logs/meals', authenticate, asyncHandler(logController.listMeals));
router.delete('/api/logs/meals/:id', authenticate, asyncHandler(logController.deleteMeal));
router.get('/api/logs/macros/daily', authenticate, asyncHandler(logController.dailyMacros));
router.get('/api/logs/macros/trend', authenticate, asyncHandler(logController.macroTrend));

router.post('/api/logs/vitals', authenticate, asyncHandler(logController.logVitals));
router.get('/api/logs/vitals', authenticate, asyncHandler(logController.listVitals));

router.post('/api/logs/activity', authenticate, asyncHandler(logController.logActivity));

// --- Wearable import and demo seeding ---
// Import is the primary wearable path: every consumer API a solo developer
// could register for has closed. See services/wearableImportService.js.
router.get('/api/wearable/formats', wearableController.importFormats);
router.post('/api/wearable/import', authenticate, asyncHandler(wearableController.importWearableData));
router.post('/api/wearable/demo', authenticate, asyncHandler(wearableController.loadDemoData));

router.get('/api/wearable/google-health', authenticate,
  asyncHandler(wearableController.googleHealthStatus));
router.post('/api/wearable/google-health/sync', authenticate,
  asyncHandler(wearableController.googleHealthSync));
router.delete('/api/wearable/google-health', authenticate,
  asyncHandler(wearableController.googleHealthDisconnect));

// --- Conversational assistant ---
// Server-side proxy: the Gemini key must never reach the browser, which is
// exactly what v1 did by inlining VITE_GEMINI_API_KEY into the bundle.
router.post('/api/chat', authenticate, asyncHandler(logController.chat));

// --- Risk assessment ---
router.post('/api/predict', authenticate, asyncHandler(riskController.assess));
router.post('/api/recommend', authenticate, asyncHandler(riskController.recommend));
router.get('/api/inference/health', asyncHandler(riskController.inferenceHealth));

export default router;
