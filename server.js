const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');
const bodyParser = require('body-parser');
const ConnectDB = require('./util/db');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const multer = require('multer');
const fs=require('fs');
const imagesDir=path.join(__dirname,'images');
const contentDir=path.join(__dirname,'content');
if(!fs.existsSync(imagesDir)){
    fs.mkdirSync(imagesDir,{recursive:true});
}
if(!fs.existsSync(contentDir)){
    fs.mkdirSync(contentDir,{recursive:true});
}
const cookieparser = require('cookie-parser');
app.use(cookieparser());
const fileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, imagesDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg') {
        cb(null, true);
    }
    else {
        cb(null, false);
    }
};
app.use(multer({ storage: fileStorage, fileFilter: fileFilter }).single('image'));
app.use('/images', express.static(imagesDir));
app.use('/content', express.static(contentDir));
const session = require('express-session');
const ConnectMongo = require('connect-mongo');
const MongoStore = ConnectMongo.default || ConnectMongo.MongoStore || ConnectMongo;
if (process.env.NODE_ENV === 'production') {

    app.set('trust proxy', 1);
}
app.use(session({
    secret: process.env.SECRET_KEY,
    saveUninitialized: false,
    resave: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 600
    }),
    cookie: {
        maxAge: 600000,
        httpOnly: true,
        sameSite: 'strict',
        secure: false
    }

}))
app.set('view engine', 'ejs');
app.set('views', 'views');
app.get('/health', (req, res) => res.status(200).send('OK'));
const adminRoutes = require('./routes/admin');
const { postToLinkedin } = require('./scheduler/cron');
app.use(adminRoutes);
const PORT = process.env.PORT || 3000;
ConnectDB
    .then(() => {
        console.log('Connection Successfully Established to the DataBase');
        setInterval(() => {
            postToLinkedin();
        }, 60000);

        require('./scheduler/emailScanner');
        require('./scheduler/replyProcessor');

        server.listen(PORT, () => {
            console.log(`Application running ats Port ${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Database connection failed:', error.message);
        process.exit(1);
    });