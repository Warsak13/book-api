import {pool} from './db'
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
    level: 'info',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
});

const warnRotateTransport = new winston.transports.DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    level: 'warn',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
});

const transports: winston.transport[] = [errorRotateTransport, combinedRotateTransport];
if (process.env.NODE_ENV !== 'production') {
    transports.push(new winston.transports.Console({
        level: 'info', 
        format: winston.format.combine(winston.format.colorize(), winston.format.simple())
    }));
} else {

    transports.push(new winston.transports.Console({
        level: 'warn', 
        format: winston.format.json()
    }));
}
const winston_logger = winston.createLogger({
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
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT as string, 10) : 6379,
        reconnectStrategy: (retries: number): number | false => {
            if (retries > 3) {
                winston_logger.warn('Redis unavailable after 3 attempts, giving up and falling back to Postgres only.');
                return false;
            }
            return Math.min(retries * 100, 1000);
        }
    }
});

redisClient.on('error', (err) => {
    winston_logger.error("Redis connection failed");
});

redisClient.connect().catch(() => {
    winston_logger.info('Redis caching failed, continuing without redis...');
});

export { winston_logger, redisClient, pool };