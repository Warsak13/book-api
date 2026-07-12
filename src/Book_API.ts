
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

import bookRoutes from './routes/books';
import reviewRoutes from './routes/reviews';
import authRoutes from './routes/auth';

const app: Application = express();

// --- CORS setup ---
const normalize = (url: string): string => url.replace(/\/$/, '').toLowerCase();

const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:6780'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(normalize(origin))) {
            callback(null, true);
        } else {
            callback(new Error('Link filed by CORS, access not allowed'));
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
        res.status(200).json({ status: 'success', db: 'connected', redis: redisClient.isOpen ? 'connected' : 'down' });
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
    winston_logger.error({
        message: err.message,
        stack: err.stack,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id || 'anonymous'
    });
    res.status(500).json({ error: 'Internal server error' });
});


const PORT = process.env.PORT || 6780;
app.listen(PORT, () => {
    console.log(`Running at server http://localhost:${PORT}`);
    winston_logger.info(`Running at server http://localhost:${PORT}`);
});


process.on('SIGTERM', async () => {
    winston_logger.info('SIGTERM received, shutting down server...');
    await pool.end();
    await redisClient.quit();
    process.exit(0);
});