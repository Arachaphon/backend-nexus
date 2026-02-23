-- 1. Profiles 
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Dormitories
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
    FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- 3. Water Rate Templates
CREATE TABLE water_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL UNIQUE,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id) ON DELETE CASCADE
);

-- 4. Electric Rate Templates
CREATE TABLE electric_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL UNIQUE,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    floor_number INTEGER NOT NULL,
    room_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id) ON DELETE CASCADE
);

-- 5. Rooms
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    floor_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- status: สถานะการเช่า (vacant = ว่าง, occupied = มีคนเช่า, maintenance = ซ่อมแซม)
    status TEXT NOT NULL DEFAULT 'vacant',
    current_rent_price REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
);

-- 6. Tenants 
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    id_card_or_passport TEXT NOT NULL,
    address TEXT,                               
    emergency_contact_name TEXT,
    emergency_contact_relation TEXT,            
    emergency_contact_phone TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Contracts (Step 1: สัญญา)
CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE,
    rent_price REAL NOT NULL DEFAULT 0,
    security_deposit REAL NOT NULL DEFAULT 0,
    security_deposit_type TEXT NOT NULL
        CHECK (security_deposit_type IN ('เงินสด', 'โอนเงินธนาคาร')),
    booking_fee REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id)  -- ✅ ไม่มี comma ท้าย
);

CREATE TABLE IF NOT EXISTS contract_tenants (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,  -- 1 = ผู้เช่าหลัก, 0 = ผู้เช่าร่วม
    UNIQUE (contract_id, tenant_id),        -- ป้องกันซ้ำ
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 8. Advance Rent Payments (Step 2: ค่าเช่าล่วงหน้า)
CREATE TABLE IF NOT EXISTS advance_rent_payments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    billing_month TEXT NOT NULL,  
    description TEXT NOT NULL ,
    amount REAL NOT NULL DEFAULT 0,
    payment_type TEXT NOT NULL
        CHECK (payment_type IN ('เงินสด', 'โอนเงินธนาคาร')),
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);



-- 9. Meter Readings (Step 3: เลขมิเตอร์วันเข้าพัก + บิลรายเดือน)
CREATE TABLE IF NOT EXISTS meter_readings (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    contract_id TEXT,                               -- อ้างอิงสัญญา (NULL ถ้าเป็นการอ่านรายเดือนทั่วไป)
    reading_type TEXT NOT NULL DEFAULT 'monthly'    -- 'check_in' | 'monthly'
        CHECK (reading_type IN ('check_in', 'monthly')),
    reading_date DATE NOT NULL,
    water_unit_current REAL NOT NULL DEFAULT 0,
    electric_unit_current REAL NOT NULL DEFAULT 0,
    water_unit_previous REAL,
    electric_unit_previous REAL,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL
);

-- 10. Bills (ใบแจ้งหนี้รายเดือน)
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    contract_id TEXT,
    bill_date DATE NOT NULL,
    water_template_id TEXT NOT NULL,
    electric_template_id TEXT NOT NULL,
    rent_price REAL NOT NULL,
    water_usage_units REAL NOT NULL,
    electric_usage_units REAL NOT NULL,
    water_charge REAL NOT NULL,
    electric_charge REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'paid' | 'overdue'
        CHECK (payment_status IN ('pending', 'paid', 'overdue')),
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL,
    FOREIGN KEY (water_template_id) REFERENCES water_rate_templates(id),
    FOREIGN KEY (electric_template_id) REFERENCES electric_rate_templates(id)
);

-- 9. Bank Accounts
CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    bank_name TEXT NOT NULL,       -- เช่น 'กสิกรไทย', 'พร้อมเพย์'
    bank_logo TEXT,                -- เก็บ path เช่น '/kbank.png'
    account_number TEXT NOT NULL,  -- ใช้ TEXT เพราะอาจมีขีด หรือเป็นเบอร์พร้อมเพย์ที่มีเลข 0 นำหน้า
    account_name TEXT NOT NULL,    -- ชื่อเจ้าของบัญชี
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contracts_room_id ON contracts(room_id);
CREATE INDEX IF NOT EXISTS idx_contract_tenants_contract_id ON contract_tenants(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_tenants_tenant_id ON contract_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_advance_rent_contract_id ON advance_rent_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_meter_readings_room_id ON meter_readings(room_id);
CREATE INDEX IF NOT EXISTS idx_bills_room_id ON bills(room_id);
CREATE INDEX IF NOT EXISTS idx_bills_contract_id ON bills(contract_id);

/*
NO ACTION	ห้ามลบ parent ถ้ายังมี child
SET NULL	ลบ parent → child กลายเป็น NULL
CASCADE	ลบ parent → child ถูกลบตาม
DROP TABLE table_name;
*/