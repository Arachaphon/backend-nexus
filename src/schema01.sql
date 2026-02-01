DROP TABLE IF EXISTS dormitories;
CREATE TABLE IF NOT EXISTS dormitories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    tax_id TEXT,
    due_date INTEGER NOT NULL CHECK (due_date >= 1 AND due_date <= 31),
    fine_per_day REAL NOT NULL,
    payment_note TEXT, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES profiles(id)
);