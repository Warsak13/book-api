// routes/books.ts
import { Router, Request, Response } from 'express';
import { Auth, validatebook, validatebookUpdate, asynchandler, userAwareLimiter } from '../middleware';
import { pool, redisClient, winston_logger } from '../config';

const router = Router();

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
router.get('/', asynchandler(async (req: Request, res: Response) => {
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
            winston_logger.warn(`Redis failed, falling back to database: ${err.message}`);
        }
    }

    let query = '';
    const params: (string | number)[] = []; 

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

    const countResults = await pool.query(`SELECT COUNT(*) FROM book ${query}`, params);
    const total = countResults.rows[0].count;

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

    try {
        if (redisClient.isOpen) {
            await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
        }
    } catch (err) {
        if (err instanceof Error) {
            winston_logger.warn("Redis cache write failed");
        }
    }

    // Return successful response payloads
    return res.status(200).json(response);
}));

router.get('/:id', asynchandler(async (req: Request, res: Response) => {
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
router.post('/', Auth, userAwareLimiter, validatebook, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const { book_name, type, price_cents } = req.body;
    const user_id = req.user.id;
    
    try {
        const result = await pool.query(
            'INSERT INTO book (book_name, type, price_cents, user_id) VALUES ($1, $2, $3, $4) RETURNING book_name, type, price_cents, user_id', 
            [book_name, type, price_cents ?? 0 , user_id]
        );

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
router.put('/:id', Auth, userAwareLimiter, validatebookUpdate, asynchandler(async (req: Request & { user?: any }, res: Response) => {
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

router.delete('/:id', Auth, userAwareLimiter, asynchandler(async (req: Request & { user?: any }, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
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

export default router;