-- 3. Water Rate Templates
CREATE TABLE water_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL UNIQUE,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id)
);

-- 4. Electric Rate Templates
CREATE TABLE electric_rate_templates (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL UNIQUE,
    charge_type TEXT NOT NULL,
    price_per_unit REAL,
    minimum_charge REAL,
    flat_rate REAL,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id)
);