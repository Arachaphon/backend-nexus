DROP TABLE IF EXISTS rooms;
--ALTER TABLE rooms ADD COLUMN floor_id TEXT REFERENCES floors(id);

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