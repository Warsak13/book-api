// TODO: File upload support (multer + local disk or S3) not implemented.
// Add if a client needs actual file attachments (PDFs, images.)
// See: npm install multer, add file_path column to relevant table.

import dotenvx from '@dotenvx/dotenvx';
dotenvx.config({quiet: true});
import express, { Application } from 'express';
import { Pool } from 'pg'; // Import types directly from your pg package if needed
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import * as redis from 'redis';
import winston from 'winston';
import 'winston-daily-rotate-file';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import CookieParser from 'cookie-parser';
import { CookieOptions } from 'express';

// Internal module imports
import pool from './db';
import swaggerSpec from './swagger';

import { Request, Response, NextFunction } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { JwtPayload } from 'jsonwebtoken';

// Initialize environment variables
dotenvx.config();

// Initialize Express App with types
const app: Application = express();

const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', 
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
};
// Initialize Redis Client with fully typed reconnect strategy
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
app.use(CookieParser()); 

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(helmet());

// Shared cookie rules for consistency across login and logout

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
    transports: [
        errorRotateTransport,
        combinedRotateTransport,
    ]
});
// defines a custom key rate-limiting key generator to identify a user based on their account ID.
const customKeyGenerator = (
    req: Request & { user?: { id: number | string } }, 
    _res: Response
): string => {
    if (req.user?.id) {
        return String(req.user.id);
    }
    
    // Fallback to the default IP generator if no user ID exists
    const ip = req.ip;
    if (!ip) {
        throw new Error('IP address could not be determined for rate limiting');
    }
    return ipKeyGenerator(ip);
};
// to transport Emails to the clients email address.

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS}
});

redisClient.on('error', (err) => {
    winston_logger.error(`Redis connection failed: ${err.message}`);
});
// Identifies whether Redis caching is not running, if not then it falls back to run without caching.
redisClient.connect().catch((_err => {
    winston_logger.info('Redis caching failed, continuing without redis...');
}));

//creates a rate limiter middleware instance to restrict requests up to 50 limits. The limit resets after every 15 minutes.
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    keyGenerator: customKeyGenerator,
    skip: (_req: Request, _res: Response): boolean => false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5, // five attempts, then sit in timeout and think about your choices
    keyGenerator: customKeyGenerator
});

const normalize = (url: string): string => {
    return url.replace(/\/$/, '').toLowerCase();
};

const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:6780'];

app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || allowedOrigins.includes(normalize(origin))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));

// Accesses the express JSON 
app.use(express.json({strict: false}));

const asynchandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// validates POST method 
const validatebook = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const { book_name, type } = req.body;
    if ((!book_name || !book_name.trim()) || (!type || !type.trim())) {
        return res.status(400).json({ error: 'book_name or type not inputed' });
    }
    if (!/^[a-zA-Z0-9\s'\-:,.!?]+$/.test(book_name)) {
        return res.status(400).json({ error: 'book_name must not contain invalid characters' });
    }
    if (book_name.length > 255) {
        return res.status(400).json({ error: 'book_name has exceeded the character limit' });
    }
    if (type.length > 100) {
        return res.status(400).json({ error: 'type has exceeded the character limit' });
    }
    if (!/^[a-zA-Z\s]+$/.test(type)) {
        return res.status(400).json({ error: 'type must only contain letters' });
    }
    next();
};

// validates PUT method
const validatebookUpdate = (req: Request, res: Response, next: NextFunction) => {

    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const { book_name, type } = req.body;
    if (book_name === undefined && type === undefined) {
        return res.status(400).json({ error: 'Provide at least book_name or type to update' });
    }
    if (book_name !== undefined && (!book_name.trim() || !/^[a-zA-Z0-9\s'\-:,.!?]+$/.test(book_name))) {
        return res.status(400).json({ error: 'book_name must contain valid characters' });
    }
    if (type !== undefined && (!type.trim() || !/^[a-zA-Z\s]+$/.test(type))) {
        return res.status(400).json({ error: 'type must only contain letters' });
    }
    next();
};

// Validates a strong user password string
const validatePass = (password: string): boolean => {
    const minLength = 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*]/.test(password);

    if (password.length < minLength) return false;
    if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) return false;
    
    return true;
};

// validate password the user inputted.
const validatePassword = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const { password } = req.body;
    if (!validatePass(password)) {
        return res.status(400).json({
            error: 'Password must be 8+ chars with uppercase, lowercase, number, and special char'
        });
    }
    next();
};

// Validates the inputted review database
const validatereview = (req: Request, res: Response, next: NextFunction) => {
    

    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const { rew_text, rating, book_id } = req.body;
    if (!book_id || typeof book_id !== 'number') {
        return res.status(400).json({ success: false, error: 'invalid book_id' });
    }
    if (rating > 5 || rating < 1 || typeof rating !== 'number') {
        return res.status(400).json({ error: 'Invalid rating' });
    }
    if (rew_text && rew_text.length > 1000) {
        return res.status(400).json({ success: false, error: 'Review text has exceeded the character limit' });
    }
    if (!rew_text?.trim() || !book_id) {
        return res.status(400).json({ error: 'important field is empty' });
    }
    next();
};

// Validates the inputted user login database
const validateuser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const {username, password} = req.body
    if (!username?.trim() || !password?.trim()) {
        return res.status(400).json({ success: false, error: 'username or password is not inputted' });
    }
    next();
};

const validatelogin = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Request body is required' });
    }
    const { username, password } = req.body;
    if (!username?.trim() || !password?.trim()) {
        return res.status(400).json({ error: 'username or password is not inputed' });
    }
    next();
};

// The Auth Middleware (With custom object injection mapping)
const Auth = (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: 'No token' });
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET key missing from environment configurations');
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Works cleanly now because of the intersection type definition
        next();
    } catch (error: any) {
        winston_logger.error(error.message);
        res.status(401).json({ error: error.message });
    }
};
app.use(limiter);

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const redisOk = redisClient.isOpen;
        res.status(200).json({ status: 'ok', db: 'connected', redis: redisOk ? 'connected' : 'down' });
    } catch (err) {
    
    if (err instanceof Error) {
        res.status(503).json({ status: 'error', error: err.message });
    } else {
        // Fallback for unexpected or weird things being thrown
        res.status(503).json({ status: 'error', error: 'An unknown server error occurred' });
    }
}
});
// /GET the books from the database.

/**
 * @swagger
 * /book:
 *   get:
 *     summary: Get a list of books
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of books
 */
app.get('/book', asynchandler(async (req: Request, res: Response) => {
    const cacheKey = `book:list:${JSON.stringify(req.query)}`;
    
    // 1. Attempt to pull from Redis cache
    try {
        if (redisClient.isOpen) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }
        }
    } catch (err) {
        if (err instanceof Error) {
            winston_logger.info(`Redis failed, falling back to database: ${err.message}`);
        }
    } // <-- Added the missing closing block bracket here!

    // 2. Database Fallback Operations
    let query = '';
    const params: (string | number)[] = []; // Explicitly typed parameter array
    
    // Explicitly cast incoming query parameters
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    if (req.query.search) {
        query += ' WHERE book_name ILIKE $1';
        params.push(`%${req.query.search}%`);
    }
    
    if (req.query.type) {
        query += (params.length > 0 ? ' AND ' : ' WHERE ') + `type = $${params.length + 1}`;       
        params.push(req.query.type as string);
    }

    // Execute total element count
    const countResults = await pool.query(`SELECT COUNT(*) FROM book ${query}`, params);
    const total = countResults.rows[0].count;

    // Execute limited chunk query
    const results = await pool.query(
        `SELECT * FROM book ${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, 
        [...params, limit, offset]
    );
    
    const response = {
        success: true, 
        data: results.rows, 
        page, 
        total: parseInt(total, 10), 
        message: '/GET successful'
    };

    // 3. Attempt to store results in Cache for future hits
    try {
        if (redisClient.isOpen) {
            await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
        }
    } catch (err) {
        if (err instanceof Error) {
            winston_logger.error(`Redis cache write failed: ${err.message}`);
        }
    }

    // Return successful response payloads
    return res.status(200).json(response);
}));

app.get('/book/:id', asynchandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({message: 'id is not a number'});
    
    const results = await pool.query(
        'SELECT book.*, users.username AS added_by FROM book LEFT JOIN users ON book.user_id = users.id WHERE book.id = $1',
        [id]
    );
    if (results.rows.length === 0) return res.status(404).json({error: 'No book found'});
    res.status(200).json({message: 'Books listed', data: results.rows[0]});
}));


/**
 * @swagger
 * /book:
 *   post:
 *     summary: Create a new book
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               book_name:
 *                 type: string
 *               type:
 *                 type: string
 *     responses:
 *       201:
 *         description: Book created
 *       401:
 *         description: No token
 */
app.post('/book', Auth, validatebook, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const { book_name, type } = req.body;
    const user_id = req.user.id;
    
    try {
        const result = await pool.query(
            'INSERT INTO book (book_name, type, user_id) VALUES ($1, $2, $3) RETURNING *', 
            [book_name, type, user_id]
        );

        // Dynamic Redis Cache Invalidation
        if (redisClient.isOpen) {
            for await (const keys of redisClient.scanIterator({ MATCH: 'book:list:*' })) {
                const keyBatch = Array.isArray(keys) ? keys : [keys];
                if (keyBatch.length > 0) {
                    await redisClient.del(keyBatch);
                }
            }
        }
        
        return res.status(201).json({ success: true, message: 'Book created', book: result.rows[0] });
    }
    catch (err) {
        if (err instanceof Error) {
            // Tell TypeScript to check for a database specific error code property
            const dbError = err as Error & { code?: string };
            if (dbError.code === '23505') {
                return res.status(400).json({ error: 'Book already exists' });
            }
            throw err;
        }
        // Fallback for completely untyped exceptions
        return res.status(500).json({ error: 'An unexpected internal error occurred' });
    }
}));

/**
 * @swagger
 * /book/{id}:
 *   put:
 *     summary: Update a book (owner only)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               book_name:
 *                 type: string
 *               type:
 *                 type: string
 *     responses:
 *       200:
 *         description: Book updated
 *       403:
 *         description: Not the owner of the book
 *       404:
 *         description: Book not found
 */
app.put('/book/:id', Auth, validatebookUpdate, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
        return res.status(404).json({ message: 'id is not a number' });
    }

    const { book_name, type } = req.body;
    const book = await pool.query('SELECT user_id FROM book WHERE id = $1', [id]);
    
    if (book.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Book not found.' });
    }
    
    if (book.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Modifying a book without ownership of the book is restricted' });
    }

    try {
        const results = await pool.query(
            'UPDATE book SET book_name = COALESCE($1, book_name), type = COALESCE($2, type) WHERE id = $3 RETURNING book_name, type, id', 
            [book_name ?? null, type ?? null, id]
        );
        
        if (redisClient.isOpen) {
            for await (const keys of redisClient.scanIterator({ MATCH: 'book:list:*' })) {
                const keyBatch = Array.isArray(keys) ? keys : [keys];
                if (keyBatch.length > 0) {
                    await redisClient.del(keyBatch);
                }
            }
        }
        
        return res.status(200).json({ data: results.rows[0], message: 'PUT /book/:id successful' });
    } catch (err) {
        if (err instanceof Error) {
            const dbError = err as Error & { code?: string };
            if (dbError.code === '23505') {
                return res.status(400).json({ success: false, error: 'A book with that name and type already exists' });
            }
            throw err;
        }
        return res.status(500).json({ success: false, error: 'An unexpected database error occurred' });
    }
}));

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Log in and receive a JWT access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: book_lover21
 *               password:
 *                 type: string
 *                 example: Person_123!
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       403:
 *         description: Invalid credentials
 */
app.post('/login', authLimiter, validatelogin, asynchandler(async (req: Request, res: Response) => {
    const { username, password } = req.body;

    const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (user.rows.length === 0) {
        return res.status(403).json({ error: 'Invalid credential' });
    }

    const validpass = await bcrypt.compare(password, user.rows[0].password);

    if (!validpass) {
        return res.status(403).json({ success: false, error: 'Invalid credential' });
    }

    // Safety guard to guarantee the JWT secret exists
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET key missing from environment configurations');
    }

    const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.cookie('token', token, {
        ...cookieOptions,
        maxAge: 24 * 60 * 1000
    });

    return res.json({ success: true, message: 'token sent successfully' });
}));

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 description: Must be 8+ chars with uppercase, lowercase, number, and special char
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Username already exists or password too weak
 */

app.post('/register', authLimiter, validateuser, validatePassword, asynchandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { username, password, email } = req.body;
    const hpassword = await bcrypt.hash(password, 10);

    if (!email?.trim()) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    
    try {
        const user = await pool.query(
            "INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING id, username, email", 
            [username, hpassword, email]
        );
        return res.status(201).json({ success: true, message: 'User created', user: user.rows[0] });
    } catch (err) {
        if (err instanceof Error) {
            const dbError = err as Error & { code?: string };
            if (dbError.code === '23505') {
                return res.status(400).json({ success: false, error: 'User or Email already exists' });
            }
            throw err;
        }
        return res.status(500).json({ success: false, error: 'An unexpected database error occurred' });
    }
}));

/**
 * @swagger
 * /logout:
 *   post:
 *     summary: Log out and clear the auth cookie
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
// Logout Route
app.post('/logout', (req: Request, res: Response) => {
    res.clearCookie('token', cookieOptions);
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

app.post('/forgot_password', authLimiter, asynchandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email?.trim()) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

    if (user.rows.length > 0) {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET key missing from environment configurations');
        }

        const tokens = jwt.sign({ id: user.rows[0].id, type: 'reset' }, process.env.JWT_SECRET, { expiresIn: '2 hours' });
        
        await pool.query(
            "UPDATE users SET reset_token = $1, reset_expiretime = NOW() + INTERVAL '2 hours' WHERE id = $2", 
            [tokens, user.rows[0].id]
        );
        
        // Assumes your Nodemailer transporter is configured globally
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset',
            html: `<p>Click <a href="https://site.com/reset?token=${tokens}">here</a> to reset your password.</p>`
        });
    }
    
    return res.status(200).json({ success: true, message: 'If user exists, a reset link will be sent.' });
}));

// 2. Reset Password Endpoint
app.post('/reset_password', authLimiter, validatePassword, asynchandler(async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token?.trim()) {
        return res.status(400).json({ success: false, error: 'Reset token is required' });
    }

    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET key missing from environment configurations');
    }

    let decoded: JwtPayload | string;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ success: false, error: 'Invalid or expired reset token' });
    } 


    const payload = decoded as JwtPayload & { id: number | string };
    if (!payload || !payload.id) {
        return res.status(401).json({ success: false, error: 'Malformed token payload' });
    }

    const user = await pool.query('SELECT reset_token, reset_expiretime FROM users WHERE id = $1', [payload.id]);

    if (user.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (user.rows[0].reset_token !== token) {
        return res.status(401).json({ success: false, error: 'Reset token no longer valid' });
    }
    if (new Date() > new Date(user.rows[0].reset_expiretime)) {
        return res.status(401).json({ success: false, error: 'Reset token has expired' });
    }

    const hpassword = await bcrypt.hash(password, 10);

    const results = await pool.query(
        'UPDATE users SET password = $1, reset_token = NULL, reset_expiretime = NULL WHERE id = $2 RETURNING id, username', 
        [hpassword, payload.id]
    );
    
    return res.status(200).json({ success: true, data: results.rows[0], message: 'Password successfully reset' });
}));

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Post a review for a book
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rew_text:
 *                 type: string
 *               rating:
 *                 type: number
 *               book_id:
 *                 type: number
 *     responses:
 *       201:
 *         description: Review posted
 *       400:
 *         description: Invalid rating or book_id
 *       401:
 *         description: No token provided
 */
app.post('/reviews', Auth, validatereview, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const { rew_text, rating, book_id } = req.body;
    const user_id = req.user.id;

    try {
        const results = await pool.query(
            'INSERT INTO reviews (rew_text, rating, book_id, user_id) VALUES ($1, $2, $3, $4) RETURNING *', 
            [rew_text, rating, book_id, user_id]
        );
        return res.status(201).json({ data: results.rows[0], message: 'Review posted' });
    } 
    catch (err) {
        if (err instanceof Error) {
            // Cast err as a Postgres database error to read code and constraint fields cleanly
            const dbError = err as Error & { code?: string; constraint?: string };
            
            if (dbError.code === '23503') {
                if (dbError.constraint === "reviews_book_id_fkey") {
                    return res.status(400).json({ success: false, error: 'Book not found' });
                }
                if (dbError.constraint === "reviews_user_id_fkey") {
                    return res.status(400).json({ success: false, error: "User not found" });
                }
            }
            throw err;
        }
        return res.status(500).json({ success: false, error: 'An unexpected database error occurred' });
    }
}));

/**
 * @swagger
 * /reviews/{id}:
 *   put:
 *     summary: Edit your own review
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rew_text:
 *                 type: string
 *               rating:
 *                 type: number
 *     responses:
 *       200:
 *         description: Review updated
 *       403:
 *         description: You can only edit your own reviews
 */
app.put('/reviews/:id', Auth, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
        return res.status(404).json({ message: 'id must be a number' });
    }

    const { rew_text, rating } = req.body;
    
    if (rew_text === undefined && rating === undefined) {
        return res.status(400).json({ error: 'Provide at least rew_text or rating to update' });
    }
    if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Invalid rating' });
    }
    if (rew_text !== undefined && !rew_text.trim()) {
        return res.status(400).json({ error: 'rew_text cannot be empty' });
    }

    const review = await pool.query('SELECT user_id FROM reviews WHERE id = $1', [id]);
    if (review.rows.length === 0) {
        return res.status(404).json({ error: 'Review not found' });
    }
    if (review.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only edit your own reviews' });
    }

    const results = await pool.query(
        'UPDATE reviews SET rew_text = COALESCE($1, rew_text), rating = COALESCE($2, rating) WHERE id = $3 RETURNING *',
        [rew_text ?? null, rating ?? null, id]
    );
    
    return res.status(200).json({ data: results.rows[0], message: 'Review updated' });
}));

/**
 * @swagger
 * /reviews:
 *   get:
 *     summary: Get reviews for a specific book
 *     parameters:
 *       - in: query
 *         name: book_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of reviews for that book
 */
app.get('/reviews', asynchandler(async (req: Request, res: Response) => {
    const id = parseInt(req.query.book_id as string, 10);
    
    if (isNaN(id)) {
        return res.status(400).json({ error: 'book_id must be a valid number' });
    }
    
    const results = await pool.query(
        'SELECT reviews.*, users.username FROM reviews LEFT JOIN users ON reviews.user_id = users.id WHERE book_id = $1', 
        [id]
    );
    
    // Better API design pattern: Always keep the envelope shape consistent for the client
    if (results.rows.length === 0) {
        return res.status(200).json({ data: [], message: 'No reviews found for this book' });
    }
    
    return res.status(200).json({ data: results.rows, message: '/GET successful' });
}));

/**
 * @swagger
 * /reviews/{id}:
 *   delete:
 *     summary: Delete your own review
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Review deleted
 *       403:
 *         description: You can only delete your own reviews
 */
app.delete('/reviews/:id', Auth, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const id = parseInt(req.params.id as string, 10); // req.params.id is always a string, no cast needed!
    if (isNaN(id)) {
        return res.status(400).json({ message: 'id must be a number' });
    }

    const review = await pool.query('SELECT user_id FROM reviews WHERE id = $1', [id]);
    if (review.rows.length === 0) {
        return res.status(404).json({ error: 'Review not found' });
    }
    
    if (review.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only delete your own reviews' });
    }

    const results = await pool.query('DELETE FROM reviews WHERE id = $1 RETURNING *', [id]);
    return res.status(200).json({ data: results.rows[0], message: 'Review successfully deleted' });
}));

/**
 * @swagger
 * /book/{id}:
 *   delete:
 *     summary: Delete a book (owner only)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Book successfully deleted
 *       403:
 *         description: Removal without ownership is restricted
 *       404:
 *         description: Book not found
 */
app.delete('/book/:id', Auth, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const id = parseInt(req.params.id as string, 10); // req.params.id is strictly a string, no 'as string' needed
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'id must be a valid number' });
    }

    const book = await pool.query('SELECT user_id FROM book WHERE id = $1', [id]);
    if (book.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Book not found' });
    }
    
    if (book.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "Removal of a book without your ownership of that book is restricted" });
    }

    const results = await pool.query('DELETE FROM book WHERE id = $1 RETURNING *', [id]);

    if (redisClient.isOpen) {
        for await (const keys of redisClient.scanIterator({ MATCH: 'book:list:*' })) {
            const keyBatch = Array.isArray(keys) ? keys : [keys];
            if (keyBatch.length > 0) {
                await redisClient.del(keyBatch);
            }
        }
    }

    return res.status(200).json({ success: true, message: "Book successfully deleted", data: results.rows[0] });
}));

app.use((err: any, req: Request & {user?: any}, res: Response, _next: NextFunction) => {
    winston_logger.error({
        message: err.message,
        stack: err.stack,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id || 'anonymous'
    });
    res.status(500).json({error: 'Internal server error'}); 
});

//server live to fetch frontends request
app.listen(process.env.PORT || 6780, () => {
    console.log('Running at server http://localhost:6780')
    winston_logger.info('Running at server http://localhost:6780')});

process.on('SIGTERM', async () => {
    winston_logger.info('SIGTERM received, shutting down gracefully...');
    await pool.end();
    await redisClient.quit();
    process.exit(0);
});