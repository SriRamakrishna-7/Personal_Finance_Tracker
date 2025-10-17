let db = null;
let transactions = [];
let pieChart = null;

// Format currency to Indian Rupees
function formatCurrency(amount) {
    return '₹' + parseFloat(amount).toFixed(2);
}

// Initialize SQL.js database
async function initDatabase() {
    try {
        // Initialize SQL.js
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        
        // Create new database
        db = new SQL.Database();
        
        console.log("SQL.js database initialized successfully");
        
        // Create tables
        db.run(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )
        `);
        
        db.run(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
                category TEXT NOT NULL,
                amount REAL NOT NULL CHECK(amount >= 0),
                description TEXT DEFAULT '-',
                date TEXT DEFAULT (date('now'))
            )
        `);
        
        // Insert default categories
        const categories = ['Salary', 'Food', 'Transport', 'Rent', 'Entertainment', 'Other'];
        const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
        
        categories.forEach(category => {
            insertCategory.run([category]);
        });
        insertCategory.free();
        
        // Load existing data
        await loadCategories();
        await loadTransactions();
        await loadSummary();
        updateStatistics();
        
        showPopup('Database initialized successfully!', '#2ecc71');
        
    } catch (error) {
        console.error('Error initializing database:', error);
        showPopup('Error initializing database', '#e74c3c');
    }
}

// Load categories from database
function loadCategories() {
    try {
        const result = db.exec('SELECT name FROM categories ORDER BY name');
        if (result.length > 0) {
            const categories = result[0].values.map(row => row[0]);
            const select = document.getElementById('category');
            const filterCategory = document.getElementById('filterCategory');
            
            select.innerHTML = '<option value="">Select Category</option>';
            filterCategory.innerHTML = '<option value="">All Categories</option>';
            
            categories.forEach(category => {
                select.innerHTML += `<option value="${category}">${category}</option>`;
                filterCategory.innerHTML += `<option value="${category}">${category}</option>`;
            });
        }
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Add transaction to database
function addTransaction() {
    const type = document.getElementById('type').value;
    const category = document.getElementById('category').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const description = document.getElementById('description').value || '-';
    const date = document.getElementById('date').value || new Date().toISOString().split('T')[0];

    if (!type || !category || !amount || amount <= 0) {
        showPopup('Please fill all fields with valid values', '#e74c3c');
        return;
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO transactions (type, category, amount, description, date) 
            VALUES (?, ?, ?, ?, ?)
        `);
        
        stmt.run([type, category, amount, description, date]);
        stmt.free();
        
        // Clear form
        document.getElementById('amount').value = '';
        document.getElementById('description').value = '';
        document.getElementById('date').value = '';
        
        // Refresh data
        loadTransactions();
        loadSummary();
        updateStatistics();
        showPopup('Transaction added successfully!', '#2ecc71');
        
    } catch (error) {
        console.error('Error adding transaction:', error);
        showPopup('Error adding transaction: ' + error.message, '#e74c3c');
    }
}

// Quick add transaction
function quickAddTransaction(type, category, amount) {
    document.getElementById('type').value = type;
    document.getElementById('category').value = category;
    document.getElementById('amount').value = amount;
    document.getElementById('description').value = `Quick ${type}: ${category}`;
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    
    showPopup(`Quick ${type} form filled!`, '#3498db', 2000);
}

// Load transactions from database
function loadTransactions(filters = {}) {
    try {
        let query = `
            SELECT id, type, category, amount, description, date 
            FROM transactions 
            WHERE 1=1
        `;
        const params = [];
        
        if (filters.type) {
            query += ' AND type = ?';
            params.push(filters.type);
        }
        
        if (filters.category) {
            query += ' AND category = ?';
            params.push(filters.category);
        }
        
        if (filters.dateFrom) {
            query += ' AND date >= ?';
            params.push(filters.dateFrom);
        }
        
        if (filters.dateTo) {
            query += ' AND date <= ?';
            params.push(filters.dateTo);
        }
        
        query += ' ORDER BY date DESC, id DESC';
        
        const result = db.exec(query, params);
        transactions = [];
        
        const tbody = document.querySelector('#transactionsTable tbody');
        tbody.innerHTML = '';
        
        if (result.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: #666;">No transactions found</td></tr>';
            drawChart();
            return;
        }
        
        result[0].values.forEach(row => {
            const [id, type, category, amount, description, date] = row;
            const transaction = { id, type, category, amount, description, date };
            transactions.push(transaction);
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${id}</td>
                <td><span class="tag ${type}">${type}</span></td>
                <td>${category}</td>
                <td>${formatCurrency(amount)}</td>
                <td>${description}</td>
                <td>${date}</td>
                <td>
                    <button class="delete-btn" onclick="deleteTx(${id})">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        drawChart();
        updateStatistics();
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        showPopup('Error loading transactions', '#e74c3c');
    }
}

// Filter transactions
function filterTransactions() {
    const filters = {
        type: document.getElementById('filterType').value,
        category: document.getElementById('filterCategory').value,
        dateFrom: document.getElementById('filterDateFrom').value,
        dateTo: document.getElementById('filterDateTo').value
    };
    
    loadTransactions(filters);
}

// Clear filters
function clearFilters() {
    document.getElementById('filterType').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    loadTransactions();
}

// Load financial summary
function loadSummary() {
    try {
        // Get income total
        const incomeResult = db.exec('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = "income"');
        const income = incomeResult.length > 0 ? incomeResult[0].values[0][0] : 0;
        
        // Get expense total
        const expenseResult = db.exec('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = "expense"');
        const expense = expenseResult.length > 0 ? expenseResult[0].values[0][0] : 0;
        
        const balance = income - expense;
        
        document.getElementById('income').textContent = formatCurrency(income);
        document.getElementById('expense').textContent = formatCurrency(expense);
        document.getElementById('balance').textContent = formatCurrency(balance);
        
        // Update balance color
        const balanceElem = document.getElementById('balance');
        balanceElem.style.color = balance < 0 ? '#e74c3c' : '#2ecc71';
        
    } catch (error) {
        console.error('Error loading summary:', error);
    }
}

// Update statistics
function updateStatistics() {
    const totalTransactions = transactions.length;
    const today = new Date().toISOString().split('T')[0];
    const todayTransactions = transactions.filter(tx => tx.date === today).length;
    const averageAmount = transactions.length > 0 
        ? transactions.reduce((sum, tx) => sum + tx.amount, 0) / transactions.length 
        : 0;
    
    document.getElementById('totalTransactions').textContent = totalTransactions;
    document.getElementById('todayTransactions').textContent = todayTransactions;
    document.getElementById('averageAmount').textContent = formatCurrency(averageAmount);
}

// Delete transaction
function deleteTx(id) {
    if (!confirm("Are you sure you want to delete this transaction?")) return;
    
    try {
        const stmt = db.prepare('DELETE FROM transactions WHERE id = ?');
        stmt.run([id]);
        stmt.free();
        
        loadTransactions();
        loadSummary();
        updateStatistics();
        showPopup('Transaction deleted successfully!', '#2ecc71');
        
    } catch (error) {
        console.error('Error deleting transaction:', error);
        showPopup('Error deleting transaction', '#e74c3c');
    }
}

// Reset all data
function resetData() {
    if (!confirm("Are you sure you want to reset ALL data? This cannot be undone.")) return;
    
    try {
        db.run('DELETE FROM transactions');
        loadTransactions();
        loadSummary();
        updateStatistics();
        showPopup('All data reset successfully!', '#2ecc71');
        
    } catch (error) {
        console.error('Error resetting data:', error);
        showPopup('Error resetting data', '#e74c3c');
    }
}

// Export data to JSON
function exportData() {
    try {
        const result = db.exec('SELECT * FROM transactions');
        const transactions = result.length > 0 ? result[0].values.map(row => ({
            id: row[0],
            type: row[1],
            category: row[2],
            amount: row[3],
            description: row[4],
            date: row[5]
        })) : [];
        
        const dataStr = JSON.stringify(transactions, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'finance_data_' + new Date().toISOString().split('T')[0] + '.json';
        link.click();
        
        showPopup('Data exported successfully!', '#2ecc71');
        
    } catch (error) {
        console.error('Error exporting data:', error);
        showPopup('Error exporting data', '#e74c3c');
    }
}

// Import data from JSON
function importData(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const transactions = JSON.parse(e.target.result);
            
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare(`
                INSERT INTO transactions (type, category, amount, description, date) 
                VALUES (?, ?, ?, ?, ?)
            `);
            
            transactions.forEach(tx => {
                stmt.run([tx.type, tx.category, tx.amount, tx.description, tx.date]);
            });
            
            stmt.free();
            db.run('COMMIT');
            
            loadTransactions();
            loadSummary();
            updateStatistics();
            showPopup('Data imported successfully!', '#2ecc71');
            input.value = '';
            
        } catch (error) {
            console.error('Error importing data:', error);
            showPopup('Error importing data: ' + error.message, '#e74c3c');
            db.run('ROLLBACK');
        }
    };
    reader.readAsText(file);
}

// Draw chart
function drawChart() {
    const ctx = document.getElementById('pieChart').getContext('2d');
    const income = transactions.filter(t => t.type === 'income').reduce((a, b) => a + b.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((a, b) => a + b.amount, 0);

    if (pieChart) {
        pieChart.destroy();
    }

    if (income > 0 || expense > 0) {
        pieChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Income', 'Expense'],
                datasets: [{
                    data: [income, expense],
                    backgroundColor: ['#4caf50', '#f44336'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { 
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 14,
                                weight: 'bold'
                            },
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((value / total) * 100);
                                return `${label}: ₹${value.toFixed(2)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    } else {
        // Clear chart if no data
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = '16px Arial';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
    }
}

// Enhanced initialization with username and date
window.onload = async function() {
    checkLoginStatus();
    displayUserInfo();
    displayCurrentDate();
    
    // Set default date to today
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    document.getElementById('filterDateFrom').value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    document.getElementById('filterDateTo').value = new Date().toISOString().split('T')[0];
    
    await initDatabase();
};

// Display current user info
function displayUserInfo() {
    const username = localStorage.getItem("username") || "User";
    document.getElementById("username").textContent = username;
}

// Display current date in header
function displayCurrentDate() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    const dateString = now.toLocaleDateString('en-US', options);
    document.getElementById("currentDate").textContent = dateString;
}

// Enhanced popup with auto-hide
function showPopup(message, color, duration = 3000) {
    const popup = document.getElementById("popup");
    popup.innerHTML = message + '<span class="popup-close" onclick="this.parentElement.style.display=\'none\'">×</span>';
    popup.style.background = color;
    popup.style.display = "block";
    
    setTimeout(() => {
        if (popup.style.display !== 'none') {
            popup.style.display = 'none';
        }
    }, duration);
}

function checkLoginStatus() {
    if (localStorage.getItem("loggedIn") !== "true") {
        window.location.href = "login.html";
    }
}

function logout() {
    localStorage.removeItem("loggedIn");
    localStorage.removeItem("username");
    showPopup("✅ Logged out successfully!", "#2ecc71");
    setTimeout(() => window.location.href = "login.html", 1500);
}