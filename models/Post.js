const mongoose = require('mongoose');
const express = require('express');
const postSchema = new mongoose.Schema({
    content: String,
    posted: {
        type: Boolean,
        required:true,
    },
    postedAt: Date
});
module.exports = mongoose.model("Post", postSchema);