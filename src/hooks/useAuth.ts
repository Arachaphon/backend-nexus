import { Hono } from 'hono'

export function useAuth() {
    const raw = localStorage.getItem('user')
    const user = raw ? JSON.parse(raw) : null

    return {
        user,
        isOwner: user?.role === 'owner',
        isManager: user?.role === 'manager',
        isLoggedIn: !!user,
    }
}


// // ใช้ใน component
// const { isOwner } = useAuth()

// return (
//     <div>
//         {/* ทุกคนเห็น */}
//         <RoomList />

//         {/* owner เท่านั้น */}
//         {isOwner && <BillingButton />}
//         {isOwner && <SettingsButton />}
//     </div>
// )

