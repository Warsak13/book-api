import { Router, Request, Response } from 'express';
import { Auth, validatereview, asynchandler } from '../middleware';
import { pool } from '../config';

const router = Router();
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
router.get('/', asynchandler(async (req: Request, res: Response) => {
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
router.post('/', Auth, validatereview, asynchandler(async (req: Request & { user?: any }, res: Response) => {
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
router.put('/:id', Auth, asynchandler(async (req: Request & { user?: any }, res: Response) => {
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
router.delete('/:id', Auth, asynchandler(async (req: Request & { user?: any }, res: Response) => {
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

export default router;