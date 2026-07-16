const express = require('express');
const mongoose = require('mongoose');
const contentModel = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true
    },
    adminName: {
        type: String,
        required: true
    },
    contentSchedule: {
        type:Array,
        required: true
    },
    image: {
        type: String,
        required: false
    }
});
module.exports = mongoose.model('contentmodel', contentModel);