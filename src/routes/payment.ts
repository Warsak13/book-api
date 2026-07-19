import {Router, Request, Response} from 'express';
import Stripe from 'stripe';
import {Auth, asynchandler} from '../middleware';
import { winston_logger, pool } from '../config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const router = Router();

interface AuthedRequest extends Request {
    user: { id: number }; 
}

router.post('/create-checkout-session/:bookId', Auth, asynchandler(async (req: AuthedRequest, res: Response) => {
    const bookId = parseInt(req.params.bookId as string, 10);
    if (isNaN(bookId)) return res.status(400).json({ error: 'Invalid book ID' });

    const book = await pool.query('SELECT id, book_name, price_cents FROM book WHERE id = $1', [bookId]);
    if (book.rows.length === 0) return res.status(404).json({ error: 'Book not found' });

    const { book_name, price_cents } = book.rows[0];

    if (!price_cents || price_cents <= 0) {
        return res.status(400).json({ error: 'This book is free, no payment needed' });
    }

    const existing = await pool.query(
        `SELECT status FROM purchases WHERE user_id = $1 AND book_id = $2 AND status IN ('completed', 'pending')`,
        [req.user.id, bookId]
    );
    const alreadyCompleted = existing.rows.find(r => r.status === 'completed');
    if (alreadyCompleted) {
        return res.status(409).json({ error: 'You already own this book' });
    }
    const pendingRow = existing.rows.find(r => r.status === 'pending');

    const idempotencyKey = `checkout-${req.user.id}-${bookId}`;

    let session;
    try {
        session = await stripe.checkout.sessions.create(
            {
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'usd',
                        product_data: { name: book_name },
                        unit_amount: price_cents,
                    },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: `${process.env.FRONTEND_URL}/success`,
                cancel_url: `${process.env.FRONTEND_URL}/cancel`,
                client_reference_id: String(req.user.id),
                metadata: { book_id: String(bookId) },
            },
            { idempotencyKey }
        );
    } catch (err) {
        winston_logger.error('Stripe session creation failed', { err, userId: req.user.id, bookId });
        return res.status(502).json({ error: 'Payment provider error, please try again' });
    }

    try {
        if (pendingRow) {
            await pool.query(
                `UPDATE purchases SET stripe_session_id = $1, updated_at = now()
                 WHERE user_id = $2 AND book_id = $3 AND status = 'pending'`,
                [session.id, req.user.id, bookId]
            );
        } else {
            await pool.query(
                `INSERT INTO purchases (user_id, book_id, stripe_session_id, status) VALUES ($1, $2, $3, $4)`,
                [req.user.id, bookId, session.id, 'pending']
            );
        }
    } catch (err) {
        winston_logger.error('Failed to persist pending purchase', { err, sessionId: session.id });
        await stripe.checkout.sessions.expire(session.id).catch(() => {});
        return res.status(500).json({ error: 'Could not start checkout, please try again' });
    }

    res.json({ url: session.url });
}));

// Webhook route
router.post('/webhooks/stripe', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (typeof sig !== 'string') { // 🐛 sig can technically be string[] | undefined
        return res.status(400).send('Webhook Error: missing or malformed signature');
    }
 
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
    let event: Stripe.Event;
 
    try {

        event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
        winston_logger.warn('Stripe webhook signature verification failed', { err: err.message });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
 
    try {
        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded': {
                const session = event.data.object as Stripe.Checkout.Session;
 
                if (session.payment_status !== 'paid') {
                    winston_logger.info(`Session ${session.id} completed but not yet paid (status: ${session.payment_status})`);
                    break;
                }
 
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
 
                    const inserted = await client.query(
                        'INSERT INTO processed_events (stripe_event_id) VALUES ($1) ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id',
                        [event.id]
                    );
 
                    if (inserted.rows.length > 0) {
                        const updateResult = await client.query(
                            `UPDATE purchases SET status = $1 WHERE stripe_session_id = $2`,
                            ['completed', session.id]
                        );
 
                        if (updateResult.rowCount === 0) {

                            winston_logger.warn(`No purchase row found for stripe_session_id ${session.id}`);
                        } else {
                            winston_logger.info(`Purchase completed: user ${session.client_reference_id}, book ${session.metadata?.book_id}`);
                        }
                    }
 
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
                break;
            }
 
            case 'checkout.session.async_payment_failed': {
                const session = event.data.object as Stripe.Checkout.Session;
                await pool.query(
                    `UPDATE purchases SET status = $1 WHERE stripe_session_id = $2 AND status = 'pending'`,
                    ['failed', session.id]
                );
                winston_logger.info(`Async payment failed for session ${session.id}`);
                break;
            }
 
            case 'checkout.session.expired': {
                const session = event.data.object as Stripe.Checkout.Session;
                await pool.query(
                    `UPDATE purchases SET status = $1 WHERE stripe_session_id = $2 AND status = 'pending'`,
                    ['cancelled', session.id]
                );
                winston_logger.info(`Checkout session expired: ${session.id}`);
                break;
            }
 
            default:

                break;
        }
    } catch (err) {
        winston_logger.error('Error processing Stripe webhook event', { err, eventId: event.id, type: event.type });
        return res.status(500).json({ error: 'Internal error processing webhook' });
    }
 
    res.json({ received: true });
});

router.get('/purchases/:bookId', Auth, asynchandler(async (req: AuthedRequest, res: Response) => {
    const bookId = parseInt(req.params.bookId as string, 10);
    if (isNaN(bookId)) return res.status(400).json({ error: 'Invalid book ID' }); // 🐛 the copy-paste gap, closed

    const result = await pool.query(
        'SELECT status FROM purchases WHERE user_id = $1 AND book_id = $2',
        [req.user.id, bookId]
    );
    const owned = result.rows.length > 0 && result.rows.some(r => r.status === 'completed');
    res.json({ owned });
}));

export default router;