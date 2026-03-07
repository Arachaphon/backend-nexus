//ฟังก์ชันเข้ารหัสและตรวจสอบรหัส


export async function hashPassword(password: string): Promise<string> {
//สร้าง salt
  const salt = crypto.randomUUID(); 
//text -> bytes(เลขแทนตัวอักษร)
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hashHex}`; 
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, originalHash] = stored.split(':');
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === originalHash;
}