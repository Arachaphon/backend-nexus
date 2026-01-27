DROP TABLE IF EXISTS apartments;
DROP TABLE IF EXISTS water_rate_templates;
DROP TABLE IF EXISTS electric_rate_templates;
DROP TABLE IF EXISTS rooms;
CREATE TABLE dormitories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    tax_id TEXT,
    due_date INTEGER NOT NULL CHECK (due_date >= 1 AND due_date <= 31),
    fine_per_day REAL NOT NULL, -- ใช้ REAL แทน numeric
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES profiles(id)
);

CREATE INDEX idx_dormitories_owner ON dormitories(owner_id);

CREATE TABLE water_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id)
);

CREATE TABLE electric_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id)
);

CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'vacant',
    current_rent_price REAL NOT NULL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id)
);