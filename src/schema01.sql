--DROP TABLE IF EXISTS dormitories;
-- เพิ่มตาราง Floors เพื่อเก็บโครงสร้างอาคาร
CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY,
    dormitories_id TEXT NOT NULL,
    floor_number INTEGER NOT NULL,
    room_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dormitories_id) REFERENCES dormitories(id) ON DELETE CASCADE
);

-- ปรับปรุงตาราง Rooms (เพิ่ม floor_id เพื่อระบุว่าห้องอยู่ชั้นไหน)
-- หมายเหตุ: กรณีสร้างใหม่ให้เพิ่ม floor_id TEXT
ALTER TABLE rooms ADD COLUMN floor_id TEXT REFERENCES floors(id);