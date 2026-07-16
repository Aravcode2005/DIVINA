const express = require('express');
const mongoose = require('mongoose');
const postSchema = require('../models/Post');
const { default: OpenAI } = require('openai');
const dotenv = require('dotenv');
dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });
async function generateposts(input) {
    try {
        const response = await client.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You have to write all the posts in the given format, no hallucinations are allowed,follow the same format for all the posts"
                },
                {
                    role: "user", content: input
                }
            ],

        });
        return response?.choices?.[0].message?.content || ' ';
    }

    catch (error) {
        console.log("There was some error connecting to the ai", error)
    }
}
const getMain = async (req, res, next) => {
    res.render('land', {
        pageTitle: "Landingpage"
    })
   const data=await postSchema.find();
   console.log(data);
}
module.exports = {
    getMain,
    generateposts
};













