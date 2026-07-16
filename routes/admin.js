const express = require('express');
const mongoose = require('mongoose');
const adminController = require('../controllers/admin');
const router = express.Router();
router.get('/', adminController.getLocal);
router.get('/HomePage', adminController.getHomepage);
router.get('/admin/welcome', adminController.getwelcomeAdmin);
router.get('/admin/signup', adminController.getAdminSignup);
router.get('/admin/signin', adminController.getAdminSignin);
router.post('/admin/signup', adminController.postAdminSignup);
router.post('/admin/signin', adminController.postAdminSingin);
router.get('/admin/verify/otp', adminController.getverifyotp);
router.post('/admin/verify/otp', adminController.postverifyotp);
router.get('/admin/profileCreation', adminController.getprofileCreation);
router.post('/admin/profileCreation', adminController.postprofileCreation);
router.get('/admin/google/connect', adminController.verifyJwt, adminController.isAuthenticated, adminController.getGoogleConnect);
router.get('/admin/google/callback',adminController.getGoogleCallback);
router.get('/admin/:username', adminController.verifyJwt, adminController.isAuthenticated, adminController.getAdminDashboard);
router.post('/admin/linkedin', adminController.verifyJwt, adminController.isAuthenticated, adminController.postlinkedin);
router.post('/admin/:username', adminController.verifyJwt, adminController.isAuthenticated, adminController.postAdminDashboard);
module.exports = router;


