const express=require('express');
const http = require('http');
const https = require('https');

const {ServerConfig,Queue}=require('./config');
const apiRoutes=require('./routes');
const CRON = require('./utils/common/cron-jobs');

const app=express();

 app.use(express.json());
 app.use(express.urlencoded({extended:true}));
 app.use('/api',apiRoutes);

// Health check endpoint — used by Render and self-ping
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(ServerConfig.PORT,async()=>{
    console.log(`Server is running on port: ${ServerConfig.PORT}`);
    CRON();
    await Queue.connectQueue();
    console.log("Queue connected");

    // Self-ping every 10 min to prevent Render free-tier cold starts
    // (cold starts cause 502 Bad Gateway on the bookings page)
    const SERVICE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${ServerConfig.PORT}`;
    setInterval(() => {
        const client = SERVICE_URL.startsWith('https') ? https : http;
        client.get(`${SERVICE_URL}/ping`, (res) => {
            console.log(`[self-ping] ${res.statusCode}`);
        }).on('error', (err) => {
            console.warn('[self-ping] failed:', err.message);
        });
    }, 10 * 60 * 1000); // every 10 minutes
});