// middleware.ts
import { Request, Response, NextFunction } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { winston_logger } from './config';



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

const asynchandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

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

export {Auth, validatebook, validatebookUpdate, asynchandler, validatePass, validatePassword, validatelogin, validatereview, validateuser, authLimiter, limiter}