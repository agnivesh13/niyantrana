/**
 * Route table.
 *
 * Declarative wiring only: handlers live in controllers, rules live in
 * services, and this file says which URL reaches which. asyncHandler forwards
 * rejected promises to the error middleware so no handler needs a try/catch.
 */
import express, { Router } from 'express';

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
// Irreversible, and the only route that removes data the user did not replace.
router.delete('/api/user/account', authenticate, asyncHandler(userController.deleteAccount));
router.post('/api/user/wearable', authenticate, asyncHandler(userController.recordWearableData));

// Authenticated: the food database is a licensed dataset, not a public API.
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

// A larger body limit than the global 4mb, and only here: a Samsung export's
// heart-rate CSV alone is 10 MB before the client trims it to the requested
// window. Raising the global limit to suit one route would widen the surface
// every other endpoint presents.
router.post('/api/wearable/import/samsung', authenticate,
  express.json({ limit: '16mb' }),
  asyncHandler(wearableController.importSamsungHealth));

router.get('/api/wearable/google-health', authenticate,
  asyncHandler(wearableController.googleHealthStatus));
router.post('/api/wearable/google-health/sync', authenticate,
  asyncHandler(wearableController.googleHealthSync));
router.delete('/api/wearable/google-health', authenticate,
  asyncHandler(wearableController.googleHealthDisconnect));

// --- Conversational assistant ---
// Server-side proxy, so the Gemini key stays out of the browser bundle.
router.post('/api/chat', authenticate, asyncHandler(logController.chat));

// --- Risk assessment ---
router.post('/api/predict', authenticate, asyncHandler(riskController.assess));
router.post('/api/recommend', authenticate, asyncHandler(riskController.recommend));
router.get('/api/inference/health', asyncHandler(riskController.inferenceHealth));

export default router;
