-- 1. Profiles 
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Apartments
CREATE TABLE apartments (
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

-- 3. Water Rate Templates
CREATE TABLE water_rate_templates (
    id TEXT PRIMARY KEY,
    apartment_id TEXT NOT NULL,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id)
);

-- 4. Electric Rate Templates
CREATE TABLE electric_rate_templates (
    id TEXT PRIMARY KEY,
    apartment_id TEXT NOT NULL,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id)
);

-- 5. Rooms
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    apartment_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'vacant',
    current_rent_price REAL NOT NULL,
    FOREIGN KEY (apartment_id) REFERENCES apartments(id)
);

-- 6. Tenants
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    current_room_id TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    phone_number TEXT,
    id_card_or_passport TEXT,
    check_in_date DATE NOT NULL,
    check_out_date DATE,
    security_deposit REAL,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    note TEXT,
    FOREIGN KEY (current_room_id) REFERENCES rooms(id)
);

-- 7. Meter Readings
CREATE TABLE meter_readings (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    reading_date DATE NOT NULL,
    water_unit_current REAL NOT NULL,
    electric_unit_current REAL NOT NULL,
    water_unit_previous REAL,
    electric_unit_previous REAL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- 8. Bills
CREATE TABLE bills (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    bill_date DATE NOT NULL,
    water_template_id TEXT NOT NULL,
    electric_template_id TEXT NOT NULL,
    rent_price REAL NOT NULL,
    water_usage_units REAL NOT NULL,
    electric_usage_units REAL NOT NULL,
    water_charge REAL NOT NULL,
    electric_charge REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (water_template_id) REFERENCES water_rate_templates(id),
    FOREIGN KEY (electric_template_id) REFERENCES electric_rate_templates(id)
);