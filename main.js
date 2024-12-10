
// Import dependencies
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const session = require('express-session');


// Initialize Express app
const app = express();
const port = 3000;

// Start server
app.listen(port, '108.174.198.186', () => {
  console.log('Server is running on http://108.174.198.186:' + port);
});

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse JSON and form submissions
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// Database connection configuration
const pool = new Pool({
  user: 'main',
  host: 'localhost',
  database: 'recipe',
  password: 'password',
  port: 5432,
});

// keep track of user sign in
app.use(session({
   secret: 'yourkeyhere',
   resave: false,
   cookie: {secure:false},
  saveUninitialized: true}));


// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Connected to the database:', res.rows[0]);
  }
});

// home route
app.get('/', async (req, res) => {
  const searchQuery = req.query.search || '';
  const filter = req.query.filter || 'title'; 


  console.log(`GET / - Searching for recipes with "${searchQuery}" filtered by "${filter}"...`);

  try {
    let query;

    if (filter === 'average_rating') {
      // Special case for filtering by average rating
      query = `
        SELECT 
          recipe_id, 
          title, 
          ingredients, 
          instructions, 
          user_id, 
          total_ratings, 
          number_of_ratings, 
          CASE 
            WHEN number_of_ratings = 0 THEN 0
            ELSE total_ratings::float / number_of_ratings
          END AS average_rating
        FROM recipes
        WHERE 
          CASE 
            WHEN number_of_ratings = 0 THEN 0
            ELSE total_ratings::float / number_of_ratings
          END::TEXT ILIKE $1
        ORDER BY average_rating DESC
      `;
    } else {
      // General case for filtering by text-based fields
      query = `
        SELECT 
          recipe_id, 
          title, 
          ingredients, 
          instructions, 
          user_id, 
          total_ratings, 
          number_of_ratings, 
          CASE 
            WHEN number_of_ratings = 0 THEN 0
            ELSE total_ratings::float / number_of_ratings
          END AS average_rating
        FROM recipes
        WHERE ${filter} ILIKE $1
        ORDER BY average_rating DESC
      `;
    }

    // Execute query with the search query
    const result = await pool.query(query, [`%${searchQuery}%`]);

    // Render the recipes page and pass data to the template
    res.render('recipes', {
      recipes: result.rows, 
      user: req.session && req.session.user ? req.session.user : null, 
      searchQuery, 
      filter, 
    });
  } catch (err) {
    console.error('Error fetching recipes:', err.stack);
    res.status(500).send('Error fetching recipes');
  }
});


// recipe submission route
app.get('/recipe_submission', (req, res) => {
  if (req.session && req.session.user)
  {
     console.log('GET /recipe_submission - Rendering recipe submission page...');
     res.render('recipe_submission', {user:req.session.user});
  }
  else
  {
     console.log('DUDE IT DID NOT WORK BRO WHAT THE HELL?!?!');
     res.redirect('/sign_in');
}
});

app.post('/recipe/create', async (req, res) => {
  const { title, ingredients, instructions } = req.body;

  // Fetch user_id from session
  const userId = req.session.user && req.session.user.user_id;
  if (!userId) {
    return res.status(401).send('User not authenticated. Please sign in.');
  }

  console.log(`POST /recipe/create - Received data: Title = ${title}, Ingredients = ${ingredients}, Instructions = ${instructions}`);

  try {
    const result = await pool.query(
      'INSERT INTO recipes (title, ingredients, instructions, user_id) VALUES ($1, $2, $3, $4)',
      [title, ingredients, instructions, userId]
    );
    console.log('Recipe created:', result.rowCount);
    res.redirect('/');
  } catch (err) {
    console.error('Error creating recipe:', err.stack);
    res.status(500).send('Error creating recipe');
  }
});

app.post('/recipe/rate/:id', async (req, res) => {
  const recipeId = req.params.id;
  const { rating } = req.body;

  if (rating < 1 || rating > 5) {
    return res.status(400).send('Invalid rating value.');
  }

  try {
    // Update the total_ratings and number_of_ratings
    await pool.query(
      `UPDATE recipes
       SET total_ratings = total_ratings + $1,
           number_of_ratings = number_of_ratings + 1
       WHERE recipe_id = $2`,
      [rating, recipeId]
    );

    console.log(`Recipe ${recipeId} updated with new rating: ${rating}`);
    res.redirect('/');
  } catch (err) {
    console.error('Error updating recipe rating:', err.stack);
    res.status(500).send('Error updating recipe rating.');
  }
});

// display comments route

app.get('/recipe/comments/:id', async (req, res) => {
  const recipeId = req.params.id;

  try {
    // Fetch the comments for the recipe
    const commentsResult = await pool.query(
      `SELECT c.content AS comment, c.created_at, u.username
       FROM comments c
       JOIN users u ON c.user_id = u.user_id
       WHERE c.recipe_id = $1
       ORDER BY c.created_at DESC`,
      [recipeId]
    );

    // Render the comments page
    res.render('comments', {
      comments: commentsResult.rows, 
      user: req.session.user, 
      recipeId, 
    });
  } catch (err) {
    console.error('Error fetching comments:', err.stack);
    res.status(500).send('Error loading comments page');
  }
});

app.post('/recipe/comments/:id', async (req, res) => {
  const recipeId = req.params.id;
  const { comment } = req.body;

  if (!req.session.user) {
    return res.redirect('/sign_in');
  }

  try {
    await pool.query(
      'INSERT INTO comments (recipe_id, user_id, content) VALUES ($1, $2, $3)',
      [recipeId, req.session.user.user_id, comment]
    );
    console.log(`Comment added to recipe ${recipeId} by user ${req.session.user.username}`);
    res.redirect(`/recipe/comments/${recipeId}`);
  } catch (err) {
    console.error('Error adding comment:', err.stack);
    res.status(500).send('Error adding comment');
  }
});


// Sign-Up Routes
app.get('/sign_up', (req, res) => {
  console.log('GET /sign_up - Rendering sign-up page...');
  res.render('sign_up');
});


app.post('/sign_up', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Received: Username = ${username}, Password = ${password}`);

    try {
        // Check if the username already exists
        const userExists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        console.log('User exists check result:', userExists.rows);

        if (userExists.rows.length > 0) {
            console.log(`Username "${username}" already exists.`);
            return res.status(400).send('Username already exists. Please choose a different username.');
        }

        // Insert the new user into the database
        const insertResult = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *',
            [username, password]
        );
        console.log('User inserted successfully:', insertResult.rows);

        res.redirect('/sign_in');
    } catch (err) {
        console.error('Sign-Up Error:', err.message);
        console.error('Stack Trace:', err.stack);
        res.status(500).send('Error signing up.');
    }
});

// Sign-In Routes
app.get('/sign_in', (req, res) => {
  console.log('GET /sign_in - Rendering sign-in page...');
  res.render('sign_in');
   
});

app.post('/sign_in', async (req, res) => {
    const { username, password } = req.body;
    console.log(`POST /sign_in - Attempting to sign in: Username = ${username}, Password = ${password}`);

    try {
        // Check if the username and password match
        const user = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND password = $2',
            [username, password]
        );
        console.log('Sign-In Query Result:', user.rows);

        if (user.rows.length === 0) {
            console.log(`Sign-In Error: Invalid credentials for username "${username}".`);
            return res.render('sign_in', { error: 'Invalid username or password.' }); 
        }

        // Save user info in session
        req.session.user = user.rows[0];
        console.log(`Sign-In Success: User "${username}" logged in.`);
        res.redirect('/');
    } catch (err) {
        console.error('Sign-In Error:', err.message);
        console.error('Stack Trace:', err.stack);
        res.status(500).render('sign_in', { error: 'An unexpected error occurred. Please try again.' });
    }
});

// Search route
app.get('/search', async (req, res) => {
  const query = req.query.query || '';
  console.log(`GET /search - Searching for recipes with query: "${query}"`);
  try {
    const result = await pool.query(
      'SELECT * FROM recipes WHERE title ILIKE $1 OR ingredients ILIKE $1',
      [`%${query}%`]
    );
    console.log('Search results:', result.rows);
    res.render('search', { recipes: result.rows });
  } catch (err) {
    console.error('Error searching recipes:', err.stack);
    res.status(500).send('Error searching recipes');
  }
});


// Route for 
