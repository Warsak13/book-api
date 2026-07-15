import dotenvx from '@dotenvx/dotenvx';
dotenvx.config({quiet: true});

import {pool} from './db'
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

const transports: winston.transport[] = [errorRotateTransport, combinedRotateTransport];

if (process.env.NODE_ENV !== 'production') {
    transports.push(new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple())
    }));
}

const winston_logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports
});


const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
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