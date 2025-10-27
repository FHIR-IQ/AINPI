# Authentication System

The ProviderCard v2 web application includes a simple authentication system with a demo account for easy testing and demonstrations.

## Demo Account Credentials

**Email**: `demo@demo.com`
**Password**: `demo`

## Quick Start

1. **Start the application**:
   ```bash
   npm run dev
   ```

2. **Access the login page**:
   - Navigate to `http://localhost:3000`
   - You'll be automatically redirected to `/login` if not authenticated

3. **Login with demo account**:
   - Enter email: `demo@demo.com`
   - Enter password: `demo`
   - Or click "Use Demo Account" button to auto-fill

4. **Access protected pages**:
   - After login, you'll be redirected to the Dashboard
   - All pages except `/login` require authentication

## Features

### Login Page (`/login`)
- Clean, modern login interface
- Email and password fields with validation
- "Use Demo Account" button for quick access
- Loading states during authentication
- Error messages for failed login attempts

### Protected Routes
All routes except `/login` are protected and require authentication:
- `/` - Home (redirects to dashboard if authenticated)
- `/dashboard` - System dashboard with sync status
- `/providers/new` - Create new provider profile

### Session Management
- **Storage**: Authentication token and user data stored in `localStorage`
- **Persistence**: Sessions persist across page refreshes
- **Auto-redirect**: Unauthenticated users automatically redirected to login

### Navigation Bar
- Displays user name and email when authenticated
- "Logout" button to end session
- Only visible on authenticated pages (hidden on login page)

## API Endpoints

### POST `/api/auth/login`

Authenticate user with credentials.

**Request**:
```json
{
  "email": "demo@demo.com",
  "password": "demo"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "token": "base64-encoded-token",
  "user": {
    "id": "user-demo-001",
    "email": "demo@demo.com",
    "name": "Demo User",
    "role": "admin"
  }
}
```

**Response** (401 Unauthorized):
```json
{
  "success": false,
  "message": "Invalid email or password"
}
```

### POST `/api/auth/logout`

End user session.

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## File Structure

```
web-app/
├── app/
│   ├── login/
│   │   └── page.tsx                 # Login page component
│   ├── layout-client.tsx            # Client-side layout with auth
│   └── api/
│       └── auth/
│           ├── login/
│           │   └── route.ts         # Login API endpoint
│           └── logout/
│               └── route.ts         # Logout API endpoint
├── components/
│   └── ProtectedRoute.tsx           # Route protection wrapper
└── lib/
    └── auth-context.tsx             # Auth context (optional)
```

## Implementation Details

### Authentication Flow

1. **User visits app** → Redirected to `/login` if not authenticated
2. **User submits credentials** → POST to `/api/auth/login`
3. **Server validates** → Returns token and user data
4. **Client stores token** → Saves to `localStorage`
5. **User redirected** → Sent to `/dashboard`
6. **Protected routes** → Check for token on mount

### Logout Flow

1. **User clicks Logout** → POST to `/api/auth/logout`
2. **Client clears storage** → Removes token and user data
3. **User redirected** → Sent back to `/login`

### Route Protection

The `ProtectedRoute` component wraps all pages and:
- Checks for `auth_token` in `localStorage`
- Redirects to `/login` if no token found
- Shows loading spinner during check
- Allows rendering once authenticated

### Security Notes

⚠️ **This is a demo authentication system**. For production use:

1. **Use proper authentication**:
   - Implement JWT with proper signing
   - Use secure, httpOnly cookies instead of localStorage
   - Add refresh token mechanism

2. **Add server-side validation**:
   - Validate tokens on every API request
   - Implement middleware for route protection
   - Use database to track sessions

3. **Enhance security**:
   - Hash passwords with bcrypt/argon2
   - Add rate limiting to login endpoint
   - Implement CSRF protection
   - Add 2FA/MFA support

4. **Production database**:
   - Store user credentials in database
   - Support multiple user accounts
   - Track login history and sessions

## Customization

### Adding More Users

Edit `/app/api/auth/login/route.ts`:

```typescript
const USERS = [
  {
    email: 'demo@demo.com',
    password: 'demo',
    user: { id: 'user-001', name: 'Demo User', role: 'admin' }
  },
  {
    email: 'admin@example.com',
    password: 'admin123',
    user: { id: 'user-002', name: 'Admin User', role: 'admin' }
  },
];
```

### Changing Demo Credentials

Edit the `DEMO_USER` constant in `/app/api/auth/login/route.ts`:

```typescript
const DEMO_USER = {
  email: 'your-email@example.com',
  password: 'your-password',
  user: {
    id: 'user-demo-001',
    email: 'your-email@example.com',
    name: 'Your Name',
    role: 'admin',
  },
};
```

### Customizing Login UI

The login page is located at `/app/login/page.tsx`. You can customize:
- Colors and styling (Tailwind classes)
- Logo and branding
- Form fields
- Error messages
- Loading states

## Testing

### Manual Testing

1. **Test successful login**:
   ```
   Email: demo@demo.com
   Password: demo
   Expected: Redirect to dashboard
   ```

2. **Test invalid credentials**:
   ```
   Email: wrong@example.com
   Password: wrong
   Expected: Error message displayed
   ```

3. **Test route protection**:
   ```
   1. Logout
   2. Try to access /dashboard directly
   Expected: Redirect to /login
   ```

4. **Test session persistence**:
   ```
   1. Login
   2. Refresh page
   Expected: Still authenticated
   ```

5. **Test logout**:
   ```
   1. Login
   2. Click Logout
   Expected: Redirect to /login, can't access protected pages
   ```

## Demo Script Integration

For the 3-minute demo presentation, the authentication is seamless:

1. **Pre-demo setup** (30 seconds before):
   - Have browser open to `/login`
   - Demo credentials visible on screen

2. **Start demo** (0:00):
   - Click "Use Demo Account" button
   - Automatically redirected to Dashboard

3. **Continue demo** (0:15-3:00):
   - Proceed with provider profile workflow
   - No need to mention authentication again

## Troubleshooting

### "Cannot access localStorage" error
- **Cause**: Trying to access localStorage during SSR
- **Fix**: Only access localStorage in `useEffect` or client components

### Infinite redirect loop
- **Cause**: Protection logic conflict between multiple components
- **Fix**: Ensure only one component handles redirects

### Login doesn't persist after refresh
- **Cause**: localStorage not properly set or cleared
- **Fix**: Check browser console for errors, verify token is saved

### Can't logout
- **Cause**: Logout handler not properly clearing storage
- **Fix**: Verify both `auth_token` and `user` are removed from localStorage

## Support

For authentication-related issues:
1. Check browser console for errors
2. Verify `auth_token` exists in localStorage (DevTools → Application → Local Storage)
3. Test with demo account first
4. Review [main README](README.md) for general setup issues
