import {Router, Request, Response, NextFunction} from 'express';
import {Auth, asynchandler, validatelogin, validatePass, validatePassword, validateuser, authLimiter} from '../middleware';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JwtPayload } from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { pool } from '../config';


const router = Router();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
};

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
 *                 email:
 *                 type: string 
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
router.post('/login', authLimiter, validatelogin, asynchandler(async (req: Request, res: Response) => {
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
        maxAge: 24 * 60 * 60 * 1000
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

router.post('/register', authLimiter, validateuser, validatePassword, asynchandler(async (req: Request, res: Response, _next: NextFunction) => {
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

router.post('/logout', (req: Request, res: Response) => {
    res.clearCookie('token', cookieOptions);
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

router.post('/forgot_password', authLimiter, asynchandler(async (req: Request, res: Response) => {
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

router.post('/reset_password', authLimiter, validatePassword, asynchandler(async (req: Request, res: Response) => {
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

export default router;