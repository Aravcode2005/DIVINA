const mongoose = require('mongoose');
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const mongooptions = {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2,
    retryWrites: true
}

const ConnectDB = mongoose.connect(process.env.MONGODB_URI, mongooptions);
ConnectDB.then(() => {
    console.log('Connected to the database');
}).catch((error) => {
    console.log('Error Connecting to the DataBase');
})

mongoose.connection.on('disconnected', (error) => {
    console.log(`${error} ,Disconnected from the Db `);

})
mongoose.connection.on('connected', () => {
    console.log(`Connected to the DataBase`);
})

mongoose.connection.on('reconnected', () => {
    console.log('Reconnected to the database');
})


module.exports = ConnectDB;
