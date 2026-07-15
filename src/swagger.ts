import swaggerJsdoc from 'swagger-jsdoc';

const isProduction = process.env.NODE_ENV === 'production';
const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Book Boilerplate API',
            version: '1.0.0',
            description: 'Books, reviews, and users',
        },
        servers: [{ url: 'http://localhost:6780' }],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'token'
                }
            }
        }
    },
    // Updated path to scan your new TypeScript files inside the src folder
    apis: isProduction
        ? ['./dist/routes/*.js']
        : ['./routes/*.ts'],
};

export default swaggerJsdoc(options);