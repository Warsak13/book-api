// Book_API.ts
import dotenv from 'dotenv';
dotenv.config();

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';

import swaggerSpec from './swagger';
import { winston_logger, pool, redisClient } from './config';
import { limiter } from './middleware';
redisClient
import bookRoutes from './routes/books';
import reviewRoutes from './routes/reviews';
import authRoutes from './routes/auth';

const app: Application = express();
app.set('trust proxy', 1)

// --- CORS setup ---
const normalize = (url: string): string => url.replace(/\/$/, '').toLowerCase();

const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:6780']).map(normalize);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(normalize(origin))) {
            callback(null, true);
        } else {
            callback(new Error('Link blocked by CORS, access not allowed'));
        }
    }
}));

app.use(helmet());
app.use(cookieParser());
app.use(express.json());
app.use(limiter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', async (req: Request, res: Response) => {
    try {
        await pool.query('SELECT 1');
        const redisStatus = await redisClient.ping().then(() => 'connected').catch(() => 'down')
        res.status(200).json({ status: 'success', db: 'connected', redis: redisStatus});
    } catch (err) {
        res.status(503).json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
    }
});

app.use('/book', bookRoutes);
app.use('/reviews', reviewRoutes);
app.use('/', authRoutes); 

app.use((req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

app.use((err: any, req: Request & { user?: any }, res: Response, _next: NextFunction) => {
    const status = err.statusCode || 500;
    winston_logger.error({ message: err.message, stack: err.stack, method: req.method, path: req.originalUrl, userId: req.user?.id || 'anonymous' });
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

const PORT = process.env.PORT || 6780;
const server = app.listen(PORT, () => {
    console.log(`Running at server http://localhost:${PORT}`);
    winston_logger.info(`Running at server http://localhost:${PORT}`);
});


const shutdown = async (signal: string) => {
    winston_logger.info(`${signal} received, shutting down server...`);
    server.close(async () => {
        await pool.end();
        await redisClient.quit();
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));