const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { Parser } = require('json2csv');


function ensureAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
}


const app = express();
dotenv.config();

// EJS + Static + Body Parser Middleware (must be before routes!)
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); // ✅ Fix for req.body undefined

// Sessions
app.use(session({
  secret: 'yourSecretKeyHere',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
}));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB connection error:", err));

// Models
const Expense = require('./models/Expense'); // Should be declared before using
const authRoutes = require('./routes/auth');

// Routes
app.use(authRoutes); // ✅ Use after middleware!

// Pages
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/add-expense', ensureAuth, (req, res) => {
  res.render('add-expense');
});

app.post('/add-expense', ensureAuth, async (req, res) => {
  const { title, amount, category, date } = req.body;

  try {
    const newExpense = new Expense({
      title,
      amount,
      category,
      date: date || undefined,
      user: req.session.userId // ✅ Assign current user
    });
    await newExpense.save();
    res.send('<h2>Expense added successfully!</h2><a href="/add-expense">Add Another</a>');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

const User = require('./models/User'); // At the top if not already

app.get('/dashboard', ensureAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const { category, from, to, search, sort } = req.query;

    const query = { user: req.session.userId };

    // Category filter
    if (category && category !== 'All') {
      query.category = category;
    }

    // Date range filter
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }

    // Search filter (on title or category)
    if (search) {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { category: new RegExp(search, 'i') }
      ];
    }

    // Sorting
    let sortOption = { date: -1 }; // Default: newest first
    if (sort === 'date_asc') sortOption = { date: 1 };
    if (sort === 'amount_asc') sortOption = { amount: 1 };
    if (sort === 'amount_desc') sortOption = { amount: -1 };

    const allExpenses = await Expense.find(query).sort(sortOption);

    // Budget + chart logic (same as before)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthlyExpenses = allExpenses.filter(exp => {
      const expDate = new Date(exp.date);
      return expDate >= startOfMonth && expDate <= endOfMonth;
    });
    const totalThisMonth = monthlyExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const categoryTotals = {};
    allExpenses.forEach(exp => {
      categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amount;
    });

    res.render('dashboard', {
      expenses: allExpenses,
      totalThisMonth,
      budgetLimit: user.budget || 0,
      categoryTotals,
      userEmail: user.email,
      category,
      from,
      to,
      search,
      sort
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load dashboard.');
  }
});




app.get('/delete-expense/:id', ensureAuth, async (req, res) => {
  try {
    const expenseId = req.params.id;
    await Expense.findByIdAndDelete(expenseId);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting expense');
  }
});

app.get('/edit-expense/:id', ensureAuth, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    res.render('edit-expense', { expense });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading expense for edit.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error(err);
    res.redirect('/login');
  });
});

app.get('/download-csv',  async (req, res) => {
  try {
    const userId = req.session.userId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const expenses = await Expense.find({
      user: userId,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    });

    const fields = ['title', 'amount', 'category', 'date'];
    const parser = new Parser({ fields });
    const csv = parser.parse(expenses);

    res.header('Content-Type', 'text/csv');
    res.attachment('monthly-expenses.csv');
    return res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating CSV');
  }
});


app.post('/edit-expense/:id', ensureAuth, async (req, res) => {
  const { title, amount, category, date } = req.body;

  try {
    await Expense.findByIdAndUpdate(req.params.id, {
      title,
      amount,
      category,
      date
    });
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating expense');
  }
});


app.post('/update-budget', ensureAuth, async (req, res) => {
  const { budget } = req.body;

  try {
    await User.findByIdAndUpdate(req.session.userId, { budget });
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update budget.');
  }
});


// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
