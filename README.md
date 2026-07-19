# Book API
A REST API for managing books and user reviews, with full CRUD functionality, 
JWT authentication, ownership-based permissions, Redis caching with automatic 
fallback to PostgreSQL, stripe payment method and rate limiting to guard against abuse. CORS is 
configured to control exactly which frontends can talk to it. Built as a 
portfolio piece to demonstrate backend architecture and API design.

## Features
- Full CRUD functionality for books and users
- JWT authentication with bcrypt password hashing
- Rate limiting, with stricter limits for auth routes 
- Redis caching with automate fallback to PostgreSQL
- CORS restricted to a specific origin whitelist
- Structured logging with winston (daily log rotation)
- Swagger/OpenAPI documentation
- Ownership-based authorization
- Sending emails via Nodemailer
- Parameterized queries to prevent SQL injection
- Stripe payment method 
- Docker containerization

## Tech stack
Node.js, Express, PostgreSQL, Redis, JWT, bcrypt, express-rate-limit, Helmet, Swagger, cookie-parser, CORS, Winston, Nodemailer, stripe, docker

## Getting Started

You can run this project either with **Docker** (recommended — no manual PostgreSQL/Redis setup required) or **manually** on your local machine.

---

### Option A: Docker (Recommended)

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and Docker Compose (included with Docker Desktop).

1. Clone the repository
```bash
   git clone https://github.com/yourusername/book-api.git
   cd book-api
```

2. Configure environment variables
```bash
   cp .env.example .env
```
   Fill in your own values — `JWT_SECRET`, database credentials, email credentials, etc.

3. Start with the following command
```bash
   docker-compose up --build
```
   This automatically provisions PostgreSQL and Redis containers, builds the API image, 
   and runs the database schema on first startup. No manual database installation or 
   schema setup is required.

4. Verify it's running
```bash
   curl http://localhost:6780/health
```
   Should return `{"status":"success","db":"connected","redis":"connected"}`.

To stop everything:
```bash
docker-compose down
```

To stop and wipe all data (fresh start):
```bash
docker-compose down -v
```

---

### Option B: Manual Setup

**Prerequisites:**

- **[Node.js](https://nodejs.org/)** (v18 or higher)
- **[PostgreSQL](https://www.postgresql.org/download/)**
- **[Redis](https://redis.io/docs/getting-started/installation/)** (optional — the app falls back to PostgreSQL if unavailable)
- **npm** — included with Node.js

Verify installation:
```bash
node --version
npm --version
psql --version
redis-cli --version
```

1. Clone the repository
```bash
   git clone https://github.com/yourusername/book-api.git
   cd book-api
```

2. Install dependencies
```bash
   npm install
```

3. Configure environment variables
```bash
   cp .env.example .env
```

4. Set up the database
```bash
   psql -U your_user -d your_database -f schema/schema.sql
```

5. Start the server

   Development mode (hot-reloading via `ts-node`):
```bash
   npm run dev
```

   Production mode (compiled TypeScript):
```bash
   npm run build
   npm start
```

On successful startup, the console will display:
```
{"level":"info","message":"Running at server http://localhost:6780"}
```

## API Documentation

Once the server is up and running, an interactive Swagger UI is available at:

http://localhost:6780/api-docs

This provides a live, browsable interface for every endpoint — including request/response schemas and the ability to execute real requests directly from the browser.

### A Note on Swagger UI Authentication

You will notice an **"Authorize"** button and padlock icons (`🔒`) within the Swagger UI. These elements can be disregarded. 

This API implements **`httpOnly` cookie-based authentication** rather than Bearer tokens (Authorization headers). 

* **Enhanced Security:** The JWT is issued inside a cookie flagged as `httpOnly`. This prevents client-side JavaScript—including the Swagger UI interface—from accessing or reading the token, mitigating Cross-Site Scripting (XSS) risks.
* **Automated Handling:** Because cookies are managed natively by the browser, credentials are automatically appended to subsequent cross-origin requests matching the scope. No manual token management or configuration is required within the UI.

### How to Test Protected Endpoints:

1. **Register an Account:** Send a request to `POST /register` to create user credentials.
2. **Authenticate:** Send a request to `POST /login`. The server will return a standard success payload and set the secure cookie in your browser headers.
3. **Execute Protected Routes:** Skip the Swagger "Authorize" dialog entirely. Proceed directly to any protected endpoint (e.g., `POST /book`) and click **Execute**. The browser will implicitly forward the active session cookie, and the request will authorize successfully.

To verify the authentication mechanics, calling `POST /logout` or allowing the 24-hour cookie lifecycle to expire will result in the expected `401 Unauthorized` responses on protected routes.

**To test authenticated routes:**
1. Register a user via `POST /register`.
2. Log in via `POST /login`. You won't get a visible token back — just a success message. This is intentional.
3. Skip the Authorize button entirely.
4. Execute any protected route (e.g. `POST /book`) directly. Your browser will already be carrying the cookie from step 2, and the request will succeed automatically.

If you log out, clear cookies, or the cookie expires (24h), protected routes will correctly reject you with a `401 No token` — which is your proof the whole thing is actually working, not just politely lying to you.

## Testing Payments Locally

Stripe webhooks require a real, signed event — you can't simulate this with Postman alone.

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Forward webhook events to your local server:
```bash
   stripe listen --forward-to localhost:6780/payments/webhooks/stripe
```
3. Copy the webhook signing secret it prints into `STRIPE_WEBHOOK_SECRET` in your `.env`
4. Create a checkout session via `POST /payments/create-checkout-session/:bookId` (requires login)
5. Open the returned URL in a browser and complete payment using Stripe's test card: `4242 4242 4242 4242`, any future expiry, any CVC

## API Reference

| Method | Endpoint             | Auth Required | Description                              |
|--------|----------------------|----------------|-------------------------------------------|
| POST   | `/register`          | No             | Create a new user account                 |
| POST   | `/login`             | No             | Log in (sets an `httpOnly` cookie)         |
| POST   | `/logout`            | No             | Log out (Clear the token cookie) |
| POST   | `/forgot_password`   | No             | Request a password reset email            |
| POST   | `/reset_password`    | No             | Reset password using a valid token        |
| GET    | `/book`              | No             | List books (supports `search`, `type`, `page`) |
| GET    | `/book/:id`          | No             | Get a single book                         |
| POST   | `/book`              | Yes            | Create a book                             |
| PUT    | `/book/:id`          | Yes (owner)    | Update a book                             |
| DELETE | `/book/:id`          | Yes (owner)    | Delete a book                             |
| GET    | `/reviews?book_id=`  | No             | Get reviews for a book                    |
| POST   | `/reviews`           | Yes            | Post a review                             |
| PUT    | `/reviews/:id`       | Yes (owner)    | Edit your own review                      |
| DELETE | `/reviews/:id`       | Yes (owner)    | Delete your own review                    |
| GET    | `/health`            | No             | Check server/DB/Redis status              |
| POST   | `/payments/create-checkout-session/:bookId` | Yes | Create a stripe checout session for a priced book |
| POST   | `/payments/webhooks/stripe` | No (stripe-signed)  | Stripe webhooks - confirms and records completed payments | 
| GET    | `/payments/purchases/:bookId` | Yes               | Checks whether the current book user owns the book |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Yes | PostgreSQL connection details |
| `JWT_SECRET` | Yes | Long random string used to sign tokens |
| `PORT`       | No  | Defaults to 6780 if omitted
| `REDIS_PORT` | No | Defaults to 6379 if omitted |
| `EMAIL_USER`, `EMAIL_PASS` | Yes (for password reset) | Gmail credentials for Nodemailer |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of frontend URLs allowed via CORS |
| `NODE_ENV` | Yes | `development` or `production` — controls cookie security behavior |
| `STRIPE_SECRET_KEY` | Yes (for payments) | Your Stripe secret key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Yes (for payments) | Webhook signing secret from Stripe dashboard or `stripe listen` |
| `FRONTEND_URL` | Yes (for payments) | Used for Stripe checkout success/cancel redirect URLs |

## Limitations

- No file upload support
- Reviews cannot support images
- No refresh token flow

## Notes

This repository is a demonstration/portfolio project showcasing backend architecture, 
authentication, and security practices. The sample data (books, reviews, users) exists 
for demo purposes only.

The codebase itself — auth, validation, rate limiting, caching — is written to 
production-quality standards and is intended to serve as a boilerplate for real 
client projects. Deploying THIS exact repository as-is (with placeholder data and 
`localhost` configuration) is not recommended without adapting it to your specific 
use case (database, domain, environment variables, etc).