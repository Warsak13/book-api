import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import * as redis from 'redis';
import winston from 'winston';
import 'winston-daily-rotate-file';

const errorRotateTransport = new winston.transports.DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '14d' 
});

const combinedRotateTransport = new winston.transports.DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
});

const winston_logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [errorRotateTransport, combinedRotateTransport]
});

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    database: process.env.DB_NAME
});

const redisClient = redis.createClient({
    socket: {
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
        reconnectStrategy: (retries: number): number | false => {
            if (retries > 3) {
                winston_logger.error('Redis unavailable after 3 attempts, giving up and falling back to Postgres only.');
                return false;
            }
            return Math.min(retries * 100, 1000);
        }
    }
});

redisClient.on('error', (err) => {
    winston_logger.error(`Redis connection failed: ${err.message}`);
});

redisClient.connect().catch(() => {
    winston_logger.info('Redis caching failed, continuing without redis...');
});

export { winston_logger, redisClient, pool };