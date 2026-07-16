const mongoose = require('mongoose');
const express = require('express');
const adminSchema = new mongoose.Schema({
  adminName: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },

  phone: {
    type: String,
    required: true,
    unique: true
  },

  image: {
    type: String,
    required: true
  }
});
module.exports = mongoose.model("adminmodel", adminSchema);