/* eslint-disable no-unused-vars */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const adminData = require('../models/adminmodel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Redis = require('ioredis');
const crypto = require('crypto');
const { parsePhoneNumber } = require('libphonenumber-js');
const { chromium, firefox, webkit } = require('playwright');
const { google } = require('googleapis');
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const linkedinUser = require('../models/linkedinauth');
const contentModel = require('../models/contentmodel');
const AdminGoogleAuth = require('../models/AdminGoogleAuth');
const { createOAuth2Client, CALLBACK_URL } = require('../config/google');

redis.on('error', (err) => {
    console.log(err);
})
const twilio = require('twilio');
const { types } = require('util');
const { triggerAsyncId } = require('async_hooks');
const accountSid = process.env.TWILIO_ID;
const authtoken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authtoken);
const transporter = nodemailer.createTransport(({
    host: 'smtp.sendgrid.net',
    port: 587,
    auth: {
        user: 'apikey',
        pass: process.env.SG_KEY
    }
}))
exports.getLocal = (req, res, next) => {
    return res.redirect('/HomePage');
}
exports.getHomepage = (req, res, next) => {
    res.render('Homepage', {
        pageTitle: 'Homepage'
    })
}
exports.getwelcomeAdmin = (req, res, next) => {
    res.render('adminHome', {
        pageTitle: "AdminHome"
    })
}
exports.getAdminSignup = (req, res, next) => {
    res.render('adminSignup', {
        pageTitle: "AdminSignup"
    })
}
exports.postAdminSignup = async (req, res, next) => {
    const { name, email, phonenumber, otpMethod } = req.body;
    if (!req.body.name || !req.body.email || !req.body.phonenumber || !req.body.otpMethod) {
        return res.redirect('/admin/signup');
    }
    const otp = Math.floor(100000 + Math.random() * 900000);
    const token = crypto.randomUUID();
    const hashedOtp = await bcrypt.hash(String(otp), 12);
    req.session.token = token;
    try {
        await redis.hset(req.session.token, {
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phonenumber,
            savedOtp: hashedOtp,
            attemptsleft: 3,
            timeStamp: Date.now(),
        })
        await redis.expire(req.session.token, 600);
        console.log(`Packet stored to redis`);
    }
    catch (error) {
        console.log(error);
    }
    console.log(`Data packet recieved ${req.body.name},${req.body.phonenumber}`);

    console.log(typeof (req.body.phonenumber));
    if (req.body.otpMethod === "Email") {
        console.log(`Choosen service is email`);
        try {
            const verificationemail = await transporter.sendMail({
                to: req.body.email,
                from: 'aravlead@gmail.com',
                subject: 'HireFlow -OTP Verification',
                html: `<h1>${otp}!</h1>`
            })
            if (verificationemail) {
                console.log(`mail sent ${verificationemail}`);
                return res.redirect('/admin/verify/otp');
            }
            else if (!verificationemail) {
                return res.redirect('/admin/signup');
            }
        }
        catch (error) {
            return res.redirect('/admin/signup');
        }
    }

    else if (req.body.otpMethod === "SMS") {
        console.log(`choosen service is SMS`);
        try {
            const verificationsms = await client.messages.create({
                body: `${otp} is your verification code for Mobile no ${req.body.phonenumber}`,
                from: process.env.TWILIO_PHONE_NO,
                to: `+91${req.body.phonenumber}`
            })
            if (verificationsms) {
                console.log(`Sent verification sms on the phone no ${req.body.phonenumber}`);
                return res.status(200).redirect('/admin/verify/otp');
            }
            else if (!verificationsms) {
                return res.status(404).json({
                    message: 'Resource not found'
                })
            }
        }
        catch (error) {
            console.error(error);
            return res.redirect('/admin/signup');
        }
    }
}
exports.getAdminSignin = (req, res, next) => {
    res.render('adminSignin', {
        pageTitle: "AdminSignin"
    })
}
exports.postAdminSingin = async (req, res, next) => {
    const name = req.body.adminName;
    const email = req.body.adminEmail;
    const password = req.body.adminPassword;
    const user = await adminData.findOne({ adminName: name });
    if (!user) {
        return res.redirect('/admin/signin');
    }
    else if (user) {
        if (user.adminName !== name || user.email !== email) {
            console.log('Wrong name or email id');
            return res.redirect('/admin/signin');
        }
        const pass = await bcrypt.compare(password, user.password);
        if (!pass) {
            console.log('Wrong password,pls retry again');
            return res.redirect('/admin/signin');
        }
        else if (pass) {
            console.log('user found ', user);
            console.log(`Session created${req.session.id}`);
            req.session.regenerate(async (err) => {
                if (err) {
                    return next(err);
                }
                try {
                    req.session.isLoggedIn = true;
                    req.session.admin = user;
                    req.session.adminEmail = user.email;
                    req.session.adminName = user.adminName;
                    req.session.photo = user.image;
                    req.session.number = user.phone;
                    const payload = {
                        adminId: user._id,
                        admin: req.session.adminName,
                        role: "admin"
                    }
                    const secretKey = process.env.JWT_ADMIN_SECRET;
                    const expiresIn = process.env.JWT_EXPIRES_IN;
                    const token = jwt.sign(payload, secretKey, { expiresIn });
                    res.cookie('admin_jwt', token, {
                        httpOnly: true,
                        secure: false,
                        sameSite: 'strict',
                        maxAge: 3600000,
                        path: '/'
                    })
                    console.log("User is Logged in" + req.session.admin);
                    return res.redirect(`/admin/${req.session.adminName}`);
                }
                catch (error) {
                    console.error(error);
                    return res.redirect('/admin/signin');
                }
            })
        }
    }
}
exports.getverifyotp = (req, res, next) => {
    res.render('verifyOtp', {
        pageTitle: 'Admin Creation otp'
    })
}
exports.postverifyotp = async (req, res, next) => {
    const userotp = req.body.otp;
    if (!req.session.token) {
        return res.redirect('/admin/signup');
    }
    const savedOtp=await redis.hget(req.session.token,"savedOtp");
    if (!savedOtp) {
        return res.redirect('/admin/signup');
    }
    const samePswd = await bcrypt.compare(userotp, savedOtp);
    const tkn = req.session.token;
    req.session.savedName = await redis.hget(req.session.token, "name");
    req.session.savedEmail = await redis.hget(req.session.token, "email");
    req.session.savedPhone = await redis.hget(req.session.token, "phone");
    if (samePswd) {
        await redis.del(tkn);
        return res.redirect('/admin/profileCreation');
    }
    if (!samePswd) {
        await redis.hincrby(tkn, "attemptsleft", -1);
        const Attempts = await redis.hget(req.session.token, "attemptsleft");
        if (parseInt(Attempts) > 0) {
            return res.redirect('/admin/verify/otp');
        }
        if (parseInt(Attempts) <= 0) {
            await redis.del(tkn);
            return res.status(403).json({
                message: 'Forbidden'
            })
        }
    }
}
exports.getprofileCreation = (req, res, next) => {
    res.render('AdminProfile', {
        pageTitle: "AdminProfile",
        username: req.session.savedName,
        email: req.session.savedEmail,
        phone: req.session.savedPhone
    })
}
exports.postprofileCreation = async (req, res, next) => {
    const image = req.file;
    const password = req.body.password;
    const duplicateName = await adminData.findOne({ adminName: req.session.savedName });
    const duplicateEmail = await adminData.findOne({ email: req.session.savedEmail });
    const Dupphoneno = await adminData.findOne({ phone: req.session.savedPhone });
    if (!image) {
        return res.status(404).json({
            message: 'Photo required'
        })
    }
    if (duplicateName || duplicateEmail || Dupphoneno) {
        return res.redirect('/admin/signin');
    }
    const securepassword = await bcrypt.hash(password, 12);
    console.log(typeof (req.session.savedPhone));
    try {
        const newAdmin = await adminData.create({
            adminName: req.session.savedName,
            password: securepassword,
            email: req.session.savedEmail,
            phone: req.session.savedPhone,
            image: '/images/' + image.filename,
        })
        if (newAdmin) {
            console.log(`New Admin created ${newAdmin}`);
            return res.redirect('/admin/signin');
        }
        else {
            return res.redirect('/admin/profileCreation')
        }
    }
    catch (error) {
        return res.status(404).json({
            message: 'Couldnt save to db'
        })
    }
}
exports.verifyJwt = async (req, res, next) => {
    const token = req.cookies.admin_jwt;
    if (!token) {
        return res.redirect('/admin/signin');
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
        if (decoded.role === "admin") {
            req.session.username = decoded.admin
            req.session.adminId = decoded.adminId
            req.session.role = decoded.role
            req.session.isLoggedIn = true
            return next();
        }

        else {
            return res.redirect('/admin/signin');
        }
    }
    catch (error) {
        return res.status(404).json({
            message: "Page not found"
        })
    }
}
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.isLoggedIn && req.session.role === "admin") {
        return next();
    }
    else {
        return res.redirect('/admin/signin')
    }
}
async function getCombinedDashboardData(adminId) {
    const mongoAdminId = new mongoose.Types.ObjectId(adminId);
    const empty = {
        stats: {
            postsScheduled: 0,
            postsDue: 0,
            resumesReceived: 0,
            responsesSent: 0,
            meetingsBooked: 0,
            needsReview: 0,
            rejected: 0,
            processedEmails: 0
        },
        linkedin: { connected: false, pageName: '' },
        recruiteros: {
            connected: false,
            gmailConnected: false,
            gmailEmail: '',
            bookingConfigured: Boolean(process.env.BOOKING_LINK),
            scannerCadence: 'Every 2 min'
        },
        candidates: [],
        activity: []
    };

    try {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const contentDoc = await contentModel.findOne({ adminId }).lean();
        const linkedinDoc = await linkedinUser.findOne({ adminId }).lean();
        const googleAuthDoc = await AdminGoogleAuth.findOne({ adminId: mongoAdminId }).lean();
        const scheduled = Array.isArray(contentDoc?.contentSchedule) ? contentDoc.contentSchedule : [];

        const candidatesCol = mongoose.connection.collection('candidates');
        const filter = { adminId: mongoAdminId };

        const [
            totalCandidates,
            screeningSent,
            needsReview,
            bookingSent,
            rejected,
            processedCount,
            processedToday,
            recentCandidates
        ] = await Promise.all([
            candidatesCol.countDocuments(filter).catch(() => 0),
            candidatesCol.countDocuments({ ...filter, stage: 'SCREENING_SENT' }).catch(() => 0),
            candidatesCol.countDocuments({ ...filter, stage: 'NEEDS_REVIEW' }).catch(() => 0),
            candidatesCol.countDocuments({ ...filter, stage: 'BOOKING_SENT' }).catch(() => 0),
            candidatesCol.countDocuments({ ...filter, stage: 'REJECTED' }).catch(() => 0),
            mongoose.connection.collection('processedemails').countDocuments({}).catch(() => 0),
            mongoose.connection.collection('processedemails').countDocuments({ processedAt: { $gte: today } }).catch(() => 0),
            candidatesCol.find(filter)
                .sort({ createdAt: -1 })
                .limit(6)
                .project({ name: 1, email: 1, location: 1, visaStatus: 1, qualified: 1, stage: 1, createdAt: 1 })
                .toArray()
                .catch(() => [])
        ]);

        const activity = recentCandidates.map((candidate) => {
            const label = candidate.name || candidate.email || 'Candidate';
            const stage = candidate.stage || 'RECEIVED';
            const createdAt = candidate.createdAt ? new Date(candidate.createdAt) : null;
            return {
                time: createdAt && !Number.isNaN(createdAt.getTime())
                    ? createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--',
                label,
                verb: stage.replace(/_/g, ' ').toLowerCase(),
                detail: candidate.email || ''
            };
        });

        return {
            stats: {
                postsScheduled: scheduled.length,
                postsDue: scheduled.filter((entry) => new Date(entry?.[1]) <= now).length,
                resumesReceived: totalCandidates,
                responsesSent: screeningSent + bookingSent + rejected + needsReview,
                meetingsBooked: bookingSent,
                needsReview,
                rejected,
                processedEmails: processedCount,
                processedToday
            },
            linkedin: {
                connected: Boolean(linkedinDoc?.AdminSessionInfo),
                pageName: linkedinDoc?.adminName || ''
            },
            recruiteros: {
                connected: Boolean(googleAuthDoc),
                gmailConnected: Boolean(googleAuthDoc),
                gmailEmail: googleAuthDoc?.email || '',
                bookingConfigured: Boolean(process.env.BOOKING_LINK),
                scannerCadence: 'Every 2 min'
            },
            candidates: recentCandidates,
            activity
        };
    } catch (error) {
        console.error('[getCombinedDashboardData] Failed:', error.message);
        return empty;
    }
}

exports.getAdminDashboard = async (req, res, next) => {
    if (!req.session.adminId) {
        return res.redirect('/admin/signin');
    }
    const dashboard = await getCombinedDashboardData(req.session.adminId);
    res.render('adminDashboard', {
        pageTitle: `Admin-${req.session.username}`,
        Admin: req.session.username,
        Id: req.session.adminId,
        Photo: req.session.photo,
        PhoneNumber: req.session.number,
        Email: req.session.adminEmail,
        linkedin: dashboard.linkedin,
        stats: dashboard.stats,
        recruiteros: dashboard.recruiteros,
        candidates: dashboard.candidates,
        activity: dashboard.activity
    })
}

exports.getGoogleConnect = (req, res) => {
    const auth = createOAuth2Client();
    const url = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/userinfo.email'
        ],
        state: String(req.session.adminId)
    });
    res.redirect(url);
};

exports.getGoogleCallback = async (req, res) => {
    const { code, state: adminId } = req.query;
    if (!code || !adminId) return res.status(400).send('Invalid OAuth callback');

    try {
        const auth = createOAuth2Client();
        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth });
        const { data } = await oauth2.userinfo.get();

        await AdminGoogleAuth.findOneAndUpdate(
            { adminId },
            { adminId, email: data.email, tokens },
            { upsert: true, new: true }
        );

        const admin = await require('../models/adminmodel').findById(adminId).lean();
        const username = admin?.adminName || adminId;
        return res.redirect(`/admin/${username}`);
    } catch (err) {
        console.error('[getGoogleCallback] Error:', err.message);
        return res.status(500).send('Google OAuth failed: ' + err.message);
    }
};

exports.postAdminDashboard = async (req, res, next) => {
    const { scheduled_date, scheduled_time, content } = req.body;
    const image = req.file;
    if (!req.body.scheduled_date || !req.body.scheduled_time || !req.body.content || !image) {
        return res.redirect(`/admin/${req.session.username}`);
    }
    console.log(`${req.body.scheduled_date}`);
    console.log(`${req.body.scheduled_time}`);
    console.log(`${req.body.content}`);
    const scheduledAt = new Date(`${req.body.scheduled_date}T${req.body.scheduled_time}`);
    if (scheduledAt <= new Date()) {
        return res.redirect(`/admin/${req.session.username}`);
    }
    const pair = [req.body.content, scheduledAt];

    try {
        await contentModel.findOneAndUpdate(
            {
                adminId: req.session.adminId
            },

            {
                $set: {
                    adminName: req.session.username,
                    image: '/images/' + image.filename
                },

                $push: {
                    contentSchedule: pair
                }
            },
            {
                upsert: true,
                new: true
            }
        )
        return res.redirect(`/admin/${req.session.username}`);
    }
    catch (error) {
        console.error(error);
        return res.redirect(`/admin/${req.session.username}`);
    }
};

exports.postlinkedin = async (req, res, next) => {
    try {
        const browser = await chromium.launch({
            headless: false
        });
        const page = await browser.newPage();
        await page.goto('https://linkedin.com/login');
        await page.waitForURL("https://www.linkedin.com/feed/", {
            timeout: 300000
        });
        const browserData = await page.context().storageState();
        const alreadyExists = await linkedinUser.findOne({ adminId: req.session.adminId });
        if (alreadyExists) {
            try {
                await linkedinUser.findOneAndUpdate(
                    {
                        adminId: req.session.adminId
                    },
                    {
                        adminName: req.session.username,
                        AdminSessionInfo: browserData
                    }
                );
                await browser.close();
                return res.redirect(`/admin/${req.session.username}`);

            } catch (error) {
                console.error(error);
                return res.status(404).json({
                    message: 'Error occured'
                })
            }
        }
        else if (!alreadyExists) {
            try {

                const newAdminInfo = await linkedinUser.create({
                    adminId: req.session.adminId,
                    adminName: req.session.username,
                    AdminSessionInfo: browserData
                })
                if (newAdminInfo) {
                    console.log('Saved to the db!');
                    await browser.close();
                    return res.redirect(`/admin/${req.session.username}`)
                }
                else if (!newAdminInfo) {
                    return res.status(404).json({
                        message: 'We have encountered some error ,sorry we  are trying to fix it'
                    })
                }
            }

            catch (error) {
                console.error(error);
                return res.status(404).json({
                    message: 'Page not found'
                })

            }
        }
    }
    catch (error) {
        console.error(error);
        return res.status(404).json({
            message: 'Resource not captured'
        })
    }
}




