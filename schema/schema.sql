
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password TEXT NOT NULL,               
    email VARCHAR(255) UNIQUE NOT NULL,
    reset_token TEXT,
    reset_expiretime TIMESTAMPTZ,         
    created_at TIMESTAMPTZ DEFAULT NOW() 
);

-- Books table
CREATE TABLE IF NOT EXISTS book (
    id SERIAL PRIMARY KEY,
    book_name VARCHAR(255) NOT NULL,
    price_cents INTEGER DEFAULT 0,
    type VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(), 
    UNIQUE (book_name, type)              
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    rew_text TEXT NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    book_id INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()  -- Optimized: Timezone-aware creation
);
-- Processes evens
CREATE TABLE IF NOT EXISTS processed_events (
    id SERIAL PRIMARY KEY,
    stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
    raw_payload JSONB,
    processed_at TIMESTAMP DEFAULT NOW()
);
-- Tracks purchases
CREATE TABLE purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    stripe_session_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, book_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_book_user_id ON book(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_book_id ON reviews(book_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
