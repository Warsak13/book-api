import dotenvx from '@dotenvx/dotenvx';
if (!process.env.DOCKER_ENV) {
    try {
        dotenvx.config({ quiet: true });
    } catch {}
}

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
import paymentRoutes from './routes/payment';

const app: Application = express();
app.set('trust proxy', 1);

// Global middleware
app.use(express.json({
    verify: (req: any, res, buf) => {
        if (req.originalUrl === '/payments/webhooks/stripe') {
            req.rawBody = buf;
        }
    }
}));
app.use(cors({ origin: '*' }));
app.use(helmet());
app.use(cookieParser());
app.use(limiter);

// Routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/book', bookRoutes);
app.use('/reviews', reviewRoutes);
app.use('/', authRoutes);
app.use('/payments', paymentRoutes);

// Error Handling
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    winston_logger.error({ message: err.message, stack: err.stack });
    res.status(err.statusCode || 500).json({ error: 'Internal server error' });
});

app.get('/success', (req, res) => {
    res.status(200).send('<h1>Payment Successful!</h1><p>Thank you for your book purchase. Your order is being processed.</p>');
});

app.get('/cancel', (req, res) => {
    res.status(200).send('<h1>Payment Cancelled</h1><p>Your transaction was cancelled. No charges were made.</p>');
});

const PORT = process.env.PORT || 6780;
const server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Running at server http://localhost:${PORT}`);
});

const shutdown = async (signal: string) => {
    winston_logger.info(`${signal} received, shutting down server...`);
    
    server.close(async () => {
        winston_logger.info('HTTP server closed.');
        

        try {
            if (redisClient) {

                await redisClient.quit();
                winston_logger.info('Redis connection closed.');
            }
        } catch (err) {

            winston_logger.warn('Redis was already closed, skipping.');
        }

        try {
            await pool.end();
            winston_logger.info('Postgres pool closed.');
        } catch (err) {
            winston_logger.warn('Error closing Postgres pool:', err);
        }

        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));