const mongoose = require('mongoose');
const express = require('express');
const authSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
        required: true
    },
    adminName: {
        type: String,
        required: true
    },
    AdminSessionInfo: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
})
module.exports = mongoose.model("linkedinauth", authSchema)